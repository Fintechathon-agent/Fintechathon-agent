"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { JournalStore } = require("../store.cjs");
const { ActionGateway } = require("../gateway.cjs");
const h = require("./helpers.cjs");
const adapter = require("../core-adapter.cjs");
const execute = (g, i, key = "execution-key-001") => g.execute(i.binding.task_id, i.binding.user_id, key);

test("R08: no user confirmation never invokes the executor", async (t) => {
  const f = h.fixture(t), i = h.input(); f.gateway.register(i); const r = await execute(f.gateway, i);
  assert.equal(r.status, "NOT_STARTED"); assert.equal(f.calls(), 0); assert.ok(r.risk.reasons.some((r) => r.code === "APPROVAL_REQUIRED"));
});
test("R08: accepted REVIEW still remains REVIEW while gateway executes once", async (t) => {
  const f = h.fixture(t), i = h.input("review"), review = f.gateway.register(i); h.confirm(f.gateway, i, review);
  const r = await execute(f.gateway, i); assert.equal(r.status, "SUCCEEDED"); assert.equal(r.risk.decision, "REVIEW"); assert.equal(f.calls(), 1);
});
test("R03/R08: explicit confirmation cannot override hard block", async (t) => {
  const f = h.fixture(t), i = h.input("block"), r = f.gateway.register(i);
  assert.throws(() => h.confirm(f.gateway, i, r), /不可接受/); assert.equal((await execute(f.gateway, i)).status, "NOT_STARTED"); assert.equal(f.calls(), 0);
});
test("R08: rejection and revocation stop execution", async (t) => {
  const f = h.fixture(t), i = h.input(), r = f.gateway.register(i); h.confirm(f.gateway, i, r);
  f.gateway.reject(i.binding.task_id, i.binding.user_id, true);
  assert.equal((await execute(f.gateway, i)).status, "NOT_STARTED"); assert.equal(f.calls(), 0);
});
test("R08: related version change invalidates old approval", async (t) => {
  const f = h.fixture(t), i = h.input(), r = f.gateway.register(i); h.confirm(f.gateway, i, r);
  const next = structuredClone(i); next.profile.reserve_cash = 6000; next.binding.constraints_version = "constraints-v2"; next.binding.profile_version = "profile-v2";
  f.gateway.replace(i.binding.task_id, i.binding.user_id, next);
  assert.throws(() => h.confirm(f.gateway, i, r), /版本/); assert.equal((await execute(f.gateway, next)).status, "NOT_STARTED"); assert.equal(f.calls(), 0);
});
test("R08: expired approval requires reconfirmation", async (t) => {
  const f = h.fixture(t, { approvalTtlMs: 0 }), i = h.input(), r = f.gateway.register(i); h.confirm(f.gateway, i, r);
  assert.equal((await execute(f.gateway, i)).status, "NOT_STARTED"); assert.equal(f.calls(), 0);
});
test("R09: same key and different keys cannot execute one plan twice", async (t) => {
  const f = h.fixture(t), i = h.input(), r = f.gateway.register(i); h.confirm(f.gateway, i, r);
  const a = await execute(f.gateway, i), b = await execute(f.gateway, i), c = await execute(f.gateway, i, "another-key-002");
  assert.equal(a.status, "SUCCEEDED"); assert.equal(b.replay, true); assert.equal(c.replay, true); assert.equal(f.calls(), 1);
});
test("R09: concurrent requests cause exactly one execution", async (t) => {
  const f = h.fixture(t), i = h.input(), r = f.gateway.register(i); h.confirm(f.gateway, i, r);
  await Promise.all([execute(f.gateway, i), execute(f.gateway, i)]); assert.equal(f.calls(), 1);
});
test("R09: unknown executor result never auto retries", async (t) => {
  let calls = 0; const f = h.fixture(t, { executePlan: async () => { calls++; throw new Error("timeout"); } }), i = h.input(), r = f.gateway.register(i); h.confirm(f.gateway, i, r);
  assert.equal((await execute(f.gateway, i)).status, "UNKNOWN"); assert.equal((await execute(f.gateway, i)).status, "UNKNOWN"); assert.equal(calls, 1);
  assert.throws(() => f.gateway.reconcile(i.binding.task_id, i.binding.user_id, "execution-key-001", {}), /可信执行回执/);
});
test("R09: restart retains durable success and prevents another execution", async (t) => {
  const f = h.fixture(t), i = h.input(), r = f.gateway.register(i); h.confirm(f.gateway, i, r); await execute(f.gateway, i); f.store.close();
  const store = new JournalStore(f.dir); t.after(() => store.close());
  let calls = 0; const gateway = new ActionGateway({ store, projectPlan: adapter.projectPlan, executePlan: async () => { calls++; }, now: () => h.now });
  assert.equal((await execute(gateway, i)).status, "SUCCEEDED"); assert.equal(calls, 0);
  store.close();
});
test("R10: failed pre-execution audit stops tool calls", async (t) => {
  const f = h.fixture(t), i = h.input(), r = f.gateway.register(i); h.confirm(f.gateway, i, r);
  f.store.append = () => { throw new Error("disk full"); };
  const outcome = await execute(f.gateway, i); assert.equal(outcome.decision, "ERROR"); assert.equal(f.calls(), 0);
});
test("R01: another user cannot inspect, approve or execute the task", async (t) => {
  const f = h.fixture(t), i = h.input(); f.gateway.register(i);
  assert.throws(() => f.gateway.inspect(i.binding.task_id, "other-user"), /无权/);
  await assert.rejects(() => f.gateway.execute(i.binding.task_id, "other-user", "valid-key-001"), /无权/);
});
test("Golden Path: real Harness -> Risk -> Approval -> existing Paper tool -> consented Memory", async (t) => {
  const { harness, input: i } = h.fresh();
  const f = h.fixture(t, { onSuccess: (record, result) => harness.saveMemory(record.input.binding.task_id, { type: "decision", consent: true, value: { receipt_id: result.receipt.receipt_id, mode: result.mode } }) });
  const r = f.gateway.register(i, { memoryConsent: true }); h.confirm(f.gateway, i, r); const outcome = await execute(f.gateway, i);
  assert.equal(outcome.status, "SUCCEEDED"); assert.equal(harness.listMemory(i.binding.session_id).length, 1);
  assert.ok(f.store.events.some((e) => e.event_type === "RISK_CHECK_COMPLETED")); assert.ok(f.store.events.some((e) => e.event_type === "EXECUTION_SUCCEEDED"));
});
