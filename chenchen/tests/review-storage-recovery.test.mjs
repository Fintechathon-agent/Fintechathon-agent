import assert from "node:assert/strict";
import test from "node:test";
import worker, { ReviewService } from "../deployment/worker.js";

function setup() {
  const rows = new Map(); let calls = 0, rejectWrites = () => false;
  const storage = {
    get: async key => structuredClone(rows.get(key)),
    put: async entries => {
      if (rejectWrites(entries)) throw new Error("SYNTHETIC_STORAGE_FAILURE");
      for (const [key, value] of Object.entries(entries)) rows.set(key, structuredClone(value));
    }
  };
  const env = { MODEL_PROVIDER: "workers_ai", MODEL_MAX_ATTEMPTS: "1", MODEL_DISABLE_RULE_FALLBACK: "true", RATE_LIMIT_PER_MINUTE: "0",
    AI: { run: async () => { calls++; return { id: "synthetic-provider-" + calls, response: {
      summary: "Synthetic storage recovery case", risk_level: "unknown", proposed_action: "HOLD_FOR_REVIEW",
      action_reason: "Risk required", evidence: [], missing_information: [] } }; } } };
  let service = new ReviewService({ storage }, env);
  env.REVIEW_SERVICE = { idFromName: x => x, get: () => service };
  return { rows, storage, env, calls: () => calls, reject: fn => { rejectWrites = fn; },
    restart: () => { service = new ReviewService({ storage }, env); } };
}
function call(app, body, endpoint = "/api/review") {
  return worker.fetch(new Request("https://synthetic.test" + endpoint, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  }), app.env);
}
const input = { text: "虚构房租与投资，存储故障测试", data_mode: "SYNTHETIC_REPLAY", idempotency_key: "storage-recovery-test" };
const isFinal = entries => Object.keys(entries).some(key => key.startsWith("run:"));

test("storage failure before reservation cannot invoke a model", async () => {
  const app = setup(); app.reject(() => true);
  const response = await call(app, input);
  assert.equal(response.status, 503); assert.equal(app.calls(), 0);
});

test("lost final write leaves an unresolved reservation; restart and retries cannot invoke again", async () => {
  const app = setup(); app.reject(isFinal);
  const response = await call(app, input); assert.equal(response.status, 503);
  const failure = await response.json();
  assert.equal(app.calls(), 1); assert.ok(failure.trace.task_id); assert.ok(failure.trace.request_id);
  assert.equal(failure.error.retryable, false); assert.equal(failure.workflow, null);
  const reservations = [...app.rows.values()].filter(x => x?.reservation_version === "review-reservation.v1");
  assert.ok(reservations.length); assert.ok(reservations.every(x => x.state === "RESERVED"));
  assert.equal(JSON.stringify(reservations).includes(input.text), false);
  app.reject(() => false); app.restart();
  const retry = await call(app, input); assert.equal(retry.status, 503);
  assert.equal((await retry.json()).trace.task_id, failure.trace.task_id);
  const read = await call(app, undefined, "/api/review/task/" + failure.trace.task_id);
  assert.equal(read.status, 503); assert.equal((await read.json()).trace.task_id, failure.trace.task_id);
  assert.equal((await call(app, { ...input, task_id: failure.trace.task_id, idempotency_key: "different-key" })).status, 503);
  assert.equal((await call(app, { ...input, text: "修改后的金额" })).status, 409);
  assert.equal(app.calls(), 1);
  const execution = await call(app, { task_id: failure.trace.task_id, proposal_sha256: "a".repeat(64) }, "/api/review/simulate");
  assert.notEqual(execution.status, 200);
});

test("model failure whose audit write fails also blocks repeated inference", async () => {
  const app = setup(); let failures = 0;
  app.env.AI.run = async () => { failures++; throw new Error("SYNTHETIC_MODEL_FAILURE"); };
  app.reject(isFinal);
  const response = await call(app, input); assert.equal(response.status, 503);
  const failed = await response.json(); assert.ok(failed.trace.task_id);
  app.reject(() => false); app.restart();
  assert.equal((await call(app, input)).status, 503); assert.equal(failures, 1);
});

test("atomic commit stores reservation and record together and survives a lost response", async () => {
  const app = setup(); const put = app.storage.put; let interrupted = false;
  app.storage.put = async entries => {
    if (isFinal(entries)) {
      assert.ok(Object.values(entries).some(x => x?.reservation_version === "review-reservation.v1" && x.state === "COMPLETED"));
      await put(entries);
      if (!interrupted) { interrupted = true; throw new Error("SYNTHETIC_RESPONSE_LOSS_AFTER_COMMIT"); }
    } else await put(entries);
  };
  assert.equal((await call(app, input)).status, 503); app.restart();
  const recovered = await call(app, input); assert.equal(recovered.status, 200);
  const record = await recovered.json();
  assert.equal(record.status, "PENDING_RISK"); assert.equal(record.execution.execution_allowed, false);
  assert.equal(app.calls(), 1);
});

test("completed reservations do not block normal workflow mutations or legacy records", async () => {
  const app = setup(); const created = await call(app, input); assert.equal(created.status, 200);
  const record = await created.json();
  const reservations = [...app.rows.values()].filter(x => x?.reservation_version === "review-reservation.v1");
  assert.ok(reservations.length); assert.ok(reservations.every(x => x.state === "COMPLETED"));
  const cancelled = await call(app, { task_id: record.task_id, proposal_sha256: record.proposed_action.proposal_sha256,
    canceler: "synthetic-user", reason: "Changed plan" }, "/api/review/cancel");
  assert.equal(cancelled.status, 200);
  for (const key of app.rows.keys()) if (key.startsWith("review-reservation:")) app.rows.delete(key);
  app.restart(); const replay = await call(app, input);
  assert.equal((await replay.json()).status, "CANCELLED"); assert.equal(app.calls(), 1);
});

test("funding context enrichment cannot break replay of the original request after restart", async () => {
  const app = setup();
  const planResponse = await call(app, { cash_minor: 5000000, currency: "CNY", synthetic: true,
    confirmed: true, protected_purposes: [{ purpose_id: "synthetic-rent", label: "Rent", amount_minor: 350000 }] }, "/api/funding-demo/plan");
  assert.equal(planResponse.status, 200); const plan = await planResponse.json();
  const funded = { ...input, action_parameters: { funding_plan_id: plan.plan_id, funding_plan_revision: plan.revision, amount: 10000, synthetic: true, currency: "CNY" } };
  const response = await call(app, funded); assert.equal(response.status, 200);
  const record = await response.json(); assert.ok(record.reviewed_input.context.demo_funding_snapshot);
  app.restart(); const replay = await call(app, funded);
  assert.equal(replay.status, 200); assert.equal((await replay.json()).run_id, record.run_id); assert.equal(app.calls(), 1);
  assert.equal((await call(app, { ...funded, action_parameters: { ...funded.action_parameters, amount: 20000 } })).status, 409);
});

test("unfinished reservations survive age and cannot be bypassed by task-only retries", async () => {
  const app = setup(); app.reject(isFinal);
  const body = { text: input.text, task_id: "explicit-synthetic-task" };
  assert.equal((await call(app, body)).status, 503);
  for (const value of app.rows.values()) if (value?.reservation_version) value.reserved_at = "2000-01-01T00:00:00Z";
  app.reject(() => false); app.restart();
  assert.equal((await call(app, body)).status, 503); assert.equal(app.calls(), 1);
});

test("an interrupted reservation write which actually committed still blocks a new model run", async () => {
  const app = setup(); const put = app.storage.put;
  app.storage.put = async entries => { await put(entries); throw new Error("SYNTHETIC_AMBIGUOUS_WRITE_ACK"); };
  assert.equal((await call(app, input)).status, 503); assert.equal(app.calls(), 0);
  app.storage.put = put; app.restart();
  assert.equal((await call(app, input)).status, 503); assert.equal(app.calls(), 0);
});
