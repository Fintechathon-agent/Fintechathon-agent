"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { once } = require("node:events");
const { prepareCoreSnapshot, REPO_ROOT, sha256 } = require("./core-snapshot.cjs");
const { createCoreHttpContext, MODEL_LABEL } = require("./harness.cjs");
const { createConversationServer } = require("../interface-adapters/conversation-server.cjs");
const { ConversationStore } = require("../interface-adapters/conversation-store.cjs");

async function main() {
  if (!process.env.PYTHON_EXECUTABLE) throw new Error("Set PYTHON_EXECUTABLE to the Finance Lab Python runtime.");
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === "--out")) throw new Error("Usage: verify-current-http.cjs [--out report.json]");
  const snapshot = prepareCoreSnapshot({ currentSource: true });
  let core, risk, child;
  const checks = [], steps = [];
  try {
    core = await createCoreHttpContext(snapshot, "python-risk-core-http");
    const riskKey = randomBytes(32).toString("hex");
    risk = createConversationServer({
      store: new ConversationStore(path.join(snapshot.directory, "risk-http-journal")),
      env: { RISK_CONVERSATION_API_KEY: riskKey, CORE_AGENT_BASE_URL: core.origin,
        CORE_AGENT_API_KEY: core.credentials.machine, RISK_SERVICE_HMAC_SECRET: core.credentials.risk,
        RISK_REVIEWER_ID: core.reviewer, RISK_ALLOW_LOCAL_HTTP: "true" },
    });
    await new Promise(resolve => risk.server.listen(0, "127.0.0.1", resolve));
    const script = "from http.server import ThreadingHTTPServer\nfrom web.app import Handler\ns=ThreadingHTTPServer(('127.0.0.1',0),Handler)\nprint(s.server_port,flush=True)\ns.serve_forever()";
    child = spawn(process.env.PYTHON_EXECUTABLE, ["-u", "-c", script], {
      env: { ...process.env, PYTHONPATH: path.join(REPO_ROOT, "qiqi"), DEEPSEEK_API_KEY: "", OPENAI_API_KEY: "", DASHSCOPE_API_KEY: "",
        CORE_AGENT_BASE_URL: core.origin, CORE_AGENT_API_KEY: core.credentials.machine, CORE_AGENT_PROXY: "",
        RISK_CONVERSATION_BASE_URL: `http://127.0.0.1:${risk.server.address().port}`, RISK_CONVERSATION_API_KEY: riskKey },
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    const port = await new Promise((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(() => reject(new Error("Python HTTP startup timed out.")), 15000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Python HTTP process exited.")); });
      child.stdout.on("data", chunk => { buffer += chunk; const match = /^(\d+)\r?\n/.exec(buffer); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
    });
    async function request(route, body) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error", signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      steps.push({ path: route, status: response.status, task_id: data.task_id || null, error_code: data.error_code || data.error?.code || null });
      return { status: response.status, data };
    }
    const status = await request("/api/core-agent/status");
    assert.equal(status.data.capabilities_http_status, 200);
    assert.equal(status.data.capabilities.model.name, MODEL_LABEL);
    assert.equal(core.modelCalls(), 0);
    checks.push("authenticated_capabilities_without_inference");
    const input = { question: "虚构资料：现金12000元，学费6000、房租1500、生活费2500均已确认保护，投资8000是否冲突？",
      idempotency_key: "current-http-protected-purposes", daily_finance_yuan: {
        cash_yuan: "12000", amount_yuan: "8000", fees_yuan: "0", holds_yuan: "0", floor_yuan: "0",
        purpose_yuan: "10000", due_yuan: "10000", due_date: "2099-11-01", purpose_label: "学费6000、房租1500、生活费2500",
        facts_confirmed: true, purpose_confirmed: true } };
    assert.equal((await request("/api/review", { ...input, user_id: "forged-user" })).status, 422);
    assert.equal(core.modelCalls(), 0);
    checks.push("forged_identity_rejected_before_model");
    const blocked = await request("/api/review", input);
    assert.equal(blocked.status, 200, JSON.stringify(blocked.data));
    const result = blocked.data;
    assert.equal(result.risk_advice.decision, "BLOCK");
    assert.equal(result.risk_advice.metrics.free_before_minor, 200000);
    assert.equal(result.risk_advice.metrics.shortfall_yuan, "6000.00");
    assert.equal(result.risk_callback.status, "RECORDED");
    assert.equal(result.risk_decision.auth.verified, true);
    assert.equal(result.risk_decision.task_id, result.task_id);
    assert.equal(result.execution_allowed, false);
    checks.push("python_risk_core_signed_block_same_task");
    const replay = await request("/api/review", input);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.task_id, result.task_id);
    assert.equal(core.modelCalls(), 1);
    checks.push("risk_replay_does_not_recall_model");
    assert.equal((await request("/api/review", { ...input, question: "已修改问题但复用原请求编号" })).status, 409);
    assert.equal(core.modelCalls(), 1);
    checks.push("changed_payload_same_id_rejected");
    const reviewInput = { question: "解释这一份虚构持仓的风险", idempotency_key: "current-http-readonly-review" };
    const direct = await request("/api/core-agent/review", reviewInput);
    const duplicate = await request("/api/core-agent/review", reviewInput);
    assert.equal(direct.status, 200); assert.equal(duplicate.status, 200);
    assert.equal(direct.data.task_id, duplicate.data.task_id);
    assert.equal(direct.data.execution_allowed, false);
    assert.equal(core.modelCalls(), 2);
    checks.push("finance_core_request_id_preserved");
    const record = await core.ok(`/api/review/task/${result.task_id}`);
    assert.equal(record.execution.receipt, null);
    const report = { schema_version: "competition-current-http.v1", generated_at: new Date().toISOString(),
      mode: "LOCAL_THREE_SERVICE_HTTP", source_manifest: snapshot.manifest,
      finance_source_sha256: Object.fromEntries(["app.py", "core_agent.py", "risk_conversation.py"].map(file =>
        [`qiqi/web/${file}`, sha256(fs.readFileSync(path.join(REPO_ROOT, "qiqi/web", file)))])),
      path: ["Finance Python HTTP", "Risk Node HTTP", "Core Worker Handler HTTP", "Risk HMAC callback"],
      model: MODEL_LABEL, core_storage: "IN_MEMORY_TEST_ADAPTER", real_model_calls: 0, synthetic_model_calls: core.modelCalls(),
      passed: checks.length, failed: 0, checks, steps, task: { task_id: result.task_id, run_id: result.run_id, audit_id: result.audit_id,
        risk_decision: result.risk_advice.decision, metrics: result.risk_advice.metrics, execution_receipt: record.execution.receipt },
      callback: result.risk_callback, audit_events: record.audit.events, production_connected: false, joint_acceptance: false };
    core.assertNoSecrets(report);
    assert.ok(!JSON.stringify(report).includes(riskKey));
    if (args[1]) fs.writeFileSync(path.resolve(args[1]), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ mode: report.mode, passed: report.passed, failed: 0, real_model_calls: 0, synthetic_model_calls: core.modelCalls(), task_id: result.task_id }));
  } finally {
    if (child && child.exitCode === null) { const stopped = once(child, "exit"); child.kill(); await stopped; }
    if (risk) { risk.server.closeAllConnections(); await new Promise(resolve => risk.server.close(resolve)); risk.store.close(); }
    if (core) await core.close();
    snapshot.dispose();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
