'use strict';
// Local static preview with an allowlisted, loopback-only Core development proxy.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const defaultRoot=path.resolve(__dirname,'..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
function createPreviewServer({coreUrl=null,root=defaultRoot}={}){
  if(coreUrl){const u=new URL(coreUrl);if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname)||u.username||u.password)throw new Error('Core proxy must be loopback HTTP');}
  return http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname.startsWith('/api/')){
        const allowed=req.method==='GET'&&(/^\/api\/(task|audit|review\/task)\/[^/]+$/.test(url.pathname)||url.pathname==='/api/demo/portfolio')||req.method==='POST'&&url.pathname==='/api/health-check/run';
        if(!coreUrl||!allowed){res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'NOT_CONNECTED'}}));return;}
        const chunks=[];let bytes=0;for await(const c of req){bytes+=c.length;if(bytes>65536)throw new Error('Request too large');chunks.push(c);}
        const upstream=await fetch(new URL(url.pathname,coreUrl),{method:req.method,headers:{'content-type':'application/json'},...(req.method==='POST'?{body:Buffer.concat(chunks)}:{}),signal:AbortSignal.timeout(8000)});
        res.writeHead(upstream.status,{'content-type':'application/json','cache-control':'no-store'});res.end(await upstream.text());return;
      }
      if(req.method!=='GET'){res.writeHead(405);res.end();return;}
      const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/workspace.html':url.pathname));
      const ext=path.extname(file);
      if(!file.startsWith(root+path.sep)||!types[ext]||path.relative(root,file).split(path.sep).some(p=>p.startsWith('.')||p==='node_modules')||!fs.existsSync(file)||!fs.statSync(file).isFile()){
        res.writeHead(404);res.end();return;
      }
      res.writeHead(200,{'content-type':types[ext],'cache-control':'no-store'});fs.createReadStream(file).pipe(res);
    }catch{res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'PREVIEW_UNAVAILABLE'}}));}
  });
}
module.exports={createPreviewServer};
if(require.main===module)createPreviewServer({coreUrl:process.env.CORE_URL || null}).listen(Number(process.env.PORT || 8917),'127.0.0.1',()=>console.log('Local candidate: http://127.0.0.1:'+(process.env.PORT || 8917)+'/workspace.html'));
