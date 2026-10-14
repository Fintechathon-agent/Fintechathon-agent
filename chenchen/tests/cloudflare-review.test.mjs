import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createHash } from "node:crypto";
import worker, { ReviewService } from "../deployment/worker.js";
import { reviewDocs } from "../deployment/review-docs.js";

const proposal = {
  summary: "虚构账单要求改付个人账户。", risk_level: "high",
  proposed_action: "FLAG_FOR_RISK", action_reason: "需核验账户变更依据。",
  missing_information: ["变更授权"], evidence: ["收款人变为个人"]
};
function setup() {
  const records = new Map();
  const storage = {
    async get(key) { return structuredClone(records.get(key)); },
    async put(entries) { for (const [key, value] of Object.entries(entries)) records.set(key, structuredClone(value)); }
  };
  const env = {
    MODEL_PROVIDER: "workers_ai", MODEL_DISABLE_RULE_FALLBACK: "true", CORS_ORIGINS: "*",
    AI: { run: async () => ({ response: proposal, usage: { prompt_tokens: 60, completion_tokens: 90 } }) }
  };
  const create = () => new ReviewService({ storage }, env);
  let service = create();
  env.REVIEW_SERVICE = { idFromName: name => name, get: () => service };
  return { env, restart() { service = create(); } };
}
function req(path, body) {
  return new Request("https://test.example" + path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
}

test("public review survives cold starts and keeps workflow mutations in the audit", async () => {
  const app = setup();
  const created = await worker.fetch(req("/api/review", { kind: "bill", text: "虚构账单改付个人" }), app.env);
  assert.equal(created.status, 200);
  const record = await created.json();
  assert.equal(record.model.model_response.call_succeeded, true);
  app.restart();
  const reloaded = await worker.fetch(req("/api/review/" + record.run_id), app.env);
  assert.deepEqual(await reloaded.json(), record);
  const blocked = await worker.fetch(req("/api/review/simulate", {
    task_id: record.task_id, proposal_sha256: record.proposed_action.proposal_sha256
  }), app.env);
  assert.equal(blocked.status, 409);
  app.restart();
  const audited = await worker.fetch(req("/api/review/task/" + record.task_id), app.env).then(r => r.json());
  assert.equal(audited.execution.execution_allowed, false);
  assert.ok(audited.audit.events.length > record.audit.events.length);
});

test("durable workflow refuses Risk mutation after simulation", async () => {
  const app = setup();
  const created = await worker.fetch(req("/api/review", { kind: "bill", text: "虚构账单" }), app.env).then(r => r.json());
  const base = { task_id: created.task_id, proposal_sha256: created.proposed_action.proposal_sha256 };
  await worker.fetch(req("/api/review/risk-decision", { ...base, decision: "APPROVE", reviewer: "risk", reason: "通过" }), app.env);
  await worker.fetch(req("/api/review/approval", { ...base, decision: "APPROVE", approver: "approver", reason: "通过" }), app.env);
  const simulated = await worker.fetch(req("/api/review/simulate", base), app.env).then(r => r.json());
  assert.equal(simulated.status, "SIMULATED");
  const repeated = await worker.fetch(req("/api/review/risk-decision", { ...base, decision: "APPROVE", reviewer: "risk", reason: "重复" }), app.env);
  assert.equal(repeated.status, 409);
  assert.equal((await repeated.json()).error.code, "WORKFLOW_TERMINAL");
  const queried = await worker.fetch(req("/api/review/task/" + created.task_id), app.env).then(r => r.json());
  assert.equal(queried.status, "SIMULATED");
  assert.equal(queried.execution.status, "SIMULATED");
});

test("failed real inference returns an error and a persistent blocked record", async () => {
  const app = setup();
  app.env.AI.run = async () => { throw new Error("unavailable"); };
  const response = await worker.fetch(req("/api/review", { text: "虚构新闻", allow_rule_fallback: true }), app.env);
  assert.equal(response.status, 502);
  const failed = await response.json();
  assert.equal(failed.workflow.status, "MODEL_FAILED");
  app.restart();
  const record = await worker.fetch(req("/api/review/" + failed.trace.run_id), app.env).then(r => r.json());
  assert.equal(record.status, "MODEL_FAILED");
  const approval = await worker.fetch(req("/api/review/risk-decision", {
    task_id: record.task_id, decision: "APPROVE", reviewer: "demo"
  }), app.env);
  assert.equal(approval.status, 409);
  assert.equal((await approval.json()).error.code, "RISK_BLOCKED");
});

test("public endpoint validates input, caps requests, and accepts frontend preflight", async () => {
  const { env } = setup();
  for (const input of [null, [], {}, { kind: "invalid", text: "x" }]) {
    assert.equal((await worker.fetch(req("/api/review", input), env)).status, 422);
  }
  assert.equal((await worker.fetch(req("/api/review", { text: "x".repeat(100001) }), env)).status, 413);
  const malformed = new Request("https://test.example/api/review", { method: "POST", body: "{" });
  assert.equal((await worker.fetch(malformed, env)).status, 400);
  const options = new Request("https://test.example/api/review", { method: "OPTIONS", headers: { Origin: "https://team.example" } });
  const preflight = await worker.fetch(options, env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "https://team.example");
  env.MODEL_REQUESTS_PER_MINUTE = "1";
  assert.equal((await worker.fetch(req("/api/review", { text: "虚构账单" }), env)).status, 200);
  assert.equal((await worker.fetch(req("/api/review", { text: "虚构账单" }), env)).status, 429);
});

test("explicit task ids cannot create a second workflow record", async () => {
  const { env } = setup();
  const body = { task_id: "review-task-fixed-001", kind: "bill", text: "虚构账单" };
  assert.equal((await worker.fetch(req("/api/review", body), env)).status, 200);
  const duplicate = await worker.fetch(req("/api/review", body), env);
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error.code, "TASK_ALREADY_EXISTS");
});

test("legacy question endpoint returns an adapter response without bypassing Risk", async () => {
  const { env } = setup();
  const response = await worker.fetch(req("/api/review/legacy", {
    question: "我想追加投资，但下个月要交房租，是否冲突？",
    run_id: "legacy-cloudflare-001"
  }), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.contract_version, "legacy-review.v0");
  assert.equal(payload.source_contract, "review-workflow.v1");
  assert.equal(payload.execution_state, "awaiting_risk");
  assert.equal(payload.gate.execution_allowed, false);
  assert.equal(payload.auto_executed, false);
  const query = await worker.fetch(req("/api/review/" + payload.run_id), env);
  assert.equal((await query.json()).task_id, payload.task_id);
});

test("test page is reachable even when opening the POST URL in a browser", async () => {
  const { env } = setup();
  const response = await worker.fetch(req("/api/review"), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /text\/html/);
  assert.match(await response.text(), /调用真实模型/);
  new vm.Script(reviewDocs.match(/<script>([\s\S]*?)<\/script>/)[1]);
});

test("handoff callback is persistent, idempotent, audit-bound and guarded against concurrent conflicts", async () => {
  const app = setup();
  const record = await worker.fetch(req("/api/review", { text: "Synthetic investment and rent conflict" }), app.env).then(r => r.json());
  const handoff = await worker.fetch(req("/api/review/" + record.run_id + "/risk-handoff"), app.env).then(r => r.json());
  assert.equal(handoff.audit_id, record.audit.audit_id);
  assert.equal(handoff.handoff_version, "risk-handoff.v1");
  assert.equal(createHash("sha256").update(JSON.stringify(handoff.reviewed_input)).digest("hex"), handoff.evidence.input_sha256);
  assert.equal(handoff.input_authority, "UNVERIFIED_CALLER_INPUT");
  const callback = {
    callback_version: "risk-callback.v1", handoff_id: handoff.handoff_id,
    task_id: handoff.task_id, request_id: handoff.request_id, run_id: handoff.run_id,
    audit_id: handoff.audit_id, proposal_sha256: handoff.proposal.proposal_sha256,
    decision: "REJECT", reviewer: "synthetic-risk-owner", reason: "Test rejection"
  };
  const mismatch = await worker.fetch(req("/api/review/risk-callback", { ...callback, run_id: "wrong" }), app.env);
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).error.code, "RISK_HANDOFF_MISMATCH");
  app.restart();
  const audited = await worker.fetch(req("/api/review/task/" + record.task_id), app.env).then(r => r.json());
  assert.ok(audited.audit.events.some(e => e.event_type === "risk.callback.blocked"));
  assert.equal(audited.risk_decision, null);
  const responses = await Promise.all([
    worker.fetch(req("/api/review/risk-callback", callback), app.env),
    worker.fetch(req("/api/review/risk-callback", callback), app.env),
    worker.fetch(req("/api/review/risk-callback", { ...callback, decision: "APPROVE" }), app.env)
  ]);
  assert.deepEqual(responses.map(r => r.status), [200, 200, 409]);
  const recorded = await responses[0].json(), duplicate = await responses[1].json();
  assert.equal(recorded.callback_status, "RECORDED");
  assert.equal(duplicate.callback_status, "DUPLICATE");
  assert.deepEqual(recorded.workflow, duplicate.workflow);
  assert.equal((await responses[2].json()).error.code, "RISK_CALLBACK_CONFLICT");
  app.restart();
  const repeated = await worker.fetch(req("/api/review/risk-callback", callback), app.env).then(r => r.json());
  assert.equal(repeated.callback_status, "DUPLICATE");
  const final = await worker.fetch(req("/api/review/task/" + record.task_id + "/risk-handoff"), app.env).then(r => r.json());
  assert.equal(final.workflow_status, "REJECTED");
  assert.equal(final.execution_allowed, false);
  const blocked = await worker.fetch(req("/api/review/simulate", { task_id: record.task_id, proposal_sha256: callback.proposal_sha256 }), app.env);
  assert.equal(blocked.status, 409);
});

test("handoff reads and callbacks use the same configured API authentication", async () => {
  const app = setup();
  app.env.CORE_AGENT_API_KEY = "test-only-key";
  for (const request of [req("/api/review/task/example/risk-handoff"), req("/api/review/risk-callback", {})]) {
    assert.equal((await worker.fetch(request, app.env)).status, 401);
    request.headers.set("X-Core-Agent-Key", "test-only-key");
    assert.notEqual((await worker.fetch(request, app.env)).status, 401);
  }
});
