const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { pipeline } = require('node:stream/promises');
const { Transform, Readable } = require('node:stream');
const { setTimeout: delay } = require('node:timers/promises');
const { SpeedMeter, ConnectionController } = require('./transfer-control.cjs');
const MIN_PART_BYTES = 512 * 1024;
const STREAM_BUFFER_BYTES = 256 * 1024;
const MAX_CONNECTIONS = 32;

function validateURL(value) {
  const u = new URL(String(value).trim());
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
    throw new Error('Use um link HTTP ou HTTPS, sem credenciais na URL.');
  if (u.href.length > 16384) throw new Error('Link muito longo.');
  return u.href;
}
function safeName(value) {
  let n = path.basename(String(value || '').replace(/\\/g, '/'))
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 170);
  if (!n || /^\.+$/.test(n)) n = 'download';
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(n)) n = '_' + n;
  return n;
}
function responseName(headers, url) {
  const cd = headers['content-disposition'] || '';
  const utf = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd);
  const simple = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(cd);
  try { if (utf) return safeName(decodeURIComponent(utf[1])); } catch {}
  if (simple) return safeName(simple[1] || simple[2]);
  try { return safeName(decodeURIComponent(new URL(url).pathname.split('/').pop())); }
  catch { return 'download'; }
}
function request(url, headers, signal, redirects = 0, agents) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new Error('Interrompido'));
    const u = new URL(validateURL(url));
    const req = (u.protocol === 'https:' ? https : http).get(u, {
      signal, agent: agents?.[u.protocol], highWaterMark: STREAM_BUFFER_BYTES,
      headers: { 'User-Agent': 'Vela/0.2', 'Accept-Encoding': 'identity', ...headers }
    }, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        res.destroy();
        if (redirects >= 8) return reject(new Error('Redirecionamentos demais.'));
        let next; try { next = validateURL(new URL(res.headers.location, u).href); }
        catch (e) { return reject(e); }
        if (u.protocol === 'https:' && next.startsWith('http:'))
          return reject(new Error('Redirecionamento HTTPS para HTTP recusado.'));
        return resolve(request(next, headers, signal, redirects + 1, agents));
      }
      resolve({ res, url: u.href });
    });
    req.setTimeout(30000, () => req.destroy(new Error('Servidor sem responder por 30 segundos.')));
    req.setNoDelay(true);
    req.on('error', reject);
  });
}
class DownloadEngine extends EventEmitter {
  constructor({ dataDir, downloadDir }) {
    super(); this.dataDir = dataDir; this.jobs = new Map(); this.closed = false;
    fs.mkdirSync(dataDir, {recursive:true});
    this.statePath = path.join(dataDir, 'state.json');
    let state; try { state = JSON.parse(fs.readFileSync(this.statePath, 'utf8')); } catch {}
    this.settings = {downloadDir, maxConcurrent:3, connections:0, ...state?.settings};
    // Upgrade the previous default profile once; later manual choices are retained.
    if (state && state.schemaVersion !== 2) this.settings.connections = 0;
    const agentOptions={keepAlive:true, maxSockets:256, maxTotalSockets:256, maxFreeSockets:32, scheduling:'lifo'};
    this.agents={'http:':new http.Agent(agentOptions),'https:':new https.Agent(agentOptions)};
    this.downloads = (Array.isArray(state?.downloads) ? state.downloads : []).map(d => ({
      ...d, status: ['queued','downloading'].includes(d.status) ? 'paused' : d.status, speed:0, instantSpeed:0
    }));
    this.timer = setInterval(() => this.emit('update'), 500);
    this.timer.unref();
    this.persistTimer = setInterval(() => this.save(), 3000);
    this.persistTimer.unref();
  }
  snapshot() {
    return {downloads:this.downloads.map(({segments,validator,rangeSupport,...d})=>({...d})), settings:{...this.settings}};
  }
  save() {
    const tmp = this.statePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({schemaVersion:2, settings:this.settings, downloads:this.downloads}, null, 2));
    fs.renameSync(tmp, this.statePath);
  }
  changed() { this.save(); this.emit('update'); }
  add({urls, filename} = {}) {
    if (!Array.isArray(urls) || !urls.length || urls.length > 100) throw new Error('Adicione entre 1 e 100 links.');
    const valid = urls.map(validateURL);
    for (const url of valid) {
      if (this.downloads.some(d=>d.url===url && ['downloading','queued'].includes(d.status))) continue;
      this.downloads.unshift({id:randomUUID(), url, filename:safeName(filename || responseName({},url)),
        customName:Boolean(filename), directory:this.settings.downloadDir, status:'queued', size:null,
        downloaded:0, speed:0, connections:1, createdAt:new Date().toISOString(), error:null, segments:null});
    }
    this.changed(); this.pump(); return this.snapshot();
  }
  configure(patch) {
    for (const [k,min,max] of [['maxConcurrent',1,8],['connections',0,MAX_CONNECTIONS]]) {
      if (patch[k] !== undefined) {
        if (!Number.isInteger(patch[k]) || patch[k]<min || patch[k]>max) throw new Error('Valor de configuração inválido.');
        this.settings[k] = patch[k];
      }
    }
    if (patch.downloadDir !== undefined) {
      if (!path.isAbsolute(patch.downloadDir)) throw new Error('Pasta inválida.');
      this.settings.downloadDir=patch.downloadDir;
    }
    this.changed(); this.pump(); return this.snapshot();
  }
  action({id,action}) {
    const d=this.downloads.find(d=>d.id===id);
    if (!d) throw new Error('Download não encontrado.');
    if (action==='pause' && ['queued','downloading'].includes(d.status)) {
      d.status='paused'; d.speed=0; this.jobs.get(id)?.abort();
    } else if (action==='resume' && ['paused','error','cancelled'].includes(d.status)) {
      d.status='queued'; d.error=null;
    } else if (action==='cancel' && d.status!=='completed') {
      d.status='cancelled'; d.speed=0; this.jobs.get(id)?.abort();
    } else if (action==='remove') {
      if (this.jobs.has(id)) throw new Error('Pause o download e aguarde um instante antes de removê-lo.');
      this.downloads=this.downloads.filter(x=>x.id!==id);
      fs.rmSync(path.join(this.dataDir,id), {recursive:true, force:true});
    }
    this.changed(); this.pump(); return this.snapshot();
  }
  pauseAll() {
    for (const d of this.downloads) if (['queued','downloading'].includes(d.status)) {
      d.status='paused'; d.speed=0; this.jobs.get(d.id)?.abort();
    }
    this.changed(); return this.snapshot();
  }
  resumeAll() {
    for (const d of this.downloads) if (d.status==='paused') d.status='queued';
    this.changed(); this.pump(); return this.snapshot();
  }
  pump() {
    if (this.closed) return;
    for (const d of this.downloads) {
      if (this.jobs.size>=this.settings.maxConcurrent) break;
      if (d.status!=='queued' || this.jobs.has(d.id)) continue;
      const controller=new AbortController(); this.jobs.set(d.id,controller);
      d.status='downloading'; d.error=null;
      this.run(d,controller.signal).catch(e=>{
        if (!controller.signal.aborted && d.status==='downloading') {d.status='error'; d.error=e.message;}
      }).finally(()=>{d.speed=0; d.instantSpeed=0; this.jobs.delete(d.id); this.changed(); this.pump();});
    }
    this.emit('update');
  }
  async run(d,signal) {
    const tmp=path.join(this.dataDir,d.id); await fsp.mkdir(tmp,{recursive:true});
    await fsp.mkdir(d.directory,{recursive:true});
    const probe=await request(d.url, {Range:'bytes=0-0'}, signal, 0, this.agents);
    const h=probe.res.headers, status=probe.res.statusCode;
    probe.res.destroy();
    if (![200,206].includes(status)) throw new Error(status===401||status===403 ? 'Este link exige autorização ou expirou. Use um link público direto atualizado.' : `Servidor retornou HTTP ${status}.`);
    if (h['content-encoding'] && h['content-encoding']!=='identity') throw new Error('O servidor enviou codificação incompatível com downloads em partes.');
    const cr=/^bytes 0-0\/(\d+)$/.exec(h['content-range'] || '');
    const size=cr ? Number(cr[1]) : (status===200 && h['content-length']!==undefined ? Number(h['content-length']) : null);
    if (size!==null && (!Number.isSafeInteger(size)||size<0)) throw new Error('Tamanho do arquivo inválido.');
    const etag=h.etag && !h.etag.startsWith('W/') ? h.etag : null;
    const validator=etag || h['last-modified'] || null;
    const ranges=status===206 && !!cr;
    const desired=this.settings.connections || MAX_CONNECTIONS;
    const parallelism=ranges ? Math.max(1, Math.min(desired, Math.floor(size/MIN_PART_BYTES))) : 1;
    // A shared queue lets fast connections take new parts instead of waiting on a slow tail.
    const count=ranges ? Math.max(1,Math.min(512,Math.max(parallelism*2,Math.ceil(size/(4*1024*1024))),Math.floor(size/MIN_PART_BYTES))) : 1;
    const canReuse=d.segments && d.size===size && d.rangeSupport===ranges && validator && d.validator===validator;
    if (!canReuse) {
      for (const n of await fsp.readdir(tmp)) await fsp.unlink(path.join(tmp,n));
      d.segments=Array.from({length:count},(_,i)=>({start:ranges?Math.floor(size*i/count):0,end:ranges?Math.floor(size*(i+1)/count)-1:null}));
    }
    d.size=size; d.validator=validator; d.rangeSupport=ranges;
    const control=new ConnectionController({maximum:Math.min(parallelism,d.segments.length),automatic:this.settings.connections===0});
    d.connections=control.limit; d.phase='transferring';
    if (!d.customName) d.filename=responseName(h,probe.url);
    const partPath=i=>path.join(tmp,`${i}.part`);
    const sizes=await Promise.all(d.segments.map((_,i)=>fsp.stat(partPath(i)).then(s=>s.size).catch(()=>0)));
    d.downloaded=sizes.reduce((a,b)=>a+b,0);
    const meter=new SpeedMeter();
    d.speed=0; d.instantSpeed=0;
    let previousReceived=0, previousAt=performance.now();
    const speedTimer=setInterval(()=>{
      if(d.status!=='downloading'||d.phase!=='transferring')return;
      const now=performance.now();
      d.instantSpeed=Math.max(0,(meter.total-previousReceived)*1000/Math.max(1,now-previousAt));
      previousReceived=meter.total; previousAt=now;
      d.speed=meter.sample(now); d.connections=control.review(d.speed,now);
    },500);
    this.changed();
    const workerController=new AbortController();
    const abort=()=>workerController.abort(signal.reason); signal.addEventListener('abort',abort,{once:true});
    if (signal.aborted) abort();
    try {
      let activeRequests=0, nextPart=0;
      const takeSlot=async()=>{
        while(activeRequests>=control.limit || control.waitMs()>0)
          await delay(Math.min(1000,Math.max(25,control.waitMs())),undefined,{signal:workerController.signal});
        workerController.signal.throwIfAborted(); activeRequests++;
      };
      const transfer=async (seg,i)=> {
        const expected=ranges ? seg.end-seg.start+1 : size;
        for (let attempt=0;attempt<6;attempt++) {
          const current=await fsp.stat(partPath(i)).then(s=>s.size).catch(()=>0);
          if (expected!==null && current===expected) { const handle=await fsp.open(partPath(i),'a'); await handle.close(); return; }
          if (expected!==null && current>expected) throw new Error('Parte local maior que o arquivo. Remova e adicione o link novamente.');
          const useRange=ranges;
          const headers=useRange ? {Range:`bytes=${seg.start+current}-${seg.end}`, ...(validator?{'If-Range':validator}:{})} : {};
          let res, hasSlot=false, retryDelay=Math.min(4000,400*2**attempt);
          try {
            await takeSlot(); hasSlot=true;
            ({res}=await request(probe.url,headers,workerController.signal,0,this.agents));
            if ([429,503].includes(res.statusCode)) {
              const retryAfter=res.headers['retry-after'];
              if(retryAfter) {
                const wait=/^\d+$/.test(retryAfter)?Number(retryAfter)*1000:Date.parse(retryAfter)-Date.now();
                if(Number.isFinite(wait))retryDelay=Math.max(0,Math.min(Number.MAX_SAFE_INTEGER/2,wait));
              }
              d.connections=control.throttle(retryDelay);
              throw new Error(`Servidor ocupado (HTTP ${res.statusCode}). Tentando com menos conexões.`);
            }
            if (useRange) {
              const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers['content-range']||'');
              if (res.statusCode!==206 || !match || +match[1]!==seg.start+current || +match[2]!==seg.end || +match[3]!==size)
                throw new Error('O servidor mudou o arquivo ou recusou a retomada. Remova e adicione o link novamente.');
            } else if (res.statusCode!==200) throw new Error(`Servidor retornou HTTP ${res.statusCode}.`);
            if (res.headers['content-encoding'] && res.headers['content-encoding']!=='identity') throw new Error('Resposta comprimida inesperada.');
            const returnedValidator=etag ? res.headers.etag : res.headers['last-modified'];
            if (validator && returnedValidator && returnedValidator!==validator) throw new Error('O arquivo mudou no servidor.');
            if (!useRange) { d.downloaded-=current; sizes[i]=0; }
            let received=useRange?current:0;
            const byteStream=new Transform({highWaterMark:STREAM_BUFFER_BYTES,transform(chunk,enc,cb){
              received+=chunk.length;
              if (expected!==null && received>expected) return cb(new Error('Resposta maior que a parte solicitada.'));
              d.downloaded+=chunk.length; sizes[i]+=chunk.length; meter.add(chunk.length); cb(null,chunk);
            }});
            await pipeline(res,byteStream,fs.createWriteStream(partPath(i),{flags:useRange?'a':'w',highWaterMark:STREAM_BUFFER_BYTES}),{signal:workerController.signal});
            if (expected!==null && received!==expected) throw new Error('Conexão interrompida antes de completar o arquivo.');
            return;
          } catch(e) {
            res?.destroy();
            if(hasSlot){activeRequests--;hasSlot=false;}
            const actual=await fsp.stat(partPath(i)).then(s=>s.size).catch(()=>0);
            d.downloaded+=actual-sizes[i]; sizes[i]=actual;
            if (workerController.signal.aborted || attempt===5 || /mudou|recusou|comprimida|maior/.test(e.message)) throw e;
            await delay(Math.min(1000,retryDelay),undefined,{signal:workerController.signal});
          } finally {if(hasSlot)activeRequests--;}
        }
      };
      const workers=Array.from({length:control.maximum},async()=>{
        while(nextPart<d.segments.length){const i=nextPart++;await transfer(d.segments[i],i);}
      });
      try { await Promise.all(workers); }
      catch(e) { workerController.abort(); await Promise.allSettled(workers); throw e; }
      if (signal.aborted) throw new Error('Interrompido');
      d.phase='assembling'; d.speed=0; d.instantSpeed=0; this.emit('update');
      const merged=d.segments.length===1?partPath(0):path.join(tmp,'complete');
      if(d.segments.length>1){
        const parts=Readable.from((async function*(){
          for(let i=0;i<d.segments.length;i++)
            yield* fs.createReadStream(partPath(i),{highWaterMark:1024*1024,signal});
        })());
        await pipeline(parts,fs.createWriteStream(merged,{highWaterMark:1024*1024}),{signal});
      }
      const finalSize=(await fsp.stat(merged)).size;
      if (size!==null && finalSize!==size) throw new Error('Verificação de tamanho falhou.');
      const parsed=path.parse(safeName(d.filename));
      let output;
      for(let suffix=0;suffix<10000;suffix++) {
        output=path.join(d.directory,`${parsed.name}${suffix?' ('+suffix+')':''}${parsed.ext}`);
        try {
          // Publish atomically on the same volume; fallback supports other volumes/filesystems.
          try {await fsp.link(merged,output);}
          catch(e){if(!['EXDEV','EPERM','ENOTSUP','EACCES','EINVAL','ENOSYS','UNKNOWN'].includes(e.code))throw e;await fsp.copyFile(merged,output,fs.constants.COPYFILE_EXCL);}
          break;
        }
        catch(e) { if(e.code!=='EEXIST'||suffix===9999) throw e; }
      }
      d.filename=path.basename(output); d.filePath=output; d.size=finalSize; d.downloaded=finalSize;
      d.status='completed'; d.phase='completed'; d.completedAt=new Date().toISOString(); d.error=null;
      await fsp.rm(tmp,{recursive:true,force:true});
    } finally {clearInterval(speedTimer);signal.removeEventListener('abort',abort);}
  }
  async shutdown() {
    this.closed=true; clearInterval(this.timer); clearInterval(this.persistTimer); this.pauseAll();
    while(this.jobs.size) await delay(30);
    this.save();
    for(const agent of Object.values(this.agents))agent.destroy();
  }
}
module.exports={DownloadEngine,validateURL,safeName,request};
