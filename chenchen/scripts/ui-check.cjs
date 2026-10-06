'use strict';
// Run against an isolated ephemeral server and synthetic data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const { server } = require('../server');
const output = path.resolve(process.env.UI_REPORT_DIR || path.join(__dirname, '../artifacts/ui'));
const results = [];
let browser, context, page, base;

async function check(name, action) {
  const start = Date.now();
  try {
    await action(); results.push({name, status:'passed', duration_ms:Date.now()-start});
    console.log('PASS '+name);
  } catch (error) {
    results.push({name, status:'failed', error:error.message});
    if (page) await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
    throw error;
  }
}

async function screenshot(name, fullPage = false) {
  await page.evaluate(() => { window.scrollTo({top:0,behavior:'instant'}); document.activeElement?.blur(); });
  await page.screenshot({ path:path.join(output,name+'.png'), fullPage, animations:'disabled' });
}

async function noOverflow() {
  const sizes = await page.evaluate(() => ({viewport:innerWidth, document:document.documentElement.scrollWidth}));
  assert.ok(sizes.document<=sizes.viewport+1, JSON.stringify(sizes));
}

async function accessible() {
  const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  assert.deepEqual(audit.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)})),[]);
}

(async()=>{
  fs.mkdirSync(output,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}), args:['--disable-gpu']});
  context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await check('showcase is the default entry with working product links',async()=>{
    await page.goto(base); assert.equal(await page.locator('#story-title').count(),1);
    assert.equal(await page.locator('#check-form').count(),0);
    await screenshot('landing-desktop'); await accessible();
    await page.getByRole('link',{name:'探索投资工作台'}).click();
    await page.locator('#run:not([disabled])').waitFor();
    await page.getByRole('link',{name:'Finance Lab 展示首页'}).click();
    await page.getByRole('link',{name:'探索经营工作台'}).click();
    await page.locator('#quick-bills .bill-preview').first().waitFor();
  });
  await check('K rotates into a large coin before traveling right and shrinking; scrolling reverses it',async()=>{
    await page.emulateMedia({reducedMotion:'no-preference'}); await page.goto(base);
    const distance=await page.locator('.scroll-story').evaluate(el=>el.offsetHeight-el.firstElementChild.offsetHeight);
    const at=async progress=>{
      await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),distance*progress);
      await page.waitForFunction(p=>Math.abs(Number(getComputedStyle(document.querySelector('.scroll-story')).getPropertyValue('--progress'))-p)<.005,progress);
    };
    const opacity=selector=>page.locator(selector).evaluate(el=>Number(getComputedStyle(el).opacity));
    assert.equal(await page.locator('#pencil').count(),0);
    assert.equal(await opacity('.coin-material'),0); assert.equal(await opacity('#k-spine'),1);
    const initialPath=await page.locator('#k-upper').getAttribute('d');
    const initialBounds=await page.locator('#coin').boundingBox();
    await screenshot('landing-desktop');
    await at(.25);
    assert.notEqual(await page.locator('#k-upper').getAttribute('d'),initialPath);
    const rotation=Number((await page.locator('#k-arms').getAttribute('transform')).match(/rotate\(([^ ]+)/)[1]);
    assert.ok(rotation>0 && rotation<360);
    await page.screenshot({path:path.join(output,'landing-k-morph.png')});
    await at(.5);
    assert.equal(await opacity('.coin-material'),1); assert.equal(await opacity('#k-spine'),0);
    const large=await page.locator('#coin').boundingBox();
    assert.ok(Math.abs(large.x-initialBounds.x)<1); assert.ok(Math.abs(large.width-initialBounds.width)<1);
    await page.screenshot({path:path.join(output,'landing-large-coin.png')});
    await at(.96);
    const moved=await page.locator('#coin').boundingBox();
    assert.ok(moved.x>large.x+300); assert.ok(moved.width<large.width*.65);
    await page.screenshot({path:path.join(output,'landing-scroll.png')});
    await page.locator('#explore').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#explore-title').isVisible(),true);
    await page.screenshot({path:path.join(output,'landing-features.png')});
    await at(.5); assert.equal(await opacity('.coin-material'),1);
    await at(0); assert.equal(await opacity('.coin-material'),0);
    assert.equal(await page.locator('#k-upper').getAttribute('d'),initialPath);
    await page.mouse.wheel(0,350);
    await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.scroll-story')).getPropertyValue('--progress'))>.1);
    await page.mouse.wheel(0,-2000);
    await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.scroll-story')).getPropertyValue('--progress'))===0);
    await page.setViewportSize({width:390,height:844}); await page.reload();
    await page.screenshot({path:path.join(output,'landing-mobile-start.png')});
    const mobileDistance=await page.locator('.scroll-story').evaluate(el=>el.offsetHeight-el.firstElementChild.offsetHeight);
    for(const progress of [.25,.5,.96]) {
      await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),mobileDistance*progress);
      await page.waitForFunction(p=>Math.abs(Number(getComputedStyle(document.querySelector('.scroll-story')).getPropertyValue('--progress'))-p)<.005,progress);
      await noOverflow();
      const artwork=await page.locator(progress<.44?'#k-arms':'.coin-material').boundingBox();
      assert.ok(artwork.x>=0 && artwork.x+artwork.width<=390,JSON.stringify(artwork));
      await page.screenshot({path:path.join(output,'landing-mobile-'+progress+'.png')});
    }
    await page.emulateMedia({reducedMotion:'reduce'}); await page.setViewportSize({width:1440,height:1000});
  });
  await check('product pages contain no community promotion or design-conversation copy',async()=>{
    for(const route of ['/','/investment','/merchant','/catalog']) {
      await page.goto(base+route);
      assert.doesNotMatch(await page.locator('body').innerText(),/KOSX|社群|视觉灵感|视觉风格探索/);
      assert.equal(await page.locator('a[href*="kosx.ai"]').count(),0);
    }
  });
  await check('reduced motion and JavaScript disabled keep all destinations available',async()=>{
    await page.goto(base);
    const heights=await page.locator('.scroll-story').evaluate(el=>({story:el.offsetHeight,stage:el.firstElementChild.offsetHeight}));
    assert.equal(heights.story,heights.stage);
    const offlineContext=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
    try {
      const staticPage=await offlineContext.newPage(); await staticPage.goto(base);
      await staticPage.getByRole('link',{name:'探索功能',exact:true}).click();
      assert.equal(await staticPage.locator('#explore-title').isVisible(),true);
      assert.equal(await staticPage.getByRole('link',{name:'探索经营工作台'}).getAttribute('href'),'/merchant');
    } finally { await offlineContext.close(); }
  });
  await check('frosted workspace and dialog materials are applied',async()=>{
    await page.goto(base+'/merchant'); await page.locator('#quick-bills .evidence').first().click();
    await page.locator('#bill-dialog[open]').waitFor();
    const material=await page.locator('#bill-dialog').evaluate(el=>({blur:getComputedStyle(el).backdropFilter,radius:getComputedStyle(el).borderRadius}));
    assert.match(material.blur,/blur/); assert.equal(material.radius,'18px');
    await page.screenshot({path:path.join(output,'merchant-glass-dialog.png')});
    await page.keyboard.press('Escape');
  });
  await check('investment snapshot, allocation and desktop layout',async()=>{
    await page.goto(base+'/investment'); await page.locator('#run:not([disabled])').waitFor();
    assert.match(await page.locator('#portfolio-total').innerText(),/31,080/);
    assert.equal(await page.locator('#allocation-legend li').count(),5);
    assert.equal(await page.locator('.workspace-switch [aria-current]').innerText(),'个人投资顾问\n01');
    await noOverflow(); await screenshot('investment-desktop');
  });
  await check('investment diagnosis, candidate details, evidence and JSON export',async()=>{
    await page.click('#demo-profile'); await page.click('#run');
    await page.locator('#results:not([hidden])').waitFor();
    assert.equal(await page.locator('.plan-card').count(),3);
    await accessible();
    await page.locator('.plan-card summary').first().click();
    assert.ok(await page.locator('.plan-card .weight-list').first().isVisible());
    await page.getByText('任务状态与工具证据',{exact:true}).click();
    const downloadPromise=page.waitForEvent('download'); await page.click('#export');
    const download=await downloadPromise;
    const downloaded=path.join(output,'analysis.json'); await download.saveAs(downloaded);
    assert.equal(JSON.parse(fs.readFileSync(downloaded)).task_state.status,'HANDOFF_REQUIRED');
    await page.getByText('任务状态与工具证据',{exact:true}).click();
    await screenshot('investment-results-desktop',true);
  });
  await check('changing investment input invalidates previous conclusions',async()=>{
    await page.locator('#input-panel>summary').click(); await page.fill('#horizon','730');
    assert.equal(await page.locator('#results').isVisible(),false);
    assert.equal(await page.locator('#input-changed').isVisible(),true);
  });
  await check('invalid JSON keeps input and shows a persistent recovery message',async()=>{
    await page.getByText('替换组合 JSON',{exact:true}).click();
    await page.fill('#portfolio-json','{broken'); await page.click('#run');
    await page.locator('#run-feedback[data-state="error"]').waitFor();
    assert.match(await page.locator('#run-feedback').innerText(),/JSON 格式/);
    assert.equal(await page.locator('#portfolio-json').inputValue(),'{broken');
    assert.equal(await page.locator('#run').isEnabled(),true);
  });
  await check('failed investment initialization retries without page reload',async()=>{
    await page.route('**/api/demo/portfolio',route=>route.abort());
    await page.goto(base+'/investment'); await page.locator('#retry-load:not([hidden])').waitFor();
    assert.equal(await page.locator('#run').isDisabled(),true);
    await page.unroute('**/api/demo/portfolio'); await page.click('#retry-load');
    await page.locator('#run:not([disabled])').waitFor();
    assert.match(await page.locator('#portfolio-total').innerText(),/31,080/);
  });
  await check('in-flight investment result cannot overwrite changed input',async()=>{
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    await page.route('**/api/health-check/run',async route=>{
      const response=await route.fetch(); await gate; await route.fulfill({response});
    });
    try {
      await page.click('#demo-profile'); await page.click('#run');
      await page.fill('#horizon','900'); release();
      await page.locator('#run:not([disabled])').waitFor();
      assert.equal(await page.locator('#results').isVisible(),false);
      assert.equal(await page.locator('#input-changed').isVisible(),true);
    } finally { release(); await page.unroute('**/api/health-check/run'); }
  });
  await check('merchant overview, review gate and bill source dialog',async()=>{
    await page.goto(base+'/merchant'); await page.locator('#quick-bills .bill-preview').first().waitFor();
    assert.match(await page.locator('#merchant-status').innerText(),/6,200/);
    assert.equal(await page.locator('#review').isDisabled(),true);
    await screenshot('merchant-desktop');
    await page.locator('#quick-bills .evidence').first().click();
    await page.locator('#bill-dialog[open]').waitFor();
    assert.match(await page.locator('#bill-detail').innerText(),/原始来源/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#bill-dialog').isVisible(),false);
    await page.waitForFunction(()=>document.querySelector('#quick-bills .evidence')===document.activeElement);
    await page.check('#confirm'); assert.equal(await page.locator('#review').isEnabled(),true);
    await page.click('#review'); await page.locator('#insights .insight').first().waitFor();
    assert.equal(await page.locator('#export-review').isEnabled(),true);
  });
  await check('merchant note and processing status persist across reload',async()=>{
    await page.locator('#insights .insight summary').first().click();
    await page.locator('.notice-note-input').first().fill('已联系平台，等待回款。');
    await page.locator('.note-save').first().click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent==='处理备注已保存。');
    await page.locator('.notice-status').first().selectOption('verified');
    await page.waitForFunction(()=>document.querySelector('#status').textContent==='提醒状态已更新。');
    await page.reload(); await page.locator('#insights .insight').first().waitFor();
    assert.ok((await page.locator('.notice-note-input').evaluateAll(items=>items.map(item=>item.value))).includes('已联系平台，等待回款。'));
    assert.ok((await page.locator('.notice-status').evaluateAll(items=>items.map(item=>item.value))).includes('verified'));
  });
  await check('merchant search empty state and clear filters',async()=>{
    await page.getByText('展开全部账单与筛选',{exact:true}).click();
    await page.fill('#search','no-matching-bill-123');
    assert.match(await page.locator('#bills').innerText(),/没有符合/);
    await page.click('#clear-filters'); assert.equal(await page.locator('#quick-bills .bill-preview').count(),3);
  });
  await check('cash delay changes the known gap with consistent scenario copy',async()=>{
    await page.selectOption('#delay','3');
    await page.waitForFunction(()=>document.querySelector('#scenario-label').textContent.includes('3'));
    assert.match(await page.locator('#cash-callout-title').innerText(),/10-06/);
    await page.selectOption('#delay','0');
    await page.waitForFunction(()=>document.querySelector('#cash-callout-title').textContent.includes('10-10'));
  });
  await check('single receipt scenario clears stale results when inputs change',async()=>{
    await page.getByText('试算一笔收入晚到账',{exact:true}).click();
    await page.selectOption('#scenario-delay','3'); await page.click('#scenario-run');
    await page.waitForFunction(()=>document.querySelector('#scenario-result').textContent.includes('预计到账日'));
    await page.selectOption('#scenario-delay','7');
    assert.equal(await page.locator('#scenario-result').isVisible(),false);
  });
  await check('review download contains actual reviewed ledger',async()=>{
    const pending=page.waitForEvent('download'); await page.click('#export-review');
    const download=await pending; const file=path.join(output,'review.json'); await download.saveAs(file);
    const data=JSON.parse(fs.readFileSync(file)); assert.ok(data.ledger.bills.length>0); assert.ok(data.review);
  });
  await check('invalid import does not replace existing merchant data',async()=>{
    await page.getByText('导入或恢复账单',{exact:true}).click();
    await page.setInputFiles('#import-file',{name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{broken')});
    await page.click('#import'); await page.locator('#page-feedback[data-state="error"]').waitFor();
    assert.match(await page.locator('#merchant-status').innerText(),/6,200/);
    assert.equal(await page.locator('#export-review').isEnabled(),true);
  });
  await check('empty ledger import provides honest empty states and invalidates review',async()=>{
    const demo=await page.request.get(base+'/api/merchant/demo').then(response=>response.json());
    demo.bills=[];
    await page.setInputFiles('#import-file',{name:'empty.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(demo))});
    await page.click('#import');
    await page.waitForFunction(()=>document.querySelector('#page-feedback').dataset.state==='success');
    assert.match(await page.locator('#quick-bills').innerText(),/没有符合/);
    assert.equal(await page.locator('#review').isDisabled(),true);
    assert.equal(await page.locator('#export-review').isDisabled(),true);
    page.once('dialog',dialog=>dialog.accept()); await page.click('#reset');
    await page.locator('#quick-bills .bill-preview').first().waitFor();
  });
  await check('merchant failed initialization has a working retry action',async()=>{
    await page.route('**/api/merchant/ledger*',route=>route.abort());
    await page.goto(base+'/merchant'); await page.locator('#retry-load:not([hidden])').waitFor();
    assert.match(await page.locator('#merchant-status').innerText(),/暂不可用/);
    await page.unroute('**/api/merchant/ledger*'); await page.click('#retry-load');
    await page.locator('#quick-bills .bill-preview').first().waitFor();
  });
  await check('successful import followed by read failure is reported truthfully and can recover',async()=>{
    const demo=await page.request.get(base+'/api/merchant/demo').then(response=>response.json());
    demo.balance_cents=1234500;
    demo.shop='测试店铺与很长的经营主体名称'.repeat(6);
    await page.getByText('导入或恢复账单',{exact:true}).click();
    await page.setInputFiles('#import-file',{name:'replacement.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(demo))});
    await page.route('**/api/merchant/ledger*',route=>route.abort());
    await page.click('#import'); await page.locator('#retry-load:not([hidden])').waitFor();
    assert.match(await page.locator('#page-feedback').innerText(),/账单已导入/);
    assert.match(await page.locator('#merchant-status').innerText(),/暂不可用/);
    assert.equal(await page.locator('#export-review').isDisabled(),true);
    await page.unroute('**/api/merchant/ledger*'); await page.click('#retry-load');
    await page.locator('#quick-bills .bill-preview').first().waitFor();
    assert.match(await page.locator('#merchant-status').innerText(),/12,345/);
    await page.setViewportSize({width:320,height:844}); await noOverflow();
    await page.setViewportSize({width:1440,height:1000});
    page.once('dialog',dialog=>dialog.accept()); await page.click('#reset');
    await page.waitForFunction(()=>document.querySelector('#merchant-status').textContent.includes('6,200'));
  });
  await check('missing page offers working recovery navigation',async()=>{
    const response=await page.goto(base+'/missing-page'); assert.equal(response.status(),404);
    await page.getByRole('link',{name:'进入店主工作台 →'}).click();
    await page.locator('#quick-bills .bill-preview').first().waitFor();
  });
  for(const width of [320,390,768,1024,1440]) {
    await check('responsive layouts without page overflow at '+width+'px',async()=>{
      await page.setViewportSize({width,height:844});
      for(const route of ['/','/investment','/merchant','/catalog']) {
        await page.goto(base+route);
        if(route==='/investment') await page.locator('#run:not([disabled])').waitFor();
        if(route==='/merchant') await page.locator('#quick-bills .bill-preview').first().waitFor();
        await noOverflow();
        if(width===390) await screenshot((route.slice(1)||'landing')+'-mobile',true);
      }
    });
  }
  await check('mobile investment and merchant actions remain operable',async()=>{
    await page.setViewportSize({width:390,height:844}); await page.goto(base+'/investment');
    await page.locator('#run:not([disabled])').waitFor(); await page.click('#demo-profile'); await page.click('#run');
    await page.locator('#results:not([hidden])').waitFor(); await noOverflow();
    await screenshot('investment-results-mobile',true);
    await page.goto(base+'/merchant'); await page.locator('#quick-bills .bill-preview').first().waitFor();
    await page.locator('#quick-bills .evidence').first().click(); await page.locator('#bill-dialog[open]').waitFor();
    await noOverflow(); await page.click('#close-dialog'); await page.check('#confirm'); await page.click('#review');
    await page.locator('#insights .insight').first().waitFor(); await noOverflow();
  });
  await check('keyboard skip link and return to the product showcase',async()=>{
    await page.goto(base+'/investment'); await page.keyboard.press('Tab');
    assert.equal(await page.locator('.skip-link').evaluate(element=>element===document.activeElement),true);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#main-content').evaluate(element=>element===document.activeElement),true);
    assert.equal(await page.locator('.lab-brand').getAttribute('href'),'/');
  });
  for(const route of ['/','/investment','/merchant','/catalog']) await check('automated WCAG A/AA checks on '+route,async()=>{
    await page.goto(base+route);
    if(route==='/investment') await page.locator('#run:not([disabled])').waitFor();
    if(route==='/merchant') await page.locator('#quick-bills .bill-preview').first().waitFor();
    await accessible();
  });
  await check('merchant dialog automated accessibility and Escape focus recovery',async()=>{
    await page.goto(base+'/merchant'); await page.locator('#quick-bills .evidence').first().click();
    await page.locator('#bill-dialog[open]').waitFor(); await accessible();
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.querySelector('#quick-bills .evidence')===document.activeElement);
  });
  await check('no uncaught browser exceptions',async()=>assert.deepEqual(errors,[]));
})().catch(error=>{ console.error(error); process.exitCode=1; }).finally(async()=>{
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({created_at:new Date().toISOString(),browser:browser?await browser.version():null,results},null,2));
  if(browser) await browser.close();
  server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  console.log('Report: '+output);
});
