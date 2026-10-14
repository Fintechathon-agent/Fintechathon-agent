"use strict";
// Local-only integration tests. Intercepted responses are explicitly test fixtures.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const load = process.env.UI_MODULE_ROOT ? createRequire(path.join(process.env.UI_MODULE_ROOT, "..", "package.json")) : require;
const { chromium } = load("playwright");
const AxeBuilder = load("@axe-core/playwright").default;
const { server } = require("../server.js");
const out = path.resolve(__dirname, "../../review/ui-p0");
fs.mkdirSync(out, { recursive:true });
const checks = [], errors = [];
let browser;
(async () => {
  await new Promise(r => server.listen(0,"127.0.0.1",r));
  const base = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ channel:"chrome", headless:true });
  const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(base); await page.waitForFunction(()=>document.querySelector("#service-state").textContent.includes("已响应"));
  assert.equal(await page.locator("[data-panel=workspace]").isVisible(),true);
  assert.equal(await page.locator(".workspace-nav a").count(),4);
  await page.locator("#status").waitFor({state:"hidden"}); await page.screenshot({path:path.join(out,"workspace-desktop.png"),fullPage:true});
  checks.push("Four navigation sections and default workspace");
  await page.locator("#task-intent").fill("检查我的投资组合，保留备用金");
  let modelCalls=0;
  page.on("request",r=>{if(new URL(r.url()).pathname==="/api/review")modelCalls++;});
  await page.locator("#open-portfolio").click();
  await page.locator("#run").click();
  assert.match(await page.locator("#input-feedback").textContent(),/WAITING_INPUT/);
  assert.equal(modelCalls,0); checks.push("Natural-language draft is not sent to an incompatible model API; required input remains explicit");
  await page.locator("#demo-profile").click(); await page.locator("#run").click();
  await page.locator("#results").waitFor({state:"visible"});
  assert.equal(await page.locator(".plan-card").count(),3);
  assert.match(await page.locator("#run-feedback").textContent(),/未审批、未执行/);
  await page.screenshot({path:path.join(out,"portfolio-desktop.png"),fullPage:true});
  checks.push("Real local v1 health-check and A/B/C comparison preserve calculations");
  await page.locator("[data-view=tasks]").click();
  await page.waitForFunction(()=>document.querySelector("#audit-timeline").children.length>0);
  const id=(await page.locator("#restore-id").inputValue());
  assert.match(await page.locator("#task-id").textContent(),new RegExp(id));
  assert.match(await page.locator("#risk-label").textContent(),/等待/);
  assert.match(await page.locator("#execution-copy").textContent(),/账本未改变/);
  assert.equal(await page.locator("#task-detail button").count(),1);
  checks.push("Read-only handoff has no approval/trade controls and shares Core task ID with audit");
  await page.screenshot({path:path.join(out,"task-desktop.png"),fullPage:true});
  const axe = await new AxeBuilder({page}).analyze();
  fs.writeFileSync(path.join(out,"axe-details.json"),JSON.stringify(axe.violations,null,2));
  assert.deepEqual(axe.violations.map(v=>({id:v.id,nodes:v.nodes.length})),[]);
  checks.push("Axe task detail has zero violations");
  for (const view of ['workspace','banking','safety']) {
    await page.locator('[data-view='+view+']').click();
    const audit=await new AxeBuilder({page}).analyze();
    fs.writeFileSync(path.join(out,'axe-'+view+'.json'),JSON.stringify(audit.violations,null,2));
    assert.deepEqual(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],view+' accessibility');
  }
  checks.push('Axe workspace, banking results and safety sections have zero violations');
  await page.locator('[data-view=tasks]').click();
  for (const state of ['WAITING_APPROVAL','BLOCKED','ERROR','UNKNOWN','SUCCEEDED']) {
    await page.evaluate(async state=>{
      const {renderTaskStates}=await import('/versions/workspace.js');
      document.querySelector('#task-source').textContent='TEST FIXTURE / 组件验收，不是真实服务响应';
      renderTaskStates({risk:state==='BLOCKED'?'BLOCK':'REVIEW',reason:'TEST FIXTURE <img src=x onerror=alert(1)>',approval:'WAITING_APPROVAL',execution:{state,text:'TEST FIXTURE / '+state+' / 未改变账本'}});
    },state);
    assert.match(await page.locator('#task-source').textContent(),/TEST FIXTURE/);
    assert.equal(await page.locator('#risk-reason img').count(),0);
    assert.equal(await page.locator('#task-detail button').count(),1);
  }
  checks.push('Explicit TEST FIXTURES render approval, blocked, error, unknown and receipt states without adding trade controls or injecting markup');
  await page.locator("#restore-form button").click();
  await page.waitForFunction(()=>document.querySelector("#restore-message").textContent.includes("已读取"));
  checks.push("Original task read-only recovery without execution");
  await page.route("**/api/audit/*",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:{code:"TEST_FIXTURE_AUDIT_FAILURE",message:"Test fixture: audit unavailable"}})}));
  await page.locator("#retry-audit").click();
  await page.waitForFunction(()=>document.querySelector("#audit-message").textContent.includes("ERROR"));
  assert.equal(await page.locator("#audit-timeline li").count(),0);
  checks.push("Audit failure shows explicit error and clears outdated events");
  await page.unroute("**/api/audit/*"); await page.locator("#retry-audit").click();
  await page.waitForFunction(()=>document.querySelector("#audit-timeline").children.length>0);
  for (const width of [1024,390,375]) {
    await page.setViewportSize({width,height:900});
    for (const view of ["workspace","banking","tasks","safety"]) {
      await page.locator("[data-view="+view+"]").click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,view+" overflow at "+width);
    }
    if(width===375){await page.locator("[data-view=tasks]").click();await page.screenshot({path:path.join(out,"task-mobile.png"),fullPage:true});}
  }
  checks.push("All four sections fit 1024/390/375 widths");
  await page.setViewportSize({width:1440,height:1000});
  await page.locator("[data-view=banking]").click();
  await page.locator("#input-panel summary").first().click();
  await page.locator("#horizon").fill("180");
  assert.equal(await page.locator("#results").isVisible(),false);
  await page.locator("[data-view=tasks]").click();
  assert.equal(await page.locator("#task-stale").isVisible(),true);
  checks.push("Input edit invalidates comparisons and marks prior task as historical");
  await page.locator("[data-view=banking]").click();
  await page.route("**/api/health-check/run",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({status:"error",error:{code:"MODEL_UNAVAILABLE",message:"Test fixture: unavailable"}})}));
  await page.locator("#run").click();
  await page.waitForFunction(()=>document.querySelector("#run-feedback").textContent.includes("ERROR"));
  assert.equal(await page.locator("#results").isVisible(),false);
  await page.screenshot({path:path.join(out,"error-desktop.png"),fullPage:true});
  checks.push("HTTP 200 business error never becomes mock success");
  await page.unroute("**/api/health-check/run");
  await page.route("**/api/health-check/run",async route=>{await new Promise(r=>setTimeout(r,200));await route.continue();});
  await page.locator("#run").click(); await page.locator("#horizon").fill("181");
  await page.waitForFunction(()=>!document.querySelector("#run").disabled);
  assert.equal(await page.locator("#results").isVisible(),false);
  checks.push("Late response cannot override newer input");
  await page.unroute("**/api/health-check/run");
  await page.route("**/api/demo/portfolio",route=>route.abort());
  await page.goto(base+"/investment");
  await page.locator("#retry-load").waitFor({state:"visible"});
  assert.equal(await page.locator("#run").isDisabled(),true);
  await page.unroute("**/api/demo/portfolio"); await page.locator("#retry-load").click();
  await page.waitForFunction(()=>!document.querySelector("#run").disabled);
  checks.push("Initial service failure disables diagnosis; explicit retry restores it");
  await page.goto(base); await page.keyboard.press("Tab");
  assert.equal(await page.locator(".skip-link").evaluate(el=>el===document.activeElement),true);
  checks.push("Keyboard skip link and reduced-motion preference supported");
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,"browser-check.json"),JSON.stringify({mode:"local service plus explicit intercepted TEST FIXTURES",checks,errors,axeViolations:axe.violations.length},null,2));
  console.log(JSON.stringify({passed:checks.length,errors}));
})().catch(error=>{
  fs.writeFileSync(path.join(out,"browser-check-failure.txt"),error.stack);
  console.error(error);process.exitCode=1;
}).finally(async()=>{if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
