import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createD1, dailyFixture } from "./site-fixture.mjs";
const root = path.resolve(process.argv[2]), DB = createD1(root), env = { DB };
const worker = (await import(pathToFileURL(path.join(root,"dist/server/index.js")).href)).default;
const rows = [];
const pass = (name, extra = {}) => rows.push({name,result:"PASS",...extra});
const oldFetch = globalThis.fetch; let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw new Error("No external calls allowed in verification"); };
async function visitor() {
  const r = await worker.fetch(new Request("https://synthetic.invalid/api/safety/session"), env), session = await r.json();
  assert.equal(r.status,200);
  const cookie = r.headers.get("set-cookie").split(";")[0];
  return { session, async request(route, data) {
    const r = await worker.fetch(new Request("https://synthetic.invalid" + route,{method:data?"POST":"GET",headers:{Cookie:cookie,"X-Risk-CSRF":session.csrf,Origin:"https://synthetic.invalid"},...(data?{body:JSON.stringify(data)}:{})}),env);
    return {status:r.status,body:await r.json()};
  } };
}
try {
  const policy = await worker.fetch(new Request("https://synthetic.invalid/api/safety/unified-policy"),env), p = await policy.json();
  assert.equal(policy.status,200); assert.equal(p.permission.decision,"ALLOW"); assert.equal(p.capabilities.length,22); assert.equal(policy.headers.has("set-cookie"),false);
  pass("public policy registered read, no private session or model call");
  assert.equal((await worker.fetch(new Request("https://synthetic.invalid/api/safety/unified-policy",{method:"POST"}),env)).status,405); pass("public policy cannot be mutated");
  for(const route of ["/risk","/risk/app.js","/risk/daily.js","/risk/unified.js","/risk/unified.css"]) {
    const r = await worker.fetch(new Request("https://synthetic.invalid"+route),env), body=await r.text(); assert.equal(r.status,200);
    if(route.endsWith(".js")) new vm.Script(body);
    if(route==="/risk") assert.ok(body.indexOf("/risk/unified.js")<body.indexOf("/risk/app.js"));
    pass("asset "+route);
  }
  const a=await visitor(), b=await visitor();
  const high=await a.request("/api/safety/daily/tasks",dailyFixture()); assert.equal(high.status,200);
  const id=high.body.input.binding.task_id;
  assert.equal(high.body.unified_assessment.business_risk_band,"HIGH"); assert.equal(high.body.unified_assessment.risk_decision,"BLOCK");
  assert.equal(high.body.unified_permission.decision,"DENY"); pass("server derives HIGH from real deterministic daily result");
  let audit=await a.request("/api/safety/audit?task_id="+id); assert.ok(audit.body.some(x=>x.event_type==="UNIFIED_ASSESSMENT_RECORDED")); pass("grade persisted as linked audit sidecar");
  assert.equal((await b.request("/api/safety/task?task_id="+id)).status,403); pass("second session cannot read first task");
  const low=await a.request("/api/safety/daily/tasks",dailyFixture(500000)); assert.equal(low.status,200);
  assert.equal(low.body.unified_assessment.business_risk_band,"LOW"); pass("affordable synthetic plan is LOW, still no execution authority");
  const task=low.body, lowId=task.input.binding.task_id;
  const confirmed=await a.request("/api/safety/confirm",{task_id:lowId,risk_check_id:task.review.risk_check_id,binding:task.input.binding,accepted_reason_ids:[],confirmed:true}); assert.equal(confirmed.status,200); pass("plan confirmation remains separate");
  for(let i=0;i<2;i++) {
    const execution=await a.request("/api/paper-trade/execute",{task_id:lowId,idempotency_key:"unified-test-key"});
    assert.equal(execution.status,403); assert.equal(execution.body.permission.code,"PAPER_GATEWAY_NOT_CONNECTED"); assert.equal(execution.body.executed,false);
  }
  const after=(await a.request("/api/safety/task?task_id="+lowId)).body;
  assert.equal(after.current_ledger.snapshot.cash_ledger_minor,task.current_ledger.snapshot.cash_ledger_minor); assert.equal(after.execution.status,"NOT_STARTED");
  pass("L3 blocked after confirmation, repeat cannot write or deduct");
  audit=await a.request("/api/safety/audit?task_id="+lowId);
  assert.equal(audit.body.filter(x=>x.event_type==="UNIFIED_PERMISSION_CHECKED").length,2);
  assert.ok(audit.body.filter(x=>x.event_type==="UNIFIED_PERMISSION_CHECKED").every(x=>x.permission.starts_new_risk_check===false)); pass("permission denials audited without rewriting previous Risk");
  const missing=dailyFixture(); missing.facts_confirmed=false;
  const unknown=await a.request("/api/safety/daily/tasks",missing); assert.equal(unknown.status,200); assert.equal(unknown.body.unified_assessment.business_risk_band,"UNKNOWN"); pass("unconfirmed inputs are UNKNOWN");
  const modified=dailyFixture(550000); modified.task_id=lowId; modified.ledger_id=after.ledger_id; modified.expected_ledger_revision=after.ledger_revision;
  delete modified.snapshot;
  const revised=await a.request("/api/safety/daily/revise",modified); assert.equal(revised.status,200); assert.notEqual(revised.body.approval.status,"CONFIRMED"); pass("relevant plan change invalidates old confirmation");
  assert.equal((await b.request("/api/paper-trade/execute",{task_id:lowId,idempotency_key:"another-key"})).status,403); pass("execution denial still checks session ownership first");
  DB.failWrites=true;
  const unavailable=await a.request("/api/safety/daily/tasks",dailyFixture()); assert.equal(unavailable.status,503); assert.equal(unavailable.body.execution_allowed,false); pass("audit/storage failure is visible error, never success");
  assert.equal(externalCalls,0);
  const report={verification:"LOCAL_WORKER_WITH_IN_MEMORY_SQLITE_D1_ADAPTER",passed:rows.length,failed:0,real_model_calls:0,external_requests:externalCalls,team_joint_acceptance:false,checks:rows};
  if(process.argv[3]) fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+"\n"); console.log(JSON.stringify(report,null,2));
} finally { globalThis.fetch=oldFetch; DB.close(); }
