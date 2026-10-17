"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createApplication } = require("../server.cjs"), h = require("./helpers.cjs"), f = require("./daily-fixture.cjs");
async function start(t, options = {}) {
  const store = h.fixture(t).store, app = createApplication({ store, ...options });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => app.server.close(resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`, response = await fetch(base + "/api/safety/session"), auth = await response.json(), cookie = response.headers.get("set-cookie").split(";")[0];
  async function request(route, payload, extra = {}) { const r = await fetch(base + route, { method: payload === undefined ? "GET" : "POST", headers: { cookie, "content-type": "application/json", "x-risk-csrf": auth.csrf, ...extra }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }); return { status: r.status, data: await r.json() }; }
  return { app, base, request, cookie };
}
test("daily HTTP uses existing session, task, confirm, execution and audit endpoints", async t => {
  const { request } = await start(t), task = (await request("/api/safety/daily/tasks", f.payload())).data, id = task.input.binding.task_id;
  assert.equal(task.review.decision, "ALLOW"); assert.equal((await request("/api/paper-trade/execute", { task_id: id, idempotency_key: "http-preconfirm" })).status, 409);
  assert.equal((await request("/api/safety/confirm", f.confirm(task))).data.status, "CONFIRMED");
  const result = (await request("/api/paper-trade/execute", { task_id: id, idempotency_key: "http-confirmed" })).data;
  assert.equal(result.status, "SUCCEEDED"); assert.equal(result.side_effects, false);
  const repeat = (await request("/api/paper-trade/execute", { task_id: id, idempotency_key: "http-confirmed" })).data; assert.equal(repeat.execution_id, result.execution_id); assert.equal(repeat.replay, true);
  assert.equal((await request(`/api/safety/task?task_id=${id}`)).data.current_ledger.holds.length, 1);
  const events = (await request(`/api/safety/audit?task_id=${id}`)).data; assert.ok(events.some(e => e.event_type === "DAILY_EXECUTION_SUCCEEDED")); assert.ok(events.every(e => e.task_id === id));
});
test("daily HTTP blocked plan and forged authority cannot pass shared execution endpoint", async t => {
  const { request, base } = await start(t), task = (await request("/api/safety/daily/tasks", f.payload(800000))).data, id = task.input.binding.task_id;
  assert.equal(task.review.decision, "BLOCK"); assert.equal((await request("/api/safety/confirm", f.confirm(task))).status, 409);
  assert.equal((await request("/api/safety/daily/tasks", { ...f.payload(), user_id: "admin" })).status, 422);
  assert.equal((await request("/api/safety/daily/tasks", f.payload(), { "x-risk-csrf": "forged" })).status, 403);
  assert.equal((await request("/api/safety/daily/tasks", f.payload(), { origin: "https://evil.invalid" })).status, 403);
  assert.equal((await fetch(base + `/api/safety/task?task_id=${id}`)).status, 403);
});
test("daily HTTP revision invalidates old approval and shared ledger cannot be reset by stale form", async t => {
  const { request } = await start(t), task = (await request("/api/safety/daily/tasks", f.payload())).data, id = task.input.binding.task_id;
  await request("/api/safety/confirm", f.confirm(task));
  const revised = (await request("/api/safety/daily/revise", { ...f.payload(50000), task_id: id, ledger_id: task.ledger_id, expected_ledger_revision: task.ledger_revision })).data;
  assert.equal(revised.approval.status, "INVALIDATED"); assert.equal((await request("/api/safety/confirm", f.confirm(task))).status, 409);
  assert.equal((await request("/api/paper-trade/execute", { task_id: id, idempotency_key: "http-stale-plan" })).status, 409);
});
test("daily model attaches actual response evidence to same task without granting authority", async t => {
  let calls = 0;
  const { request, app } = await start(t, { coreFetch: async (_url, init) => { calls++; const input = JSON.parse(init.body); assert.equal(input.allow_rule_fallback, false); return Response.json(f.modelResponse(input)); } });
  const task = (await request("/api/safety/daily/tasks", f.payload())).data, id = task.input.binding.task_id;
  const result = await request("/api/safety/daily/model-review", { task_id: id }); assert.equal(result.status, 200); assert.equal(result.data.task_id, id); assert.equal(result.data.run_id, "run-daily-test"); assert.equal(result.data.execution_allowed, false); assert.equal(calls, 1);
  assert.equal(app.dailyGateway.inspect(id, task.input.binding.user_id).approval.status, "UNCONFIRMED");
  const events = (await request(`/api/safety/audit?task_id=${id}`)).data; assert.ok(events.some(e => e.event_type === "DAILY_MODEL_REVIEW_RECEIVED" && e.run_id === "run-daily-test"));
  assert.equal((await request("/api/safety/daily/model-review", { task_id: id, approval: true })).status, 400);
});
test("daily model failure has no fixture fallback or successful model record", async t => {
  const { request } = await start(t, { coreFetch: async () => Response.json({ error: "unavailable" }, { status: 503 }) });
  const task = (await request("/api/safety/daily/tasks", f.payload())).data, id = task.input.binding.task_id;
  const result = await request("/api/safety/daily/model-review", { task_id: id }); assert.equal(result.status, 503); assert.equal(result.data.execution_allowed, false);
  const record = (await request(`/api/safety/task?task_id=${id}`)).data; assert.equal(record.model_review, undefined); assert.equal(record.approval.status, "UNCONFIRMED");
  const events = (await request(`/api/safety/audit?task_id=${id}`)).data; assert.ok(events.some(e => e.event_type === "DAILY_MODEL_REVIEW_FAILED")); assert.ok(!events.some(e => e.event_type === "DAILY_MODEL_REVIEW_RECEIVED"));
});
