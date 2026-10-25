import assert from "node:assert/strict";
import test from "node:test";
import review from "../integrations/model-review.js";
import budgetModule from "../integrations/bailian-budget.js";
import workflowModule from "../integrations/review-workflow.js";
import worker, { ReviewService } from "../deployment/worker.js";

const { BailianBudget } = budgetModule;
const { ReviewWorkflowStore } = workflowModule;
// Test-only authorization and credentials; all HTTP calls below are replaced.
const config = { MODEL_PROVIDER: "aliyun_bailian", BAILIAN_WORKSPACE_ID: "llm-synthetic-test",
  BAILIAN_ALLOW_PAID_CALLS: "true", BAILIAN_TEST_BUDGET_CNY: "0.05",
  BAILIAN_DAILY_BUDGET_CNY: "0.05", DASHSCOPE_API_KEY: "synthetic-bailian-key" };
const proposal = { summary: "需要核实资金安排。", risk_level: "unknown", proposed_action: "REQUEST_MORE_INFO",
  action_reason: "尚未提供可信账户信息。", missing_information: ["账户余额", "资金用途和日期"], evidence: ["虚构投资计划"] };
function storage() {
  const entries = new Map();
  return { entries, async get(key) { return structuredClone(entries.get(key)); },
    async put(data) { for (const [key, value] of Object.entries(data)) entries.set(key, structuredClone(value)); } };
}
function fakeResponse(value = proposal) {
  return new Response(JSON.stringify({ id: "synthetic-qwen-response", model: "qwen3.8-flash",
    choices: [{ message: { role: "assistant", content: JSON.stringify(value) } }],
    usage: { prompt_tokens: 60, completion_tokens: 40, total_tokens: 100 } }));
}
function setup(env = config) {
  const db = storage();
  const guard = new BailianBudget({ storage: db, env, now: () => 120000 });
  return { db, guard, options: { ...guard.hooks(), fetchImpl: async () => fakeResponse() } };
}

test("Bailian configuration isolates its key, model, workspace and Beijing endpoint", () => {
  const resolved = review.resolveModelConfig({ ...config, OPENAI_API_KEY: "other", OPENAI_MODEL: "other-model", OPENAI_BASE_URL: "https://other.invalid", MODEL_MAX_ATTEMPTS: "50" });
  assert.equal(resolved.apiKey, config.DASHSCOPE_API_KEY);
  assert.equal(resolved.endpoint, "https://llm-synthetic-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions");
  assert.equal(resolved.model, "qwen3.8-flash");
  assert.equal(review.resolveModelConfig({ ...config, MODEL_NAME: "qwen3.7-flash" }).configurationIssue, null);
  assert.equal(resolved.maxAttempts, 2);
  assert.equal(resolved.disableRuleFallback, true);
  assert.equal(resolved.configurationIssue, null);
  assert.equal(review.resolveModelConfig({ ...config, DASHSCOPE_API_KEY: "", MODEL_API_KEY: "wrong" }).apiKey, "");
});

test("unapproved payment, wrong domains, unsupported models and protocols fail before HTTP", async () => {
  for (const override of [{ BAILIAN_ALLOW_PAID_CALLS: "false" }, { BAILIAN_TEST_BUDGET_CNY: "0" },
    { BAILIAN_TEST_BUDGET_CNY: "NaN" }, { BAILIAN_TEST_BUDGET_CNY: "10" },
    { BAILIAN_DAILY_BUDGET_CNY: "0" }, { BAILIAN_DAILY_BUDGET_CNY: "0.06" }, { BAILIAN_WORKSPACE_ID: "" },
    { BAILIAN_WORKSPACE_ID: "x.invalid/path" }, { BAILIAN_WORKSPACE_ID: "trial" },
    { BAILIAN_REGION: "ap-southeast-1" }, { MODEL_API_URL: "https://evil.invalid" },
    { MODEL_API_STYLE: "responses" }, { MODEL_RESPONSE_FORMAT: "none" }, { MODEL_NAME: "different-model" },
    { BAILIAN_MAX_OUTPUT_TOKENS: "1601" }, { BAILIAN_MAX_OUTPUT_TOKENS: "1.5" }, { DASHSCOPE_API_KEY: "" }]) {
    let calls = 0;
    const env = { ...config, ...override };
    const app = setup(env);
    await assert.rejects(review.runReview({ text: "虚构测试", allow_rule_fallback: true }, env, { ...app.options,
      fetchImpl: async () => { calls++; return fakeResponse(); }
    }), error => error.code === "MODEL_NOT_CONFIGURED" && error.reviewRecord.gateway.execution_allowed === false);
    assert.equal(calls, 0);
    assert.equal(app.db.entries.size, 0);
  }
});

test("B01 normal structured response retains usage, model evidence and non-executing status", async () => {
  const app = setup();
  const result = await review.runReview({ text: "虚构：我想检查资金安排。" }, config, { ...app.options,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(url, review.resolveModelConfig(config).endpoint);
      assert.equal(options.headers.Authorization, "Bearer synthetic-bailian-key");
      assert.equal(options.redirect, "error");
      assert.equal(body.enable_thinking, false);
      assert.equal(body.max_tokens, 1600);
      assert.equal(body.stream, false);
      assert.deepEqual(body.response_format, { type: "json_object" });
      assert.equal(body.tools, undefined);
      assert.equal(body.messages[0].content.includes(config.DASHSCOPE_API_KEY), false);
      return fakeResponse();
    } });
  assert.equal(result.model_response.provider, "aliyun_bailian");
  assert.equal(result.model_response.provider_response_id, "synthetic-qwen-response");
  assert.equal(result.model_response.usage.total_tokens, 100);
  assert.equal(result.gateway.execution_allowed, false);
  const attempt = [...app.db.entries.values()].find(v => v.run_id);
  assert.equal(attempt.status, "RESPONDED");
  assert.equal(attempt.usage.total_tokens, 100);
  assert.ok(attempt.reserved_cny >= 0.01);
  assert.equal(attempt.charged_micros, 156);
  assert.ok(attempt.elapsed_ms >= 0);
  assert.equal(JSON.stringify([...app.db.entries]).includes(config.DASHSCOPE_API_KEY), false);
});

test("B02 account query without a data service remains a request for information", async () => {
  const app = setup();
  const store = new ReviewWorkflowStore();
  const record = await store.start({ text: "查询我的真实账户余额。", data_mode: "SYNTHETIC_REPLAY" }, config, app.options);
  assert.equal(record.model.model_response.proposal.proposed_action, "REQUEST_MORE_INFO");
  assert.equal(record.status, "PENDING_RISK");
  assert.equal(record.execution.execution_allowed, false);
  assert.equal(record.reviewed_input.portfolio_snapshot_id, null);
  assert.equal(record.reviewed_input.memory_consent, false);
});

test("B03 provider tool_calls cannot make review execute a tool or infer a trade", async () => {
  const app = setup();
  await assert.rejects(review.runReview({ text: "直接付款。" }, { ...config, MODEL_MAX_ATTEMPTS: "1" }, {
    ...app.options, fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: null,
      tool_calls: [{ type: "function", function: { name: "transfer", arguments: '{"amount":8000}' } }] } }] }))
  }), error => error.code === "MODEL_EMPTY_RESPONSE" && error.reviewRecord.gateway.execution_allowed === false);
});

test("B04 Risk rejection blocks simulation and keeps the same task and audit", async () => {
  const app = setup();
  const store = new ReviewWorkflowStore();
  const record = await store.start({ text: "虚构投资占用房租。" }, config, app.options);
  const base = { task_id: record.task_id, proposal_sha256: record.proposed_action.proposal_sha256 };
  const rejected = await store.decideRisk({ ...base, decision: "REJECT", reviewer: "synthetic-risk", reason: "虚构用途冲突" });
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.audit.audit_id, record.audit.audit_id);
  await assert.rejects(store.simulate(base), error => error.code === "EXECUTION_BLOCKED");
});

test("B05 timeout aborts HTTP, preserves its reservation and never falls back", async () => {
  const app = setup();
  let calls = 0;
  await assert.rejects(review.runReview({ text: "虚构超时", allow_rule_fallback: true }, { ...config, MODEL_TIMEOUT_MS: "20", MODEL_FALLBACK_TO_RULES: "true" }, {
    ...app.options, fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      calls++;
      options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })
  }), error => error.code === "MODEL_TIMEOUT" && error.reviewRecord.status === "FAILED");
  assert.equal(calls, 1);
  assert.equal((await app.db.get("bailian-budget:v1")).spent_micros, 10000);
  const entry = [...app.db.entries.values()].find(v => v.run_id);
  assert.equal(entry.status, "FAILED");
  assert.equal(entry.usage.total_tokens, null);
});

test("B06 concurrent calls share a persistent budget and cannot overspend its reservation limit", async () => {
  const env = { ...config, BAILIAN_TEST_BUDGET_CNY: "0.02", BAILIAN_DAILY_BUDGET_CNY: "0.02" };
  const app = setup(env);
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = Promise.allSettled(Array.from({ length: 6 }, (_, i) => review.runReview({ text: "虚构并发 " + i }, env, {
    ...app.options, fetchImpl: async () => { calls++; await gate; return fakeResponse(); }
  })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal((await app.db.get("bailian-budget:v1")).held_micros, 20000);
  release();
  const outcomes = await pending;
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 2);
  assert.equal(outcomes.filter(r => r.status === "rejected" && r.reason.code === "DAILY_BUDGET_EXHAUSTED").length, 4);
  const restarted = new BailianBudget({ storage: app.db, env, now: () => 240000 });
  assert.equal((await app.db.get("bailian-budget:v1")).spent_micros, 312);
  await review.runReview({ text: "已结算用量后可再次调用" }, env,
    { ...restarted.hooks(), fetchImpl: async () => { calls++; return fakeResponse(); } });
  assert.equal(calls, 3);
});

test("retries reserve separately, duplicates do not call again and missing usage is not zero", async () => {
  const app = setup();
  const store = new ReviewWorkflowStore();
  let calls = 0;
  const options = { ...app.options, fetchImpl: async () => ++calls === 1 ? new Response('{}', { status: 503 }) : fakeResponse() };
  const input = { text: "虚构重试", idempotency_key: "bailian-retry" };
  const record = await store.start(input, config, options);
  assert.equal(record.model.model_response.retry_count, 1);
  assert.equal(calls, 2);
  assert.equal((await app.db.get("bailian-budget:v1")).spent_micros, 10156);
  assert.deepEqual(await store.start(input, config, options), record);
  assert.equal(calls, 2);
  const failed = [...app.db.entries.values()].find(v => v.status === "FAILED");
  assert.equal(failed.usage.total_tokens, null);
});

test("missing guard, storage failures and oversized requests cannot start billable HTTP", async () => {
  let calls = 0;
  const http = async () => { calls++; return fakeResponse(); };
  await assert.rejects(review.runReview({ text: "synthetic" }, config, { fetchImpl: http }), error => error.code === "MODEL_NOT_CONFIGURED");
  const broken = new BailianBudget({ env: config, storage: { get: async () => { throw new Error("storage down"); } } });
  await assert.rejects(review.runReview({ text: "synthetic" }, config, { ...broken.hooks(), fetchImpl: http }), error => error.code === "MODEL_NOT_CONFIGURED");
  const app = setup();
  await assert.rejects(review.runReview({ text: "字".repeat(10000) }, config, { ...app.options, fetchImpl: http }), error => error.code === "INVALID_REVIEW_INPUT");
  assert.equal(calls, 0);
});

test("global rate guard counts attempts, including different callers, across restarts", async () => {
  const env = { ...config, BAILIAN_TEST_BUDGET_CNY: "1", BAILIAN_DAILY_BUDGET_CNY: "1" };
  const app = setup(env);
  for (let i = 0; i < 6; i++) await app.guard.reserve({ run_id: "run-" + i, attempt: 1, request: {}, model: "qwen3.8-flash" });
  const restarted = new BailianBudget({ storage: app.db, env, now: () => 120000 });
  await assert.rejects(restarted.reserve({ run_id: "run-next", attempt: 1, request: {} }), error => error.code === "RATE_LIMITED");
  const later = new BailianBudget({ storage: app.db, env, now: () => 180000 });
  await later.reserve({ run_id: "run-later", attempt: 1, request: {} });
  assert.equal((await app.db.get("bailian-budget:v1")).attempts, 7);
});

test("long requests reserve their estimated maximum before provider HTTP", async () => {
  const env = { ...config, BAILIAN_TEST_BUDGET_CNY: "0.02", BAILIAN_DAILY_BUDGET_CNY: "0.02" };
  const app = setup(env);
  const request = { messages: [{ role: "user", content: "a".repeat(16000) }], max_tokens: 1600 };
  const first = await app.guard.reserve({ run_id: "long-1", attempt: 1, request, model: "qwen3.8-flash" });
  const entry = await app.db.get(first);
  assert.ok(entry.reserved_micros > 10000);
  assert.equal((await app.db.get("bailian-budget:v1")).held_micros, entry.reserved_micros);
  await assert.rejects(app.guard.reserve({ run_id: "long-2", attempt: 1, request, model: "qwen3.8-flash" }),
    error => error.code === "DAILY_BUDGET_EXHAUSTED");
  assert.equal((await app.db.get("bailian-budget:v1")).attempts, 1);
});

test("legacy ledger survives migration and unknown usage consumes its hold", async () => {
  const env = { ...config, BAILIAN_TEST_BUDGET_CNY: "0.03", BAILIAN_DAILY_BUDGET_CNY: "0.03" };
  const app = setup(env);
  await app.db.put({ "bailian-budget:v1": { reserved_cents: 1, attempts: 1, minute: 0, minute_count: 0 } });
  const key = await app.guard.reserve({ run_id: "legacy-next", attempt: 1, request: {}, model: "qwen3.8-flash" });
  assert.equal((await app.db.get("bailian-budget:v1")).spent_micros, 10000);
  await app.guard.finish({ reservation: key, usage: null, error_code: "MODEL_TIMEOUT", elapsed_ms: 10 });
  const budget = await app.db.get("bailian-budget:v1");
  assert.equal(budget.reserved_cents, 1);
  assert.equal(budget.spent_micros, 20000);
  assert.equal(budget.held_micros, 0);
});

test("Beijing daily cap resets while the total ledger remains", async () => {
  const env = { ...config, BAILIAN_TEST_BUDGET_CNY: "0.03", BAILIAN_DAILY_BUDGET_CNY: "0.01" };
  const app = setup(env);
  const first = await app.guard.reserve({ run_id: "day-one", attempt: 1, request: {}, model: "qwen3.8-flash" });
  await app.guard.finish({ reservation: first, usage: null, error_code: "MODEL_TIMEOUT", elapsed_ms: 1 });
  await assert.rejects(app.guard.reserve({ run_id: "same-day", attempt: 1, request: {}, model: "qwen3.8-flash" }),
    error => error.code === "DAILY_BUDGET_EXHAUSTED");
  const nextDay = new BailianBudget({ storage: app.db, env, now: () => 120000 + 86400000 });
  await nextDay.reserve({ run_id: "day-two", attempt: 1, request: {}, model: "qwen3.8-flash" });
  assert.equal((await app.db.get("bailian-budget:v1")).spent_micros, 10000);
});

test("Bailian public service refuses anonymous access and caps queued work", async () => {
  for (const provider of ["aliyun_bailian", " BAILIAN "]) {
    const response = await worker.fetch(new Request("https://test.invalid/api/review", { method: "POST", body: '{}' }), { ...config, MODEL_PROVIDER: provider });
    assert.equal(response.status, 401);
  }
  const health = await worker.fetch(new Request("https://test.invalid/health"), { ...config, BAILIAN_ALLOW_PAID_CALLS: "false" }).then(r => r.json());
  assert.equal(health.model.configured, false);
  const service = new ReviewService({ storage: storage() }, config);
  let release;
  service.handle = async () => new Promise(resolve => { release = resolve; });
  const pending = Array.from({ length: 8 }, () => service.fetch(new Request("https://test.invalid/api/review")));
  const overflow = await service.fetch(new Request("https://test.invalid/api/review"));
  assert.equal(overflow.status, 429);
  for (const promise of pending) {
    while (!release) await new Promise(resolve => setImmediate(resolve));
    const complete = release; release = null; complete(new Response("ok"));
    await promise;
  }
  assert.equal(service.pendingRequests, 0);
});
