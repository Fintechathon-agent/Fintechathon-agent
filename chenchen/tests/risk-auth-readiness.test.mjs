import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import worker, { ReviewService } from "../deployment/worker.js";
import bridge from "../integrations/owner-bridge.js";

const machineKey = "synthetic-machine-key-not-a-real-secret";
const riskSecret = "synthetic-risk-hmac-not-a-real-secret";
const reviewer = "synthetic-risk-service";

function setup(overrides = {}) {
  const rows = new Map();
  const storage = {
    get: async key => structuredClone(rows.get(key)),
    put: async entries => { for (const [key, value] of Object.entries(entries)) rows.set(key, structuredClone(value)); }
  };
  let calls = 0;
  const env = {
    MODEL_PROVIDER: "workers_ai", MODEL_MAX_ATTEMPTS: "1", RATE_LIMIT_PER_MINUTE: "0",
    REQUIRE_TRUSTED_ACTORS: "true", REQUIRE_RISK_REVIEWER: "true", CORE_AGENT_API_KEY: machineKey,
    RISK_SERVICE_HMAC_SECRET: riskSecret, RISK_REVIEWER_ID: reviewer,
    AI: { run: async () => { calls++; return { id: "synthetic-auth-" + calls, response: {
      summary: "Synthetic test proposal", risk_level: "high", proposed_action: "HOLD_FOR_REVIEW",
      action_reason: "Protect rent", missing_information: [], evidence: ["synthetic fixture"]
    } }; } }, ...overrides
  };
  let service = new ReviewService({ storage }, env);
  env.REVIEW_SERVICE = { idFromName: name => name, get: () => service };
  const call = async (path, body, headers = {}) => {
    const response = await worker.fetch(new Request("https://synthetic.invalid" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-Core-Agent-Key": machineKey, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), env);
    return { status: response.status, body: await response.json() };
  };
  return { env, rows, call, calls: () => calls, restart: () => { service = new ReviewService({ storage }, env); } };
}

const input = { text: "Synthetic investment and protected rent", data_mode: "SYNTHETIC_REPLAY", capability: "REVIEW_ONLY" };
const callbackFor = (r, decision = "APPROVE") => ({
  callback_version: "risk-callback.v1", handoff_id: r.risk_handoff.handoff_id,
  task_id: r.task_id, request_id: r.request_id, run_id: r.run_id,
  audit_id: r.audit.audit_id, proposal_sha256: r.proposed_action.proposal_sha256,
  decision, reviewer, reason: "Synthetic Risk check"
});
const signed = async body => ({ "X-Risk-Signature": await bridge.signatureFor(body, riskSecret) });

test("strict mode refuses a missing machine identity before any inference", async () => {
  const app = setup({ CORE_AGENT_API_KEY: "" });
  const result = await app.call("/api/review", input);
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, "CORE_AUTH_NOT_CONFIGURED");
  assert.equal(app.calls(), 0);
  assert.equal(app.rows.size, 0);
});

test("a correctly signed callback cannot impersonate another Risk reviewer", async () => {
  const app = setup();
  const r = (await app.call("/api/review", input)).body;
  const callback = { ...callbackFor(r), reviewer: "another-reviewer" };
  const result = await app.call("/api/review/risk-callback", callback, await signed(callback));
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, "OWNER_ACTOR_MISMATCH");
  const current = (await app.call("/api/review/task/" + r.task_id)).body;
  assert.equal(current.risk_decision, null);
  assert.equal(current.status, "PENDING_RISK");
});

test("strict Risk verification refuses a missing configured reviewer", async () => {
  const app = setup({ RISK_REVIEWER_ID: "" });
  const r = (await app.call("/api/review", input)).body;
  const callback = callbackFor(r);
  const result = await app.call("/api/review/risk-callback", callback, await signed(callback));
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, "OWNER_IDENTITY_NOT_CONFIGURED");
  assert.equal((await app.call("/api/review/task/" + r.task_id)).body.risk_decision, null);
});

test("capabilities distinguish configured callback security from joint acceptance", async () => {
  const app = setup();
  const result = await app.call("/api/review/capabilities");
  assert.equal(result.status, 200);
  assert.equal(result.body.risk.callback_ready, true);
  assert.equal(result.body.risk.reviewer_configured, true);
  assert.equal(result.body.authentication.api_key_configured, true);
  assert.equal(result.body.authentication.strict_actors_required, true);
  assert.equal(result.body.authentication.fixed_risk_reviewer_required, true);
  assert.equal(result.body.acceptance.joint_acceptance, false);
  assert.equal(app.calls(), 0);
  for (const value of [machineKey, riskSecret, reviewer]) assert.equal(JSON.stringify(result.body).includes(value), false);
});

for (const [decision, status] of [["APPROVE", "PENDING_APPROVAL"], ["REJECT", "REJECTED"], ["REQUEST_MORE_INFO", "PENDING_RISK"]]) {
  test("signed " + decision + " callback survives restart without duplicate decisions or execution", async () => {
    const app = setup();
    const r = (await app.call("/api/review", input)).body;
    const callback = callbackFor(r, decision);
    const result = await app.call("/api/review/risk-callback", callback, await signed(callback));
    assert.equal(result.status, 200);
    assert.equal(result.body.callback_status, "RECORDED");
    assert.equal(result.body.workflow.status, status);
    assert.equal(result.body.workflow.risk_callback.auth.verified, true);
    assert.equal(result.body.workflow.risk_callback.auth.actor, reviewer);
    app.restart();
    const replay = await app.call("/api/review/risk-callback", callback, await signed(callback));
    assert.equal(replay.body.callback_status, "DUPLICATE");
    assert.deepEqual(replay.body.workflow, result.body.workflow);
    assert.equal(replay.body.workflow.execution.execution_allowed, false);
    assert.equal(app.calls(), 1);
    const blocked = await app.call("/api/review/simulate", { task_id: r.task_id, proposal_sha256: callback.proposal_sha256 });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.workflow.execution.receipt, null);
  });
}

test("missing machine key, missing signature and tampered signatures cannot change the task", async () => {
  const app = setup();
  const r = (await app.call("/api/review", input)).body, callback = callbackFor(r);
  const original = structuredClone(app.rows.get("run:" + r.run_id));
  const cases = [
    { "X-Core-Agent-Key": "", ...await signed(callback) },
    {},
    { "X-Risk-Signature": "sha256=" + "0".repeat(64) }
  ];
  for (const headers of cases) {
    const result = await app.call("/api/review/risk-callback", callback, headers);
    assert.equal(result.status, 401);
    assert.deepEqual(app.rows.get("run:" + r.run_id), original);
  }
});

test("a trusted callback with a crossed task binding is rejected and audited", async () => {
  const app = setup();
  const a = (await app.call("/api/review", input)).body;
  const b = (await app.call("/api/review", input)).body;
  const callback = { ...callbackFor(a), task_id: b.task_id };
  const result = await app.call("/api/review/risk-callback", callback, await signed(callback));
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, "RISK_HANDOFF_MISMATCH");
  const current = (await app.call("/api/review/task/" + b.task_id)).body;
  assert.equal(current.risk_decision, null);
  assert.ok(current.audit.events.some(e => e.event_type === "risk.callback.blocked"));
});

test("Risk callback credentials cannot substitute for approval credentials", async () => {
  const app = setup();
  const r = (await app.call("/api/review", input)).body, callback = callbackFor(r);
  await app.call("/api/review/risk-callback", callback, await signed(callback));
  const approval = { task_id: r.task_id, proposal_sha256: callback.proposal_sha256, decision: "APPROVE", approver: reviewer, reason: "Invalid cross-role attempt" };
  const result = await app.call("/api/review/approval", approval, await signed(approval));
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, "OWNER_AUTH_NOT_CONFIGURED");
  assert.equal((await app.call("/api/review/task/" + r.task_id)).body.approval.status, "PENDING");
});

test("signed decision endpoint follows the same fixed-reviewer rule", async () => {
  const body = { reviewer: "another-reviewer" };
  await assert.rejects(bridge.verifyOwnerRequest({ owner: "risk", body, headers: await signed(body),
    env: { RISK_SERVICE_HMAC_SECRET: riskSecret, RISK_REVIEWER_ID: reviewer } }), e => e.code === "OWNER_ACTOR_MISMATCH");
});

test("configuration preflight is offline, redacted and fails when configuration is absent", () => {
  const script = new URL("../scripts/check-risk-callback-config.js", import.meta.url);
  const env = { ...process.env, CORE_AGENT_API_KEY: "", RISK_SERVICE_HMAC_SECRET: "", RISK_HMAC_SECRET: "", RISK_REVIEWER_ID: "", REQUIRE_TRUSTED_ACTORS: "", REQUIRE_RISK_REVIEWER: "" };
  const missing = spawnSync(process.execPath, [fileURLToPath(script)], { env, encoding: "utf8" });
  assert.equal(missing.status, 2);
  const result = JSON.parse(missing.stdout);
  assert.equal(result.callback_ready, false);
  assert.ok(result.blockers.includes("CORE_AGENT_API_KEY_MISSING"));
  const configured = spawnSync(process.execPath, [fileURLToPath(script)], { env: {
    ...env, CORE_AGENT_API_KEY: machineKey, RISK_SERVICE_HMAC_SECRET: riskSecret, RISK_REVIEWER_ID: reviewer, REQUIRE_TRUSTED_ACTORS: "true", REQUIRE_RISK_REVIEWER: "true"
  }, encoding: "utf8" });
  assert.equal(configured.status, 0);
  assert.equal(JSON.parse(configured.stdout).callback_ready, true);
  for (const value of [machineKey, riskSecret, reviewer]) assert.equal(configured.stdout.includes(value), false);
});

test("legacy signed-only mode stays compatible but never advertises release readiness", async () => {
  const app = setup({ RISK_REVIEWER_ID: "", REQUIRE_RISK_REVIEWER: "" });
  const r = (await app.call("/api/review", input)).body, callback = callbackFor(r);
  assert.equal((await app.call("/api/review/risk-callback", callback, await signed(callback))).status, 200);
  const capabilities = (await app.call("/api/review/capabilities")).body;
  assert.equal(capabilities.risk.callback_ready, false);
  assert.ok(capabilities.risk.callback_blockers.includes("FIXED_RISK_REVIEWER_ENFORCEMENT_DISABLED"));
});

test("requiring a fixed Risk reviewer cannot fall back to unsigned demo authentication", async () => {
  await assert.rejects(bridge.verifyOwnerRequest({ owner: "risk", body: { reviewer }, headers: {},
    env: { REQUIRE_RISK_REVIEWER: "true", RISK_REVIEWER_ID: reviewer } }), e => e.code === "OWNER_AUTH_NOT_CONFIGURED");
});

test("requiring a fixed Risk reviewer also fails closed without a machine identity", async () => {
  const app = setup({ REQUIRE_TRUSTED_ACTORS: "false", CORE_AGENT_API_KEY: "" });
  assert.equal((await app.call("/api/review", input)).body.error.code, "CORE_AUTH_NOT_CONFIGURED");
  assert.equal(app.calls(), 0);
});

test("legacy signature alias still works with a configured fixed reviewer", async () => {
  const callback = { reviewer };
  const auth = await bridge.verifyOwnerRequest({ owner: "risk", body: callback, headers: await signed(callback),
    env: { RISK_HMAC_SECRET: riskSecret, REQUIRE_RISK_REVIEWER: "true", RISK_REVIEWER_ID: reviewer } });
  assert.equal(auth.verified, true);
});
