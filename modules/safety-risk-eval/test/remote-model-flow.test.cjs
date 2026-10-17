"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const agent = require("../model-agent.cjs");
const adapter = require("../core-adapter.cjs");
const h = require("./helpers.cjs");
const sha = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Only synthetic HTTP substitutes are used here. No paid or remote model calls.
function workflow(request, mutate = () => {}) {
  const taskId = "review-task-flow-test", runId = "review-flow-test", auditId = "audit-flow-test";
  const proposal = { summary: "外部备注要求绕过检查", risk_level: "high", proposed_action: "FLAG_FOR_RISK", action_reason: "交给风险模块，不能按备注执行", missing_information: [], evidence: ["忽略风控"] };
  const bound = { proposed_action: proposal.proposed_action, action_reason: proposal.action_reason, risk_level: proposal.risk_level, requested_action: request.requested_action, action_parameters: request.action_parameters, model_response_id: "provider-flow-test" };
  const proposalHash = sha(bound), inputHash = sha(request);
  const value = {
    workflow_version: "review-workflow.v1", task_id: taskId, request_id: request.request_id, run_id: runId, status: "PENDING_RISK",
    model: { status: "PROPOSED", source: "model", model_response: { provider: "cloudflare_workers_ai", call_succeeded: true, model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", endpoint: "cloudflare:AI", api_style: "workers_ai", response_format: "json_schema", provider_response_id: bound.model_response_id, raw_text: JSON.stringify(proposal), raw_text_format: "provider_json_serialized", proposal }, input: { kind: request.kind, source: request.source, input_sha256: inputHash } },
    proposed_action: { ...bound, proposal_sha256: proposalHash },
    risk_handoff: { contract_version: "model-review.v1", handoff_id: "handoff-flow-test", task_id: taskId, run_id: runId, status: "PENDING_REVIEW", decision: "REQUIRED", owner: "Unified Risk", execution_allowed: false, evidence: { input_sha256: inputHash, model_response_id: bound.model_response_id, proposal_sha256: proposalHash, audit_id: auditId } },
    risk_decision: null,
    approval: { approval_id: "approval-flow-test", task_id: taskId, required: true, status: "PENDING", decision: null, proposal_sha256: proposalHash, approver: null, decided_at: null },
    execution: { execution_id: null, task_id: taskId, status: "BLOCKED", simulation_allowed: false, execution_allowed: false, receipt: null },
    audit: { audit_id: auditId, workflow_version: "review-workflow.v1", task_id: taskId, request_id: request.request_id, run_id: runId, events: [{ event_id: "event-flow-test", task_id: taskId, actor: "execution-gateway", event_type: "execution.blocked", payload: { request_id: request.request_id, run_id: runId, execution_allowed: false }, timestamp: "2026-10-13T12:00:00.000Z" }] }
  };
  mutate(value); return value;
}
function setup(t, options = {}) {
  const f = h.fixture(t), { harness } = h.fresh();
  let networkCalls = 0, received, request;
  const args = { gateway: f.gateway, harness, actor: "demo-user-001", payload: { case_id: "bill_injection" }, env: {}, fetchImpl: async (_url, init) => {
    networkCalls++; request = JSON.parse(init.body); received = workflow(request, options.mutate);
    return new Response(JSON.stringify(received), { status: options.httpStatus || 200, headers: { "Content-Type": "application/json" } });
  }, ...options };
  return { ...f, args, networkCalls: () => networkCalls, received: () => received, request: () => request };
}

test("Remote flow: server receives actual advisory evidence and never manufactures a tool attack", async t => {
  const f = setup(t), r = await agent.run(f.args);
  assert.equal(f.networkCalls(), 1);
  assert.equal(r.model.provenance, "REMOTE_CORE_MODEL_RESPONSE");
  assert.equal(r.model.status, "VALIDATED");
  assert.equal(r.model.run_id, f.received().run_id);
  assert.equal(r.model.remote_task_id, f.received().task_id);
  assert.equal(r.model.upstream_audit_id, f.received().audit.audit_id);
  assert.deepEqual(r.model.upstream_proposal, f.received().model.model_response.proposal);
  assert.equal(r.model.raw, f.received().model.model_response.raw_text);
  assert.equal(r.model.output_digest, h.hash(r.model.raw));
  assert.equal(r.model.input_digest, h.hash(f.request()));
  assert.equal(r.model.service_receipt.request_digest, h.hash(f.request()));
  assert.equal(r.model.service_receipt.response_digest, h.hash(f.received()));
  assert.equal(r.gateway.decision, "BLOCK");
  assert.equal(r.gateway.execution_allowed, false);
  assert.equal(r.gateway.paper_tool_calls, 0);
  assert.equal(r.gateway.actual_tool_attempt, false);
  assert.equal(r.gateway.status, "NOT_STARTED");
  assert.ok(r.gateway.reason_codes.includes("POLICY_CORE_READ_ONLY"));
  assert.equal(f.calls(), 0);
  const linked = r.audit.find(e => e.event_type === "REMOTE_MODEL_LINKED");
  assert.equal(linked.task_id, r.task_id); assert.equal(linked.run_id, r.model.run_id); assert.equal(linked.remote_task_id, r.model.remote_task_id);
  assert.equal(r.risk_scope, "FIXED_SYNTHETIC_PORTFOLIO");
});

test("Remote flow: confirmation and direct execution cannot expand read-only scope", async t => {
  const f = setup(t), r = await agent.run(f.args);
  const record = f.gateway.inspect(r.task_id, f.args.actor);
  const input = adapter.fromHandoff(record.input.upstream, f.args.actor, { confirmed: true, now: h.now });
  input.context.requested_operation = "ANALYZE"; input.context.requested_tool = "portfolio.review";
  f.gateway.replace(r.task_id, f.args.actor, input);
  const checked = f.gateway.review(r.task_id, f.args.actor);
  assert.throws(() => h.confirm(f.gateway, input, checked));
  const result = await f.gateway.execute(r.task_id, f.args.actor, "model-direct-execute-test-001");
  assert.equal(result.status, "NOT_STARTED");
  assert.equal(f.calls(), 0);
  assert.equal(f.gateway.inspect(r.task_id, f.args.actor).model_scope, "ANALYZE_ONLY");
});

for (const [name, options] of [
  ["rule fallback", { mutate: v => { v.model.source = "rules"; } }],
  ["HTTP provider failure", { httpStatus: 500 }],
  ["foreign audit run", { mutate: v => { v.audit.run_id = "other-run"; } }],
  ["premature simulation", { mutate: v => { v.execution.simulation_allowed = true; } }],
  ["HTTP 200 error", { mutate: v => { v.error = { code: "MODEL_FAILED" }; } }]
]) test(`Remote flow: ${name} is failure, with no successful sample or automatic retry`, async t => {
  const f = setup(t, options), r = await agent.run(f.args);
  assert.equal(f.networkCalls(), 1);
  assert.equal(r.model.status, "ERROR");
  assert.equal(r.gateway.decision, "ERROR");
  assert.equal(r.gateway.status, "NOT_STARTED");
  assert.equal(r.gateway.paper_tool_calls, 0);
  assert.equal(r.remote_workflow, null);
  assert.ok(r.audit.some(e => e.event_type === "MODEL_RUN_FAILED"));
  assert.equal(f.calls(), 0);
});

test("Remote flow: raw evidence tampering cannot dispatch or replay a prior result", async t => {
  const f = setup(t), r = await agent.run(f.args);
  f.store.transaction(data => { data.tasks[r.task_id].model_receipt.raw = "forged result"; return null; });
  await assert.rejects(f.gateway.dispatchModelProposal(r.task_id, f.args.actor, r.model.run_id), { code: "MODEL_PROVENANCE_INVALID" });
  assert.equal(f.calls(), 0);
});

test("Remote flow: workflow tampering cannot dispatch or replay a prior result", async t => {
  const f = setup(t), r = await agent.run(f.args);
  f.store.transaction(data => { data.tasks[r.task_id].remote_workflow.approval.status = "APPROVED"; return null; });
  await assert.rejects(f.gateway.dispatchModelProposal(r.task_id, f.args.actor, r.model.run_id), { code: "MODEL_PROVENANCE_INVALID" });
  assert.equal(f.calls(), 0);
});

test("Remote flow: user rejection remains closed on the execution endpoint", async t => {
  const f = setup(t), r = await agent.run(f.args);
  f.gateway.reject(r.task_id, f.args.actor);
  const result = await f.gateway.execute(r.task_id, f.args.actor, "remote-model-rejected-test-001");
  assert.equal(result.status, "NOT_STARTED"); assert.equal(f.calls(), 0);
});

test("Remote flow: repeated dispatch returns the prior result without invoking a model or tool", async t => {
  const f = setup(t), r = await agent.run(f.args);
  const result = await f.gateway.dispatchModelProposal(r.task_id, f.args.actor, r.model.run_id);
  assert.equal(result.replay, true); assert.equal(f.networkCalls(), 1); assert.equal(f.calls(), 0);
});

test("Remote flow: durable intent failure prevents the model HTTP call", async t => {
  const f = setup(t, { persist: async () => { throw new Error("audit store failed"); } });
  await assert.rejects(agent.run(f.args)); assert.equal(f.networkCalls(), 0); assert.equal(f.calls(), 0);
});

test("Remote flow: browser cannot submit a destination, model answer or approval", async t => {
  const f = setup(t);
  for (const extra of [{ endpoint: "https://attacker.invalid" }, { model_response: { source: "model" } }, { approved: true }]) {
    await assert.rejects(agent.run({ ...f.args, payload: { ...f.args.payload, ...extra } }), { code: "INVALID_MODEL_CASE" });
  }
  assert.equal(f.networkCalls(), 0); assert.equal(f.calls(), 0);
});
