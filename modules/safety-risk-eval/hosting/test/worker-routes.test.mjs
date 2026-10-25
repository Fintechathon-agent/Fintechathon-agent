import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SQLiteD1 } from "./sqlite-d1.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const hosting = path.resolve(directory, "..");
const repository = path.resolve(hosting, "../../..");
const require = createRequire(import.meta.url);
const healthRequest = require("../../../../chenchen/contracts/examples/health-check.request.json");

test("built worker routes intent, health, independent risk, approval, paper execution and audit", async t => {
  execFileSync(process.execPath, [path.join(hosting, "build.mjs"), "--check-only"], { cwd: hosting, stdio: "pipe" });
  const bundle = path.join(repository, "output/risk-build-check/dist/server/index.js");
  const worker = (await import(pathToFileURL(bundle).href)).default;
  const db = new SQLiteD1();
  t.after(() => db.close());
  const origin = "https://risk.example.test";
  const send = (route, options = {}) => worker.fetch(new Request(origin + route, options), { DB: db });
  const sessionResponse = await send("/api/safety/session");
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  const cookie = sessionResponse.headers.get("set-cookie").split(";")[0];
  const headers = { cookie, "x-risk-csrf": session.csrf, "content-type": "application/json" };
  const post = async (route, data) => {
    const response = await send(route, { method: "POST", headers, body: JSON.stringify(data) });
    return { status: response.status, data: await response.json() };
  };

  const page = await send("/risk");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /\/risk\/intents\.js/);
  assert.equal((await send("/risk/intents.js")).status, 200);
  const classified = await post("/api/safety/intents/classify", { text: "检查我的持仓，也想转账" });
  assert.equal(classified.status, 200);
  assert.equal(classified.data.execution_allowed, false);
  assert.ok(classified.data.groups.some(group => group.code === "TRANSFER" && group.capability === "NOT_CONNECTED"));
  assert.equal((await post("/api/safety/intents/classify", { text: "转账", approved: true })).status, 422);

  const health = await post("/api/health-check/run", healthRequest);
  assert.equal(health.status, 200);
  const taskId = health.data.task_state.task_id;
  const early = await post("/api/paper-trade/execute", { task_id: taskId, idempotency_key: "worker-before-approval" });
  assert.equal(early.data.status, "NOT_STARTED");
  const profile = { confirmed: true, reserve_cash: 5000, max_drawdown: 0.1, forbidden: [], plan_id: "A", memory_consent: false };
  const review = await post("/api/safety/profile", { task_id: taskId, profile });
  assert.equal(review.status, 200);
  assert.equal(review.data.decision, "ALLOW");
  const approval = await post("/api/safety/confirm", { task_id: taskId, risk_check_id: review.data.risk_check_id, binding: review.data.binding, accepted_reason_ids: [], confirmed: true });
  assert.equal(approval.data.status, "CONFIRMED");
  const execution = await post("/api/paper-trade/execute", { task_id: taskId, idempotency_key: "worker-approved-paper" });
  assert.equal(execution.data.status, "SUCCEEDED");
  assert.equal(execution.data.result.mode, "SYNTHETIC_PAPER_ONLY");
  const replay = await post("/api/paper-trade/execute", { task_id: taskId, idempotency_key: "worker-approved-paper" });
  assert.equal(replay.data.replay, true);
  const auditResponse = await send(`/api/audit/${taskId}`, { headers: { cookie } });
  assert.equal(auditResponse.status, 200);
  const audit = await auditResponse.json();
  assert.equal(audit.core.task_id, taskId);
  assert.equal(audit.core_provenance, "LOCAL_CORE");
  assert.ok(audit.safety.some(event => event.event_type === "RISK_CHECK_COMPLETED"));
  assert.ok(audit.safety.some(event => event.event_type === "PLAN_CONFIRMED"));
  assert.ok(audit.safety.some(event => event.event_type === "EXECUTION_SUCCEEDED"));
});
