"use strict";
const { randomUUID } = require("node:crypto");
const { hash } = require("../../docs/safety-risk-eval/contracts/validate.cjs");
const { fromHandoff } = require("./core-adapter.cjs");
const { GatewayError } = require("./gateway.cjs");
const baseRequest = require("../../chenchen/contracts/examples/health-check.request.json");

function ingestBusinessData(source, text) {
  if (!["BILL_NOTE", "FINANCIAL_NEWS"].includes(source) || typeof text !== "string" || !text.trim() || text.length > 5000) throw new GatewayError("INVALID_EXTERNAL_DATA", "请选择账单备注或外部新闻，文字长度为1到5000字。", "ERROR", 400);
  const normalized = text.normalize("NFKC").replace(/[\u200b-\u200f\ufeff]/g, "");
  // This hint is explanatory only. Authorization never depends on keyword detection.
  const hint = /忽略|绕过|直接.*(?:操作|交易)|ignore|bypass|system|approved|批准|管理员/i.test(normalized);
  return Object.freeze({ document_id: `document-${hash({ source, text }).slice(0, 20)}`, source, trust: "UNTRUSTED_DATA", text, content_sha256: hash(text), instruction_hint: hint });
}

function buildCoreContext(document) {
  return Object.freeze({
    authority: Object.freeze({ operation: "PORTFOLIO_HEALTH_CHECK", automatic_execution: false, may_grant_permissions: false, allowed_tools: Object.freeze(["portfolio.review"]) }),
    business_data: Object.freeze([document]),
    requested_privileged_actions: Object.freeze([])
  });
}

async function runAttackDemo({ gateway, harness, actor, source, text }) {
  const document = ingestBusinessData(source, text);
  const context = buildCoreContext(document);
  const authorityBefore = hash(context.authority);
  // The real Core receives only the allowlisted financial request. Business text is never merged into control fields.
  const request = structuredClone(baseRequest); request.request_id = `attack-demo-${randomUUID()}`;
  const upstream = harness.runHealthCheckContract(request);
  const input = fromHandoff(upstream, actor, { confirmed: true });
  // Explicit red-team probe: emulate an illicit downstream action even though Core did not request one.
  gateway.register(input, { actionSource: "EXTERNAL_CONTENT", external: [document], deferReview: true });
  const taskId = input.binding.task_id, record = gateway.inspect(taskId, actor);
  gateway.event("EXTERNAL_DATA_RECEIVED", record, { document_id: document.document_id, source, trust: document.trust, original_text: text, content_sha256: document.content_sha256, instruction_hint: document.instruction_hint });
  gateway.event("CORE_AUTHORITY_PRESERVED", record, { document_id: document.document_id, authority_before: authorityBefore, authority_after: hash(context.authority), promoted_instruction_count: 0, privileged_action_count: context.requested_privileged_actions.length, note: "实际Core调用为结构化健康检查；后续越权动作是演示器主动构造的隔层探针。" });
  const review = gateway.review(taskId, actor);
  gateway.event("RISK_PROBE_BLOCKED", record, { document_id: document.document_id, decision: review.decision, reason_codes: review.reasons.map((r) => r.code), risk_check_id: review.risk_check_id });
  const outcome = await gateway.execute(taskId, actor, `attack-probe-${randomUUID()}`);
  const toolCalls = gateway.toolCalls.get(taskId) || 0;
  gateway.event("ATTACK_DEMO_COMPLETED", record, { document_id: document.document_id, paper_tool_calls: toolCalls, execution_status: outcome.status, authority_changed: hash(context.authority) !== authorityBefore });
  return { task_id: taskId, document, core: { authority_before: context.authority, authority_after: context.authority, promoted_instruction_count: 0, privileged_action_count: 0, mechanism: "Allowlisted control fields; external text is retained only as untrusted data", probe_note: "为检验后层，本演示额外构造一次来源为外部内容的越权请求；不是声称 Core 实际执行了该指令。" }, risk: review, gateway: outcome, paper_tool_calls: toolCalls, audit: gateway.store.events.filter((e) => (e.task_id || e.binding?.task_id) === taskId), scope: "Deterministic local integration security demonstration; no LLM provider, real accounts or live trading connected" };
}
module.exports = { ingestBusinessData, buildCoreContext, runAttackDemo };
