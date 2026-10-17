"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildModelRequest,
  buildReviewError,
  buildOutputContract,
  normalizeReviewInput,
  resolveModelConfig,
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
      assert.equal(payload.error_contract_version, "core-agent-error.v1");
      assert.equal(payload.source_contract_version, "model-review.v1");
      assert.equal(payload.trace.run_id, error.runId);
      assert.equal(payload.trace.audit_id, error.auditId);
      return true;
    }
  );

  const fallback = await runReview({ kind: "news", text: "这条内容提到疑似诈骗，需要核查。", allow_rule_fallback: true }, { MODEL_FALLBACK_TO_RULES: "true" }, {
    fetchImpl: async () => { throw new Error("should not be called without configuration"); }
  });
  assert.equal(fallback.source, "rule_fallback");
  assert.equal(fallback.status, "DEGRADED_RULE_FALLBACK");
  assert.equal(fallback.model_response.proposal.proposed_action, "FLAG_FOR_RISK");
  assert.equal(fallback.model_response.error.code, "MODEL_NOT_CONFIGURED");
  assert.equal(fallback.gateway.execution_allowed, false);
});

test("transient model failures retry once and expose the retry in the audit", async () => {
  let calls = 0;
  const result = await runReview({ kind: "bill", text: "虚构账单需要核查" }, env, {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ error: { code: "temporary" } }), { status: 503 });
      return new Response(JSON.stringify({ id: "resp-after-retry", output_text: JSON.stringify(proposal) }), { status: 200 });
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.model_response.attempt_count, 2);
  assert.equal(result.model_response.retry_count, 1);
  assert.ok(result.audit.events.some(event => event.event_type === "model.retry_scheduled"));
  assert.equal(result.audit.events.at(-2).event_type, "model.completed");
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

test("attempt configuration is bounded and fractional configuration cannot skip inference", () => {
  for (const value of ["0", "-1", "0.5", "NaN", "Infinity"]) {
    assert.equal(resolveModelConfig({ MODEL_MAX_ATTEMPTS: value }).maxAttempts, 2);
  }
  assert.equal(resolveModelConfig({ MODEL_MAX_ATTEMPTS: "1" }).maxAttempts, 1);
  assert.equal(resolveModelConfig({ MODEL_MAX_ATTEMPTS: "50" }).maxAttempts, 3);
});

test("DeepSeek uses the domestic chat endpoint and keeps the shared JSON contract", () => {
  const config = resolveModelConfig({ MODEL_PROVIDER: "deepseek", MODEL_API_KEY: "deepseek-test", MODEL_NAME: "deepseek-chat" });
  assert.equal(config.provider, "deepseek");
  assert.equal(config.endpoint, "https://api.deepseek.com/chat/completions");
  assert.equal(config.style, "chat_completions");
  assert.equal(config.responseFormat, "json_object");
  assert.equal(config.model, "deepseek-chat");
});

test("DeepSeek ignores OpenAI credentials, model and endpoint aliases", () => {
  const config = resolveModelConfig({ MODEL_PROVIDER: "deepseek", OPENAI_API_KEY: "other-provider-secret",
    OPENAI_BASE_URL: "https://other-provider.invalid/responses", OPENAI_MODEL: "other-provider-model" });
  assert.equal(config.apiKey, "");
  assert.equal(config.model, "");
  assert.equal(config.endpoint, "https://api.deepseek.com/chat/completions");
  assert.equal(config.style, "chat_completions");
});

test("missing DeepSeek configuration fails before HTTP with auditable blocked output", async () => {
  for (const config of [
    { MODEL_API_KEY: "test" },
    { MODEL_NAME: "configured-model", OPENAI_API_KEY: "unrelated-key" },
    { MODEL_API_KEY: "test", MODEL_NAME: "configured-model", MODEL_API_STYLE: "responses" }
  ]) {
    let calls = 0;
    await assert.rejects(runReview({ text: "虚构测试" }, { MODEL_PROVIDER: "deepseek", ...config }, {
      fetchImpl: async () => { calls++; throw new Error("must not call"); }
    }), error => {
      assert.equal(error.code, "MODEL_NOT_CONFIGURED");
      assert.equal(error.reviewRecord.status, "FAILED");
      assert.equal(error.reviewRecord.gateway.execution_allowed, false);
      assert.equal(error.reviewRecord.attempt_count, 1);
      assert.equal(calls, 0);
      return true;
    });
  }
});

test("DeepSeek chat adapter carries the full schema and records a verifiable model response", async () => {
  let sent;
  const result = await runReview({ text: "虚构测试：只有399元预算，没有平台报价。" }, {
    MODEL_PROVIDER: "deepseek", MODEL_API_KEY: "synthetic-key", MODEL_NAME: "configured-deepseek-model"
  }, { fetchImpl: async (url, options) => {
    sent = JSON.parse(options.body);
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer synthetic-key");
    return new Response(JSON.stringify({ id: "synthetic-deepseek-response", choices: [{ message: { content: JSON.stringify(proposal) } }], usage: { total_tokens: 90 } }));
  } });
  assert.deepEqual(sent.response_format, { type: "json_object" });
  assert.equal(sent.max_tokens, 1600);
  for (const key of Object.keys(proposal)) assert.ok(sent.messages[0].content.includes(key));
  assert.match(sent.messages[0].content, /Format-only example/);
  assert.equal(result.model_response.provider_response_id, "synthetic-deepseek-response");
  assert.equal(result.model_response.raw_text, JSON.stringify(proposal));
  assert.equal(result.model_response.usage.total_tokens, 90);
  assert.equal(result.gateway.execution_allowed, false);
});

test("schema-invalid responses cannot silently become safe-looking proposals", async () => {
  const { evidence: _evidence, ...withoutEvidence } = proposal;
  for (const invalid of [withoutEvidence, { ...proposal, risk_level: "safe" },
    { ...proposal, missing_information: null }, { ...proposal, execute: true }, { ...proposal, evidence: [8] }]) {
    await assert.rejects(runReview({ text: "虚构测试" }, env, { fetchImpl: async () =>
      new Response(JSON.stringify({ output_text: JSON.stringify(invalid) }))
    }), error => error.code === "MODEL_INVALID_RESPONSE" && error.reviewRecord.gateway.execution_allowed === false);
  }
});

test("scenario routing and output conversion stay explicit", () => {
  const input = normalizeReviewInput({
    kind: "combined",
    scenario: "DOUBLE11_COMPARE",
    output_formats: ["json", "xlsx", "chart"],
    text: "虚构双十一商品和订阅账单，请比较优惠并检查是否挤占生活预算。"
  });
  assert.equal(input.scenario, "DOUBLE11_COMPARE");
  assert.deepEqual(input.output_formats, ["json", "xlsx", "chart"]);
  assert.deepEqual(buildOutputContract(input), {
    contract_version: "agent-output.v1",
    requested_formats: ["json", "xlsx", "chart"],
    available_formats: ["json"],
    status: "PENDING_CONVERTER",
    pending_formats: ["xlsx", "chart"],
    side_effects: false
  });
});

test("persistent transient failures stop at the cap and retain retry evidence", async () => {
  let calls = 0;
  await assert.rejects(runReview({ text: "synthetic" }, { ...env, MODEL_MAX_ATTEMPTS: "50" }, {
    fetchImpl: async () => { calls++; return new Response('{}', { status: 503 }); }
  }), error => {
    assert.equal(calls, 3);
    assert.equal(error.reviewRecord.attempt_count, 3);
    assert.equal(error.reviewRecord.retry_count, 2);
    assert.equal(error.reviewRecord.audit.events.filter(e => e.event_type === "model.retry_scheduled").length, 2);
    assert.equal(error.reviewRecord.gateway.execution_allowed, false);
    return true;
  });
});

test("authentication errors, invalid proposals and unsafe actions are never retried", async () => {
  for (const [status, body, expected] of [
    [401, {}, "MODEL_PROVIDER_ERROR"],
    [200, { output_text: "not a proposal" }, "MODEL_INVALID_RESPONSE"],
    [200, { output_text: JSON.stringify({ ...proposal, proposed_action: "BUY" }) }, "MODEL_UNSAFE_ACTION"]
  ]) {
    let calls = 0;
    await assert.rejects(runReview({ text: "synthetic" }, env, { fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify(body), { status });
    } }), error => {
      assert.equal(error.code, expected);
      assert.equal(calls, 1);
      assert.equal(error.reviewRecord.retry_count, 0);
      return true;
    });
  }
});

test("Retry-After longer than the shared time budget returns a failure without another call", async () => {
  let calls = 0;
  await assert.rejects(runReview({ text: "synthetic" }, { ...env, MODEL_TIMEOUT_MS: "1000" }, { fetchImpl: async () => {
    calls++;
    return new Response('{}', { status: 429, headers: { "Retry-After": "60" } });
  } }), error => {
    assert.equal(calls, 1);
    assert.equal(error.reviewRecord.retry_count, 0);
    assert.equal(error.details.retry_after_ms, 60000);
    return true;
  });
});

test("Workers AI timeout uses one total budget and a late result cannot change the failed record", async () => {
  let finish, calls = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  let failure;
  await assert.rejects(runReview({ text: "synthetic" }, {
    MODEL_PROVIDER: "workers_ai", MODEL_TIMEOUT_MS: "30", MODEL_DISABLE_RULE_FALLBACK: "true",
    AI: { run: () => { calls++; return pending; } }
  }), error => {
    failure = error;
    assert.equal(error.code, "MODEL_TIMEOUT");
    assert.equal(calls, 1);
    return true;
  });
  finish({ response: proposal });
  await pending;
  assert.equal(failure.reviewRecord.status, "FAILED");
  assert.equal(failure.reviewRecord.retry_count, 0);
  assert.equal(failure.reviewRecord.gateway.execution_allowed, false);
});

test("HTTP timeout aborts the request and does not create another attempt after the budget", async () => {
  let calls = 0;
  await assert.rejects(runReview({ text: "synthetic" }, { ...env, MODEL_TIMEOUT_MS: "30" }, {
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      calls++;
      options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })
  }), error => {
    assert.equal(error.code, "MODEL_TIMEOUT");
    assert.equal(calls, 1);
    return true;
  });
});
