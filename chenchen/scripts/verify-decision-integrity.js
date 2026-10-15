"use strict";
// Offline, synthetic provider only. Never executes financial operations.
const assert = require("node:assert/strict");
const { ReviewWorkflowStore } = require("../integrations/review-workflow");
const { buildRiskHandoffPackage } = require("../integrations/risk-handoff");
async function verify() {
  const store = new ReviewWorkflowStore();
  const env = { MODEL_PROVIDER: "workers_ai", AI: { run: async () => ({ id: "synthetic-integrity-response", response: {
    summary: "虚构用途核对", risk_level: "medium", proposed_action: "HOLD_FOR_REVIEW",
    action_reason: "需要Risk和审批", missing_information: [], evidence: ["虚构材料"]
  } }) } };
  const created = await store.start({ kind: "bill", text: "虚构投资与生活安排", context: { synthetic: true } }, env);
  const binding = { task_id: created.task_id, proposal_sha256: created.proposed_action.proposal_sha256 };
  const callback = { ...binding, callback_version: "risk-callback.v1", handoff_id: created.risk_handoff.handoff_id,
    request_id: created.request_id, run_id: created.run_id, audit_id: created.audit.audit_id,
    decision: "APPROVE", reviewer: "synthetic-risk", reason: "核对" };
  const [risk, cancelled] = await Promise.all([
    store.receiveRiskCallback(callback), store.cancel({ ...binding, canceler: "synthetic-user", reason: "停止" })
  ]);
  assert.equal(risk.callback_status, "RECORDED");
  assert.equal(cancelled.status, "CANCELLED");
  const duplicate = await store.receiveRiskCallback(callback);
  assert.equal(duplicate.callback_status, "DUPLICATE");
  assert.equal(duplicate.workflow.status, "CANCELLED");
  await assert.rejects(store.simulate(binding), e => e.code === "EXECUTION_BLOCKED");
  const race = store.getByTaskId(created.task_id);
  assert.equal(race.status, "CANCELLED");
  assert.ok(race.audit.events.some(e => e.event_type === "task.cancelled"));
  assert.ok(race.audit.events.some(e => e.event_type === "risk.callback.recorded"));

  const next = await store.start({ kind: "bill", text: "虚构审批重试测试", context: { synthetic: true } }, env);
  const base = { task_id: next.task_id, proposal_sha256: next.proposed_action.proposal_sha256 };
  const conflicts = [], requests = [];
  for (const [method, actor, code] of [["decideRisk", "reviewer", "RISK_DECISION_IMMUTABLE"], ["decideApproval", "approver", "APPROVAL_IMMUTABLE"]]) {
    const request = { ...base, decision: "APPROVE", [actor]: "synthetic-owner", reason: "只同意原方案" };
    requests.push(request);
    const first = await store[method](request);
    assert.deepEqual(await store[method](request), first);
    for (const patch of [{ [actor]: "other-person" }, { reason: "changed-evidence" }]) {
      await assert.rejects(store[method]({ ...request, ...patch }), error => {
        assert.equal(error.code, code);
        conflicts.push({ method, code: error.code, http: error.statusCode, trace_task_id: error.taskId });
        return true;
      });
    }
  }
  const final = store.getByTaskId(next.task_id);
  assert.equal(final.approval.approver, "synthetic-owner");
  assert.equal(final.execution.execution_allowed, false);
  return { checked_at: new Date().toISOString(), passed: true, evidence_type: "LOCAL_SYNTHETIC_CONCURRENCY_AND_RETRY",
    limitation: "Not proof of authenticated Risk/approval or distributed execution.", requests, conflicts,
    results: [{ scenario: "callback_cancel_race", workflow: race, handoff: buildRiskHandoffPackage(race) },
      { scenario: "changed_approval_evidence", workflow: final, handoff: buildRiskHandoffPackage(final) }] };
}
if (require.main === module) verify().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { verify };
