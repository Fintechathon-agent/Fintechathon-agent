'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const load=createRequire(path.join(process.env.UI_MODULE_ROOT,'..','package.json'));
const {chromium}=load('playwright');
const AxeBuilder=load('@axe-core/playwright').default;
const {server}=require('../server');
const {build}=require('./build-site.cjs');
const out=path.resolve(__dirname,'../../review/site-integration');fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[];let browser,staticServer;
async function screenshot(page,name){await page.screenshot({path:path.join(out,name+'.png'),fullPage:false});}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/index.html');await page.waitForURL('**/landing.html');
 assert.equal(await page.locator('.team-logo-cutout').evaluate(e=>e.complete&&e.naturalWidth>0),true);
 await screenshot(page,'landing-desktop');
 await page.locator('.nav-enter').click();await page.waitForURL('**/workspace.html');
 await page.waitForFunction(()=>document.querySelector('#service-state').textContent.includes('已响应'));
 await screenshot(page,'workspace-desktop');checks.push('A: index to Landing to single Workspace');
 await page.locator('[data-view=banking]').click();await page.locator('#demo-profile').click();await page.locator('#run').click();
 await page.locator('#results').waitFor({state:'visible'});assert.equal(await page.locator('.plan-card').count(),3);
 await screenshot(page,'portfolio-desktop');checks.push('B: real local Core health-check and comparisons');
 await page.locator('[data-view=tasks]').click();await page.waitForFunction(()=>document.querySelector('#audit-timeline').children.length>0);
 const id=await page.locator('#restore-id').inputValue();assert.match(await page.locator('#risk-label').textContent(),/等待/);
 assert.equal(await page.locator('#task-detail button').count(),1);await screenshot(page,'risk-readonly-desktop');
 checks.push('C: read-only Risk handoff, no execution control');
 await page.locator('.workspace-brand').click();await page.waitForURL('**/landing.html');await page.locator('.nav-enter').click();
 await page.waitForFunction(()=>document.querySelector('#restore-message').textContent.includes('已读取'));
 await page.locator('[data-view=tasks]').click();assert.equal(await page.locator('#restore-id').inputValue(),id);
 checks.push('Task identifier survives Landing roundtrip; data re-read from service');
 for(const route of ['/investment.html','/investment-v0.10','/merchant.html','/risk-workbench.html']){
   await page.goto(base+route);assert.equal(await page.locator('.product-nav a[href="/workspace.html"]').count(),1);
   assert.equal(await page.locator('.product-nav a[href="/landing.html"]').count(),1);
   await page.locator('.product-nav a[href="/workspace.html"]').click();await page.waitForURL('**/workspace.html');
 }
 await page.goto(base+'/catalog.html');await page.locator('details').evaluate(e=>e.open=true);
 assert.equal(await page.locator('a[href="/merchant"]').count(),1);
 checks.push('D/F: preserved investment, legacy, merchant, Risk and catalog routes with return links');
 await page.goto(base+'/workspace.html#banking');await page.locator('#demo-profile').click();
 await page.route('**/api/health-check/run',r=>r.abort('failed'));await page.locator('#run').click();
 await page.waitForFunction(()=>document.querySelector('#run-feedback').textContent.includes('ERROR'));
 assert.equal(await page.locator('#results').isVisible(),false);await screenshot(page,'service-error');await page.unroute('**/api/health-check/run');
 checks.push('E: network failure shows ERROR without success fallback');
 for(const width of [390,375]){
   await page.setViewportSize({width,height:844});
   for(const route of ['/landing.html','/workspace.html','/investment.html','/merchant.html','/catalog.html']){
     await page.goto(base+route);
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true,route+' width '+width);
     if(width===390&&['/landing.html','/workspace.html','/investment.html'].includes(route))await screenshot(page,route.slice(1,-5)+'-mobile');
   }
 }
 checks.push('G: desktop and 390/375 mobile layouts without page overflow');
 await page.setViewportSize({width:1440,height:1000});
 const axe={};for(const route of ['/landing.html','/workspace.html','/investment.html']){
   await page.goto(base+route);axe[route]=(await new AxeBuilder({page}).analyze()).violations;
 }
 fs.writeFileSync(path.join(out,'site-axe.json'),JSON.stringify(axe,null,2));
 assert.deepEqual(Object.values(axe).flat().map(v=>v.id),[]);
 // Serve the built static UI under a Pages-like prefix, with no backend.
 const dist=build();staticServer=http.createServer((req,res)=>{
   let url=new URL(req.url,'http://localhost').pathname;
   if(!url.startsWith('/team_site/')){res.writeHead(404);return res.end('outside project');}
   const rel=url.slice('/team_site/'.length)||'index.html';
   const file=path.resolve(dist,rel);if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end('No service');}
   res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));
 });await new Promise(r=>staticServer.listen(0,'127.0.0.1',r));
 const site='http://127.0.0.1:'+staticServer.address().port+'/team_site/';
 const broken=[];page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))broken.push(r.url());});
 await page.goto(site+'index.html');await page.waitForURL('**/landing.html');await page.locator('.nav-enter').click();
 await page.waitForFunction(()=>document.querySelector('#load-error').textContent.length>0);
 assert.equal(await page.locator('#run').isDisabled(),true);
 for(const file of ['landing.html','workspace.html','investment.html','merchant.html','catalog.html']){
   await page.goto(site+file);
   const links=await page.locator('a[href]').evaluateAll(nodes=>nodes.map(e=>e.href).filter(h=>h.startsWith(location.origin)));
   assert.equal(links.every(h=>new URL(h).pathname.startsWith('/team_site/')),true,file);
 }
 assert.deepEqual(broken,[]);checks.push('Pages subpath asset/navigation checks; missing backend stays unavailable');
 assert.deepEqual(errors,[]);
 const result={checks,errors,axe:Object.fromEntries(Object.entries(axe).map(([k,v])=>[k,v.map(x=>({id:x.id,nodes:x.nodes.length}))])),staticOutput:dist,publicDeployment:'NOT_VERIFIED'};
 fs.writeFileSync(path.join(out,'site-browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));if(staticServer){staticServer.closeAllConnections();await new Promise(r=>staticServer.close(r));}});
