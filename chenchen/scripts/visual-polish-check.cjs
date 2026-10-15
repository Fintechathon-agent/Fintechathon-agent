'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const load=createRequire(path.join(process.env.UI_MODULE_ROOT,'..','package.json'));
const {chromium}=load('playwright');const Axe=load('@axe-core/playwright').default;
const {server}=require('../server');
const out=path.resolve(__dirname,'../../review/brand-final');fs.mkdirSync(out,{recursive:true});
let browser;const errors=[],checks=[];
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});const p=await context.newPage();
 p.on('pageerror',e=>errors.push(e.message));let posts=0;p.on('request',r=>{if(r.method()==='POST')posts++;});
 await p.goto(base+'/workspace.html');
 assert.equal(await p.locator('.brand-options').count(),0);
 await p.locator('.workspace-brand').screenshot({path:path.join(out,'brand-final.png')});
 assert.match(await p.locator('.workspace-brand').textContent(),/KFinance Lab/);
 await p.goto(base+'/workspace.html?brand=a');
 assert.equal(await p.locator('[data-brand]').count(),0);
 assert.doesNotMatch(await p.locator('body').textContent(),/昕澜|听澜|版本 A|版本 B/);
 checks.push('Approved B brand is unconditional, including legacy preview URLs');
 for(const view of ['workspace','banking','tasks','safety']){
   await p.locator('[data-view='+view+']').click();
   await p.waitForFunction(v=>document.querySelector('[data-panel="'+v+'"]').classList.contains('is-active'),view);
   await p.waitForTimeout(800);
   assert.equal(await p.locator('[data-panel].is-active').count(),1);
   assert.equal(await p.locator('[data-view='+view+']').getAttribute('aria-current'),'location');
   await p.screenshot({path:path.join(out,'active-'+view+'.png')});
 }
 checks.push('Four navigation targets synchronize one active container');
 await p.evaluate(()=>scrollTo(0,0));await p.waitForTimeout(500);
 const seen=new Set();
 for(let i=0;i<26;i++){await p.mouse.wheel(0,280);await p.waitForTimeout(120);seen.add(await p.locator('[data-panel].is-active').getAttribute('data-panel'));}
 assert.deepEqual([...seen].sort(),['banking','safety','tasks','workspace']);assert.equal(posts,0);
 checks.push('Real wheel scrolling visits all four active regions without POST requests');
 await p.locator('footer').screenshot({path:path.join(out,'footer-after.png')});
 await p.emulateMedia({reducedMotion:'reduce'});await p.locator('[data-view=workspace]').click();
 assert.equal(await p.locator('[data-panel].is-active').evaluate(e=>getComputedStyle(e).transform),'none');
 checks.push('Reduced motion removes floating transforms');
 for(const width of [1024,390,375]){
   await p.setViewportSize({width,height:844});
   for(const view of ['workspace','banking','tasks','safety']){
     await p.locator('[data-view='+view+']').click();await p.waitForTimeout(150);
     assert.equal(await p.locator('[data-panel].is-active').getAttribute('data-panel'),view);
     assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
     if(view==='banking'||view==='workspace') await p.screenshot({path:path.join(out,view+'-'+width+'.png')});
   }
 }
 await p.locator('[data-view=workspace]').click();await p.screenshot({path:path.join(out,'mobile.png')});
 checks.push('Navigation, focus and layout at 1024/390/375');
 const axe=(await new Axe({page:p}).analyze()).violations;fs.writeFileSync(path.join(out,'axe.json'),JSON.stringify(axe,null,2));assert.deepEqual(axe.map(x=>x.id),[]);
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({checks,errors,axeViolations:axe.length},null,2));console.log(JSON.stringify({checks,errors}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();server.closeAllConnections();server.close()});
