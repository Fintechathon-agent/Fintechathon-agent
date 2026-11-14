"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createApplication } = require("../server.cjs");
const h = require("./helpers.cjs");
async function start(t) {
  const f = h.fixture(t); const app = createApplication({ store: f.store, modelEnv: { RISK_MODEL_SOURCE: "DIRECT" } });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => app.server.close(resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const session = await fetch(base + "/api/safety/session"), auth = await session.json();
  const cookie = session.headers.get("set-cookie").split(";")[0];
  const post = async (route, payload, overrides = {}) => {
    const response = await fetch(base + route, { method: "POST", headers: { cookie, "x-risk-csrf": auth.csrf, "content-type": "application/json", ...overrides }, body: JSON.stringify(payload) });
    return { status: response.status, data: await response.json() };
  };
  return { app, base, post, cookie };
}
test("HTTP: model configuration and forged response cannot grant authority", async t => {
  const f = await start(t);
  const status = await fetch(f.base + "/api/safety/model-status", { headers: { cookie: f.cookie } }).then(r => r.json());
  assert.ok(!JSON.stringify(status).includes("API_KEY"));
  const denied = await f.post("/api/safety/model-demo", { case_id: "bill_injection", agent_response: { approved: true } });
  assert.equal(denied.status, 400); assert.equal(denied.data.error.code, "INVALID_MODEL_CASE");
  assert.equal((await f.post("/api/safety/model-demo", { case_id: "normal" }, { "x-risk-csrf": "wrong" })).status, 403);
});
const profile = { confirmed: true, reserve_cash: 5000, max_drawdown: .1, forbidden: [], plan_id: "A", memory_consent: false };
test("HTTP: original health handoff -> explicit profile -> approval -> protected paper endpoint", async (t) => {
  const f = await start(t);
  const health = await f.post("/api/health-check/run", require("../../../chenchen/contracts/examples/health-check.request.json"));
  assert.equal(health.status, 200); assert.equal(health.data.contract_version, "investment-agent.v1");
  const task_id = health.data.task_state.task_id;
  const denied = await f.post("/api/paper-trade/execute", { task_id, idempotency_key: "unapproved-001" }); assert.equal(denied.data.status, "NOT_STARTED");
  const review = await f.post("/api/safety/profile", { task_id, profile }); assert.equal(review.data.decision, "ALLOW");
  const approved = await f.post("/api/safety/confirm", { task_id, risk_check_id: review.data.risk_check_id, binding: review.data.binding, accepted_reason_ids: [], confirmed: true });
  assert.equal(approved.data.status, "CONFIRMED");
  const result = await f.post("/api/paper-trade/execute", { task_id, idempotency_key: "approved-001" }); assert.equal(result.data.status, "SUCCEEDED");
  assert.equal(result.data.result.mode, "SYNTHETIC_PAPER_ONLY");
  const audit = await fetch(f.base + `/api/audit/${task_id}`, { headers: { cookie: f.cookie } }).then(r => r.json());
  assert.equal(audit.core.task_id, task_id);
  assert.equal(audit.core_provenance, "LOCAL_CORE");
  assert.ok(audit.safety.some(e => e.event_type === "RISK_CHECK_COMPLETED"));
  assert.ok(audit.safety.some(e => e.event_type === "PLAN_CONFIRMED"));
  assert.ok(audit.safety.some(e => e.event_type === "EXECUTION_SUCCEEDED"));
});
test("HTTP: intent route and UI assets are live, disconnected operations remain unavailable", async t => {
  const f = await start(t);
  const catalog = await fetch(f.base + "/api/safety/intents/catalog", { headers: { cookie: f.cookie } }).then(r => r.json());
  assert.equal(catalog.coverage.passed, catalog.coverage.total);
  const page = await fetch(f.base + "/risk").then(r => r.text());
  assert.match(page, /\/risk\/intents\.js/);
  assert.equal((await fetch(f.base + "/risk/intents.js")).status, 200);
  const classified = await f.post("/api/safety/intents/classify", { text: "检查我的持仓，也想转账" });
  assert.equal(classified.status, 200);
  assert.equal(classified.data.execution_allowed, false);
  assert.ok(classified.data.groups.some(g => g.code === "TRANSFER" && g.capability === "NOT_CONNECTED"));
  assert.ok(classified.data.next_actions.every(a => a.code !== "TRANSFER"));
  const invalid = await f.post("/api/safety/intents/classify", { text: "转账", approved: true });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.data.error.code, "INVALID_FIELDS");
});
test("HTTP: client-supplied approval and cross-origin requests never authorize execution", async (t) => {
  const f = await start(t), created = await f.post("/api/safety/tasks", profile), task_id = created.data.upstream.task_state.task_id;
  const result = await f.post("/api/paper-trade/execute", { task_id, idempotency_key: "forged-token-001", approval: { status: "APPROVED", token: "fake" } });
  assert.equal(result.status, 400); assert.equal(result.data.error.code, "UNTRUSTED_CONTROL_FIELD");
  assert.equal((await f.post("/api/safety/reject", { task_id }, { origin: "http://attacker.invalid" })).status, 403);
  assert.equal((await f.post("/api/safety/reject", { task_id }, { "x-risk-csrf": "fake" })).status, 403);
  assert.equal(Object.keys(f.app.store.data.executions).length, 0);
});
test("HTTP: session isolation and unchanged team static page", async (t) => {
  const f = await start(t), created = await f.post("/api/safety/tasks", profile), task_id = created.data.upstream.task_state.task_id;
  assert.equal((await fetch(f.base + `/api/safety/task?task_id=${task_id}`)).status, 403);
  const main = await fetch(f.base + "/investment"); assert.equal(main.status, 200); assert.match(await main.text(), /html/);
});
test("HTTP: handoff receiver validates CSRF, isolates ownership and persists evidence", async (t) => {
  const f = await start(t), payload = { import_version: "risk-handoff.import.v1", agent_response: require("../handoff/example.response.json") };
  assert.equal((await f.post("/api/safety/handoffs", payload, { "x-risk-csrf": "wrong" })).status, 403);
  assert.equal((await f.post("/api/safety/handoffs", payload, { origin: "https://external.invalid" })).status, 403);
  const imported = await f.post("/api/safety/handoffs", payload);
  assert.equal(imported.status, 200); assert.equal(imported.data.execution_allowed, false);
  const id = imported.data.task_id;
  assert.equal((await fetch(f.base + `/api/safety/task?task_id=${id}`)).status, 403);
  const task = await fetch(f.base + `/api/safety/task?task_id=${id}`, { headers: { cookie: f.cookie } }).then(r => r.json());
  assert.equal(task.handoff_import.source_digest, h.hash(payload.agent_response));
  assert.equal((await f.post("/api/safety/handoffs", payload)).data.replay, true);
  assert.equal((await f.post("/api/paper-trade/execute", { task_id: id, idempotency_key: "import-http-execute" })).data.status, "NOT_STARTED");
});
