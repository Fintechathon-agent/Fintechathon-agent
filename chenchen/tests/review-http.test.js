"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { server, reviewWorkflow } = require("../server");

function fakeReview(input) {
  const proposal = {
    summary: "模型建议先复核账单",
    risk_level: "medium",
    proposed_action: "HOLD_FOR_REVIEW",
    action_reason: "付款动作必须先经过 Risk 和人工审批",
    missing_information: ["付款状态"],
    evidence: ["账单金额"]
  };
  return Promise.resolve({
    review_version: "model-review.v1", run_id: "review-http-fake-001", request_id: input.request_id, task_id: input.task_id,
    status: "PROPOSED", source: "model",
    input: { kind: input.kind, source: input.source, input_sha256: "b".repeat(64) },
    model_response: { model: "fake-model", provider_response_id: "resp-http-fake-001", raw_text: JSON.stringify(proposal), proposal, usage: { input_tokens: 1, output_tokens: 1 } },
    audit: { audit_id: "audit-http-fake-001", events: [{ event_type: "review.received", at: new Date().toISOString() }] }
  });
}

test("HTTP model-to-Risk-to-approval-to-simulation chain is queryable", async t => {
  const previousRunner = reviewWorkflow.modelRunner;
  reviewWorkflow.reset();
  reviewWorkflow.modelRunner = fakeReview;
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    reviewWorkflow.modelRunner = previousRunner;
    reviewWorkflow.reset();
    server.closeAllConnections();
    server.close();
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const headers = { "Content-Type": "application/json" };
  const start = await fetch(base + "/api/review", { method: "POST", headers, body: JSON.stringify({ request_id: "req-http-workflow-001", kind: "bill", text: "演示账单 1280 元", requested_action: "进入付款准备", action_parameters: { amount: 1280 } }) });
  assert.equal(start.status, 200);
  const created = await start.json();
  assert.equal(created.status, "PENDING_RISK");
  assert.equal(created.model.model_response.raw_text.length > 0, true);

  const blocked = await fetch(base + "/api/review/simulate", { method: "POST", headers, body: JSON.stringify({ task_id: created.task_id, proposal_sha256: created.proposed_action.proposal_sha256 }) });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).error.code, "EXECUTION_BLOCKED");

  const risk = await fetch(base + "/api/review/risk-decision", { method: "POST", headers, body: JSON.stringify({ task_id: created.task_id, proposal_sha256: created.proposed_action.proposal_sha256, decision: "APPROVE", reviewer: "risk-owner", reason: "证据充分" }) }).then(r => r.json());
  assert.equal(risk.status, "PENDING_APPROVAL");
  const approval = await fetch(base + "/api/review/approval", { method: "POST", headers, body: JSON.stringify({ task_id: created.task_id, proposal_sha256: created.proposed_action.proposal_sha256, decision: "APPROVE", approver: "approver", reason: "已核对" }) }).then(r => r.json());
  assert.equal(approval.status, "READY_FOR_SIMULATION");
  const simulated = await fetch(base + "/api/review/simulate", { method: "POST", headers, body: JSON.stringify({ task_id: created.task_id, proposal_sha256: created.proposed_action.proposal_sha256 }) }).then(r => r.json());
  assert.equal(simulated.status, "SIMULATED");
  assert.equal(simulated.execution.receipt.side_effects, false);
  const queried = await fetch(base + "/api/review/task/" + encodeURIComponent(created.task_id));
  assert.equal(queried.status, 200);
  const record = await queried.json();
  assert.equal(record.task_id, created.task_id);
  assert.equal(record.audit.audit_id, created.audit.audit_id);
  assert.equal(record.risk_decision.task_id, created.task_id);
  assert.equal(record.approval.task_id, created.task_id);
  assert.equal(record.execution.task_id, created.task_id);
  assert.ok(record.audit.events.some(item => item.event_type === "execution.simulated"));
  const run = await fetch(base + "/api/review/" + encodeURIComponent(created.run_id));
  assert.equal(run.status, 200);
  assert.equal((await run.json()).task_id, created.task_id);

  const legacy = await fetch(base + "/api/review/legacy", {
    method: "POST", headers, body: JSON.stringify({ question: "我想追加投资，但下个月要交房租，是否冲突？", run_id: "legacy-http-001" })
  });
  assert.equal(legacy.status, 200);
  const legacyPayload = await legacy.json();
  assert.equal(legacyPayload.contract_version, "legacy-review.v0");
  assert.equal(legacyPayload.source_contract, "review-workflow.v1");
  assert.equal(legacyPayload.execution_state, "awaiting_risk");
  assert.equal(legacyPayload.gate.execution_allowed, false);
});
