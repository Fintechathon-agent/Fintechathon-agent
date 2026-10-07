'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const AxeBuilder=require('@axe-core/playwright').default;
const {server}=require('../server');
const output=path.resolve(__dirname,'../../screenshots');
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});
  const base='http://127.0.0.1:'+server.address().port,report=[];
  try {
    for(const width of [1440,1024,375]) {
      const context=await browser.newContext({viewport:{width,height:width===375?844:1000},hasTouch:width===375});
      const page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      await page.goto(base);
      const show=async i=>page.evaluate(i=>{const r=document.querySelectorAll('.feature-card')[i].getBoundingClientRect();scrollTo({top:scrollY+r.top-130,behavior:'instant'});},i);
      await show(0);
      await page.waitForFunction(()=>document.querySelector('.feature-card').dataset.ready==='true',{},{timeout:18000});
      if(width===375){await show(1);await page.waitForFunction(()=>[...document.querySelectorAll('.feature-card')].every(e=>e.dataset.ready==='true'),{},{timeout:15000});await show(0);}
      await page.waitForFunction(()=>document.querySelector('.feature-grid').dataset.motion==='breathing');
      await page.waitForTimeout(1600);
      assert.equal(await page.locator('.liquid-water').first().evaluate(e=>getComputedStyle(e).opacity),'0.6');
      const canvasBefore=await page.locator('.liquid-water').first().evaluate(e=>e.toDataURL());
      await page.waitForTimeout(700);
      assert.notEqual(await page.locator('.liquid-water').first().evaluate(e=>e.toDataURL()),canvasBefore,'gentle breathing');
      assert.equal(Number(await page.locator('.feature-grid').getAttribute('data-theta')),0,'breathing leaves beam still');
      if(width===375){assert.equal(await page.locator('.pour-hint').first().evaluate(e=>getComputedStyle(e).opacity),'1');assert(await page.locator('.hint-cn').first().isVisible());}
      await page.locator('.liquid-vessel').first().click();await page.waitForTimeout(250);
      assert.equal(await page.locator('.liquid-water').first().evaluate(e=>getComputedStyle(e).opacity),'1','interaction restores brightness');
      await page.locator('.section-heading').evaluate(e=>scrollTo({top:scrollY+e.getBoundingClientRect().top-120,behavior:'instant'}));
      const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,glass:[...document.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&r.top<innerHeight&&r.bottom>0&&getComputedStyle(e).backdropFilter!=='none';}).length,headingBlur:getComputedStyle(document.querySelector('.section-heading')).backdropFilter,overlap:[...document.querySelectorAll('.balance-caption')].some(e=>{const a=e.firstElementChild.getBoundingClientRect(),b=e.lastElementChild.getBoundingClientRect();return a.right>b.left;})}));
      assert(!metrics.overflow);assert(!metrics.overlap);assert(metrics.glass<=6);assert.match(metrics.headingBlur,/blur/);
      const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
      if(width!==1024)await page.screenshot({path:path.join(output,'explore-quiet-'+(width===375?'mobile':'desktop')+'.png')});
      await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(100);assert.equal(await page.locator('.feature-grid').getAttribute('data-running'),'false');
      await page.emulateMedia({reducedMotion:'reduce'});await show(0);await page.reload();await show(0);await page.waitForTimeout(200);
      assert.equal(await page.locator('.feature-grid').getAttribute('data-running'),'false');
      const reducedCanvas=await page.locator('.liquid-water').first().evaluate(e=>e.toDataURL());await page.waitForTimeout(300);assert.equal(await page.locator('.liquid-water').first().evaluate(e=>e.toDataURL()),reducedCanvas);
      assert.deepEqual(errors,[]);report.push({width,status:'passed',glass:metrics.glass});console.log('PASS quiet explore '+width);await context.close();
    }
    fs.writeFileSync(path.join(output,'explore-quiet-report.json'),JSON.stringify(report,null,2));
  } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
