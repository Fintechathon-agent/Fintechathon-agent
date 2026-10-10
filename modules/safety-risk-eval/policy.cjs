"use strict";
const { randomUUID } = require("node:crypto");
const { hash } = require("../../docs/safety-risk-eval/contracts/validate.cjs");

// Trusted server configuration. Neither prompts nor HTTP request bodies can replace it.
const bundle = Object.freeze({
  version: "financial-policy-v1",
  implementation: "LOCAL_DETERMINISTIC_POLICY",
  rules: Object.freeze(["DEFAULT_DENY", "SAME_OWNER", "NO_EXTERNAL_AUTHORITY", "NO_REAL_TRADE", "BOUND_APPROVAL", "RISK_ELIGIBLE", "MEMORY_CONSENT"]),
  tools: Object.freeze({
    "portfolio.review": Object.freeze({ scenario: "PORTFOLIO", operation: "ANALYZE", effect: "READ_ONLY" }),
    paper_trade: Object.freeze({ scenario: "SIMULATION", operation: "PAPER_TRADE", effect: "SIMULATED_WRITE" }),
    "memory.write": Object.freeze({ scenario: "MEMORY", operation: "MEMORY_WRITE", effect: "CONSENTED_WRITE" })
  })
});
function currentPolicy() { return bundle; }
function fingerprint(policy) {
  if (!policy || typeof policy.version !== "string" || !policy.version || policy.implementation !== bundle.implementation || !Array.isArray(policy.rules) || !policy.tools || typeof policy.tools !== "object") throw new Error("POLICY_UNAVAILABLE");
  return hash(policy);
}
function snapshot(input) {
  return hash({ binding: input.binding, context: input.context, profile: input.profile, plan: input.plan, data_context: input.data_context, upstream: input.upstream });
}
function decide(input, policy = currentPolicy(), now = new Date().toISOString()) {
  let digest = null;
  const reasons = [];
  const add = (code, message_zh, recovery) => reasons.push({ code, message_zh, recovery, acceptance_allowed: false });
  let decision = "ALLOW";
  try {
    digest = fingerprint(policy);
    if (!input || !["REVIEW", "EXECUTE"].includes(input.stage) || !["USER", "EXTERNAL_CONTENT"].includes(input.source) || !input.subject || !input.owner || !input.tool || !input.operation || !input.scenario || typeof input.request_hash !== "string") throw new Error("POLICY_INPUT_INVALID");
    if (input.subject !== input.owner) add("POLICY_OWNER_MISMATCH", "不能操作其他用户的资源。", "由资源所属用户重新发起。");
    if (input.source !== "USER") add("POLICY_UNTRUSTED_AUTHORITY", "外部内容只能作为业务数据，不能发起有权限的操作。", "保留原文作为证据，由用户独立发起任务。");
    if (input.operation === "REAL_TRADE") add("POLICY_REAL_TRADE_DISABLED", "此环境禁止真实交易。", "仅使用模拟操作。");
    const tool = policy.tools[input.tool];
    if (!Object.hasOwn(policy.tools, input.tool) || !tool || tool.scenario !== input.scenario || tool.operation !== input.operation) add("POLICY_TOOL_NOT_ALLOWED", "工具、场景与操作类型不在允许组合内。", "通过团队评审登记工具及其执行边界。");
    if (input.stage === "EXECUTE" && input.tool === "paper_trade") {
      if (input.approval_matches !== true) add("POLICY_APPROVAL_STALE", "确认未绑定当前策略及完整业务快照。", "重新检查，再确认完整计划。");
      if (input.risk_eligible !== true) add("POLICY_RISK_NOT_ELIGIBLE", "风险检查尚未取得执行资格。", "修复风险原因或完成允许的逐项接受。");
    }
    if (input.tool === "memory.write" && input.memory_consent !== true) add("POLICY_MEMORY_CONSENT_REQUIRED", "未同意写入长期演示记忆。", "由用户明确选择是否保存。");
    if (reasons.length) decision = "BLOCK";
  } catch {
    decision = "ERROR";
    add("POLICY_EVALUATION_FAILED", "策略或必要输入不可用，默认不执行。", "恢复可信策略与输入后重新检查。");
  }
  return { schema_version: "policy-decision.v1", decision_id: `policy-${randomUUID()}`, policy_version: policy?.version || null, policy_digest: digest, input_digest: hash(input ?? null), request_hash: input?.request_hash || null, checked_at: now, stage: input?.stage || null, tool: input?.tool || null, scenario: input?.scenario || null, decision, allow: decision === "ALLOW", reasons };
}
function describe() {
  return { ...bundle, digest: fingerprint(bundle), opa_runtime_connected: false, agents_sdk_connected: false,
    enforcement_scope: "模拟写入与经同意的记忆写入已接网关；portfolio.review 为登记契约，健康检查读取仍由现有服务认证边界保护。",
    invariant: "模型提出动作；可信服务构造策略输入；策略判定与 Risk 均满足后，网关才可调用执行工具。" };
}
module.exports = { currentPolicy, fingerprint, snapshot, decide, describe };
