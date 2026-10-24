'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),base=process.env.TEST_URL||'http://127.0.0.1:8897';
const live=process.argv.includes('--live'),online=process.argv.includes('--online');
const report={base,liveRequested:live,widths:[],errors:[],steps:[]};
const evidence=path.join(root,'evidence');fs.mkdirSync(evidence,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,...(!online?{args:['--no-proxy-server']}:process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY}}:{})});
 const context=await browser.newContext({reducedMotion:'reduce',viewport:{width:1440,height:1000}});
 const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 const get=async()=>{const r=await page.request.get(base+'/api/assistant/workspace/state');assert.equal(r.status(),200);return r.json();};
 const route=async view=>{await page.locator(`.workspace-nav [data-view="${view}"]`).click();await page.locator(`section[data-panel="${view}"]`).waitFor({state:'visible'});assert.equal(await page.locator('section[data-panel]:visible').count(),1);};
 const frame=()=>page.frameLocator('#life-frame');
 const sendLife=async text=>{await frame().locator('#message').fill(text);const response=page.waitForResponse(r=>r.url().endsWith('/api/assistant/message')&&r.request().method()==='POST');await frame().locator('#send').click();assert.equal((await response).status(),200);await frame().locator('#send').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#life-frame').contentDocument.getElementById('send').disabled);};
 try{
  for(const width of [320,375,430,700,840,1024,1440]){
   await page.setViewportSize({width,height:1000});await page.goto(base+'/workspace.html?layout='+width,{waitUntil:'networkidle'});
   assert.equal(await page.locator('.workspace-nav [data-view]').count(),6);
   assert.equal(await page.locator('.workspace-nav [aria-current="page"]').getAttribute('data-view'),'workspace');
   for(const view of ['banking','life','tasks','safety','analysis','workspace'])await route(view);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: page overflow`);
   if([375,840,1440].includes(width))await page.screenshot({path:path.join(evidence,`${online?'online':'shell'}-${width}.png`)});
   report.widths.push(width);
  }
  await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/workspace.html',{waitUntil:'networkidle'});await route('workspace');
  await page.locator('#task-intent').fill('核对投资组合与生活备用金');await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.locator('#task-intent').inputValue(),'核对投资组合与生活备用金');
  await route('banking');await route('safety');await page.goBack();await page.locator('section[data-panel="banking"]').waitFor({state:'visible'});
  report.steps.push('six routes, defaults, draft persistence, back');
  await page.goto(base+'/conversation.html',{waitUntil:'networkidle'});await page.waitForURL('**/workspace.html#life');
  await frame().locator('#message').waitFor({state:'visible'});
  assert.equal(await frame().locator('.sidebar').isVisible(),false);
  assert.equal(await frame().locator('#new-chat').isVisible(),true);
  assert.equal(await frame().locator('#thread-picker').isVisible(),true);
  if(!online){
   await page.waitForFunction(()=>document.querySelector('#life-frame').contentDocument.getElementById('save-state').textContent.includes('已保存'));
   await sendLife('我只想记账。今天工资到账12000元，午饭实付18元。');
   await sendLife('午饭其实实付28元');
   const ledger=(await (await page.request.get(base+'/api/assistant/state')).json()).state;
   assert.equal(ledger.records.find(r=>r.kind==='expense').amount_cents,2800);
   const csv=await page.request.get(base+'/api/assistant/export');assert.equal(csv.status(),200);assert.ok((await csv.text()).includes('工资'));
   await sendLife('月初可用现金20000元，本月剩余必要开支6000元，应急预留10000元');
   await frame().locator('#message').fill('这份草稿切换后保留');await route('banking');await route('life');
   assert.equal(await frame().locator('#message').inputValue(),'这份草稿切换后保留');
   await frame().locator('#message').fill('');await route('workspace');await page.locator('#refresh-shared').click();
   await page.waitForFunction(()=>document.getElementById('shared-portfolio').textContent==='golden-demo-portfolio');
   const before=await get();const beforeLedgerRecords=(await (await page.request.get(base+'/api/assistant/state')).json()).state.records.length;assert.ok(before.sources.budget.summary.budget);assert.equal(before.sources.portfolio.mode,'FIXTURE');
   report.steps.push('real assistant ledger and shared budget, stable iframe draft');
   await route('banking');await page.locator('#demo-profile').click();
   const health=page.waitForResponse(r=>r.url().endsWith('/api/health-check/run')&&r.request().method()==='POST');
   await page.locator('#run').click();assert.equal((await health).status(),200);await page.locator('#results').waitFor({state:'visible'});
   await page.reload({waitUntil:'networkidle'});await page.locator('#results').waitFor({state:'visible'});
   assert.equal(await page.locator('#horizon').inputValue(),'365');
   report.steps.push('unchanged Core fixture health-check and restored result');
   await route('life');await page.getByText('本机储蓄目标草稿',{exact:true}).click();await page.locator('#goal-name').fill('生活备用金');await page.locator('#goal-amount').fill('30000');
   await page.locator('#budget-analyze').click();assert.equal(await page.locator('#use-budget').isChecked(),true);
   await route('workspace');await page.locator('#shared-analyze').click();
   await page.locator('#analysis-question').fill('请结合已选中的持仓、生活预算与备用金目标，简短说明应先核对哪些风险和缺失资料。最多三条，只分析，不执行任何操作。');
   await page.locator('#use-portfolio').check();await page.locator('#use-budget').check();await page.locator('#use-goal').check();
   const preview=JSON.parse(await page.locator('#context-preview').textContent());
   assert.equal(preview.portfolio.id,before.sources.portfolio.id);assert.equal(preview.budget.revision,before.sources.budget.revision);
   report.steps.push('combined authorized source selection');
   if(live){
    await page.locator('#context-consent').check();
    const response=page.waitForResponse(r=>r.url().endsWith('/api/assistant/workspace/analysis')&&r.request().method()==='POST',{timeout:60000});
    await page.locator('#unified-analyze').click();const r=await response;const data=await r.json();report.liveHttp=r.status();
    assert.equal(r.status(),200,JSON.stringify(data));assert.equal(data.analysis.model,'qwen3.8-flash');assert.equal(data.analysis.mode,'REAL_MODEL');
    assert.equal(data.analysis.execution_allowed,false);assert.equal(data.analysis.risk.decision,null);
    assert.equal(data.analysis.sources.portfolio.mode,'FIXTURE');assert.equal(data.analysis.sources.budget.mode,'USER_REPORTED');
    assert.equal(data.analysis.sources.goal.amountCents,3000000);
    assert.ok(data.analysis.text.includes(data.providerEvidence.proposal.action_reason));
    report.live={analysis:data.analysis,providerEvidence:data.providerEvidence};
    await page.locator(`[data-draft="${data.analysis.id}"]`).waitFor({state:'visible'});
    page.once('dialog',dialog=>dialog.accept());await page.locator(`[data-draft="${data.analysis.id}"]`).click();
    await page.waitForURL('**/workspace.html#tasks');await page.locator('#unified-task-list .local-record').waitFor({state:'visible'});
    const saved=await get(),task=saved.tasks.find(t=>t.analysisId===data.analysis.id);assert.ok(task);assert.equal(task.status,'WAITING_OWNER_RISK');assert.equal(task.execution_allowed,false);
    assert.ok(saved.events.some(e=>e.taskId===task.id&&e.analysisId===data.analysis.id));
    const afterLife=await page.request.get(base+'/api/assistant/state');const unchanged=(await afterLife.json()).state;
    assert.equal(unchanged.records.length,beforeLedgerRecords);
    report.task=task;report.steps.push('real combined AI -> local REVIEW -> explicit task confirmation -> persistent task/audit');
    await page.reload({waitUntil:'networkidle'});await page.locator('#unified-task-list .local-record').waitFor({state:'visible'});
    await page.locator('#unified-task-list a[href="#safety"]').first().click();await page.locator('#unified-audit-list .local-record').first().waitFor({state:'visible'});
    await page.screenshot({path:path.join(evidence,'live-safety.png')});
    await route('analysis');await page.screenshot({path:path.join(evidence,'live-analysis.png')});
   }else{
    await page.locator('#demo-closed-loop').click();assert.ok((await page.locator('#unified-analysis-list').textContent()).includes('DEMO'));
   }
   const state=await get();
   const guarded=await page.request.post(base+'/api/assistant/workspace/analysis',{headers:{'X-Finance-Request':'1'},data:{requestId:'blocked-'+Date.now(),question:'立即转账1000元',consent:true,sources:{}}});assert.equal(guarded.status(),403);
   const execute=await page.request.post(base+'/api/paper-trade/execute',{data:{}});assert.equal(execute.status(),403);
   const cross=await page.request.get(base+'/api/assistant/workspace/state',{headers:{Origin:'https://untrusted.example'}});assert.equal(cross.status(),403);
   const otherContext=await browser.newContext(),other=await otherContext.newPage();await other.goto(base+'/workspace.html');
   assert.equal((await (await other.request.get(base+'/api/assistant/workspace/state')).json()).analyses.length,0);await otherContext.close();
   report.steps.push('sensitive operation blocked, no executor, origin denial, session isolation');
  }else{
   assert.equal(await page.locator('#unified-analyze').isDisabled(),true);report.steps.push('static preview never claims provider connection');
   const crypto=require('node:crypto');
   const files=JSON.parse(fs.readFileSync(path.join(root,'release-files.json'),'utf8')).files.filter(e=>!e.file.startsWith('.'));
   for(const entry of files){const response=await page.request.get(`${base}/${entry.file}?qa=20261024-unified-final`);assert.equal(response.status(),200);assert.equal(crypto.createHash('sha256').update(await response.body()).digest('hex'),entry.sha256,entry.file);}
   report.publishedFilesVerified=files.length;
  }
  assert.deepEqual(report.errors,[]);report.result='PASSED';
 }catch(error){report.result='FAILED';report.error=error.message;throw error;}
 finally{fs.writeFileSync(path.join(evidence,online?'online.json':live?'live.json':'shell.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,widths:report.widths.length,live:!!report.live,error:report.error}));await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
