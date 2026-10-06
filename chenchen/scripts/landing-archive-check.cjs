'use strict';
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {chromium}=require('playwright');
const AxeBuilder=require('@axe-core/playwright').default;
const {server}=require('../server');
const output=path.resolve(__dirname,'../../screenshots');
const report=[];
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});
  try {
    for(const width of [1440,1024,375]) {
      const context=await browser.newContext({viewport:{width,height:width===375?844:1000}});
      const page=await context.newPage();
      const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      await page.goto(base);await page.evaluate(()=>document.fonts.ready);
      const initial=await page.locator('#k-upper').getAttribute('d');
      const at=async p=>{
        await page.evaluate(p=>{const s=document.querySelector('.scroll-story');scrollTo({top:(s.offsetHeight-s.firstElementChild.offsetHeight)*p,behavior:'instant'});},p);
        await page.waitForFunction(p=>Math.abs(Number(getComputedStyle(document.querySelector('.scroll-story')).getPropertyValue('--progress'))-p)<.002,p);
      };
      for(const progress of [...Array.from({length:101},(_,i)=>i/100),.96,.5,.25,0]) {
        await at(progress);
        const state=await page.evaluate(()=>{
          const visible=e=>{const c=getComputedStyle(e);return c.visibility!=='hidden'&&Number(c.opacity)>0;};
          const headings=[...document.querySelectorAll('.story-copy,.story-next')].filter(visible);
          const overlap=(a,b)=>a.x<b.right&&a.right>b.x&&a.y<b.bottom&&a.bottom>b.y;
          const action=document.querySelector('.story-action').getBoundingClientRect();
          const glyph=document.querySelector('.coin-glyph');
          return {progress:Number(getComputedStyle(document.querySelector('.scroll-story')).getPropertyValue('--progress')),headings:headings.length,overlap:headings.some(e=>overlap(e.getBoundingClientRect(),action)),overflow:document.documentElement.scrollWidth>innerWidth+1,angle:Number(document.querySelector('#coin').dataset.flipAngle),glyph:visible(glyph)};
        });
        assert(state.headings<=1,'title overlap '+JSON.stringify({width,progress,state}));
        assert(!state.overlap,'title/button overlap '+JSON.stringify({width,progress,state}));
        assert(!state.overflow,'overflow '+width);
        if(state.progress>=.18&&state.progress<=.31)assert.equal(state.headings,0,'quiet interval');
        if((state.angle>=60&&state.angle<=120)||(state.angle>=240&&state.angle<=300))assert(!state.glyph,'edge glyph');
      }
      assert.equal(await page.locator('#k-upper').getAttribute('d'),initial,'reversible K');
      for(const [name,p] of [['landing-hero',0],['landing-transition',.5],['coin-edge',.68996]]) {
        await at(p);
        if(name==='coin-edge')assert(Math.abs(Number(await page.locator('#coin').getAttribute('data-flip-angle'))-90)<1,'edge angle');
        if(width!==1024)await page.screenshot({path:path.join(output,name+'-'+(width===375?'mobile':'desktop')+'.png')});
      }
      await page.locator('#explore').scrollIntoViewIfNeeded();
      assert.equal(await page.getByRole('link',{name:'探索投资工作台'}).getAttribute('href'),'/investment');
      assert.equal(await page.getByRole('link',{name:'探索经营工作台'}).getAttribute('href'),'/merchant');
      const glass=await page.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&r.bottom>0&&r.top<innerHeight&&getComputedStyle(e).backdropFilter!=='none';}).length);
      assert(glass<=6,'glass count '+glass);
      await page.screenshot({path:path.resolve(__dirname,'../artifacts/archive/features-'+width+'.png')});
      for(const location of ['#explore','.scroll-story']){
        await page.locator(location).scrollIntoViewIfNeeded();
        const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
        assert.deepEqual(audit.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],'accessibility '+width);
      }
      await page.emulateMedia({reducedMotion:'reduce'});await page.reload();
      const reduced=await page.evaluate(()=>({story:document.querySelector('.scroll-story').offsetHeight,stage:document.querySelector('.story-stage').offsetHeight,animations:[...document.querySelectorAll('.archive-paper')].map(e=>getComputedStyle(e).animationName),transform:getComputedStyle(document.querySelector('.coin-flip')).transform}));
      assert.equal(reduced.story,reduced.stage);assert(reduced.animations.every(x=>x==='none'));assert.equal(reduced.transform,'none');
      assert.deepEqual(errors,[]);
      report.push({width,status:'passed',samples:105});console.log('PASS landing archive '+width);
      await context.close();
    }
    const page=await browser.newPage({javaScriptEnabled:false,viewport:{width:375,height:844}});
    await page.goto(base);assert(await page.locator('#story-title').isVisible());assert.equal(await page.getByRole('link',{name:'探索投资工作台'}).getAttribute('href'),'/investment');await page.close();
    fs.writeFileSync(path.join(output,'landing-report.json'),JSON.stringify(report,null,2));
  } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{fs.writeFileSync(path.join(output,'landing-failure.txt'),e.stack);console.error(e);process.exitCode=1;});
