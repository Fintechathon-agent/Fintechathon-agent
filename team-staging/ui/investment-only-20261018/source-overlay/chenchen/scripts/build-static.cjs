'use strict';
// Build an offline-demo runtime from the existing, unmodified business modules.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');

function sha256(input) {
  const data=new TextEncoder().encode(input),length=Math.ceil((data.length+9)/64)*64;
  const bytes=new Uint8Array(length);bytes.set(data);bytes[data.length]=128;
  const view=new DataView(bytes.buffer),bits=data.length*8;
  view.setUint32(length-8,Math.floor(bits/4294967296));view.setUint32(length-4,bits>>>0);
  const initial=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const constants=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const rotate=(n,b)=>(n>>>b)|(n<<(32-b)),words=new Uint32Array(64);
  for(let offset=0;offset<length;offset+=64){
    for(let i=0;i<16;i++)words[i]=view.getUint32(offset+i*4);
    for(let i=16;i<64;i++){const x=words[i-15],y=words[i-2];words[i]=(words[i-16]+(rotate(x,7)^rotate(x,18)^(x>>>3))+words[i-7]+(rotate(y,17)^rotate(y,19)^(y>>>10)))>>>0;}
    let [a,b,c,d,e,f,g,h]=initial;
    for(let i=0;i<64;i++){const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^((~e)&g))+constants[i]+words[i])>>>0;const t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
    [a,b,c,d,e,f,g,h].forEach((n,i)=>{initial[i]=(initial[i]+n)>>>0;});
  }
  return initial.map(n=>n.toString(16).padStart(8,'0')).join('');
}

function browserAdapter() {
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,init={}) {
    const url=new URL(input instanceof Request?input.url:String(input),location.href);
    if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return nativeFetch(input,init);
    const signal=init.signal||(input instanceof Request?input.signal:null);
    if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
    const request={method:(init.method||(input instanceof Request?input.method:'GET')).toUpperCase(),bodyText:init.body!==undefined?String(init.body):(input instanceof Request?await input.text():'')};
    let status=200,headers={},payload='';
    const response={headersSent:false,setHeader(name,value){headers[name]=value;},writeHead(code,values){status=code;Object.assign(headers,values);this.headersSent=true;},end(value){payload=value||'';}};
    try{
      if(url.pathname==='/api/review'||url.pathname.startsWith('/api/review/'))sendJson(response,503,{source:'unavailable',execution_allowed:false,error:{code:'STATIC_AI_UNAVAILABLE',message:'当前为静态预览，AI 服务尚未连接；请在本机服务中使用真实 AI。'}});
      else if(url.pathname.startsWith('/api/merchant/'))sendJson(response,410,{error:{code:'PRODUCT_RETIRED',message:'当前仅保留个人投资顾问。'}});
      else if(!await handleApi(request,response,url.pathname,url))sendJson(response,404,{error:{code:'API_NOT_FOUND',message:'API route not found'}});
    }
    catch(error){sendError(response,error);}
    if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
    return new Response(payload,{status,headers});
  };
  // Download links normally bypass fetch. Keep demo exports local as well.
  document.addEventListener('click',async event=>{
    const anchor=event.target.closest('a[href]');if(!anchor)return;
    const url=new URL(anchor.href,location.href);if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return;
    event.preventDefault();
    try{const response=await fetch(url);if(!response.ok)throw new Error((await response.json()).error?.message||'导出失败');
      const blob=URL.createObjectURL(await response.blob()),download=document.createElement('a');download.href=blob;
      const filename=response.headers.get('content-disposition')?.split("UTF-8''")[1];download.download=filename?decodeURIComponent(filename):'finance-lab-demo.json';download.click();setTimeout(()=>URL.revokeObjectURL(blob),1000);
    }catch(error){const status=document.querySelector('#status');if(status)status.textContent=error.message;}
  },true);
}

function build(base=root) {
  const dist=path.join(base,'dist-static'),versions=path.join(dist,'versions');
  fs.mkdirSync(versions,{recursive:true});
  // Remove only retired generated assets; keep source pages and backend routes untouched.
  for(const relative of ['versions/merchant.js','versions/ai-review.js','versions/ai-review.css','versions/risk.js','versions/risk.css','versions/risk-handoff.js'])fs.rmSync(path.join(dist,relative),{force:true});
  const modules=['core/harness.js','core/memory.js','tools/financial-tools.js','data/demo-portfolio.json'];
  const factories=modules.map(id=>JSON.stringify(id)+':function(module,exports,require){\n'+(id.endsWith('.json')?'module.exports='+fs.readFileSync(path.join(base,id),'utf8')+';':fs.readFileSync(path.join(base,id),'utf8'))+'\n}').join(',\n');
  const source=fs.readFileSync(path.join(base,'server.js'),'utf8');
  const helpers=source.slice(source.indexOf('function sendJson('),source.indexOf('function parseBody('));
  let routes=source.slice(source.indexOf('function resolvePortfolio('),source.indexOf('function serveStatic('));
  if(!helpers.includes('sendDownload')||!routes.includes('async function handleApi('))throw new Error('Server route boundaries changed; inspect before building.');
  const omitSection=(text,start,end)=>{
    const a=text.indexOf(start),b=text.indexOf(end,a);
    if(a<0||b<=a)throw new Error('Static route boundaries changed; inspect before building.');
    return text.slice(0,a)+text.slice(b);
  };
  routes=omitSection(routes,'  if (pathname === "/api/review") {','  let body = {};');
  routes=omitSection(routes,'  if (pathname.startsWith("/api/merchant/")) {','  if (method === "GET" && pathname.startsWith("/api/task/")) {');
  if(/reviewService|reviewFailure|merchantFor|merchantDemo|publicAccessEnabled/.test(routes))throw new Error('Server-only dependencies remain in static routes.');
  const runtime=`'use strict';\n(()=>{\n${sha256.toString()}\nconst factories={${factories}},cache={};
const cryptoShim={randomUUID:()=>crypto.randomUUID(),createHash(algorithm){if(algorithm!=='sha256')throw new Error('Only SHA-256 is supported');let input='';return {update(value){input+=String(value);return this;},digest(format){if(format!=='hex')throw new Error('Only hex is supported');return sha256(input);}};}};
function load(id,from=''){if(id==='node:crypto')return cryptoShim;let key=id;if(id.startsWith('.')){const parts=from.split('/');parts.pop();for(const part of id.split('/')){if(part==='..')parts.pop();else if(part!=='.')parts.push(part);}key=parts.join('/');}if(!/\\.(js|json)$/.test(key))key+='.js';if(cache[key])return cache[key].exports;if(!factories[key])throw new Error('Unknown demo module '+key);const module={exports:{}};cache[key]=module;factories[key](module,module.exports,name=>load(name,key));return module.exports;}
const {Harness}=load('core/harness.js'),tools=load('tools/financial-tools.js');
const harness=new Harness({toolset:tools});
${helpers}
async function parseBody(request){const text=request.bodyText||'';if(text.length>1024*1024)throw Object.assign(new Error('request body exceeds 1 MB'),{statusCode:413});if(!text)return {};try{return JSON.parse(text);}catch(error){error.statusCode=400;error.code='INVALID_JSON';throw error;}}
${routes}\n(${browserAdapter.toString()})();\n})();\n`;
  fs.writeFileSync(path.join(versions,'api.js'),runtime);
  const assets=['archive.js','common.js','investment.js','presentation.mjs','ui-model.mjs','landing.js','favicon.svg','tokens.css','glass.css','style.css','product-overrides.css','kosx.css','landing.css'];
  for(const name of assets){let text=fs.readFileSync(path.join(base,'versions',name),'utf8');if(name.endsWith('.css'))text=text.replace(/(['"])\/versions\//g,'$1./');fs.writeFileSync(path.join(versions,name),text);}
  fs.writeFileSync(path.join(versions,'static-preview.css'),'.static-preview-notice{position:relative;z-index:30;margin:0;padding:10px 18px;background:#292018;color:#f1dcc5;border-bottom:1px solid #69513a;text-align:center;font:12px/1.6 system-ui,sans-serif}.static-preview-notice a{color:inherit;text-decoration:underline}');
  const pages={landing:'landing',investment:'investment',home:'catalog','not-found':'not-found'};
  const linkMap={'/':'landing.html','/index.html':'landing.html','/investment':'investment.html','/catalog':'catalog.html'};
  for(const [sourceName,target] of Object.entries(pages)){
    let html=fs.readFileSync(path.join(base,'versions',sourceName+'.html'),'utf8');
    if(/href=["']\/merchant/.test(html))throw new Error('Retired merchant entry in '+sourceName);
    if(sourceName==='investment'){
      const a=html.indexOf('<section class="panel" id="ai-assistant"'),b=html.indexOf('</section>',a);
      if(a<0||b<a)throw new Error('AI panel boundary changed; inspect before building.');
      html=html.slice(0,a)+'<section class="panel" id="ai-assistant"><h2>昕澜 AI 助手</h2><p class="notice" role="note">当前为静态预览，AI 服务尚未连接。这里仅展示个人投资顾问的虚构数据与本地模拟计算，不会发送真实模型请求。</p><button type="button" disabled>AI 服务未接入</button></section>'+html.slice(b+10);
      html=html.replace(/<script type="module" src="\/versions\/ai-review.js"><\/script>/,'').replace(/<link rel="stylesheet" href="\/versions\/ai-review.css">/,'');
    }
    html=html.replace('</head>','<link rel="stylesheet" href="versions/static-preview.css"></head>').replace(/(<body\b[^>]*>)/,'$1<aside class="static-preview-notice" role="note">静态预览 · 虚构数据与浏览器模拟计算 · AI 后端未连接 · 不执行交易</aside>');
    html=html.replace('<head>','<head><script src="versions/api.js"></script>').replace(/(["'])\/versions\//g,'$1versions/');
    html=html.replace(/href=(["'])(\/(?:investment|merchant|catalog|index\.html)?)([?#][^"']*)?\1/g,(_,quote,link,suffix='')=>'href='+quote+linkMap[link]+suffix+quote);
    fs.writeFileSync(path.join(dist,target+'.html'),html);
  }
  fs.writeFileSync(path.join(dist,'index.html'),'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=landing.html"><title>Finance Lab</title><link rel="icon" href="versions/favicon.svg" type="image/svg+xml"></head><body><a href="landing.html">进入 Finance Lab</a></body></html>');
  const redirect=(target,icon)=>'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url='+target+'"><title>前往个人投资顾问</title><link rel="icon" href="'+icon+'"></head><body><p>当前仅保留个人投资顾问。</p><a href="'+target+'">进入个人投资顾问</a></body></html>';
  fs.writeFileSync(path.join(dist,'merchant.html'),redirect('investment.html','versions/favicon.svg'));
  fs.writeFileSync(path.join(versions,'merchant.html'),redirect('../investment.html','favicon.svg'));
  fs.mkdirSync(path.join(dist,'merchant'),{recursive:true});
  fs.writeFileSync(path.join(dist,'merchant/index.html'),redirect('../investment.html','../versions/favicon.svg'));
  fs.writeFileSync(path.join(dist,'.nojekyll'),'');
  fs.writeFileSync(path.join(dist,'build-info.json'),JSON.stringify({mode:'STATIC_SIMULATION_ONLY',backend:'NOT_CONNECTED',realModelCalls:false,execution_allowed:false,product:'personal-investment-only'},null,2));
  console.log('Static demo built: '+dist);return dist;
}
if(require.main===module)build();
module.exports={build,sha256};
