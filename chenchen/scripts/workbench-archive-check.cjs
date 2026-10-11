'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),Axe=require('@axe-core/playwright').default,{server}=require('../server');
const routes=process.argv[2]?[process.argv[2]]:['investment','merchant'];
const output=path.resolve(__dirname,'../../screenshots');
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({channel:'chrome',args:['--disable-gpu']});
  const report=[];
  try{for(const route of routes)for(const width of [1440,1024,375]){
    const context=await browser.newContext({viewport:{width,height:width===375?844:1000}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto('http://127.0.0.1:'+server.address().port+'/'+route);
    await page.locator(route==='investment'?'#run:not([disabled])':'#quick-bills .bill-preview').first().waitFor();
    await page.waitForTimeout(380);
    const measure=async()=>{
      const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,brand:getComputedStyle(document.body).getPropertyValue('--brand-orange').trim(),signals:document.querySelectorAll('.signal-focus').length,glass:[...document.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&!e.closest('[hidden]')&&getComputedStyle(e).backdropFilter!=='none';}).length}));
      assert(!state.overflow,route+' overflow '+width);assert.equal(state.brand,'');assert(state.signals<=1);assert(state.glass<=6,JSON.stringify(state));
    };
    const capture=async name=>{if(width!==1024){await page.evaluate(()=>document.activeElement?.blur());await page.screenshot({path:path.join(output,name+'-'+(width===375?'mobile':'desktop')+'.png')});}};
    assert.match(await page.locator(route==='investment'?'#portfolio-total':'#merchant-status').innerText(),route==='investment'?/31,080\.00/:/6,200\.00/);
    await measure();await capture(route+'-data');
    if(route==='investment'){
      await page.waitForFunction(()=>document.querySelector('#run').classList.contains('signal-focus'));
      assert.equal(await page.locator('#journey-evidence').getAttribute('aria-disabled'),'true');
      await page.locator('[data-step="1"]').click();await page.locator('#demo-profile').click();await page.locator('#run').click();
      await page.locator('#results:not([hidden])').waitFor();await page.waitForTimeout(500);
      await page.locator('.result-verdict').evaluate(e=>scrollTo({top:scrollY+e.getBoundingClientRect().top-140,behavior:'instant'}));
      await page.waitForFunction(()=>document.querySelector('.result-verdict').classList.contains('signal-focus'));
      await measure();await capture('investment-result');
      await page.locator('.plan-card summary').first().click();assert(await page.locator('.plan-card .weight-list').first().isVisible());
      await page.locator('[data-step="3"]').click();await page.waitForFunction(()=>document.querySelector('[data-step="3"]').getAttribute('aria-current')==='step');
      assert.equal(await page.locator('#evidence-panel').getAttribute('open'),'');
      await page.locator('[data-step="1"]').click();await page.locator('#horizon').fill('730');
      await page.waitForFunction(()=>document.querySelector('#journey-evidence').getAttribute('aria-disabled')==='true');assert(!(await page.locator('#results').isVisible()));
    }else{
      assert.match(await page.locator('#cash-callout-title').innerText(),/10-10/);assert.match(await page.locator('#cash-callout-copy').innerText(),/3,628\.20/);
      await page.locator('[data-step="1"]').click();await page.locator('#quick-bills .evidence').first().click();
      await page.locator('#bill-dialog[open]').waitFor();await measure();await page.locator('#close-dialog').click();
      await page.locator('#confirm').check();await page.locator('#review').click();await page.locator('#insights .insight').first().waitFor();
      for(const step of ['2','3','1']){await page.locator('[data-step="'+step+'"]').click();await page.waitForFunction(s=>document.querySelector('[data-step="'+s+'"]').getAttribute('aria-current')==='step',step);await measure();}
      const sections=await page.evaluate(()=>{const a=document.querySelector('#cash-panel').getBoundingClientRect(),b=document.querySelector('#cost-panel').getBoundingClientRect();return a.bottom<=b.top;});assert(sections,'cash and cost stack');
    }
    const height=await page.evaluate(()=>document.documentElement.scrollHeight);
    for(let y=0;y<height;y+=600){await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);await page.waitForTimeout(35);await measure();}
    const axe=await new Axe({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
    await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(100);
    assert.equal(await page.locator('.archive-paper-primary').evaluate(e=>getComputedStyle(e).animationName),'none');
    assert.deepEqual(errors,[]);report.push({route,width,status:'passed'});console.log('PASS archive '+route+' '+width);await context.close();
  }}finally{await browser.close();await new Promise(r=>server.close(r));}
  fs.writeFileSync(path.join(output,'workbench-'+routes.join('-')+'-report.json'),JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
