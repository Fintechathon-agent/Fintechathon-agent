import test from "node:test";
import assert from "node:assert/strict";
import { responseError, executionView, provenance, assertHealthResponse, healthTask, auditEvents } from "../versions/workspace-model.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Harness } = require("../core/harness.js");
const { createRequest } = require("../contracts/investment-contract.js");
const profile = { investment_horizon_days:365, max_drawdown:.1, liquidity_need:"medium" };
function response() { return new Harness().runHealthCheckContract(createRequest({riskProfile:profile})); }
test("HTTP 200 business errors cannot become success", () => {
  assert.equal(responseError({status:"error",error:{code:"MODEL_UNAVAILABLE",message:"Unavailable"}},true).code,"MODEL_UNAVAILABLE");
  assert.ok(responseError({},false)); assert.equal(responseError({status:"ok"}),null);
});
test("Core response retains identity and stops at read-only Risk", () => {
  const data=response(); assertHealthResponse(data);
  const view=healthTask(data);
  assert.equal(view.taskId,data.task_state.task_id); assert.equal(view.canExecute,false);
  assert.equal(view.state,"WAITING_RISK"); assert.equal(view.execution.state,"NOT_CONNECTED");
});
test("cross-task responses and malformed analysis are rejected", () => {
  const data=response(); data.trace.task_id="another-task"; assert.throws(()=>assertHealthResponse(data),/任务关联/);
  const broken=response(); delete broken.artifacts.health_report.metrics; assert.throws(()=>assertHealthResponse(broken),/不完整/);
});
test("approval alone does not claim execution", () => {
  assert.equal(executionView({status:"READY",approval:{status:"APPROVED"}},"t1").state,"NOT_EXECUTED");
});
test("success without a bound receipt remains UNKNOWN", () => {
  assert.equal(executionView({status:"SUCCEEDED"},"t1").state,"UNKNOWN");
  assert.equal(executionView({status:"SUCCEEDED",receipt:{task_id:"other",execution_id:"e1"}},"t1").state,"UNKNOWN");
});
test("simulation receipt explicitly says no ledger change", () => {
  const view=executionView({status:"SIMULATED",receipt:{task_id:"t1",execution_id:"e1",side_effects:false}},"t1");
  assert.equal(view.state,"SUCCEEDED"); assert.match(view.text,/未改变 PAPER 账本/);
});
test("UNKNOWN requires reconciliation, never blind retry", () => {
  assert.match(executionView({status:"UNKNOWN"},"t1").text,/不要重复提交交易/);
  assert.equal(executionView({status:"BLOCKED"},"t1").state,"BLOCKED");
  assert.equal(executionView({status:"ERROR"},"t1").state,"ERROR");
});
test("transport success cannot prove LIVE provenance", () => {
  assert.equal(provenance({status:"SUCCEEDED"}),"来源待核验");
  assert.equal(provenance({data_mode:"LIVE"}),"来源待核验");
  assert.equal(provenance({data_mode:"LIVE"},true),"LIVE");
  assert.equal(provenance({data_mode:"SYNTHETIC_REPLAY"},true),"DEMO / FIXTURE");
});
test("audit events must belong to the selected task", () => {
  assert.throws(()=>auditEvents({task_id:"t1",events:[{task_id:"other"}]},"t1"),/不匹配/);
  assert.deepEqual(auditEvents({task_id:"t1",events:[]},"t1"),[]);
});
test("waiting input is not waiting approval", () => {
  const data=response(); data.task_state.status="WAITING_INPUT";
  assert.equal(healthTask(data).state,"WAITING_INPUT");
});

test("unrecognized task status remains UNKNOWN", () => { const data=response(); data.task_state.status="FUTURE_STATE"; assert.equal(healthTask(data).state,"UNKNOWN"); });
