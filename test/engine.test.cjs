const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {DownloadEngine,safeName,validateURL}=require('../src/engine.cjs');
const {startBridge}=require('../src/bridge.cjs');
const payload=Buffer.alloc(2*1024*1024+13);for(let i=0;i<payload.length;i++)payload[i]=i%251;
const digest=b=>createHash('sha256').update(b).digest('hex');
async function waitFor(fn,timeout=15000){const start=Date.now();while(!fn()){if(Date.now()-start>timeout)throw new Error('Timed out');await delay(20);}}
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vela-test-'));const requests=[];let etag='"v1"';
 const server=http.createServer((req,res)=>{
  requests.push({url:req.url,range:req.headers.range});
  if(req.url==='/redirect'){res.writeHead(302,{Location:'/file'}).end();return;}
  if(req.url==='/auth'){res.writeHead(403).end();return;}
  const noRange=req.url==='/plain';const m=!noRange&&/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');
  const start=m?+m[1]:0,end=m&&m[2]?+m[2]:payload.length-1;
  const headers={'Content-Length':end-start+1,'Content-Type':'application/octet-stream','ETag':etag,'Content-Disposition':"attachment; filename*=UTF-8''relat%C3%B3rio.bin",...(m?{'Content-Range':`bytes ${req.url==='/bad'&&start>0?start+1:start}-${end}/${payload.length}`}:{})};
  res.writeHead(m?206:200,headers);
  if(req.url==='/slow'){let p=start;const timer=setInterval(()=>{if(p>end){clearInterval(timer);res.end();return;}const n=Math.min(p+16384,end+1);res.write(payload.subarray(p,n));p=n;},6);res.on('close',()=>clearInterval(timer));}
  else res.end(payload.subarray(start,end+1));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const engine=new DownloadEngine({dataDir:path.join(dir,'state'),downloadDir:path.join(dir,'downloads')});
 t.after(async()=>{await engine.shutdown();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 return {engine,dir,base,requests,setETag:v=>{etag=v;}};
}
test('validates protocols and safe Windows filenames',()=>{
 for(const u of ['file:///C:/x','javascript:alert(1)','https://name:pass@example.com/a'])assert.throws(()=>validateURL(u));
 assert.equal(safeName('../../CON.txt'),'_CON.txt');assert.equal(safeName('file?.zip'),'file_.zip');
});
test('parallel ranged download matches SHA-256 and never overwrites an existing file',async t=>{
 const {engine,base,dir,requests}=await fixture(t);await fs.mkdir(path.join(dir,'downloads'));
 await fs.writeFile(path.join(dir,'downloads','relatório.bin'),'existing');
 engine.add({urls:[base+'/file']});const d=engine.downloads[0];await waitFor(()=>['completed','error'].includes(d.status));
 assert.equal(d.status,'completed',d.error);assert.equal(d.connections,4);assert.equal(d.filename,'relatório (1).bin');
 assert.equal(digest(await fs.readFile(d.filePath)),digest(payload));assert.equal(await fs.readFile(path.join(dir,'downloads','relatório.bin'),'utf8'),'existing');
 assert.equal(requests.filter(r=>r.range&&r.range!=='bytes=0-0').length,4);
});
test('pause and resume continue from verified partial ranges',async t=>{
 const {engine,base,requests}=await fixture(t);engine.add({urls:[base+'/slow']});const d=engine.downloads[0];
 await waitFor(()=>d.downloaded>100000);engine.action({id:d.id,action:'pause'});await waitFor(()=>engine.jobs.size===0);
 assert.equal(d.status,'paused');assert(d.downloaded>0&&d.downloaded<payload.length);
 const count=requests.length;engine.action({id:d.id,action:'resume'});await waitFor(()=>['completed','error'].includes(d.status));
 assert.equal(d.status,'completed',d.error);assert.equal(digest(await fs.readFile(d.filePath)),digest(payload));
 assert(requests.slice(count).some(r=>r.range&&r.range!=='bytes=0-0'&&!r.range.startsWith('bytes=0-')));
});
test('server ignoring Range is downloaded intact as one stream',async t=>{
 const {engine,base}=await fixture(t);engine.add({urls:[base+'/plain']});const d=engine.downloads[0];await waitFor(()=>['completed','error'].includes(d.status));
 assert.equal(d.status,'completed',d.error);assert.equal(d.connections,1);assert.equal(digest(await fs.readFile(d.filePath)),digest(payload));
});
test('changed validator discards stale partial bytes before resuming',async t=>{
 const {engine,base,setETag}=await fixture(t);engine.add({urls:[base+'/slow']});const d=engine.downloads[0];await waitFor(()=>d.downloaded>100000);
 engine.action({id:d.id,action:'pause'});await waitFor(()=>!engine.jobs.size);setETag('"v2"');engine.action({id:d.id,action:'resume'});
 await waitFor(()=>['completed','error'].includes(d.status));assert.equal(d.status,'completed',d.error);assert.equal(digest(await fs.readFile(d.filePath)),digest(payload));
});
test('rejects malformed Content-Range instead of publishing corrupt data',async t=>{
 const {engine,base}=await fixture(t);engine.add({urls:[base+'/bad']});const d=engine.downloads[0];await waitFor(()=>['error','completed'].includes(d.status));assert.equal(d.status,'error');assert(!d.filePath);
});
test('relative redirects work; authorization failures are visible',async t=>{
 const {engine,base}=await fixture(t);engine.add({urls:[base+'/redirect',base+'/auth']});await waitFor(()=>engine.downloads.every(d=>['completed','error'].includes(d.status)));
 assert.equal(engine.downloads.find(d=>d.url.endsWith('/redirect')).status,'completed');assert.match(engine.downloads.find(d=>d.url.endsWith('/auth')).error,/autorização/);
});
test('queue obeys concurrency limit and persisted downloads restart paused',async t=>{
 const {engine,base,dir}=await fixture(t);engine.configure({maxConcurrent:1});engine.add({urls:[base+'/slow?1',base+'/slow?2']});
 assert.equal(engine.jobs.size,1);assert.equal(engine.downloads.filter(d=>d.status==='queued').length,1);await engine.shutdown();
 const reopened=new DownloadEngine({dataDir:path.join(dir,'state'),downloadDir:path.join(dir,'downloads')});assert(reopened.downloads.every(d=>d.status==='paused'));assert.equal(reopened.jobs.size,0);await reopened.shutdown();
});
test('bridge requires token, rejects web origins, acknowledges accepted downloads',async t=>{
 const {engine,base}=await fixture(t);const token='a'.repeat(64),bridge=await startBridge(engine,token,0);t.after(()=>new Promise(r=>bridge.close(r)));
 const endpoint=`http://127.0.0.1:${bridge.address().port}/downloads`;
 assert.equal((await fetch(endpoint,{method:'POST',body:'{}'})).status,401);
 assert.equal((await fetch(endpoint,{method:'POST',headers:{Origin:'https://evil.example','X-Vela-Token':token},body:'{}'})).status,403);
 const r=await fetch(endpoint,{method:'POST',headers:{Origin:'chrome-extension://'+'a'.repeat(32),'X-Vela-Token':token,'Content-Type':'application/json'},body:JSON.stringify({urls:[base+'/file']})});
 assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
});
test('invalid batch is atomic; cancelled download is not published',async t=>{
 const {engine,base}=await fixture(t);assert.throws(()=>engine.add({urls:[base+'/file','file:///invalid']}));assert.equal(engine.downloads.length,0);
 engine.add({urls:[base+'/slow']});const d=engine.downloads[0];await waitFor(()=>d.downloaded>100000);engine.action({id:d.id,action:'cancel'});await waitFor(()=>engine.jobs.size===0);assert.equal(d.status,'cancelled');assert(!d.filePath);
});

test('received 100 percent is not completed until disk synchronization finishes',async t=>{
 const {engine,base}=await fixture(t);const originalOpen=fs.open;
 let entered=false,release;const gate=new Promise(resolve=>{release=resolve;});
 fs.open=async function(filename,...args){
  const handle=await originalOpen.call(this,filename,...args);
  if(path.basename(String(filename))==='complete'&&args[0]==='r+'){
   const sync=handle.sync.bind(handle);handle.sync=async()=>{entered=true;await gate;return sync();};
  }
  return handle;
 };
 let d;
 try {
  engine.add({urls:[base+'/file']});d=engine.downloads[0];await waitFor(()=>entered);
  assert.equal(d.downloaded,d.size);assert.equal(d.status,'downloading');assert.equal(d.phase,'syncing');assert.equal(d.filePath,undefined);
 }finally{release();fs.open=originalOpen;}
 await waitFor(()=>['completed','error'].includes(d.status));assert.equal(d.status,'completed',d.error);
 assert.equal(digest(await fs.readFile(d.filePath)),digest(payload));
});
