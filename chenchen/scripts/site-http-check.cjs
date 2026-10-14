'use strict';
// Current UI route expectations, independent of legacy backend-owner tests.
const test=require('node:test'),assert=require('node:assert/strict');
const {server}=require('../server');
test('integrated website routes and typed assets',async t=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();});
 const base='http://127.0.0.1:'+server.address().port;
 const routes=['/','/index.html','/landing.html','/workspace.html','/workspace','/investment','/investment.html','/investment-v0.10','/merchant','/merchant.html','/catalog','/catalog.html','/risk-workbench'];
 const assets=new Set();
 for(const route of routes){
   const res=await fetch(base+route);assert.equal(res.status,200,route);
   const html=await res.text();assert.doesNotMatch(html,/<iframe/i);
   for(const match of html.matchAll(/(?:src|href)="(\/versions\/[^"]+)"/g))assets.add(match[1]);
 }
 for(const asset of assets){const res=await fetch(base+asset);assert.equal(res.status,200,asset);
   const ext=new URL(base+asset).pathname.split('.').pop();
   const mime={css:'text/css',js:'text/javascript',mjs:'text/javascript',svg:'image/svg+xml',png:'image/png'}[ext];
   assert.ok(res.headers.get('content-type').startsWith(mime),asset);
   assert.ok((await res.arrayBuffer()).byteLength>0);
 }
 assert.match(await fetch(base+'/index.html').then(r=>r.text()),/url=landing.html/);
 assert.match(await fetch(base+'/landing.html').then(r=>r.text()),/href="\/workspace.html"/);
 assert.match(await fetch(base+'/workspace.html').then(r=>r.text()),/href="\/landing.html"/);
});
