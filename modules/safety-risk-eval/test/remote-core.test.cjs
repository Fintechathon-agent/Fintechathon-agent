"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers.cjs");
const remote = require("../handoff/remote.cjs");
const receiver = require("../handoff/receiver.cjs");
const adapter = require("../core-adapter.cjs");
const example = require("../handoff/example.response.json");
test("Remote Core: health and handoff reject redirects without following them", async t => {
  let calls = 0;
  const redirect = async (url, init) => { calls++; assert.equal(init.redirect, "manual"); return new Response(null, { status: 302, headers: { Location: "https://attacker.invalid" } }); };
  await assert.rejects(remote.health(redirect), { code: "CORE_REDIRECT_REJECTED" });
  const f = setup(t, { fetchImpl: redirect });
  await assert.rejects(remote.run(f.args), { code: "CORE_REDIRECT_REJECTED" });
  assert.equal(calls, 2); assert.equal(Object.keys(f.store.data.tasks).length, 0);
  assert.ok(f.store.events.some(e => e.event_type === "REMOTE_CORE_FAILED" && e.code === "CORE_REDIRECT_REJECTED"));
});
function response(requestId, mutate = () => {}) {
  const u = structuredClone(example);
  u.request_id = requestId; u.trace.request_id = requestId; u.task_state.request_id = requestId; u.audit_evidence.request_id = requestId;
  const packet = { integration_version: "core-agent-to-risk-workbench.cloudflare@0.1.0", agent_response: u, risk_workbench: { integration_mode: "READ_ONLY_HANDOFF_PREVIEW", decision: { execution_allowed: false }, controls: { no_execution: true }, source: { task_id: u.task_state.task_id, request_id: requestId, audit_id: u.audit_evidence.audit_id } } };
  mutate(packet); return new Response(JSON.stringify(packet), { headers: { "Content-Type": "application/json" } });
}
function setup(t, options = {}) {
  const f = h.fixture(t); let calls = 0, sent;
  const args = { gateway: f.gateway, actor: "remote-user-001", payload: { request_key: "test-request-0001" }, fetchImpl: async (url, init) => { calls++; sent = { url, init }; return response(JSON.parse(init.body).request.request_id, options.mutate); }, ...options };
  return { ...f, args, remoteCalls: () => calls, sent: () => sent };
}
test("Remote Core: pinned HTTPS response is validated and retains source evidence", async t => {
  const f = setup(t), r = await remote.run(f.args), record = f.gateway.inspect(r.task_id, f.args.actor);
  assert.equal(r.provenance, "PINNED_HTTPS_CORE_RESPONSE"); assert.equal(r.execution_allowed, false);
  assert.equal(record.handoff_import.service_receipt.response_digest, h.hash(record.handoff_import.original_response));
  assert.notEqual(r.task_id, r.source.task_id); assert.equal(f.sent().url, remote.ENDPOINT); assert.equal(f.sent().init.redirect, "manual");
  assert.ok(r.policy.reasons.some(x => x.code === "POLICY_CORE_READ_ONLY")); assert.ok(!r.policy.reasons.some(x => x.code === "POLICY_HANDOFF_UNVERIFIED"));
  assert.ok(f.store.events.some(e => e.event_type === "REMOTE_CORE_RECEIVED" && e.task_id === r.task_id));
});
test("Remote Core: replay returns prior task without a second network call", async t => {
  const f = setup(t), a = await remote.run(f.args), b = await remote.run(f.args);
  assert.equal(a.task_id, b.task_id); assert.equal(b.replay, true); assert.equal(f.remoteCalls(), 1);
});
test("Remote Core: profile confirmation and direct execution cannot expand read-only scope", async t => {
  const f = setup(t), r = await remote.run(f.args), record = f.gateway.inspect(r.task_id, f.args.actor);
  const i = adapter.fromHandoff(record.input.upstream, f.args.actor, { confirmed: true, now: h.now });
  f.gateway.replace(r.task_id, f.args.actor, i); const risk = f.gateway.review(r.task_id, f.args.actor);
  assert.equal(risk.decision, "ALLOW"); assert.throws(() => h.confirm(f.gateway, i, risk), { code: "POLICY_CORE_READ_ONLY" });
  const result = await f.gateway.execute(r.task_id, f.args.actor, "remote-execute-0001"); assert.equal(result.status, "NOT_STARTED"); assert.equal(f.calls(), 0);
});
for (const [name, mutate, code] of [
  ["wrong request", p => { p.agent_response.request_id = "not-this-request"; }, "CORE_CORRELATION_MISMATCH"],
  ["elevated execution", p => { p.risk_workbench.decision.execution_allowed = true; }, "CORE_BRIDGE_INVALID"],
  ["wrong trace", p => { p.agent_response.trace.task_id = "other-task"; }, "HANDOFF_TRACE_MISMATCH"],
  ["bad evidence", p => { p.agent_response.risk_handoff.evidence.simulation_id = "unknown"; }, "HANDOFF_EVIDENCE_INVALID"]
]) test(`Remote Core: ${name} is rejected and audited`, async t => {
  const f = setup(t, { mutate }); await assert.rejects(remote.run(f.args), { code }); assert.equal(Object.keys(f.store.data.tasks).length, 0);
  assert.ok(f.store.events.some(e => e.event_type === "REMOTE_CORE_FAILED" && e.code === code)); assert.equal(f.calls(), 0);
});
test("Remote Core: browser cannot choose target URL or submit trusted receipt", async t => {
  const f = setup(t); await assert.rejects(remote.run({ ...f.args, payload: { ...f.args.payload, endpoint: "https://attacker.invalid" } }), { code: "CORE_REQUEST_INVALID" });
  assert.equal(f.remoteCalls(), 0);
  assert.throws(() => receiver.receive({ payload: { import_version: receiver.VERSION, agent_response: example, serviceReceipt: { verification: "SERVER_FETCH_PINNED_HTTPS" } }, actor: f.args.actor, gateway: f.gateway }), { code: "HANDOFF_ENVELOPE_INVALID" });
});
test("Remote Core: failed service has no sample fallback or automatic retry", async t => {
  let calls = 0; const f = setup(t, { fetchImpl: async () => { calls++; throw new Error("network timeout"); } });
  await assert.rejects(remote.run(f.args), { code: "CORE_UNAVAILABLE" }); await assert.rejects(remote.run(f.args), { code: "CORE_REQUEST_ALREADY_ATTEMPTED" });
  assert.equal(calls, 1); assert.equal(Object.keys(f.store.data.tasks).length, 0);
});
test("Remote Core: audit failure before HTTP prevents the remote call", async t => {
  const f = setup(t, { persist: async () => { throw new Error("storage unavailable"); } }); await assert.rejects(remote.run(f.args)); assert.equal(f.remoteCalls(), 0);
});
test("Remote Core: owner isolation is retained", async t => {
  const f = setup(t), r = await remote.run(f.args); assert.throws(() => f.gateway.inspect(r.task_id, "different-user"), { code: "PERMISSION_DENIED" });
});
test("Remote Core: health validates the expected service and contract", async () => {
  const ok = await remote.health(async () => new Response(JSON.stringify({ status: "ok", service: "core-agent", contract_version: "investment-agent.v1" }), { headers: { "Content-Type": "application/json" } })); assert.equal(ok.status, "CONNECTED");
  await assert.rejects(remote.health(async () => new Response("{}", { headers: { "Content-Type": "application/json" } })), { code: "CORE_HEALTH_INVALID" });
});
