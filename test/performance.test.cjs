const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {setTimeout:delay}=require('node:timers/promises');
const {createHash}=require('node:crypto');
const {DownloadEngine}=require('../src/engine.cjs');
const digest=b=>createHash('sha256').update(b).digest('hex');
async function waitFor(fn){const start=Date.now();while(!fn()){if(Date.now()-start>45000)throw new Error('Timed out');await delay(10);}}
async function setup(t,mode){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vela-performance-'));
 const body=Buffer.alloc((mode==='ramp'?32:16)*1024*1024,73);const records=[];let busy=0,peak=0,rejections=0,firstDone=Infinity,rejectedAt=null,finishFirst;
 const server=http.createServer((req,res)=>{
  const m=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');const a=m?+m[1]:0,b=m&&m[2]?+m[2]:body.length-1;
  const probe=a===0&&b===0;
  if(mode==='retry-after'&&!probe&&!rejections){rejections++;rejectedAt=Date.now();res.writeHead(429,{'Retry-After':'2'}).end();return;}
  if(mode==='throttle'&&!probe&&busy>=2){rejections++;res.writeHead(429,{'Retry-After':'0'}).end();return;}
  res.writeHead(m?206:200,{'Content-Length':b-a+1,'ETag':'"same"',...(m?{'Content-Range':`bytes ${a}-${b}/${body.length}`}:{})});
  if(probe){res.end(body.subarray(0,1));return;}
  records.push({start:a,at:Date.now(),port:req.socket.remotePort,firstStillActive:firstDone===Infinity});busy++;peak=Math.max(peak,busy);res.once('close',()=>busy--);
  const finish=()=>{if(a===0)firstDone=Date.now();res.end(body.subarray(a,b+1));};
  if(mode==='queue'&&a===0)finishFirst=finish;
  else setTimeout(finish,mode==='ramp'?700:30);
  if(mode==='queue'&&records.length>4&&finishFirst){const release=finishFirst;finishFirst=null;setImmediate(release);}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const engine=new DownloadEngine({dataDir:path.join(dir,'state'),downloadDir:path.join(dir,'downloads')});
 t.after(async()=>{await engine.shutdown();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 return{engine,url:`http://127.0.0.1:${server.address().port}/file`,body,records,rejections:()=>rejections,firstDone:()=>firstDone,rejectedAt:()=>rejectedAt,peak:()=>peak};
}
test('automatic profile starts with eight connections and preserves file integrity',async t=>{
 const f=await setup(t);let initial;f.engine.on('update',()=>{const current=f.engine.downloads[0];if(initial===undefined&&current?.phase==='transferring')initial=current.connections;});assert.equal(f.engine.settings.connections,0);f.engine.add({urls:[f.url]});const d=f.engine.downloads[0];await waitFor(()=>['completed','error'].includes(d.status));
 assert.equal(d.status,'completed',d.error);assert.equal(initial,8);assert(d.connections<=32);assert.equal(digest(await fs.readFile(d.filePath)),digest(f.body));
 assert.equal(f.engine.configure({connections:32}).settings.connections,32);assert.throws(()=>f.engine.configure({connections:33}));
});

test('manual profile still supports 32 connections with intact output',async t=>{
 const f=await setup(t);f.engine.configure({connections:32});f.engine.add({urls:[f.url]});const d=f.engine.downloads[0];await waitFor(()=>['completed','error'].includes(d.status));
 assert.equal(d.status,'completed',d.error);assert.equal(d.connections,32);assert.equal(digest(await fs.readFile(d.filePath)),digest(f.body));
});

test('automatic workers can actually grow beyond the initial eight sockets',async t=>{
 const f=await setup(t,'ramp');f.engine.add({urls:[f.url]});const d=f.engine.downloads[0];await waitFor(()=>['completed','error'].includes(d.status));
 assert.equal(d.status,'completed',d.error);assert(f.peak()>8,'the scheduler must activate waiting workers when the limit increases');assert(f.peak()<=32);
 assert.equal(digest(await fs.readFile(d.filePath)),digest(f.body));
});
test('shared part queue reuses sockets and does not wait for the slow first part',async t=>{
 const f=await setup(t,'queue');f.engine.configure({connections:4});f.engine.add({urls:[f.url]});const d=f.engine.downloads[0];await waitFor(()=>['completed','error'].includes(d.status));
 assert.equal(d.status,'completed',d.error);assert(f.records.length>4);assert(new Set(f.records.map(x=>x.port)).size<f.records.length,'connections should be reused');
 assert(f.records.slice(4).some(x=>x.firstStillActive),'free workers should take new parts while the slow one runs');
 assert.equal(digest(await fs.readFile(d.filePath)),digest(f.body));
});
test('server connection limit triggers automatic reduction and successful retries',async t=>{
 const f=await setup(t,'throttle');f.engine.add({urls:[f.url]});const d=f.engine.downloads[0];await waitFor(()=>['completed','error'].includes(d.status));
 assert(f.rejections()>0);assert.equal(d.status,'completed',d.error);assert(d.connections<=2);assert.equal(digest(await fs.readFile(d.filePath)),digest(f.body));
});
test('upgrades the old default to automatic once and preserves subsequent choices',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vela-migration-'));await fs.writeFile(path.join(dir,'state.json'),JSON.stringify({settings:{connections:4},downloads:[]}));
 const e=new DownloadEngine({dataDir:dir,downloadDir:path.join(dir,'downloads')});assert.equal(e.settings.connections,0);e.configure({connections:8});await e.shutdown();
 const reopened=new DownloadEngine({dataDir:dir,downloadDir:path.join(dir,'downloads')});assert.equal(reopened.settings.connections,8);await reopened.shutdown();await fs.rm(dir,{recursive:true,force:true});
});

test('Retry-After holds every new request, not just the worker that was rejected',async t=>{
 const f=await setup(t,'retry-after');f.engine.add({urls:[f.url]});const d=f.engine.downloads[0];await waitFor(()=>['completed','error'].includes(d.status));
 assert.equal(d.status,'completed',d.error);
 const at=f.rejectedAt();assert(at);
 assert(!f.records.some(r=>r.at>at+200&&r.at<at+1900),'no fresh work during shared server cooldown');
 assert(f.records.some(r=>r.at>=at+1900),'queued work resumes after Retry-After');
 assert.equal(digest(await fs.readFile(d.filePath)),digest(f.body));
});
