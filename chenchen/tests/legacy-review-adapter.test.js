"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ReviewWorkflowStore } = require("../integrations/review-workflow");
const { normalizeLegacyReviewInput, mapWorkflowToLegacyResponse } = require("../integrations/legacy-review-adapter");

function fakeReview(input) {
  return Promise.resolve({
    review_version: "model-review.v1",
    run_id: "review-legacy-fake-001",
    request_id: input.request_id,
    task_id: input.task_id,
    status: "PROPOSED",
    source: "model",
    input: { kind: input.kind, source: input.source, input_sha256: "c".repeat(64) },
    model_response: {
      model: "fake-model",
      provider_response_id: "resp-legacy-fake-001",
      raw_text: JSON.stringify({
        summary: "需要人工复核",
        risk_level: "medium",
        proposed_action: "HOLD_FOR_REVIEW",
        action_reason: "模型只能提出建议",
        missing_information: [],
        evidence: ["用户问题"]
      }),
      proposal: {
        summary: "需要人工复核",
        risk_level: "medium",
        proposed_action: "HOLD_FOR_REVIEW",
        action_reason: "模型只能提出建议",
        missing_information: [],
        evidence: ["用户问题"]
      }
    },
    audit: { audit_id: "audit-legacy-fake-001", events: [] }
  });
}

test("legacy question input maps into the unified review contract", async () => {
  const input = normalizeLegacyReviewInput({
    question: "我想再投入 8000 元买基金，但下个月要交房租，是否冲突？",
    run_id: "legacy-run-001",
    session_id: "legacy-session-001"
  });
  assert.equal(input.kind, "combined");
  assert.equal(input.text.startsWith("我想再投入"), true);
  assert.equal(input.request_id, "legacy-run-001");
  assert.equal(input.context.legacy_contract, "legacy-review.v0");

  const store = new ReviewWorkflowStore({ modelRunner: fakeReview });
  const record = await store.start(input);
  const legacy = mapWorkflowToLegacyResponse(record);
  assert.equal(legacy.adapter_version, "legacy-review-adapter.v1");
  assert.equal(legacy.source_contract, "review-workflow.v1");
  assert.equal(legacy.execution_state, "awaiting_risk");
  assert.equal(legacy.queued, true);
  assert.equal(legacy.auto_executed, false);
  assert.equal(legacy.gate.execution_allowed, false);
  assert.equal(legacy.recommendation.proposal_sha256, record.proposed_action.proposal_sha256);
  assert.equal(legacy.audit.task_id, legacy.task_id);
});
