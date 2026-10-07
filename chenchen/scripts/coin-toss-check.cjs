'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require('playwright'),{server}=require('../server');
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});
  const results=[];
  try{for(const width of (process.argv.length>2?process.argv.slice(2).map(Number):[1440,1024,375])){
    const context=await browser.newContext({viewport:{width,height:width===375?844:1000},hasTouch:width===375}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto('http://127.0.0.1:'+server.address().port);
    assert.equal(await page.locator('[data-toss-metal]').evaluate(e=>getComputedStyle(e).opacity),'1','cloned metal must not inherit the hidden hero state');
    const show=async i=>page.evaluate(i=>{const c=document.querySelectorAll('.feature-card')[i];scrollTo({top:scrollY+c.getBoundingClientRect().top-120,behavior:'instant'});},i);
    await show(0);await page.waitForFunction(()=>document.querySelector('.feature-card').dataset.ready==='true',null,{timeout:18000});
    if(width===375){await show(1);await page.waitForFunction(()=>[...document.querySelectorAll('.feature-card')].every(c=>c.dataset.ready==='true'),null,{timeout:15000});}
    await page.waitForFunction(()=>Number(document.querySelector('.feature-grid').dataset.tossImpacts)>=2,null,{timeout:18000});
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    const hiddenState=await page.locator('.balance-coin').getAttribute('style');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.feature-grid').getAttribute('data-running'),'false','visibility event stops the shared frame loop');
    assert.equal(await page.locator('.balance-coin').getAttribute('style'),hiddenState);
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
    await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(100);
    const offscreenCount=await page.locator('.feature-grid').getAttribute('data-toss-impacts');
    await page.waitForTimeout(500);assert.equal(await page.locator('.feature-grid').getAttribute('data-toss-impacts'),offscreenCount);
    assert.equal(await page.locator('.feature-grid').getAttribute('data-running'),'false','offscreen flight pauses');
    await show(width===375?1:0);
    const before=Number(await page.locator('.feature-grid').getAttribute('data-toss-impacts'));
    const box=await page.locator('.liquid-vessel').nth(width===375?1:0).boundingBox();
    await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
    assert.equal(await page.locator('.feature-grid').getAttribute('data-toss-phase'),'paused');
    await page.waitForTimeout(1200);assert.equal(Number(await page.locator('.feature-grid').getAttribute('data-toss-impacts')),before,'pause preserves count');
    await page.waitForFunction(()=>document.querySelector('.feature-grid').dataset.tossPhase==='flight',null,{timeout:18000});
    await page.waitForFunction(()=>{const g=document.querySelector('.feature-grid');return g.dataset.tossPhase==='flight'&&Number(g.dataset.tossProgress)>.3&&Number(g.dataset.tossProgress)<.7;});
    if(width===375)await page.locator('.balance-coin').evaluate(e=>scrollTo({top:scrollY+e.getBoundingClientRect().top-200,behavior:'instant'}));
    else await page.locator('.section-heading').evaluate(e=>scrollTo({top:scrollY+e.getBoundingClientRect().top-110,behavior:'instant'}));
    if(width!==1024)await page.screenshot({path:path.resolve('../screenshots/coin-toss-'+(width===375?'mobile':'desktop')+'.png')});
    let max=0;const deadline=Date.now()+75000;
    while(await page.locator('.feature-grid').getAttribute('data-toss-phase')!=='rest'){
      assert(Date.now()<deadline,'loop completes within bounded time');
      const state=await page.evaluate(()=>({levels:[...document.querySelectorAll('.feature-card')].map(c=>Number(c.dataset.level)),overflow:document.documentElement.scrollWidth>innerWidth+1,coin:document.querySelector('.balance-coin').getBoundingClientRect().top,title:document.querySelector('.section-heading').getBoundingClientRect().bottom,overlaps:[...document.querySelectorAll('.feature-card h3,.feature-link,.card-top span,.section-heading')].filter(e=>{const a=e.getBoundingClientRect(),b=document.querySelector('.balance-coin').getBoundingClientRect();return a.width>0&&b.left<a.right&&b.right>a.left&&b.top<a.bottom&&b.bottom>a.top;}).map(e=>e.className||e.tagName)}));
      max=Math.max(max,...state.levels);assert(!state.overflow);assert.deepEqual(state.overlaps,[],'coin avoids reading and action areas');assert(state.coin>=state.title-1,'coin stays below section title');
      await page.waitForTimeout(150);
    }
    assert(max<1);assert.equal(await page.locator('.feature-grid').getAttribute('data-toss-impacts'),'9');assert.equal(await page.locator('.feature-grid').getAttribute('data-toss-trips'),'4');
    const levels=await page.locator('.feature-card').evaluateAll(cs=>cs.map(c=>Number(c.dataset.level)));assert.deepEqual(levels,[.34,.34]);assert(Math.abs(Number(await page.locator('.feature-grid').getAttribute('data-theta')))<.02);
    if(width===1440)await page.screenshot({path:path.resolve('../screenshots/coin-rest-desktop.png')});
    await page.locator('.liquid-vessel').first().focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('.feature-grid').getAttribute('data-toss-phase'),'rest','finished loop stays finished after keyboard input');
    await page.waitForTimeout(500);assert.equal(await page.locator('.feature-grid').getAttribute('data-toss-impacts'),'9');
    await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(100);assert.equal(await page.locator('.feature-grid').getAttribute('data-running'),'false');
    await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await show(0);await page.waitForTimeout(200);assert.equal(await page.locator('.feature-grid').getAttribute('data-toss-impacts'),'0');
    assert.equal(await page.locator('.feature-grid').getAttribute('data-toss-phase'),'reduced');
    const staticTransform=await page.locator('.balance-coin').getAttribute('style');await page.waitForTimeout(400);
    assert.equal(await page.locator('.balance-coin').getAttribute('style'),staticTransform);
    assert.equal(await page.locator('.feature-grid').getAttribute('data-running'),'false');
    assert.deepEqual(errors,[]);results.push({width,roundTrips:4,maxLevel:max,passed:true});console.log('PASS coin '+width);await context.close();
  }}finally{await browser.close();await new Promise(r=>server.close(r));}
  fs.writeFileSync(path.resolve(__dirname,'../../screenshots/coin-toss-report.json'),JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
