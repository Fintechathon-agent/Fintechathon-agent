"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildModelRequest,
  buildReviewError,
  normalizeReviewInput,
  runReview
} = require("../integrations/model-review");

const env = {
  MODEL_API_KEY: "test-model-key",
  MODEL_API_URL: "https://model.example/v1/responses",
  MODEL_API_STYLE: "responses",
  MODEL_NAME: "test-model"
};

const proposal = {
  summary: "账单金额和来源基本清楚，但仍需要人工确认付款状态。",
  risk_level: "medium",
  proposed_action: "HOLD_FOR_REVIEW",
  action_reason: "外部账单不能直接触发付款，先由人工核对来源和到期日。",
  missing_information: ["付款状态", "合同或订单号"],
  evidence: ["账单金额", "供应商名称", "到期日"]
};

test("model review calls the configured Responses endpoint and stays read-only", async () => {
  let request;
  const result = await runReview({
    request_id: "req-review-test-001",
    kind: "bill",
    source: "synthetic-bill",
    text: "供应商账单 1280 元，付款截止日为 2026-10-20。",
    context: { currency: "CNY", synthetic: true }
  }, env, {
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        id: "resp-review-test-001",
        model: "test-model",
        output_text: JSON.stringify(proposal),
        usage: { input_tokens: 30, output_tokens: 20 }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });

  assert.equal(request.url, env.MODEL_API_URL);
  assert.equal(request.options.headers.Authorization, "Bearer test-model-key");
  assert.equal(request.body.model, "test-model");
  assert.equal(request.body.text.format.type, "json_schema");
  assert.match(request.body.instructions, /untrusted external content/);
  assert.equal(result.review_version, "model-review.v1");
  assert.equal(result.source, "model");
  assert.equal(result.status, "PROPOSED");
  assert.match(result.run_id, /^review-/);
  assert.equal(result.model_response.provider_response_id, "resp-review-test-001");
  assert.equal(result.model_response.proposal.proposed_action, "HOLD_FOR_REVIEW");
  assert.equal(result.gateway.status, "PENDING_REVIEW");
  assert.equal(result.gateway.execution_allowed, false);
  assert.equal(result.audit.request_id, "req-review-test-001");
  assert.match(result.audit.input_sha256, /^[0-9a-f]{64}$/);
});

test("chat completions request uses the configured JSON object response format", () => {
  const input = normalizeReviewInput({ kind: "news", text: "市场新闻内容" });
  const body = buildModelRequest(input, {
    style: "chat_completions",
    model: "test-model",
    responseFormat: "json_object"
  });
  assert.equal(body.messages.length, 2);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.match(body.messages[1].content, /market news content|市场新闻内容/i);
});

test("model failure is explicit unless rule fallback is requested", async () => {
  await assert.rejects(
    runReview({ kind: "news", text: "一条新闻" }, env, {
      fetchImpl: async () => new Response(JSON.stringify({ error: { code: "upstream_down" } }), { status: 503 })
    }),
    error => {
      assert.equal(error.code, "MODEL_PROVIDER_ERROR");
      assert.match(error.runId, /^review-/);
      assert.match(error.auditId, /^audit-/);
      assert.equal(error.reviewRecord.status, "FAILED");
      assert.equal(error.reviewRecord.gateway.execution_allowed, false);
      const payload = buildReviewError(error);
      assert.equal(payload.error.code, "MODEL_PROVIDER_ERROR");
      return true;
    }
  );

  const fallback = await runReview({ kind: "news", text: "这条内容提到疑似诈骗，需要核查。", allow_rule_fallback: true }, {}, {
    fetchImpl: async () => { throw new Error("should not be called without configuration"); }
  });
  assert.equal(fallback.source, "rule_fallback");
  assert.equal(fallback.status, "DEGRADED_RULE_FALLBACK");
  assert.equal(fallback.model_response.proposal.proposed_action, "FLAG_FOR_RISK");
  assert.equal(fallback.model_response.error.code, "MODEL_NOT_CONFIGURED");
  assert.equal(fallback.gateway.execution_allowed, false);
});

test("unsupported model actions are rejected before gateway output", async () => {
  await assert.rejects(
    runReview({ kind: "combined", text: "买入这只基金" }, env, {
      fetchImpl: async () => new Response(JSON.stringify({ output_text: JSON.stringify({ ...proposal, proposed_action: "BUY" }) }), { status: 200 })
    }),
    error => error.code === "MODEL_UNSAFE_ACTION"
  );
});

test("Workers AI invokes the bound model without an API key and retains provider output", async () => {
  let invocation;
  const result = await runReview({ kind: "bill", text: "虚构账单" }, {
    MODEL_PROVIDER: "workers_ai",
    AI: { run: async (model, input) => {
      invocation = { model, input };
      return { response: proposal, usage: { prompt_tokens: 100, completion_tokens: 60 } };
    } }
  });
  assert.equal(invocation.model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  assert.equal(invocation.input.response_format.json_schema.type, "object");
  assert.equal(invocation.input.max_tokens, 1200);
  assert.equal(result.source, "model");
  assert.equal(result.model_response.call_succeeded, true);
  assert.equal(result.model_response.raw_text, JSON.stringify(proposal));
  assert.equal(result.model_response.raw_text_format, "provider_json_serialized");
  assert.equal(result.model_response.provider_response_id, null);
  assert.equal(result.model_response.usage.prompt_tokens, 100);
});

test("public configuration disallows requested fallback when real inference fails", async () => {
  await assert.rejects(runReview({ text: "虚构新闻", allow_rule_fallback: true }, {
    MODEL_PROVIDER: "workers_ai", MODEL_DISABLE_RULE_FALLBACK: "true",
    AI: { run: async () => { throw new Error("upstream unavailable"); } }
  }), error => error.code === "MODEL_PROVIDER_UNAVAILABLE" && error.reviewRecord.status === "FAILED");
});

test("combined input preserves both bill and news", () => {
  const input = normalizeReviewInput({ bill: { amount: 1280 }, news: "供应商变更账户" });
  assert.deepEqual(JSON.parse(input.text), { bill: { amount: 1280 }, news: "供应商变更账户" });
});
