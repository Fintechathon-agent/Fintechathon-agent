"use strict";
const { randomUUID } = require("node:crypto");
const { hash } = require("../../../docs/safety-risk-eval/contracts/validate.cjs");
const receiver = require("./receiver.cjs");
const { GatewayError } = require("../gateway.cjs");
const baseRequest = require("../../../chenchen/contracts/examples/health-check.request.json");
const ORIGIN = "https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev";
const ENDPOINT = `${ORIGIN}/api/risk-workbench/handoff`;
const fail = (code, text, status = 502) => new GatewayError(code, text, "ERROR", status);
async function readJson(response) {
  if (response.status >= 300 && response.status < 400) throw fail("CORE_REDIRECT_REJECTED", "后端地址发生跳转，停止接收。");
  if (!response.ok) throw fail("CORE_HTTP_ERROR", `队友后端返回 HTTP ${response.status}，本次未接收任务。`);
  if (response.redirected) throw fail("CORE_REDIRECT_REJECTED", "后端地址发生跳转，停止接收。");
  if (!response.headers.get("content-type")?.includes("application/json")) throw fail("CORE_RESPONSE_INVALID", "后端未返回 JSON 交接数据。");
  const reader = response.body.getReader(), chunks = []; let total = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 262144) throw fail("CORE_RESPONSE_TOO_LARGE", "交接数据超过演示接收上限。"); chunks.push(value); }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw fail("CORE_RESPONSE_INVALID", "交接数据不是有效 JSON。"); }
}
async function health(fetchImpl = (...args) => fetch(...args)) {
  let value;
  try { value = await readJson(await fetchImpl(`${ORIGIN}/health`, { redirect: "manual", signal: AbortSignal.timeout(10000) })); }
  catch (error) {
    if (error instanceof GatewayError) throw error;
    console.error("REMOTE_CORE_HEALTH_FAILED", String(error.name), String(error.message).slice(0, 250));
    throw fail("CORE_UNAVAILABLE", "队友后端连接暂不可用，请稍后重试。", 503);
  }
  if (value.status !== "ok" || value.service !== "core-agent" || value.contract_version !== "investment-agent.v1") throw fail("CORE_HEALTH_INVALID", "后端健康信息与约定服务不一致。");
  return { status: "CONNECTED", origin: ORIGIN, contract_version: value.contract_version, service: value.service, access: "PUBLIC_DEMO_NO_CALLER_AUTH", capability: "READ_ONLY_HANDOFF", model_runtime: "NOT_ATTESTED", checked_at: new Date().toISOString() };
}
async function run({ payload, actor, gateway, fetchImpl = (...args) => fetch(...args), persist = async () => {} }) {
  if (!payload || Object.keys(payload).sort().join() !== "request_key" || typeof payload.request_key !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(payload.request_key)) throw fail("CORE_REQUEST_INVALID", "请使用本页面发起请求；不能指定外部地址、身份、审批或交接结果。", 400);
  const store = gateway.store, key = hash({ actor, request_key: payload.request_key });
  const previous = store.data.core_requests?.[key];
  if (previous?.status === "SUCCEEDED") {
    const record = gateway.inspect(previous.task_id, actor);
    gateway.event("REMOTE_CORE_REPLAY", record, { remote_request_id: previous.request_id });
    await persist(); return { ...receiver.result(record, true), service_receipt: record.handoff_import.service_receipt };
  }
  if (previous) throw fail("CORE_REQUEST_ALREADY_ATTEMPTED", "本次调用失败或结果未持久化。请查看状态后主动开始新检查，不会自动重复请求后端。", 409);
  if (Object.keys(store.data.tasks).length >= 20 || Object.keys(store.data.core_requests || {}).length >= 10) throw fail("CORE_DEMO_LIMIT", "本会话已达远程检查上限。", 429);
  const request = structuredClone(baseRequest); request.request_id = `remote-core-${randomUUID()}`;
  const started = gateway.now(), requestDigest = hash(request);
  store.transaction(data => { data.core_requests ||= {}; data.core_requests[key] = { request_id: request.request_id, status: "PENDING", started_at: started }; return null; });
  store.append({ event_id: `audit-${randomUUID()}`, event_type: "REMOTE_CORE_REQUESTED", user_id: actor, occurred_at: started, request_id: request.request_id, endpoint: ENDPOINT, request_digest: requestDigest });
  await persist();
  try {
    const envelope = await readJson(await fetchImpl(ENDPOINT, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(25000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request }) }));
    const raw = envelope.agent_response;
    if (envelope.integration_version !== "core-agent-to-risk-workbench.cloudflare@0.1.0" || raw?.request_id !== request.request_id) throw fail("CORE_CORRELATION_MISMATCH", "后端返回的版本或请求编号不属于本次调用，停止接收。");
    const bridge = envelope.risk_workbench;
    if (bridge?.integration_mode !== "READ_ONLY_HANDOFF_PREVIEW" || bridge?.decision?.execution_allowed !== false || bridge?.controls?.no_execution !== true || bridge.source?.task_id !== raw.task_state?.task_id || bridge.source?.request_id !== raw.request_id || bridge.source?.audit_id !== raw.audit_evidence?.audit_id) throw fail("CORE_BRIDGE_INVALID", "只读交接权限或审计关联与约定不一致。");
    const serviceReceipt = { endpoint: ENDPOINT, request_id: request.request_id, request_digest: requestDigest, response_digest: hash(raw), started_at: started, received_at: gateway.now(), verification: "SERVER_FETCH_PINNED_HTTPS", service_auth: "PUBLIC_DEMO_NO_CALLER_AUTH", capability: "READ_ONLY_HANDOFF", integration_version: envelope.integration_version };
    const result = receiver.receive({ payload: { import_version: receiver.VERSION, agent_response: raw }, actor, gateway, serviceReceipt });
    const record = gateway.inspect(result.task_id, actor);
    gateway.event("REMOTE_CORE_RECEIVED", record, { source: record.handoff_import.source, service_receipt: serviceReceipt, source_note: "由工作台服务端直接调用指定 HTTPS 后端；不代表调用方登录认证或大模型调用证明。" });
    store.transaction(data => { data.core_requests[key] = { ...data.core_requests[key], status: "SUCCEEDED", task_id: result.task_id }; return null; });
    await persist();
    return { ...result, service_receipt: serviceReceipt };
  } catch (error) {
    const code = error.code || "CORE_UNAVAILABLE";
    store.transaction(data => { data.core_requests[key] = { ...data.core_requests[key], status: "FAILED", code }; return null; });
    store.append({ event_id: `audit-${randomUUID()}`, event_type: "REMOTE_CORE_FAILED", user_id: actor, occurred_at: gateway.now(), request_id: request.request_id, code, execution_allowed: false });
    await persist();
    if (error instanceof GatewayError) throw error;
    throw fail(code, "队友后端或审计存储暂不可用，已暂停。未退回固定样例。请稍后主动重试。");
  }
}
module.exports = { ORIGIN, ENDPOINT, health, run };
