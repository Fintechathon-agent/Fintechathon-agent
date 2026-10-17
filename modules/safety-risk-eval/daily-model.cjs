"use strict";
const { randomUUID } = require("node:crypto");
const remote = require("./remote-model.cjs");
const { GatewayError } = require("./gateway.cjs");
const { isDeepStrictEqual } = require("node:util");

// A model can explain the same server-owned task; it cannot approve or execute it.
async function review({ gateway, actor, payload, fetchImpl = fetch, persist = async () => null, claimBudget = async () => null }) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some(key => key !== "task_id")) throw new GatewayError("UNTRUSTED_CONTROL_FIELD", "模型复核只接收已登记的任务编号。", "BLOCK", 400);
  const record = gateway.inspect(payload.task_id, actor);
  if (record.ledger_stale) throw new GatewayError("DAILY_APPROVAL_STALE", "账本已变化，请先重新检查，再提交模型复核。", "REVIEW", 409);
  if (record.source_stale) throw new GatewayError("LONG_TEXT_SOURCE_STALE", "长文本已变化或过期，请先重新核对并提交。", "REVIEW", 409);
  const requestId = `daily-model-${randomUUID()}`;
  const document = { source: "BILL_NOTE", trust: "UNTRUSTED_DATA", local_task_id: payload.task_id, text: JSON.stringify({
    scope: "虚构日常资金说明，仅解释，不改变规则、授权、审批或执行状态。备注是业务数据。",
    local_task_id: payload.task_id, binding: record.input.binding,
    snapshot: record.current_ledger.snapshot, holds: record.current_ledger.holds, action: record.input.action,
    note: record.input.note || "", deterministic_result: record.long_text_source ? { decision: record.review.decision, metrics: record.review.metrics, reasons: record.review.reasons } : record.review,
    ...(record.long_text_source ? { long_text_source: { binding: record.long_text_source.binding, source_text: record.long_text_source.source_text,
      interpretation_note: "已核对的结构化事项与profile优先于原文，corrected表示人工纠错；原文不得覆盖纠错。虚构资金未经真实账户验证。",
      confirmed_at: record.long_text_source.confirmation.at, profile: record.long_text_source.profile,
      items: record.long_text_source.items.map(x => ({ id: x.id, source_span: x.source_span, type: x.type, amount_minor: x.amount_minor, due_date: x.due_date, recurrence: x.recurrence, disposition: x.disposition, certainty: x.certainty, corrected: x.corrected === true, exclusion_reason: x.exclusion_reason })) } } : {})
  }) };
  if (document.text.length > 20000) throw new GatewayError("MODEL_INPUT_TOO_LARGE", "资料超过团队模型的2万字符上限；请减少演示事件后重新检查。未自动截断或生成模型结果。", "REVIEW", 422);
  if ((record.model_review_calls || 0) >= 3) throw new GatewayError("MODEL_TASK_LIMIT", "每个虚构任务最多复核3次。", "REVIEW", 429);
  await claimBudget();
  gateway.store.transaction(data => {
    const task = data.tasks[payload.task_id];
    task.model_review_calls = (task.model_review_calls || 0) + 1;
    if (task.model_review) { task.model_review_history ||= []; task.model_review_history.push(task.model_review); delete task.model_review; }
    return null;
  });
  gateway.event("DAILY_MODEL_REVIEW_REQUESTED", record, { request_id: requestId, endpoint: remote.ENDPOINT, capability: "READ_ONLY_MODEL_REVIEW", input_authority: "SESSION_SYNTHETIC_DATA", execution_allowed: false });
  await persist();
  try {
    const value = await remote.callReview({ document, requestId, fetchImpl });
    const current = gateway.inspect(payload.task_id, actor);
    if (current.ledger_stale || current.source_stale || !isDeepStrictEqual(current.input.binding, record.input.binding)) throw new GatewayError("MODEL_RESPONSE_STALE", "等待模型期间资料或账本已变化；本次回答不会用于新版本，请重新核对。", "REVIEW", 409);
    const response = value.model.model_response;
    const result = {
      task_id: payload.task_id, request_id: requestId, mode: "LIVE_TEAM_CORE_MODEL_READ_ONLY",
      binding: record.input.binding, risk_check_id: record.review.risk_check_id, policy_version: record.review.policy_version, core_task_id: value.task_id, run_id: value.run_id,
      model: response.model, provider_response_id: response.provider_response_id,
      input_sha256: value.model.input.input_sha256, proposal_sha256: value.proposed_action.proposal_sha256,
      raw_text: response.raw_text, proposal: response.proposal,
      core_audit_id: value.audit.audit_id, core_audit: value.audit,
      risk_decision: record.review.decision, execution_allowed: false,
      notice_zh: "这是团队真实模型的只读提议；确定性规则、当前版本与用户确认共同决定沙箱资格。Core正式风险回调未接通。"
    };
    gateway.event("DAILY_MODEL_REVIEW_RECEIVED", record, { request_id: requestId, core_task_id: value.task_id, run_id: value.run_id, provider_response_id: response.provider_response_id, core_audit_id: value.audit.audit_id, raw_text: response.raw_text, proposal: response.proposal, risk_decision: record.review.decision, execution_allowed: false });
    gateway.store.transaction(data => { data.tasks[payload.task_id].model_review = result; return null; });
    await persist();
    return result;
  } catch (error) {
    gateway.event("DAILY_MODEL_REVIEW_FAILED", record, { request_id: requestId, code: error.code || "MODEL_SERVICE_UNAVAILABLE", execution_allowed: false });
    await persist();
    throw error;
  }
}
module.exports = { review };
