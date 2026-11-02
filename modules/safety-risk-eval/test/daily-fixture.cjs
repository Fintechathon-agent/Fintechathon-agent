"use strict";
const { createHash } = require("node:crypto");
const sha = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function payload(amount = 100000) {
  const now = new Date(), at = now.toISOString(), due = new Date(now.getTime() + 3 * 86400000).toISOString();
  return { contract_version: "daily-risk-workbench.v1", snapshot: { currency: "CNY", cash_ledger_minor: 1200000, as_of: at,
    purposes: [{ purpose_id: "tuition", label: "学费", reserved_now_minor: 600000, remaining_due_minor: 600000, due_at: due }, { purpose_id: "rent", label: "房租", reserved_now_minor: 400000, remaining_due_minor: 400000, due_at: due }],
    hard_floor: { state: "DISABLED_CONFIRMED", amount_minor: 0 }, income_events: [] },
    action: { type: "INVESTMENT", amount_minor: amount, fees_minor: 0, at }, facts_confirmed: true, purposes_confirmed: true };
}
function confirm(record) { return { task_id: record.input.binding.task_id, risk_check_id: record.review.risk_check_id, binding: record.input.binding, accepted_reason_ids: record.review.reasons.filter(r => r.acceptance_allowed).map(r => r.reason_id), confirmed: true }; }
// Contract substitute only; this is never shown as an actual model run.
function modelResponse(request) {
  const task_id = "core-daily-test", run_id = "run-daily-test", audit_id = "audit-daily-test", input_sha256 = sha(request), provider_response_id = "provider-daily-test";
  const proposal = { summary: "当前资金保护需保留。", risk_level: "medium", proposed_action: "FLAG_FOR_RISK", action_reason: "只读分析不授权执行", evidence: [], missing_information: [] };
  const bound = { proposed_action: proposal.proposed_action, action_reason: proposal.action_reason, risk_level: proposal.risk_level, requested_action: request.requested_action, action_parameters: request.action_parameters, model_response_id: provider_response_id }, proposal_sha256 = sha(bound);
  return { workflow_version: "review-workflow.v1", task_id, request_id: request.request_id, run_id, status: "PENDING_RISK", risk_decision: null,
    model: { source: "model", status: "PROPOSED", input: { source: request.source, kind: request.kind, input_sha256 }, model_response: { call_succeeded: true, model: "test-model", provider_response_id, raw_text: JSON.stringify(proposal), raw_text_format: "provider_json_serialized", proposal } },
    proposed_action: { ...bound, proposal_sha256 }, risk_handoff: { contract_version: "model-review.v1", handoff_id: "handoff-daily-test", task_id, run_id, status: "PENDING_REVIEW", execution_allowed: false, evidence: { input_sha256, model_response_id: provider_response_id, proposal_sha256, audit_id } },
    audit: { audit_id, task_id, request_id: request.request_id, run_id, events: [{ task_id, payload: { request_id: request.request_id, run_id } }] },
    approval: { task_id, status: "PENDING", decision: null, approver: null, proposal_sha256 }, execution: { task_id, status: "BLOCKED", execution_allowed: false, simulation_allowed: false, receipt: null } };
}
module.exports = { payload, confirm, modelResponse };
