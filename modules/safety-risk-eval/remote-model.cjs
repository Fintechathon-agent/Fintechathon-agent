"use strict";
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { GatewayError } = require("./gateway.cjs");
const ORIGIN = "https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev";
const ENDPOINT = `${ORIGIN}/api/review`;
const SOURCE = "risk-workbench-live";
const ACTIONS = ["NO_ACTION", "REQUEST_MORE_INFO", "HOLD_FOR_REVIEW", "FLAG_FOR_RISK"];
const sha = text => createHash("sha256").update(text).digest("hex");
const object = value => value && typeof value === "object" && !Array.isArray(value);
const identifier = value => typeof value === "string" && value.length > 0 && value.length <= 180;
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const fail = (code, message, status = 502) => new GatewayError(code, message, "ERROR", status);

async function readJson(response) {
  if (response.redirected || (response.status >= 300 && response.status < 400)) throw fail("MODEL_REDIRECT_REJECTED", "模型后端发生跳转，停止接收。");
  if (!response.ok) throw fail("MODEL_SERVICE_FAILED", `团队模型后端返回 HTTP ${response.status}，本次未取得可用模型提议。`, 503);
  if (!response.headers.get("content-type")?.includes("application/json") || !response.body) throw fail("MODEL_RESPONSE_INVALID", "模型后端未返回有效 JSON。");
  const reader = response.body.getReader(), chunks = []; let total = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 262144) throw fail("MODEL_RESPONSE_TOO_LARGE", "模型响应超过接收上限。"); chunks.push(value); }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw fail("MODEL_RESPONSE_INVALID", "模型响应不是有效 JSON。"); }
}

async function health(fetchImpl = fetch) {
  let value;
  try { value = await readJson(await fetchImpl(`${ORIGIN}/health`, { redirect: "manual", signal: AbortSignal.timeout(10000) })); }
  catch (error) { if (error instanceof GatewayError) throw error; throw fail("MODEL_SERVICE_UNAVAILABLE", "团队模型后端暂不可访问，请稍后检查连接。", 503); }
  if (value.status !== "ok" || value.service !== "core-agent" || value.model?.configured !== true || !identifier(value.model?.name)) throw fail("MODEL_NOT_CONFIGURED", "团队后端尚未报告可用模型，暂停真实模型入口。", 503);
  return { configured: true, available: true, provider: "TEAM_CORE_MODEL_SERVICE", model: value.model.name, origin: ORIGIN, capability: "READ_ONLY_MODEL_REVIEW", audit_storage: value.audit_storage || "NOT_ATTESTED" };
}

function validate(value, { requestId, document } = {}) {
  const bad = message => { throw fail("MODEL_HANDOFF_INVALID", message); };
  if (!object(value) || value.error || value.workflow_version !== "review-workflow.v1" || value.status !== "PENDING_RISK" || value.risk_decision !== null || value.request_id !== requestId || !identifier(value.task_id) || !identifier(value.run_id)) bad("模型响应版本、状态或请求关联不符合本次调用。");
  const model = value.model, response = model?.model_response, proposal = response?.proposal;
  if (model?.source !== "model" || model.status !== "PROPOSED" || response?.call_succeeded !== true || !identifier(response?.model) || !identifier(response?.provider_response_id) || typeof response.raw_text !== "string" || !response.raw_text || response.raw_text.length > 32768 || !["provider_json_serialized", "text", "provider_text", "model_text"].includes(response.raw_text_format)) bad("缺少本轮实际模型调用证据，不能用规则降级或旧结果继续。");
  let parsed; try { parsed = JSON.parse(response.raw_text); } catch { bad("模型原始返回不是可核对的结构化提议。"); }
  if (!object(proposal) || !isDeepStrictEqual(parsed, proposal) || !ACTIONS.includes(proposal.proposed_action) || typeof proposal.summary !== "string" || typeof proposal.action_reason !== "string" || !["low", "medium", "high", "unknown"].includes(proposal.risk_level) || !Array.isArray(proposal.evidence) || !Array.isArray(proposal.missing_information) || Object.keys(proposal).some(key => !["summary", "risk_level", "proposed_action", "action_reason", "missing_information", "evidence"].includes(key))) bad("模型原文与提议不一致或含未登记的动作、授权字段。");
  const action = value.proposed_action, handoff = value.risk_handoff, audit = value.audit;
  if (!object(action) || action.proposed_action !== proposal.proposed_action || action.action_reason !== proposal.action_reason || action.risk_level !== proposal.risk_level || action.model_response_id !== response.provider_response_id || !object(action.action_parameters) || !digest(action.proposal_sha256)) bad("拟议动作与实际模型输出不一致。");
  const bound = { ...action }; delete bound.proposal_sha256;
  if (sha(JSON.stringify(bound)) !== action.proposal_sha256) bad("完整拟议动作摘要校验失败。");
  if (!digest(model.input?.input_sha256) || model.input.source !== SOURCE || model.input.kind !== (document?.source === "FINANCIAL_NEWS" ? "news" : "bill") || handoff?.contract_version !== "model-review.v1" || handoff.status !== "PENDING_REVIEW" || handoff.execution_allowed !== false || handoff.task_id !== value.task_id || handoff.run_id !== value.run_id || !identifier(handoff.handoff_id) || handoff.evidence?.input_sha256 !== model.input.input_sha256 || handoff.evidence?.model_response_id !== response.provider_response_id || handoff.evidence?.proposal_sha256 !== action.proposal_sha256 || handoff.evidence?.audit_id !== audit?.audit_id) bad("模型交接的数据证据、只读范围或来源关联不一致。");
  if (!identifier(audit?.audit_id) || audit.task_id !== value.task_id || audit.request_id !== requestId || audit.run_id !== value.run_id || !Array.isArray(audit.events) || !audit.events.length || audit.events.length > 100 || audit.events.some(event => event.task_id !== value.task_id || event.payload?.run_id !== value.run_id || event.payload?.request_id !== requestId)) bad("模型任务与审计链不一致。");
  const approval = value.approval, execution = value.execution;
  if (!approval || approval.task_id !== value.task_id || approval.proposal_sha256 !== action.proposal_sha256 || !["BLOCKED", "PENDING", "NOT_REQUIRED"].includes(approval.status) || (approval.status === "NOT_REQUIRED" && proposal.proposed_action !== "NO_ACTION") || approval.decision !== null || approval.approver !== null || execution?.task_id !== value.task_id || execution.status !== "BLOCKED" || execution.execution_allowed !== false || execution.simulation_allowed !== false || execution.receipt !== null) bad("未经本工作台风险检查和确认的任务不能获得执行资格。");
  return value;
}

function buildRequest(document, requestId) {
  if (!identifier(requestId) || document?.trust !== "UNTRUSTED_DATA" || !["BILL_NOTE", "FINANCIAL_NEWS"].includes(document.source) || typeof document.text !== "string") throw fail("MODEL_REQUEST_INVALID", "缺少服务器登记的虚构业务材料。", 400);
  const planning = document.review_profile === "LONG_TEXT_PLANNING";
  return { request_id: requestId, kind: document.source === "FINANCIAL_NEWS" ? "news" : "bill", source: SOURCE, text: document.text, requested_action: planning ? document.requested_action : "仅分析虚构业务材料及外部指令，不执行交易、付款或记忆写入", action_parameters: {}, context: { synthetic: true, authorized_intent: "ANALYZE_ONLY", business_data_trust: "UNTRUSTED_DATA", ...(planning ? { review_focus: "GROUNDED_BUDGET_PLANNING", money_unit: "CNY_YUAN" } : {}) }, allow_rule_fallback: false,
    ...(identifier(document.local_task_id) ? { schema_version: "model-review.v1", source_task_id: document.local_task_id, scenario: "FUNDING_CONFLICT", data_mode: "SYNTHETIC_REPLAY", execution_mode: "PAPER", capability: "REVIEW_ONLY" } : {}) };
}
async function callReview({ document, requestId, fetchImpl = fetch }) {
  const body = buildRequest(document, requestId);
  try {
    const value = await readJson(await fetchImpl(ENDPOINT, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(document.review_profile === "LONG_TEXT_PLANNING" ? 45000 : 60000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    return validate(value, { requestId, document });
  } catch (error) { if (error instanceof GatewayError) throw error; throw fail("MODEL_SERVICE_UNAVAILABLE", "模型调用超时或连接失败，已暂停；不会切换为离线成功。", 503); }
}
module.exports = { ORIGIN, ENDPOINT, SOURCE, health, validate, buildRequest, callReview };
