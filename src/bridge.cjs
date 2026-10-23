const http=require('node:http');
const { timingSafeEqual }=require('node:crypto');
function startBridge(engine,token,port=17839) {
  return new Promise((resolve,reject)=>{
    const server=http.createServer(async(req,res)=>{
      const origin=req.headers.origin||'';
      if (req.headers.host!==`127.0.0.1:${server.address().port}` || (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))) {
        res.writeHead(403).end();return;
      }
      const cors=origin ? {'Access-Control-Allow-Origin':origin,'Vary':'Origin'} : {};
      if(req.method==='OPTIONS') {res.writeHead(204,{...cors,'Access-Control-Allow-Headers':'Content-Type, X-Vela-Token','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Private-Network':'true'}).end();return;}
      const reply=(code,data)=>{res.writeHead(code,{...cors,'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
      if(req.url==='/health' && req.method==='GET') return reply(200,{app:'Vela',version:'0.2.0'});
      const given=Buffer.from(String(req.headers['x-vela-token']||'')); const expected=Buffer.from(token);
      if(given.length!==expected.length || !timingSafeEqual(given,expected)) return reply(401,{error:'Código de conexão incorreto. Copie-o no Vela.'});
      if(req.method!=='POST' || req.url!=='/downloads') return reply(404,{error:'Rota inexistente.'});
      try {
        let body=''; for await(const chunk of req) {body+=chunk;if(Buffer.byteLength(body)>65536) {reply(413,{error:'Solicitação grande demais.'});req.destroy();return;}}
        const data=JSON.parse(body);
        const snapshot=engine.add({urls:data.urls,filename:data.filename});
        reply(200,{ok:true,ids:snapshot.downloads.filter(d=>data.urls.includes(d.url)).map(d=>d.id)});
      }catch(e){reply(400,{error:e.message});}
    });
    server.requestTimeout=10000; server.headersTimeout=10000;
    server.on('error',reject);server.listen(port,'127.0.0.1',()=>resolve(server));
  });
}
module.exports={startBridge};
