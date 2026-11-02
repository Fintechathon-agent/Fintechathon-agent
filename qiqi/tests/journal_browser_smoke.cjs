const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const url=process.env.JOURNAL_TEST_URL||'http://127.0.0.1:8765/team/journal.html';
const out=path.resolve('artifacts/journal-2026-10-17');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
 const results=[];
 try{
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
   const context=await browser.newContext({viewport,acceptDownloads:true,reducedMotion:'reduce'});
   const page=await context.newPage(),errors=[],failed=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push(`${r.status()} ${r.url()}`);});
   await page.goto(url,{waitUntil:'networkidle'});
   const baseline=await (await page.request.get(new URL('/api/trades',url).href)).json();
   await page.locator('#message').click();await page.keyboard.type('12345');await page.keyboard.press('Backspace');assert.equal(await page.locator('#message').inputValue(),'1234');
   await page.keyboard.press('Control+A');await page.keyboard.press('Backspace');assert.equal(await page.locator('#message').inputValue(),'');
   const hit=await page.locator('#message').evaluate(el=>{const b=el.getBoundingClientRect();return document.elementFromPoint(b.left+b.width/2,b.top+10)===el;});assert(hit);
   await page.locator('#sample-mixed').click();await page.locator('#send').click();
   await page.waitForFunction(()=>document.querySelector('#record-count').textContent==='4');
   assert((await page.locator('#summary').innerText()).includes('12,000.00'));
   assert((await page.locator('#summary').innerText()).includes('3,600.00'));
   await page.locator('.budget summary').click();
   await page.locator('[name=opening]').fill('0');await page.locator('[name=essentials]').fill('7000');await page.locator('[name=buffer]').fill('2000');
   await page.locator('#budget-form button').click();assert((await page.locator('#risk').innerText()).includes('618.00'));
   await page.locator('#tab-ledger').click();
   const meal=page.locator('#ledger .record').filter({hasText:'餐饮支出'});
   await meal.locator('[data-edit]').click();await page.locator('#edit-form [name=amount]').fill('28');await page.locator('#edit-form button[type=submit]').click();
   await page.locator('#edit-dialog').waitFor({state:'hidden'});assert((await meal.innerText()).includes('28.00'));assert((await page.locator('#risk').innerText()).includes('628.00'));
   const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;const target=path.join(out,`ledger-${viewport.width}.csv`);await download.saveAs(target);const csv=fs.readFileSync(target,'utf8');assert(csv.includes('28.00'));assert(csv.includes('USD'));assert(csv.includes('计划'));
   await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('#record-count').innerText(),'4');
   await page.locator('#tab-memory').click();assert((await page.locator('#memory').innerText()).includes('纳斯达克'));assert((await page.locator('#memory').innerText()).includes('计划'));
   await page.locator('#hide-life').check();assert(!(await page.locator('#summary').innerText()).includes('28.00'));assert(!(await page.locator('#memory').innerText()).includes('200.00'));
   await page.locator('#hide-life').uncheck();await page.locator('#tab-chat').click();
   await page.locator('#message').fill('今天午饭实付28元，帮我找美团猪脚饭优惠券。');await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#record-count').textContent==='6');
   await page.locator('#tab-ledger').click();assert((await page.locator('#ledger').innerText()).includes('可能是重复描述'));assert((await page.locator('#ledger').innerText()).includes('尚未查询'));
   const sameTrades=await (await page.request.get(new URL('/api/trades',url).href)).json();assert.deepEqual(sameTrades,baseline);
   page.once('dialog',d=>d.accept());await page.locator('#ledger .record').filter({hasText:'GPT Pro'}).locator('[data-delete]').click();assert.equal(await page.locator('#record-count').innerText(),'5');
   await page.locator('#tab-memory').click();assert(!(await page.locator('#memory').innerText()).includes('GPT Pro'));
   // A failed parser must keep the draft and never show saved success.
   await page.locator('#tab-chat').click();await page.route('**/api/journal/parse',r=>r.abort('failed'));await page.locator('#message').fill('吃饭花了99元');await page.locator('#send').click();await page.locator('#error').waitFor({state:'visible'});assert.equal(await page.locator('#message').inputValue(),'吃饭花了99元');assert.equal(await page.locator('#record-count').innerText(),'5');await page.unroute('**/api/journal/parse');
   await page.locator('#message').fill('');
   const overflow=await page.evaluate(()=>document.scrollingElement.scrollWidth>document.scrollingElement.clientWidth);assert(!overflow);
   const size=await page.locator('#send').boundingBox();assert(size.height>=44);
   assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
   await page.locator('#tab-ledger').click();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,`journal-${viewport.width}.png`),fullPage:true});
   results.push({viewport,overflow,inputHit:hit,sendHeight:size.height,errors,failed,persistence:true,editDelete:true,download:true,noTrades:true});await context.close();
  }
  const page=await browser.newPage();await page.goto(new URL('/team/workspace.html',url).href,{waitUntil:'networkidle'});assert.equal(await page.locator('a[href="journal.html"]').count(),1);await page.locator('a[href="journal.html"]').click();assert(page.url().endsWith('/team/journal.html'));await page.screenshot({path:path.join(out,'journal-empty-desktop.png'),fullPage:true});
  fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
