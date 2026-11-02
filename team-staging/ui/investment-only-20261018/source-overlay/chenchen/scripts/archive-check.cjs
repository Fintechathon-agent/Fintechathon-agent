'use strict';
// Isolated synthetic-data browser checks for the archive presentation migration.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { server } = require('../server');
const mode = process.argv[2] || 'baseline';
const output = path.resolve(__dirname, '../artifacts/archive');
const properties = ['display','position','color','backgroundColor','backgroundImage','fontSize','fontWeight','lineHeight','padding','margin','border','borderRadius','boxShadow','backdropFilter','gridTemplateColumns','width','height'];
(async () => {
  fs.mkdirSync(output, {recursive:true});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({channel:'chrome', headless:true, args:['--disable-gpu']});
  const results = [];
  try {
    for (const width of [1440,1024,375]) {
      for (const route of (mode==='catalog'?['/catalog']:['/', '/investment', '/catalog'])) {
        const page = await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
        await page.goto(base + route);
        if (route==='/investment') await page.waitForFunction(() => document.querySelector('#run')?.disabled===false);
        await page.evaluate(() => document.fonts.ready);
        const name = (route==='/'?'landing':route.slice(1)) + '-' + width;
        const snapshot = await page.evaluate(props => ({
          overflow:document.documentElement.scrollWidth > innerWidth + 1,
          nodes:[...document.querySelectorAll('body,body *')].filter(e=>e.getClientRects().length && !['SCRIPT','STYLE','LINK'].includes(e.tagName)).map(e=>{
            const css=getComputedStyle(e), rect=e.getBoundingClientRect();
            return {tag:e.tagName,id:e.id,style:Object.fromEntries(props.map(p=>[p,css[p]])),box:[rect.x,rect.y,rect.width,rect.height].map(n=>Math.round(n*100)/100)};
          })
        }), properties);
        assert.equal(snapshot.overflow,false,name+' horizontal overflow');
        assert.deepEqual(errors,[],name+' console errors');
        if (mode==='baseline') fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(snapshot));
        if (mode==='consolidation') assert.deepEqual(snapshot,JSON.parse(fs.readFileSync(path.join(output,name+'.json'),'utf8')),name+' visual geometry and computed styles changed');
        if (mode==='catalog') {
          // Merchant removal intentionally changes the old two-product geometry.
          assert.equal(await page.locator('.catalog-grid > article').count(),1);
          assert.equal(await page.locator('a[href*="merchant"]').count(),0);
          assert.doesNotMatch(await page.locator('body').innerText(),/双场景|两种场景|店主财务助手/);
          assert.match(await page.locator('body').innerText(),/31,080\.00/);
          const boxes=await page.locator('.catalog-grid > article').evaluateAll(items=>items.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};}));
          assert.ok(boxes.every(r=>r.left>=0 && r.right<=width+1 && r.width>0));
          const clippedValues=await page.locator('.choice-snapshot strong').evaluateAll(items=>items.flatMap(el=>{
            const range=document.createRange();range.selectNodeContents(el);
            const text=range.getBoundingClientRect(),cell=el.parentElement.getBoundingClientRect();
            return text.left<cell.left-1||text.right>cell.right+1?[el.textContent]:[];
          }));
          assert.deepEqual(clippedValues,[],name+' snapshot values stay inside their cells');
        }
        await page.screenshot({path:path.join(output,mode+'-'+name+'.png'),fullPage:true,animations:'disabled'});
        results.push({name,status:'passed'});
        console.log('PASS '+mode+' '+name);
        await page.close();
      }
    }
    fs.writeFileSync(path.join(output,mode+'-report.json'),JSON.stringify(results,null,2));
  } finally {
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
