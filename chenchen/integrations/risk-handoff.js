"use strict";

const { ReviewError, REVIEW_VERSION } = require("./model-review");

const HANDOFF_VERSION = "risk-handoff.v1";
const CALLBACK_VERSION = "risk-callback.v1";
const CALLBACK_FIELDS = ["callback_version", "handoff_id", "task_id", "request_id", "run_id", "audit_id", "proposal_sha256", "decision", "reviewer", "reason"];
const RISK_DECISIONS = ["APPROVE", "REJECT", "REQUEST_MORE_INFO"];

function invalid(code, message, statusCode = 422) {
  return new ReviewError(code, message, { statusCode, stage: "RISK_CALLBACK", recovery: "Reload the Risk handoff. Copy its identifiers and proposal hash without changing the action." });
}

function buildRiskHandoffPackage(record) {
  const model = record.model?.model_response;
  const attempts = model || record.model?.response;
  return structuredClone({
    handoff_version: HANDOFF_VERSION,
    contract_version: REVIEW_VERSION,
    workflow_version: record.workflow_version,
    handoff_id: record.risk_handoff.handoff_id,
    task_id: record.task_id,
    request_id: record.request_id,
    run_id: record.run_id,
    audit_id: record.audit.audit_id,
    workflow_status: record.status,
    status: record.risk_handoff.status,
    decision: record.risk_handoff.decision,
    owner: record.risk_handoff.owner,
    execution_allowed: false,
    proposal: record.proposed_action,
    ...(record.funding_check ? { funding_check: record.funding_check } : {}),
    ...(record.cancellation ? { cancellation: record.cancellation } : {}),
    reviewed_input: record.reviewed_input || null,
    input_authority: "UNVERIFIED_CALLER_INPUT",
    model: {
      source: record.model.source || null,
      status: record.model.status,
      model: model?.model || null,
      provider_response_id: model?.provider_response_id || null,
      call_succeeded: model?.call_succeeded === true,
      ...(Number.isInteger(attempts?.attempt_count) ? { attempt_count: attempts.attempt_count, retry_count: attempts.retry_count } : {})
    },
    evidence: record.risk_handoff.evidence,
    approval: record.approval,
    audit: { audit_id: record.audit.audit_id, event_count: record.audit.events.length, latest_event: record.audit.events.at(-1) || null },
    record_endpoint: "/api/review/task/" + encodeURIComponent(record.task_id),
    callback: {
      callback_version: CALLBACK_VERSION,
      endpoint: "/api/review/risk-callback",
      method: "POST",
      required_fields: CALLBACK_FIELDS,
      decisions: RISK_DECISIONS,
      retry_policy: "Identical accepted callback returns DUPLICATE without another decision or audit event. Changed callbacks are rejected. REQUEST_MORE_INFO requires a new reviewed task."
    }
  });
}

function validateRiskCallback(input, record) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !CALLBACK_FIELDS.includes(key))) {
    throw invalid("INVALID_RISK_CALLBACK", "Callback must contain only the documented fields; it cannot change action parameters.");
  }
  const normalized = {};
  for (const field of CALLBACK_FIELDS) {
    if (typeof input[field] !== "string" || !input[field].trim() || input[field].length > 500) {
      throw invalid("INVALID_RISK_CALLBACK", field + " must be a non-empty string of at most 500 characters.");
    }
    normalized[field] = input[field].trim();
  }
  if (normalized.callback_version !== CALLBACK_VERSION || !RISK_DECISIONS.includes(normalized.decision)) {
    throw invalid("INVALID_RISK_CALLBACK", "Unsupported callback version or decision.");
  }
  if (!record?.proposed_action) throw invalid("RISK_BLOCKED", "A failed or missing model proposal cannot receive a Risk callback.", 409);
  const expected = {
    handoff_id: record.risk_handoff.handoff_id, task_id: record.task_id,
    request_id: record.request_id, run_id: record.run_id,
    audit_id: record.audit.audit_id, proposal_sha256: record.proposed_action.proposal_sha256
  };
  for (const [field, value] of Object.entries(expected)) {
    if (normalized[field] !== value) throw invalid("RISK_HANDOFF_MISMATCH", field + " does not match this task's Risk handoff.", 409);
  }
  return normalized;
}

module.exports = { HANDOFF_VERSION, CALLBACK_VERSION, CALLBACK_FIELDS, RISK_DECISIONS, buildRiskHandoffPackage, validateRiskCallback };
