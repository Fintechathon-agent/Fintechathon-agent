'use strict';
// Static UI only: no API interception, bundled backend, or success fixtures.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..');
function build(){
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'finance-lab-site-'));
  fs.mkdirSync(path.join(output,'versions'));
  const pages={index:'index',landing:'landing',workspace:'workspace',investment:'investment',merchant:'merchant',home:'catalog','investment-legacy':'investment-v0.10','risk-workbench':'risk-workbench'};
  const routes={'/':'landing.html','/catalog':'catalog.html','/investment':'investment.html','/investment-v0.10':'investment-v0.10.html','/merchant':'merchant.html','/risk-workbench':'risk-workbench.html'};
  for(const name of fs.readdirSync(path.join(root,'versions'))){
    if(!/\.(css|js|mjs|svg|png)$/.test(name))continue;
    let data=fs.readFileSync(path.join(root,'versions',name));
    if(name.endsWith('.css'))data=Buffer.from(data.toString().replace(/(['"])\/versions\//g,'$1./'));
    fs.writeFileSync(path.join(output,'versions',name),data);
  }
  for(const [source,target] of Object.entries(pages)){
    let html=fs.readFileSync(path.join(root,'versions',source+'.html'),'utf8');
    html=html.replace(/(["'])\/versions\//g,'$1versions/');
    html=html.replace(/href="(\/[^"#?]*)([^\"]*)"/g,(_,url,suffix)=>'href="'+(routes[url]||url.slice(1))+suffix+'"');
    fs.writeFileSync(path.join(output,target+'.html'),html);
  }
  fs.writeFileSync(path.join(output,'.nojekyll'),'');
  fs.writeFileSync(path.join(output,'build-info.json'),JSON.stringify({mode:'STATIC_UI_ONLY',apiMocks:false,backend:'Not included. Service calls must fail visibly when unavailable.'},null,2));
  return output;
}
if(require.main===module)console.log(build());
module.exports={build};
