// Controlled congestion fixture. This is not an IDM or public-internet benchmark.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {performance}=require('node:perf_hooks');
const {createHash}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {DownloadEngine}=require('../src/engine.cjs');
const hash=b=>createHash('sha256').update(b).digest('hex');
const cv=values=>{if(!values.length)return null;const mean=values.reduce((a,b)=>a+b)/values.length;return mean?Math.sqrt(values.reduce((s,x)=>s+(x-mean)**2,0)/values.length)/mean:0;};
(async()=>{
  const baseline=process.argv[2]&&require(path.resolve(process.argv[2])).DownloadEngine;
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vela-stability-'));
  const body=Buffer.alloc(32*1024*1024,73),expectedHash=hash(body),results=[];
  try {
    for(let round=1;round<=2;round++)for(const [name,Engine] of [...(baseline?[['0.2.0',baseline]]:[]),['new',DownloadEngine]]){
      let active=0,peak=0,rejections=0,requests=0;
      const server=http.createServer((req,res)=>{
        const m=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');const start=m?+m[1]:0,end=m&&m[2]?+m[2]:body.length-1;
        const probe=start===0&&end===0;
        if(!probe&&active>=4){rejections++;res.writeHead(429,{'Retry-After':'1'}).end();return;}
        res.writeHead(m?206:200,{'Content-Length':end-start+1,ETag:'"stable-fixture"',...(m?{'Content-Range':`bytes ${start}-${end}/${body.length}`}:{})});
        if(probe){res.end(body.subarray(0,1));return;}
        requests++;active++;peak=Math.max(peak,active);let pos=start,blocked=false;
        res.on('drain',()=>blocked=false);
        const timer=setInterval(()=>{if(blocked)return;const next=Math.min(end+1,pos+65536);blocked=!res.write(body.subarray(pos,next));pos=next;if(pos>end){clearInterval(timer);res.end();}},20);
        res.once('close',()=>{clearInterval(timer);active--;});
      });
      await new Promise(r=>server.listen(0,'127.0.0.1',r));
      const engine=new Engine({dataDir:path.join(dir,`${round}-${name}`),downloadDir:path.join(dir,`${round}-${name}-files`)});
      const samples=[];let sampleTimer;
      try {
        engine.configure({connections:0,maxConcurrent:1});const begin=performance.now();
        engine.add({urls:[`http://127.0.0.1:${server.address().port}/file`]});const d=engine.downloads[0];
        let last=0,lastAt=begin;
        sampleTimer=setInterval(()=>{const now=performance.now();if(d.phase==='transferring')samples.push({ms:Math.round(now-begin),received:d.downloaded,actual:(d.downloaded-last)*1000/(now-lastAt),displayed:d.speed});last=d.downloaded;lastAt=now;},500);
        while(!['completed','error'].includes(d.status)){if(performance.now()-begin>60000)throw new Error('Benchmark timed out');await delay(20);}
        if(d.status!=='completed')throw new Error(d.error);
        const totalMs=Math.round(performance.now()-begin);
        if(hash(await fs.readFile(d.filePath))!==expectedHash)throw new Error('Integrity mismatch');
        const steady=samples.filter(x=>x.ms>=1500);
        results.push({round,version:name,totalMs,mibPerSecond:32/(totalMs/1000),rejections,requests,peak,finalConnections:d.connections,actualRateCV:cv(steady.map(x=>x.actual)),displayedRateCV:cv(steady.map(x=>x.displayed)),sha256:expectedHash,samples});
      }finally{clearInterval(sampleTimer);await engine.shutdown();server.closeAllConnections();await new Promise(r=>server.close(r));}
    }
    const report={scope:'Two sequential runs per engine, 32 MiB over loopback; maximum four concurrent requests, 64 KiB every 20 ms per response; excess requests return HTTP 429 with Retry-After 1s. No IDM, ISP, TLS or public server measurement.',date:new Date().toISOString(),results};
    await fs.mkdir(path.resolve(__dirname,'../docs'),{recursive:true});await fs.writeFile(path.resolve(__dirname,'../docs/STABILITY-BENCHMARK.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({...report,results:results.map(({samples,...r})=>r)},null,2));
  }finally{if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('vela-stability-'))await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
