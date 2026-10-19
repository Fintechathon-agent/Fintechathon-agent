import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import worker, { ReviewService } from "../deployment/worker.js";
import workflow from "../integrations/review-workflow.js";
import review from "../integrations/model-review.js";
import reservation from "../integrations/review-reservation.js";

const original = { text: "合成房租与投资", idempotency_key: "canonical-request", data_mode: "SYNTHETIC_REPLAY",
  context: { note: "保留房租", purposes: { rent: true, tuition: false }, priority: ["rent", "tuition"] } };
const reordered = input => ({ ...input,
  context: { priority: ["rent", "tuition"], purposes: { tuition: false, rent: true }, note: "保留房租" },
  ...(input.action_parameters ? { action_parameters: Object.fromEntries(Object.entries(input.action_parameters).reverse()) } : {}) });
function oldDigest(input) {
  const body = structuredClone(input);
  for (const field of ["request_id", "task_id", "idempotency_key", "session_id"]) delete body[field];
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}
function fixture() {
  const rows = new Map(); let calls = 0;
  const storage = { get: async key => structuredClone(rows.get(key)), put: async entries => {
    for (const [key, value] of Object.entries(entries)) rows.set(key, structuredClone(value));
  } };
  const env = { MODEL_PROVIDER: "workers_ai", MODEL_MAX_ATTEMPTS: "1", MODEL_DISABLE_RULE_FALLBACK: "true", RATE_LIMIT_PER_MINUTE: "0",
    AI: { run: async () => { calls++; return { id: "synthetic-provider", response: {
      summary: "Synthetic fingerprint", proposed_action: "HOLD_FOR_REVIEW", risk_level: "unknown", action_reason: "Wait for Risk", evidence: [], missing_information: [] } }; } } };
  let service = new ReviewService({ storage }, env);
  env.REVIEW_SERVICE = { idFromName: x => x, get: () => service };
  return { rows, storage, env, calls: () => calls, restart: () => { service = new ReviewService({ storage }, env); } };
}
async function call(app, body, endpoint = "/api/review") {
  const response = await worker.fetch(new Request("https://synthetic.test" + endpoint,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), app.env);
  return { status: response.status, body: await response.json() };
}
async function funded(app) {
  const result = await call(app, { synthetic: true, confirmed: true, currency: "CNY", cash_minor: 1000000,
    protected_purposes: [{ purpose_id: "rent", label: "Synthetic rent", amount_minor: 400000 }] }, "/api/funding-demo/plan");
  assert.equal(result.status, 200);
  return { ...original, action_parameters: { amount: 1000, currency: "CNY", synthetic: true,
    funding_plan_id: result.body.plan_id, funding_plan_revision: result.body.revision } };
}

test("request identity ignores nested object key order while preserving values and array order", async () => {
  const input = review.normalizeReviewInput(original), digest = await workflow.fingerprint(input);
  assert.equal(await workflow.fingerprint(review.normalizeReviewInput(reordered(original))), digest);
  for (const context of [{ ...original.context, priority: ["tuition", "rent"] },
    { ...original.context, purposes: { rent: "true", tuition: false } }, { ...original.context, note: null }]) {
    assert.notEqual(await workflow.fingerprint(review.normalizeReviewInput({ ...original, context })), digest);
  }
  const special = JSON.parse('{"__proto__":{"x":1},"a":2}');
  assert.notEqual(await workflow.fingerprint({ context: special }), await workflow.fingerprint({ context: { a: 2 } }));
});

test("funded API retry accepts reordered fields across service reload without duplicate inference", async () => {
  const app = fixture(), input = await funded(app), first = await call(app, input);
  assert.equal(first.status, 200);
  app.restart(); const replay = await call(app, reordered(input));
  assert.equal(replay.status, 200); assert.equal(replay.body.run_id, first.body.run_id); assert.equal(app.calls(), 1);
  for (const changed of [{ ...reordered(input), action_parameters: { ...input.action_parameters, amount: 1001 } },
    { ...reordered(input), context: { ...input.context, priority: ["tuition", "rent"] } }]) {
    const conflict = await call(app, changed); assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, "IDEMPOTENCY_CONFLICT");
  }
  assert.equal(app.calls(), 1); assert.equal(replay.body.execution.receipt, null);
});

test("legacy completed funding reservations remain replayable using their original byte-order digest", async () => {
  const app = fixture(), input = await funded(app), created = await call(app, input);
  assert.equal(created.status, 200);
  const record = app.rows.get("run:" + created.body.run_id);
  record.request_fingerprint = oldDigest(record.reviewed_input);
  for (const value of app.rows.values()) if (value?.reservation_version) value.request_fingerprint = oldDigest(review.normalizeReviewInput(input));
  app.restart();
  const replay = await call(app, input); assert.equal(replay.status, 200); assert.equal(replay.body.run_id, record.run_id);
  const changed = await call(app, { ...input, action_parameters: { ...input.action_parameters, amount: 2000 } });
  assert.equal(changed.status, 409); assert.equal(app.calls(), 1);
});

test("legacy unfinished reservations stay blocked and cannot trigger a fresh model invocation", async () => {
  const app = fixture(), input = review.normalizeReviewInput(original), reservations = new reservation.ReviewReservations(app.storage);
  const saved = await reservations.reserve(input);
  for (const value of app.rows.values()) if (value?.reservation_version) value.request_fingerprint = oldDigest(input);
  app.restart();
  const replay = await call(app, original);
  assert.equal(replay.status, 503); assert.equal(replay.body.error.code, "REVIEW_SERVICE_UNAVAILABLE");
  assert.equal(replay.body.trace.task_id, saved.task_id); assert.equal(replay.body.error.retryable, false);
  const changed = await call(app, { ...original, text: "用途改变" });
  assert.equal(changed.status, 409); assert.equal(changed.body.error.code, "IDEMPOTENCY_CONFLICT"); assert.equal(app.calls(), 0);
});
