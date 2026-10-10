"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const p = require("../policy.cjs");
const h = require("./helpers.cjs");
const request = () => ({ subject: "user-1", owner: "user-1", source: "USER", stage: "EXECUTE", tool: "paper_trade", operation: "PAPER_TRADE", scenario: "SIMULATION", request_hash: "snapshot", approval_matches: true, risk_eligible: true });
const execute = (f, i) => f.gateway.execute(i.binding.task_id, i.binding.user_id, "policy-execute-001");

test("Policy: unknown tools, cross-scenario calls, other owners and external authority default deny", () => {
  assert.equal(p.decide(request()).decision, "ALLOW");
  for (const patch of [{ tool: "shell" }, { tool: "toString" }, { scenario: "MEMORY" }, { subject: "other" }, { source: "EXTERNAL_CONTENT" }, { operation: "REAL_TRADE" }, { approval_matches: false }, { risk_eligible: false }]) {
    const result = p.decide({ ...request(), ...patch }); assert.equal(result.allow, false); assert.equal(result.decision, "BLOCK");
  }
});
test("Policy: missing input or unavailable policy never becomes ALLOW", () => {
  for (const result of [p.decide(null), p.decide(request(), null), p.decide({ ...request(), source: undefined })]) assert.equal(result.decision, "ERROR");
});
test("Policy: research reads and memory writes have distinct capabilities", () => {
  assert.equal(p.decide({ ...request(), tool: "portfolio.review", operation: "ANALYZE", scenario: "PORTFOLIO", approval_matches: false }).allow, true);
  const memory = { ...request(), tool: "memory.write", operation: "MEMORY_WRITE", scenario: "MEMORY" };
  assert.equal(p.decide(memory).allow, false); assert.equal(p.decide({ ...memory, memory_consent: true }).allow, true);
});
test("Gateway: policy update after review requires recheck before confirmation", (t) => {
  let policy = structuredClone(p.currentPolicy());
  const f = h.fixture(t, { getPolicy: () => policy }), i = h.input(), r = f.gateway.register(i);
  policy.version = "financial-policy-test-update";
  assert.throws(() => h.confirm(f.gateway, i, r), /策略或业务内容/);
  h.confirm(f.gateway, i, f.gateway.review(i.binding.task_id, i.binding.user_id));
});
test("Gateway: policy update after confirmation prevents execution with zero tool calls", async (t) => {
  let policy = structuredClone(p.currentPolicy());
  const f = h.fixture(t, { getPolicy: () => policy }), i = h.input(), r = f.gateway.register(i); h.confirm(f.gateway, i, r);
  policy.version = "financial-policy-test-update";
  const result = await execute(f, i); assert.equal(result.status, "NOT_STARTED"); assert.equal(f.calls(), 0);
  assert.ok(result.policy.reasons.some((reason) => reason.code === "POLICY_APPROVAL_STALE"));
});
test("Gateway: missing policy fails closed even for a financially valid approved plan", async (t) => {
  const f = h.fixture(t), i = h.input(), r = f.gateway.register(i); h.confirm(f.gateway, i, r);
  f.gateway.getPolicy = () => { throw new Error("unavailable"); };
  const result = await execute(f, i); assert.equal(result.policy.decision, "ERROR"); assert.equal(f.calls(), 0);
  f.gateway.getPolicy = () => undefined;
  const empty = await execute(f, i); assert.equal(empty.policy.decision, "ERROR"); assert.equal(f.calls(), 0);
});
test("Gateway: changed business content without version bump invalidates policy approval", async (t) => {
  const f = h.fixture(t), i = h.input(), r = f.gateway.register(i); h.confirm(f.gateway, i, r);
  f.store.data.tasks[i.binding.task_id].input.profile.reserve_cash = 4000;
  const result = await execute(f, i); assert.equal(result.status, "NOT_STARTED"); assert.equal(f.calls(), 0);
  assert.ok(result.policy.reasons.some((reason) => reason.code === "POLICY_APPROVAL_STALE"));
});
test("Gateway: policy changes during persistence fence cannot race through dispatch", async (t) => {
  let policy = structuredClone(p.currentPolicy());
  const f = h.fixture(t, { getPolicy: () => policy, beforeExecute: async () => { policy.version = "changed-during-fence"; } }), i = h.input(), r = f.gateway.register(i); h.confirm(f.gateway, i, r);
  assert.equal((await execute(f, i)).status, "NOT_STARTED"); assert.equal(f.calls(), 0);
});
test("Gateway: legacy unbound confirmation cannot execute", async (t) => {
  const f = h.fixture(t), i = h.input(), r = f.gateway.register(i); h.confirm(f.gateway, i, r);
  delete f.store.data.tasks[i.binding.task_id].approval_policy;
  assert.equal((await execute(f, i)).status, "NOT_STARTED"); assert.equal(f.calls(), 0);
});
test("Gateway: policy audit has traceable digest and successful execution receipt", async (t) => {
  const f = h.fixture(t), i = h.input(), r = f.gateway.register(i); h.confirm(f.gateway, i, r);
  const result = await execute(f, i); assert.equal(result.status, "SUCCEEDED"); assert.equal(f.calls(), 1);
  const event = f.store.events.find((e) => e.event_type === "EXECUTION_STARTED");
  assert.equal(event.policy.policy_digest, p.fingerprint(p.currentPolicy())); assert.equal(event.policy.request_hash, p.snapshot(i));
  assert.ok(event.correlation_id); assert.equal(event.task_id, i.binding.task_id);
});
