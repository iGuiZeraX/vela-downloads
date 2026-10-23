// Local development harness. The packaged application uses isolated Electron IPC.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {DownloadEngine}=require('../src/engine.cjs');
const base=process.env.VELA_PREVIEW_DATA || path.resolve(__dirname,'../.preview-data');
const engine=new DownloadEngine({dataDir:path.join(base,'state'),downloadDir:path.join(base,'downloads')});
const fixture=Buffer.alloc(8*1024*1024);for(let i=0;i<fixture.length;i++)fixture[i]=i%251;
const snapshot=()=>({...engine.snapshot(),version:require('../package.json').version,bridge:{port:17839,token:'0'.repeat(64),extensionPath:path.resolve(__dirname,'../extension')}});
const server=http.createServer(async(req,res)=>{
 if(req.headers.host!=='127.0.0.1:17840'){res.writeHead(403).end();return;}
 if(req.url==='/favicon.ico'){res.writeHead(204).end();return;}
 if(req.url.startsWith('/fixture/')){
  const m=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');const start=m?+m[1]:0,end=m&&m[2]?+m[2]:fixture.length-1;
  res.writeHead(m?206:200,{'Content-Type':'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes','ETag':'"vela-fixture-v1"',...(m?{'Content-Range':`bytes ${start}-${end}/${fixture.length}`}:{})});
  let offset=start;const timer=setInterval(()=>{if(offset>end){clearInterval(timer);res.end();return;}const next=Math.min(end+1,offset+16384);res.write(fixture.subarray(offset,next));offset=next;},25);res.on('close',()=>clearInterval(timer));return;
 }
 try{
  if(req.url.startsWith('/api/')){
   if(req.method==='POST'&&req.headers.origin && req.headers.origin!=='http://127.0.0.1:17840')throw new Error('Origin denied');
   let raw='';for await(const c of req){raw+=c;if(raw.length>65536)throw new Error('Large body');}const data=raw?JSON.parse(raw):{};
   switch(req.url){case '/api/add':engine.add(data);break;case '/api/action':if(!['open','reveal'].includes(data.action))engine.action(data);break;case '/api/pause-all':engine.pauseAll();break;case '/api/resume-all':engine.resumeAll();break;case '/api/settings':engine.configure(data);break;}
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(snapshot()));return;
  }
  const name={'/':'index.html','/index.html':'index.html','/dark.css':'dark.css','/app.js':'app.js'}[req.url.split('?')[0]];
  if(!name){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; script-src 'self'"});
  fs.createReadStream(path.resolve(__dirname,'../src/renderer',name)).pipe(res);
 }catch(e){res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:e.message}));}
});
server.listen(17840,'127.0.0.1',()=>process.stdout.write('Vela preview: http://127.0.0.1:17840\n'));
process.on('SIGINT',async()=>{server.close();await engine.shutdown();process.exit();});
