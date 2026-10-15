"use strict";

// Synthetic provider faults only; does not call a live model or execute money movements.
const assert = require("node:assert/strict");
const { ReviewWorkflowStore } = require("../integrations/review-workflow");
const { buildRiskHandoffPackage } = require("../integrations/risk-handoff");

async function verify() {
  const proposal = { summary: "虚构投资计划需要核对房租预留", risk_level: "medium",
    proposed_action: "HOLD_FOR_REVIEW", action_reason: "用户资金用途需经过 Risk 和审批",
    missing_information: ["来源核验"], evidence: ["虚构房租安排"] };
  const results = [];
  for (const outcome of ["recovered", "exhausted"]) {
    let calls = 0;
    const workflow = new ReviewWorkflowStore();
    const env = { MODEL_PROVIDER: "workers_ai", MODEL_DISABLE_RULE_FALLBACK: "true", MODEL_MAX_ATTEMPTS: "2",
      AI: { run: async () => {
        calls++;
        if (calls === 1 || outcome === "exhausted") throw new Error("synthetic temporary outage");
        return { id: "synthetic-retry-provider-response", response: proposal };
      } } };
    let record;
    try {
      record = await workflow.start({ text: "虚构投资计划与房租用途检查", context: { synthetic: true } }, env);
    } catch (error) { record = error.workflowRecord; }
    assert.equal(calls, 2);
    assert.equal(record.status, outcome === "recovered" ? "PENDING_RISK" : "MODEL_FAILED");
    assert.equal(record.execution.execution_allowed, false);
    const handoff = buildRiskHandoffPackage(record);
    assert.equal(handoff.model.attempt_count, 2);
    assert.equal(handoff.model.retry_count, 1);
    assert.equal(record.audit.events.filter(event => event.event_type === "model.retry_scheduled").length, 1);
    await assert.rejects(workflow.simulate({ task_id: record.task_id, proposal_sha256: record.proposed_action?.proposal_sha256 }), error => error.code === "EXECUTION_BLOCKED");
    record = workflow.getByTaskId(record.task_id);
    results.push({ scenario: outcome, actual_provider_calls: calls, workflow: record, handoff: buildRiskHandoffPackage(record) });
  }
  return { checked_at: new Date().toISOString(), evidence_type: "LOCAL_SYNTHETIC_FAULT_INJECTION", passed: true,
    scope: "Real Cloudflare outage/recovery was not induced; these are reproducible controlled tests.", results };
}

if (require.main === module) verify().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
module.exports = { verify };
