'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {server}=require('../server');
const output=path.resolve(__dirname,'../../screenshots');
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});
  const base='http://127.0.0.1:'+server.address().port, report=[];
  try {
    for(const width of [1440,1024,375]) {
      const context=await browser.newContext({viewport:{width,height:width===375?844:1000}}),page=await context.newPage();
      const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      await page.goto(base);
      const cards=page.locator('.feature-card'),buttons=page.locator('.liquid-vessel');
      const show=async i=>page.evaluate(i=>{const r=document.querySelectorAll('.feature-card')[i].getBoundingClientRect();scrollTo({top:scrollY+r.top-120,behavior:'instant'});},i);
      await show(0);
      await page.waitForFunction(()=>document.querySelector('.feature-card').dataset.phase==='intro');
      await buttons.first().focus();await page.keyboard.press('Enter');
      assert.equal(Number(await cards.first().getAttribute('data-level')),0,'intro ignores click');
      await page.waitForTimeout(2200);
      assert(Number(await cards.first().getAttribute('data-level'))>0,'left stream');
      assert.equal(Number(await cards.nth(1).getAttribute('data-level')),0,'left before right');
      if(width===1440)await page.screenshot({path:path.join(output,'feature-balance-intro-desktop.png')});
      if(width===375){
        assert.equal(await cards.nth(1).getAttribute('data-phase'),'waiting','stacked independent intro');
        await page.waitForFunction(()=>document.querySelector('.feature-card').dataset.ready==='true');
        await show(1);
      }
      await page.waitForFunction(()=>[...document.querySelectorAll('.feature-card')].every(e=>e.dataset.ready==='true'),{},{timeout:15000});
      await page.waitForFunction(()=>Math.abs(Number(document.querySelector('.feature-grid').dataset.theta))<.03);
      await show(0);
      for(let i=0;i<3;i++)await buttons.first().click();
      await page.waitForFunction(()=>Number(document.querySelector('.feature-card').dataset.level)>.57);
      await page.waitForFunction(()=>Number(document.querySelector('.feature-grid').dataset.theta)>3);
      await show(0);await page.waitForTimeout(100);
      if(width===1440)await page.screenshot({path:path.join(output,'feature-balance-tilt-desktop.png')});
      if(width===375)await page.screenshot({path:path.join(output,'feature-balance-mobile.png')});
      for(let i=0;i<6;i++)await buttons.first().click();
      await page.waitForFunction(()=>Number(document.querySelector('.feature-card').dataset.level)>=.999);
      assert.equal(await buttons.first().getAttribute('aria-disabled'),'true');
      assert.match(await buttons.first().getAttribute('aria-label'),/已满/);
      await buttons.first().focus();await page.keyboard.press('Enter');
      assert.equal(Number(await cards.first().getAttribute('data-pending')),0,'full rejects new drops');
      assert.equal(Number(await cards.first().getAttribute('data-level')),1);
      const url=page.url();assert.equal(new URL(url).pathname,'/','pour does not navigate');
      await page.waitForFunction(()=>Number(document.querySelector('.feature-card').dataset.level)<=.34001,{},{timeout:25000});
      await page.waitForFunction(()=>Math.abs(Number(document.querySelector('.feature-grid').dataset.theta))<.02);
      assert.equal(await buttons.first().getAttribute('aria-disabled'),'false');
      await page.waitForFunction(()=>document.querySelector('.feature-grid').dataset.motion==='breathing',{},{timeout:12000});
      const geometry=await page.evaluate(()=>{
        const cards=[...document.querySelectorAll('.feature-card')],vessels=cards.map(c=>c.querySelector('.liquid-vessel').getBoundingClientRect());
        return {overflow:document.documentElement.scrollWidth>innerWidth+1,aligned:Math.abs(vessels[0].top-vessels[1].top)<1,overlap:cards.some(c=>{const h=c.querySelector('.pour-hint'),b=c.querySelector('.balance-caption b'),hr=h.getBoundingClientRect(),br=b.getBoundingClientRect();return getComputedStyle(h).display!=='none'&&hr.right>br.left;}),dpr:[...document.querySelectorAll('.liquid-water')].every(c=>c.width<=c.clientWidth*2+1)};
      });
      assert(!geometry.overflow);assert(!geometry.overlap);assert(geometry.dpr);if(width>700)assert(geometry.aligned);
      await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(100);
      assert.equal(await page.locator('.feature-grid').getAttribute('data-running'),'false','offscreen stopped');
      await show(0);assert.equal(await cards.first().getAttribute('data-phase'),'ready','intro does not replay');
      assert.deepEqual(errors,[]);await context.close();
      const simple=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),q=await simple.newPage();await q.goto(base);
      await q.locator('.feature-card').first().scrollIntoViewIfNeeded();
      const button=q.locator('.liquid-vessel').first();await button.focus();await q.keyboard.press('Enter');
      assert.equal(Number(await q.locator('.feature-card').first().getAttribute('data-level')),.42);
      assert.equal(Number(await q.locator('.feature-card').first().getAttribute('data-pending')),0);
      await q.keyboard.press('Space');assert.equal(Number(await q.locator('.feature-card').first().getAttribute('data-level')),.5);
      await q.getByRole('link',{name:'探索投资工作台'}).click();await q.locator('#run:not([disabled])').waitFor();
      await simple.close();report.push({width,status:'passed'});console.log('PASS liquid balance '+width);
    }
    fs.writeFileSync(path.join(output,'feature-balance-report.json'),JSON.stringify(report,null,2));
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
