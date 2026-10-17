import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// This command creates one synthetic review task on the configured backend.
// It does not approve, simulate successfully, write Memory or make real trades.
const base = process.env.CORE_AGENT_BASE_URL || "https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev";
const report = { checked_at: new Date().toISOString(), endpoint: base, data_mode: "SYNTHETIC_REPLAY", checks: [], exchanges: [], result: "RUNNING" };
const requestId = "iteration-20261017-" + randomUUID();
async function request(path, body) {
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(process.env.CORE_AGENT_API_KEY ? { "X-Core-Agent-Key": process.env.CORE_AGENT_API_KEY } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000)
  });
  const result = { path, status: response.status, body: await response.json() };
  report.exchanges.push({ path, status: response.status, workflow_status: result.body.status || null,
    run_id: result.body.run_id || result.body.trace?.run_id || null,
    error: result.body.error || null });
  return result;
}
function check(label, condition) {
  report.checks.push({ label, passed: Boolean(condition) });
  assert.ok(condition, label);
}
try {
  const health = await request("/health");
  check("backend and real model binding configured", health.status === 200 && health.body.model.configured === true);
  const input = { schema_version: "model-review.v1", request_id: requestId, task_id: "task-" + requestId,
    idempotency_key: requestId, kind: "combined", source: "synthetic-iteration-verification",
    text: "【虚构测试】我打算投入8000元买基金，下个月房租4500元，视频会员每月25元。尚未提供余额和具体日期，请列出需要补充的信息，不要虚构账户余额、优惠或交易结果。",
    data_mode: "SYNTHETIC_REPLAY", execution_mode: "PAPER", capability: "REVIEW_ONLY", memory_consent: false,
    scenario: "FUNDING_CONFLICT", output_formats: ["json"], action_parameters: { amount: 8000, currency: "CNY" } };
  report.synthetic_request = input;
  const created = await request("/api/review", input);
  const record = created.body;
  check("real model returned retained evidence", created.status === 200 && record.model?.source === "model" &&
    record.model?.model_response?.call_succeeded === true && Boolean(record.model.model_response.raw_text));
  check("model proposal waits for Risk with execution blocked", record.status === "PENDING_RISK" && record.execution.execution_allowed === false);
  report.trace = { task_id: record.task_id, run_id: record.run_id, audit_id: record.audit.audit_id };
  const replay = await request("/api/review", input);
  check("identical retry reuses the same task and model evidence", replay.status === 200 && replay.body.run_id === record.run_id && replay.body.model.model_response.raw_text === record.model.model_response.raw_text);
  const changed = await request("/api/review", { ...input, action_parameters: { amount: 9000, currency: "CNY" } });
  check("changed amount is blocked", changed.status === 409 && changed.body.error.code === "IDEMPOTENCY_CONFLICT");
  const taskInput = { task_id: record.task_id, proposal_sha256: record.proposed_action.proposal_sha256 };
  const simulated = await request("/api/review/simulate", taskInput);
  check("simulation without Risk and approval is blocked", simulated.status === 409 && simulated.body.error.code === "EXECUTION_BLOCKED");
  const dispatch = await request("/api/review/risk-dispatch", taskInput);
  check("unconfigured Risk gateway fails explicitly", dispatch.status === 503 && dispatch.body.error.code === "RISK_OWNER_NOT_CONFIGURED");
  const loaded = await request("/api/review/task/" + encodeURIComponent(record.task_id));
  report.final_record = loaded.body;
  check("task and audit remain queryable and execution stays blocked", loaded.status === 200 && loaded.body.audit.audit_id === record.audit.audit_id &&
    loaded.body.execution.execution_allowed === false && loaded.body.audit.events.length > record.audit.events.length);
  report.result = "PASS";
} catch (error) {
  report.result = "FAIL";
  report.error = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
