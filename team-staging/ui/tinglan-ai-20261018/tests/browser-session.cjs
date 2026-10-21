'use strict';
// Exercise slow authentication initialization without any model traffic.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
(async()=>{const root=path.resolve(__dirname,'../public');let browser,server;try{
 server=http.createServer((req,res)=>{const f=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await require('playwright').chromium.launch({channel:'chrome'});const page=await browser.newPage();let posts=0,leak=false,modelRequests=0;const code='synthetic-session-test-password';
 page.on('request',r=>{if(r.url().includes(code))leak=true;if(r.url().endsWith('/api/review'))modelRequests++;});
 await page.route('**/tinglan-config.json',r=>r.fulfill({json:{endpoint:'/api/review',model:'qwen3.8-flash',mode:'SESSION'}}));
 await page.route('**/api/session',async r=>{if(r.request().method()==='GET'){await new Promise(resolve=>setTimeout(resolve,1500));await r.fulfill({status:401,json:{authenticated:false}});}else{posts++;assert.equal(r.request().method(),'POST');assert.equal(r.request().postDataJSON().code,code);await r.fulfill({json:{authenticated:true}});}});
 await page.goto('http://127.0.0.1:'+server.address().port+'/investment-only/investment.html');await page.locator('#share-login').waitFor({state:'visible'});
 assert.equal(await page.locator('#share-login button').isDisabled(),true);assert.equal(await page.locator('#tinglan-form').isVisible(),false);
 await page.locator('#share-login [name=code]').fill(code);await page.locator('#share-login [name=code]').press('Enter');assert.equal(posts,0);
 await page.locator('#share-login button').click();await page.locator('#tinglan-form').waitFor({state:'visible'});assert.equal(posts,1);assert.equal(leak,false);assert.equal(modelRequests,0);assert.equal(await page.locator('#share-login [name=code]').inputValue(),'');
 console.log(JSON.stringify({result:'SESSION_INITIALIZATION_PASSED',passwordInUrl:false,nativeSubmission:false,modelRequests:0}));
}finally{await browser?.close();await new Promise(r=>server?server.close(r):r());}})().catch(e=>{console.error(e.name);process.exitCode=1;});
