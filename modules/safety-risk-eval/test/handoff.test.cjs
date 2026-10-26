"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers.cjs");
const receiver = require("../handoff/receiver.cjs");
const adapter = require("../core-adapter.cjs");
const sample = require("../handoff/example.response.json");
const packet = () => ({ import_version: receiver.VERSION, agent_response: structuredClone(sample) });
const actor = "import-demo-user";
test("Handoff: actual latest Core response imports with original evidence and isolated local IDs", (t) => {
  const f = h.fixture(t), payload = packet(), r = receiver.receive({ payload, actor, gateway: f.gateway });
  assert.equal(r.execution_allowed, false); assert.notEqual(r.task_id, sample.task_state.task_id);
  const record = f.gateway.inspect(r.task_id, actor);
  assert.deepEqual(record.handoff_import.original_response, sample);
  assert.equal(record.handoff_import.source_digest, h.hash(sample));
  assert.equal(record.input.binding.user_id, actor); assert.equal(record.input.approval.status, "UNCONFIRMED");
  assert.equal(r.policy.decision, "BLOCK"); assert.equal(r.policy.reasons[0].code, "POLICY_HANDOFF_UNVERIFIED");
  assert.ok(f.store.events.some((e) => e.event_type === "HANDOFF_IMPORTED" && e.source.audit_id === sample.audit_evidence.audit_id));
});
test("Handoff: repeat is idempotent and changed content with same source IDs conflicts", (t) => {
  const f = h.fixture(t), args = { payload: packet(), actor, gateway: f.gateway };
  const a = receiver.receive(args), b = receiver.receive(args);
  assert.equal(a.task_id, b.task_id); assert.equal(b.replay, true); assert.equal(Object.keys(f.store.data.tasks).length, 1);
  args.payload.agent_response.risk_handoff.reason = "different source content";
  assert.throws(() => receiver.receive(args), { code: "HANDOFF_IMPORT_CONFLICT" });
});
test("Handoff: another user receives a separate task and cannot access the first", (t) => {
  const f = h.fixture(t), a = receiver.receive({ payload: packet(), actor, gateway: f.gateway });
  const b = receiver.receive({ payload: packet(), actor: "second-user", gateway: f.gateway });
  assert.notEqual(a.task_id, b.task_id); assert.throws(() => f.gateway.inspect(a.task_id, "second-user"), { code: "PERMISSION_DENIED" });
});
for (const [name, mutate, code] of [
  ["missing full evidence", p => { p.agent_response.artifacts = {}; }, "HANDOFF_EVIDENCE_INVALID"],
  ["forged authority", p => { p.user_id = "admin"; }, "HANDOFF_ENVELOPE_INVALID"],
  ["trace mismatch", p => { p.agent_response.trace.task_id = "other-task"; }, "HANDOFF_TRACE_MISMATCH"],
  ["foreign audit event", p => { p.agent_response.audit_evidence.events[0].task_id = "other-task"; }, "HANDOFF_TRACE_MISMATCH"],
  ["broken evidence pointer", p => { p.agent_response.risk_handoff.evidence.simulation_id = "other-simulation"; }, "HANDOFF_EVIDENCE_INVALID"],
  ["forged ready approval", p => { p.agent_response.risk_handoff.execution_allowed = true; }, "HANDOFF_SCHEMA_INVALID"]
]) test(`Handoff: ${name} rejects without creating a task`, (t) => {
  const f = h.fixture(t), payload = packet(); mutate(payload);
  assert.throws(() => receiver.receive({ payload, actor, gateway: f.gateway }), { code });
  assert.equal(Object.keys(f.store.data.tasks).length, 0);
  assert.ok(f.store.events.some((e) => e.event_type === "HANDOFF_IMPORT_REJECTED"));
});
test("Handoff: profile confirmation and direct executor call cannot bypass provenance", async (t) => {
  const f = h.fixture(t), imported = receiver.receive({ payload: packet(), actor, gateway: f.gateway });
  const record = f.gateway.inspect(imported.task_id, actor);
  const input = adapter.fromHandoff(record.input.upstream, actor, { confirmed: true, now: h.now });
  f.gateway.replace(imported.task_id, actor, input);
  const review = f.gateway.review(imported.task_id, actor);
  assert.equal(review.decision, "ALLOW");
  assert.throws(() => h.confirm(f.gateway, input, review), { code: "POLICY_HANDOFF_UNVERIFIED" });
  const execution = await f.gateway.execute(imported.task_id, actor, "import-direct-attempt");
  assert.equal(execution.status, "NOT_STARTED"); assert.equal(f.calls(), 0);
  assert.ok(execution.policy.reasons.some((r) => r.code === "POLICY_HANDOFF_UNVERIFIED"));
});
