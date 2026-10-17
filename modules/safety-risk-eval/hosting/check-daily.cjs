"use strict";
const assert = require("node:assert/strict");
const fixture = require("../test/daily-fixture.cjs");
const base = process.argv[2] || "http://127.0.0.1:8781";
(async () => {
  const sessionResponse = await fetch(base + "/api/safety/session"), session = await sessionResponse.json(), cookie = sessionResponse.headers.get("set-cookie").split(";")[0];
  async function call(route, payload) { const r = await fetch(base + route, { method: payload === undefined ? "GET" : "POST", headers: { cookie, "x-risk-csrf": session.csrf, "content-type": "application/json" }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }); return { status: r.status, body: await r.json() }; }
  const blocked = (await call("/api/safety/daily/tasks", fixture.payload(800000))).body; assert.equal(blocked.review.decision, "BLOCK");
  assert.equal((await call("/api/safety/confirm", fixture.confirm(blocked))).status, 409);
  const task = (await call("/api/safety/daily/tasks", fixture.payload())).body, task_id = task.input.binding.task_id;
  assert.equal(task.review.decision, "ALLOW"); assert.equal((await call("/api/paper-trade/execute", { task_id, idempotency_key: "daily-check-before" })).status, 409);
  assert.equal((await call("/api/safety/confirm", fixture.confirm(task))).body.status, "CONFIRMED");
  const execution = (await call("/api/paper-trade/execute", { task_id, idempotency_key: "daily-check-once" })).body; assert.equal(execution.status, "SUCCEEDED"); assert.equal(execution.side_effects, false);
  const repeat = (await call("/api/paper-trade/execute", { task_id, idempotency_key: "daily-check-once" })).body; assert.equal(repeat.replay, true); assert.equal(repeat.execution_id, execution.execution_id);
  const record = (await call(`/api/safety/task?task_id=${task_id}`)).body; assert.equal(record.current_ledger.holds.length, 1);
  const events = (await call(`/api/safety/audit?task_id=${task_id}`)).body; assert.ok(events.some(e => e.event_type === "DAILY_EXECUTION_SUCCEEDED"));
  const policy = (await call("/api/safety/daily/policy")).body; assert.equal(policy.rules.length, 8);
  console.log(JSON.stringify({ checks: 11, status: "PASS", base, task_id, rules: policy.policy_version, mode: record.mode, real_transactions: false }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
