// Reproducible local comparison; this measures no public server or ISP bandwidth.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {setTimeout:delay}=require('node:timers/promises');
const {DownloadEngine}=require('../src/engine.cjs');
const digest=b=>createHash('sha256').update(b).digest('hex');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vela-benchmark-'));
 const payload=Buffer.alloc(16*1024*1024);for(let i=0;i<payload.length;i++)payload[i]=i%251;
 let active=0,peak=0;const expected=digest(payload);
 const server=http.createServer((req,res)=>{
  const match=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');const start=match?+match[1]:0,end=match&&match[2]?+match[2]:payload.length-1;
  res.writeHead(match?206:200,{'Content-Length':end-start+1,'ETag':'"benchmark-v1"','Accept-Ranges':'bytes',...(match?{'Content-Range':`bytes ${start}-${end}/${payload.length}`}:{})});
  if(start===0&&end===0){res.end(payload.subarray(0,1));return;}
  active++;peak=Math.max(peak,active);let pos=start,blocked=false;
  res.on('drain',()=>blocked=false);
  const timer=setInterval(()=>{if(blocked)return;const next=Math.min(pos+65536,end+1);blocked=!res.write(payload.subarray(pos,next));pos=next;if(pos>end){clearInterval(timer);res.end();}},20);
  res.once('close',()=>{clearInterval(timer);active--;});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/payload`;
 const results=[];
 try{
  for(const [name,connections] of [['Uma conexão',1],['Automático',0]]){
   peak=0;const engine=new DownloadEngine({dataDir:path.join(dir,String(connections),'state'),downloadDir:path.join(dir,String(connections),'downloads')});
   try{
    engine.configure({connections,maxConcurrent:1});const start=performance.now();let networkMs=null;
    engine.on('update',()=>{if(networkMs===null&&engine.downloads[0]?.phase==='assembling')networkMs=performance.now()-start;});
    engine.add({urls:[url]});const job=engine.downloads[0];
    while(!['completed','error'].includes(job.status)){if(performance.now()-start>60000)throw new Error('Benchmark timed out');await delay(10);}
    if(job.status!=='completed')throw new Error(job.error);const totalMs=performance.now()-start;
    if(digest(await fs.readFile(job.filePath))!==expected)throw new Error('Integrity mismatch');
    results.push({profile:name,connections:job.connections,observedPeakConnections:peak,networkMs:Math.round(networkMs),totalMs:Math.round(totalMs),mibPerSecond:+(payload.length/1024/1024/(totalMs/1000)).toFixed(2),sha256:expected});
   }finally{await engine.shutdown();}
  }
  const report={version:require('../package.json').version,date:new Date().toISOString(),fixture:'16 MiB; cada resposta limitada a 64 KiB a cada 20 ms; loopback',scope:'Comparação local de uma execução por perfil. Não mede a internet do usuário, não compara com IDM e não garante ganho em servidores públicos.',results,speedup:+(results[0].totalMs/results[1].totalMs).toFixed(2)};
  await fs.mkdir(path.resolve(__dirname,'../docs'),{recursive:true});await fs.writeFile(path.resolve(__dirname,'../docs/PERFORMANCE.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));if(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('vela-benchmark-'))await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
