'use strict';
// Automated browser fixtures never call a provider and are not live model evidence.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),{createPreviewServer}=require('../scripts/preview.cjs');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'evidence');fs.mkdirSync(evidence,{recursive:true});
const report={startedAt:new Date().toISOString(),modelCalls:0,externalWrites:0,widths:[],steps:[],errors:[],fixtures:'Named synthetic fixtures only; actual Core health calculation is separately identified.'};
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r('http://127.0.0.1:'+s.address().port)));
const close=s=>new Promise(r=>s.close(r));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let core,server,baseline,browser;
(async()=>{
 try{
  let coreUrl=null;
  if(process.env.CORE_SOURCE){
    const port=18927;coreUrl='http://127.0.0.1:'+port;
    core=spawn(process.execPath,[path.join(process.env.CORE_SOURCE,'server.js')],{windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,PORT:String(port)},stdio:'ignore'});
    let ready=false;for(let i=0;i<50;i++){try{ready=(await fetch(coreUrl+'/health')).ok;}catch{}if(ready)break;await sleep(100);}assert.ok(ready,'Core did not start');
  }
  server=createPreviewServer({coreUrl});const base=await listen(server);
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  const posts=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
  const go=async view=>{await page.locator(`.workspace-nav [data-view="${view}"]`).click();await page.locator(`section[data-panel="${view}"]`).waitFor({state:'visible'});assert.equal(await page.locator('section[data-panel]:visible').count(),1);};
  if(process.env.BASELINE_ROOT){
    baseline=createPreviewServer({coreUrl,root:path.resolve(process.env.BASELINE_ROOT)});const baselineUrl=await listen(baseline);
    await page.goto(baselineUrl+'/workspace.html',{waitUntil:'networkidle'});await page.screenshot({path:path.join(evidence,'01-baseline-desktop.png')});
    await go('tasks');await page.screenshot({path:path.join(evidence,'02-baseline-tasks.png')});report.steps.push('Current-run baseline screenshots captured before candidate interactions');
  }
  for(const width of [320,375,390,430,768,1024,1440]){
    await page.setViewportSize({width,height:1000});await page.goto(base+'/workspace.html',{waitUntil:'networkidle'});
    for(const view of ['workspace','banking','life','analysis','tasks','safety']){
      await go(view);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}/${view}: horizontal overflow`);
      assert.equal(await page.locator('.workspace-nav [aria-current="page"]').getAttribute('data-view'),view);
    }
    report.widths.push({width,views:6,overflow:false});
  }
  report.steps.push('Seven required widths x six navigation views; one visible panel; no horizontal page overflow');
  await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/workspace.html',{waitUntil:'networkidle'});
  await page.locator('#task-intent').fill('理财健康与生活备用金');await page.locator('#shared-analyze').click();
  assert.equal(await page.locator('#context-consent').isChecked(),false);assert.equal(await page.locator('#analysis-question').inputValue(),'理财健康与生活备用金');
  await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('#analysis-question').inputValue(),'理财健康与生活备用金');
  await go('banking');await go('tasks');await page.goBack();await page.locator('[data-panel="banking"]').waitFor({state:'visible'});
  if(coreUrl){
    await page.locator('#demo-profile').click();await page.locator('#run').click();await page.locator('#results').waitFor({state:'visible'});
    await go('tasks');const id=(await page.locator('#task-id').textContent()).replace('task_id · ','');
    assert.ok(id.startsWith('task-'));assert.equal(await page.locator(`#unified-task-list [data-task-ref="${id}"]`).count(),1);
    await page.screenshot({path:path.join(evidence,'03-core-task-desktop.png')});
    for(const view of ['workspace','banking','life','analysis','tasks','safety']){await go(view);assert.equal(await page.locator('#active-task-context [data-trace]').getAttribute('data-trace'),id);}
    await go('tasks');
    await page.locator(`#unified-task-list [data-task-ref="${id}"] a[href="#safety"]`).click();
    assert.ok(await page.locator(`#unified-audit-list [data-task-ref="${id}"]`).count()>0);
    await page.screenshot({path:path.join(evidence,'04-core-audit-desktop.png')});
    await page.reload({waitUntil:'networkidle'});await go('tasks');await page.locator(`#unified-task-list [data-task-ref="${id}"]`).waitFor();
    assert.ok((await page.locator('#unified-task-list').textContent()).includes('Core'));
    report.steps.push('Actual pinned Core health HTTP response, same task in unified tasks and audit, refresh and server re-query');
    await page.setViewportSize({width:390,height:1000});await page.screenshot({path:path.join(evidence,'05-core-task-mobile.png')});
  }
  await page.setViewportSize({width:1440,height:1000});await go('analysis');
  await page.locator('#analysis-question').fill('<img src=x onerror="window.__xss=1">');await page.locator('#demo-closed-loop').click();
  assert.equal(await page.locator('.analysis-entry img').count(),0);assert.equal(await page.evaluate(()=>window.__xss),undefined);
  await page.locator('.analysis-entry [data-draft]').first().click();await page.locator('[data-panel="tasks"]').waitFor({state:'visible'});
  assert.ok((await page.locator('#unified-task-list').textContent()).includes('DEMO'));
  assert.equal(await page.locator('[data-execute], [data-approve], [data-simulate]').count(),0);
  const unlabelled=await page.locator('section[data-panel]:visible input,section[data-panel]:visible textarea,section[data-panel]:visible select').evaluateAll(els=>els.filter(e=>e.type!=='hidden'&&!e.labels?.length&&!e.getAttribute('aria-label')).map(e=>e.id));
  assert.deepEqual(unlabelled,[]);await page.locator('.workspace-nav [data-view="analysis"]').focus();await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'analysis-heading');report.steps.push('XSS escaped, DEMO remains local, form labels and keyboard route focus');
  // Stub only the pre-existing isolated candidate API; no new protocol or external call.
  const fixtureContext=await browser.newContext({viewport:{width:390,height:1000},reducedMotion:'reduce'});
  await fixtureContext.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  let revision='r1',analyses=[],postCount=0,errorStatus=0,timeout=false;
  const candidate=()=>({sessionId:'UNIT_TEST_SESSION',analyses,tasks:[],events:[],sources:{portfolio:{id:'fixture-p',mode:'FIXTURE',revision:'p1',asOf:'2026-10-01',snapshot:{}},budget:{id:'fixture-b',mode:'USER_REPORTED',revision,summary:{available_cents:200000}}},provider:{configured:true},execution_allowed:false});
  await fixtureContext.route('**/api/assistant/workspace/state',r=>r.fulfill({json:candidate()}));
  await fixtureContext.route('**/api/assistant/workspace/analysis',async r=>{postCount++;if(timeout){await sleep(250);try{await r.fulfill({json:{}});}catch{}return;}await r.fulfill({status:errorStatus||423,json:{error:{code:'TEST_GUARD',message:'not for UI'}}});});
  await fixtureContext.addInitScript(()=>{const old=window.setTimeout;window.setTimeout=(f,ms,...args)=>old(f,ms===45000?30:ms,...args);});
  const fp=await fixtureContext.newPage();fp.on('pageerror',e=>report.errors.push(e.message));
  await fp.goto(base+'/workspace.html#analysis',{waitUntil:'networkidle'});await fp.locator('#analysis-question').fill('测试夹具：核对资料');
  await fp.locator('#use-budget').check();await fp.locator('#context-consent').check();
  await fp.locator('#analysis-question').fill('测试夹具：问题变化');assert.equal(await fp.locator('#context-consent').isChecked(),false);
  await fp.locator('#context-consent').check();await fp.locator('#use-goal').check();assert.equal(await fp.locator('#context-consent').isChecked(),false);
  await fp.locator('#context-consent').check();revision='r2';await fp.locator('#analysis-refresh').click();await fp.waitForFunction(()=>document.getElementById('context-preview').textContent.includes('r2'));
  assert.equal(await fp.locator('#context-consent').isChecked(),false);
  report.steps.push('Synthetic candidate: question, selected scope and service source revision changes revoke consent');
  for(const code of [401,403,423]){
    errorStatus=code;await fp.locator('#context-consent').check();await fp.locator('#unified-analyze').click();
    await fp.waitForFunction(()=>!document.getElementById('unified-analyze').disabled);
    const copy=await fp.locator('#analysis-status').textContent();assert.ok(copy.includes({401:'身份认证',403:'没有对应权限',423:'安全策略'}[code]));
    assert.equal(await fp.locator('.analysis-entry').count(),0);
  }
  errorStatus=409;await fp.locator('#context-consent').check();await fp.locator('#unified-analyze').click();await fp.waitForFunction(()=>!document.getElementById('query-pending').hidden&&!document.getElementById('query-pending').disabled);
  assert.ok((await fp.locator('#analysis-status').textContent()).includes('版本冲突'));
  assert.equal(await fp.locator('#unified-analyze').isDisabled(),true);
  // Reset only the test's synthetic local draft to exercise a distinct timeout case.
  await fp.evaluate(()=>{for(const k of Object.keys(localStorage))localStorage.removeItem(k);});await fp.reload({waitUntil:'networkidle'});
  timeout=true;await fp.locator('#analysis-question').fill('测试夹具：超时恢复');await fp.locator('#use-budget').check();await fp.locator('#context-consent').check();
  const before=postCount;await fp.locator('#unified-analyze').click();await fp.waitForFunction(()=>document.getElementById('analysis-status').textContent.includes('结果未知'));
  assert.equal(await fp.locator('#unified-analyze').isDisabled(),true);assert.equal(postCount,before+1);
  await fp.reload({waitUntil:'networkidle'});assert.equal(postCount,before+1);assert.equal(await fp.locator('#unified-analyze').isDisabled(),true);
  const pending=await fp.evaluate(()=>{const k=Object.keys(localStorage).find(k=>k.startsWith('finance-workspace-drafts.v1:'));return JSON.parse(localStorage.getItem(k)).drafts.pendingAnalysis;});
  analyses=[{id:'unit-analysis-only',sessionId:'UNIT_TEST_SESSION',requestId:pending.request.requestId,title:pending.request.question,mode:'REAL_MODEL',model:'UNIT_TEST_FIXTURE',createdAt:new Date().toISOString(),text:'仅测试恢复，非真实模型',sources:{budget:candidate().sources.budget},provider:{http_status:200,provider_response_id:'unit-response-only',duration_ms:12}}];
  await fp.locator('#query-pending').click();await fp.waitForFunction(()=>document.getElementById('query-pending').hidden);
  assert.equal(postCount,before+1);assert.ok((await fp.locator('#analysis-status').textContent()).includes('未重复调用'));
  report.steps.push('Synthetic HTTP 401/403/409/423; accelerated timeout; refresh retains UNKNOWN; original request recovered with zero resend');
  let workflow=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/review.json'),'utf8'));
  await fixtureContext.route('**/api/review/task/review-task-example-001',r=>r.fulfill({json:workflow}));
  await fp.locator('.workspace-nav [data-view="tasks"]').click();await fp.locator('#restore-kind').selectOption('review');
  await fp.locator('#restore-id').fill(workflow.task_id);
  const phases=['PENDING_RISK','PENDING_APPROVAL','READY_FOR_SIMULATION','SIMULATED','REJECTED','EXPIRED','MODEL_FAILED','FUNDING_BLOCKED','CANCELLED'];
  for(const phase of phases){
    workflow.status=phase;
    workflow.execution=phase==='SIMULATED'?{status:'SIMULATED',execution_id:'unit-execution',execution_allowed:false,receipt:{task_id:workflow.task_id,execution_id:'unit-execution',proposal_sha256:workflow.plan_hash,mode:'SIMULATED',side_effects:false}}:{status:'BLOCKED',execution_allowed:false,receipt:null};
    await fp.locator('#restore-form button').click();await fp.locator(`#unified-task-list [data-phase="${phase}"]`).waitFor();
  }
  assert.equal(await fp.locator('[data-execute], [data-approve], [data-simulate]').count(),0);
  report.steps.push('Synthetic frozen-contract responses: all nine task phases render independently; no execution or approval control');
  assert.ok(posts.every(url=>url.endsWith('/api/health-check/run')));assert.equal(report.errors.length,0,JSON.stringify(report.errors));
  report.postsToRealCore=posts.length;report.syntheticAnalysisPosts=postCount;report.result='PASS';
  await fixtureContext.close();await context.close();
 }catch(error){report.result='FAIL';report.failure=error.stack;process.exitCode=1;console.error(error);}
 finally{
  if(browser)await browser.close();if(server)await close(server);if(baseline)await close(baseline);if(core)core.kill();
  report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(evidence,'browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }
})();
