import assert from "node:assert/strict";
import test from "node:test";
import worker, { ReviewService } from "../deployment/worker.js";
import serverModule from "../server.js";

const proposal = { summary: "Synthetic legacy review", risk_level: "unknown", proposed_action: "HOLD_FOR_REVIEW",
  action_reason: "Wait for Risk", missing_information: [], evidence: ["Synthetic input"] };
function setup() {
  const rows = new Map(); let calls = 0, failFinal = false;
  const storage = {
    get: async key => structuredClone(rows.get(key)),
    put: async entries => {
      if (failFinal && Object.keys(entries).some(key => key.startsWith("run:"))) throw new Error("SYNTHETIC_STORAGE_FAILURE");
      for (const [key, value] of Object.entries(entries)) rows.set(key, structuredClone(value));
    }
  };
  const env = { MODEL_PROVIDER: "workers_ai", MODEL_MAX_ATTEMPTS: "1", MODEL_REQUESTS_PER_MINUTE: "100",
    MODEL_DISABLE_RULE_FALLBACK: "true", RATE_LIMIT_PER_MINUTE: "0",
    AI: { run: async () => { calls++; return { id: "synthetic-legacy-" + calls, response: proposal }; } } };
  let service = new ReviewService({ storage }, env);
  env.REVIEW_SERVICE = { idFromName: x => x, get: () => service };
  return { env, calls: () => calls, fail: value => { failFinal = value; }, restart: () => { service = new ReviewService({ storage }, env); } };
}
function call(app, body, key, endpoint = "/api/review/legacy") {
  return worker.fetch(new Request("https://synthetic.test" + endpoint, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body)
  }), app.env);
}

test("legacy header retries share one model call and recover the same task after restart", async () => {
  const app = setup(), input = { question: "Synthetic rent and investment" };
  const results = await Promise.all(Array.from({ length: 6 }, () => call(app, input, "legacy-header-key")));
  assert.ok(results.every(r => r.status === 200));
  const records = await Promise.all(results.map(r => r.json()));
  assert.equal(app.calls(), 1);
  assert.equal(new Set(records.map(r => r.task_id)).size, 1);
  app.restart();
  const replay = await call(app, input, "legacy-header-key").then(r => r.json());
  assert.deepEqual(replay, records[0]);
  const full = await call(app, undefined, null, "/api/review/task/" + replay.task_id).then(r => r.json());
  assert.equal(full.idempotency_key, "legacy-header-key");
  assert.equal(full.status, "PENDING_RISK");
  assert.equal(replay.auto_executed, false);
  assert.equal(replay.gate.execution_allowed, false);
  assert.equal(app.calls(), 1);
});

test("legacy body key rejects changed question, amount and session without another model call", async () => {
  const app = setup(), input = { question: "Synthetic bill", session_id: "synthetic-session", idempotency_key: "legacy-body-key", action_parameters: { amount: 4000 } };
  assert.equal((await call(app, input)).status, 200);
  for (const change of [{ question: "Different purpose" }, { action_parameters: { amount: 8000 } }, { session_id: "different-session" }]) {
    const response = await call(app, { ...input, ...change });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "IDEMPOTENCY_CONFLICT");
  }
  assert.equal(app.calls(), 1);
});

test("legacy invalid keys and overlong questions fail before inference instead of dropping data", async () => {
  const app = setup();
  for (const body of [{ question: "Synthetic", idempotency_key: 17 }, { question: "Synthetic", idempotency_key: "k".repeat(201) },
    { question: "x".repeat(20000) + "下月必须交房租" }]) {
    const response = await call(app, body);
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, "INVALID_REVIEW_INPUT");
  }
  assert.equal(app.calls(), 0);
});

test("legacy final storage failure keeps its reservation and blocks a new inference after restart", async () => {
  const app = setup(), input = { question: "Synthetic interrupted legacy request", idempotency_key: "legacy-interrupted" };
  app.fail(true);
  const failed = await call(app, input); assert.equal(failed.status, 503);
  const first = await failed.json(); assert.ok(first.trace.task_id);
  app.fail(false); app.restart();
  const retry = await call(app, input); assert.equal(retry.status, 503);
  const body = await retry.json();
  assert.equal(body.trace.task_id, first.trace.task_id);
  assert.equal(body.error.retryable, false);
  assert.equal(app.calls(), 1);
});

test("local HTTP legacy route preserves the same retry protection", async t => {
  const { server, reviewWorkflow } = serverModule;
  const previous = reviewWorkflow.modelRunner; let calls = 0;
  reviewWorkflow.reset();
  reviewWorkflow.modelRunner = async input => {
    calls++;
    return { run_id: "synthetic-local-" + input.task_id, source: "model", status: "PROPOSED",
      input: { input_sha256: "a".repeat(64) }, model_response: { provider_response_id: "synthetic-response", proposal },
      audit: { audit_id: "synthetic-audit-" + input.task_id, events: [] } };
  };
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { reviewWorkflow.modelRunner = previous; reviewWorkflow.reset(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const endpoint = "http://127.0.0.1:" + server.address().port + "/api/review/legacy";
  const init = { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "local-legacy-retry" }, body: JSON.stringify({ question: "Synthetic bill" }) };
  const responses = await Promise.all(Array.from({ length: 5 }, () => fetch(endpoint, init)));
  assert.ok(responses.every(r => r.status === 200));
  const records = await Promise.all(responses.map(r => r.json()));
  assert.equal(calls, 1);
  assert.equal(new Set(records.map(r => r.task_id)).size, 1);
  const changed = await fetch(endpoint, { ...init, body: JSON.stringify({ question: "Changed purpose" }) });
  assert.equal(changed.status, 409);
  assert.equal(calls, 1);
});
