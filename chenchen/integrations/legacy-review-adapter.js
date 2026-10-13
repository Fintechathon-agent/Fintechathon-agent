"use strict";

const modelReview = require("./model-review");

const ADAPTER_VERSION = "legacy-review-adapter.v1";

function requiredQuestion(value) {
  if (typeof value !== "string" || !value.trim()) {
    const error = new modelReview.ReviewError("INVALID_LEGACY_REVIEW_INPUT", "question is required", {
      statusCode: 422,
      stage: "VALIDATION",
      recovery: "Provide the legacy question field or use model-review.v1 with kind and text."
    });
    throw error;
  }
  return value.trim().slice(0, 20000);
}

function normalizeLegacyReviewInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new modelReview.ReviewError("INVALID_LEGACY_REVIEW_INPUT", "legacy review body must be a JSON object", {
      statusCode: 422,
      stage: "VALIDATION",
      recovery: "Send { question: string } or use model-review.v1."
    });
  }
  const question = requiredQuestion(input.question);
  const legacyContext = {
    ...(input.context && typeof input.context === "object" && !Array.isArray(input.context) ? input.context : {}),
    legacy_contract: "legacy-review.v0",
    legacy_run_id: input.run_id || null,
    legacy_session_id: input.session_id || null
  };
  return modelReview.normalizeReviewInput({
    request_id: input.request_id || input.run_id || null,
    task_id: input.task_id || null,
    source: input.source || "qiqi-legacy-review",
    kind: input.kind || "combined",
    text: question,
    requested_action: input.requested_action || "只生成建议并交给统一 Risk，不执行任何动作",
    action_parameters: input.action_parameters || {},
    context: legacyContext,
    allow_rule_fallback: false
  });
}

function executionState(record) {
  return {
    PENDING_RISK: "awaiting_risk",
    PENDING_APPROVAL: "awaiting_approval",
    READY_FOR_SIMULATION: "ready_for_simulation",
    SIMULATED: "simulated",
    REJECTED: "rejected",
    MODEL_FAILED: "blocked"
  }[record.status] || "blocked";
}

function mapWorkflowToLegacyResponse(record) {
  const proposal = record.proposed_action;
  const riskApproved = record.risk_decision?.decision === "APPROVE";
  return {
    adapter_version: ADAPTER_VERSION,
    contract_version: "legacy-review.v0",
    source_contract: record.workflow_version,
    run_id: record.run_id,
    task_id: record.task_id,
    request_id: record.request_id,
    decision_source: record.model?.source || "model",
    model_status: record.model?.status || "FAILED",
    model_raw: record.model?.model_response?.raw_text || null,
    execution_state: executionState(record),
    queued: record.status === "PENDING_RISK" || record.status === "PENDING_APPROVAL",
    requires_approval: Boolean(record.approval?.required),
    auto_executed: false,
    recommendation: proposal ? {
      action: proposal.proposed_action,
      reason: proposal.action_reason,
      risk_level: proposal.risk_level,
      quantity: proposal.action_parameters?.quantity ?? 0,
      price: proposal.action_parameters?.price ?? 0,
      confidence: 0,
      evidence: record.model?.model_response?.proposal?.evidence || [],
      proposal_sha256: proposal.proposal_sha256
    } : null,
    gate: {
      passed: riskApproved,
      fail_closed: true,
      execution_allowed: false,
      status: record.risk_handoff?.status || "BLOCKED",
      reasons: [record.risk_handoff?.reason || "统一 Risk 尚未完成复核。"]
    },
    approval: record.approval,
    risk_handoff: record.risk_handoff,
    execution: record.execution,
    audit: record.audit,
    error: record.error || null
  };
}

module.exports = { ADAPTER_VERSION, normalizeLegacyReviewInput, mapWorkflowToLegacyResponse };
