"use strict";

// Internal projection of a deterministic result, never an HTTP input parser.
const policy = require("../../../docs/safety-risk-eval/unified-rating-v1/risk-policy.json");
const daily = require("../../../docs/safety-risk-eval/daily-policy-v1/policy-config.v1.json");
const definitions = new Map(daily.rules.flatMap(rule => rule.reasons.map(row => [row.code, { ...row, rule_id: rule.rule_id }])));
const financialHard = new Set(["PROTECTED_PURPOSE_CONFLICT", "PAYMENT_CASH_INSUFFICIENT", "HARD_FLOOR_CONFLICT", "PAYMENT_DATE_GAP", "SHARED_FUNDS_CONFLICT", "LIQUIDITY_DATE_MISMATCH"]);
const soft = new Set(["PERSONAL_BUDGET_EXCEEDED", "BUDGET_REFERENCE_DEVIATION", "RESERVE_TARGET_SHORTFALL"]);
const control = new Set(daily.rules.find(rule => rule.rule_id === "D08").reasons.map(row => row.code));
const validDecision = value => ["ALLOW", "REVIEW", "BLOCK", "ERROR"].includes(value);
const states = new Set(["PASS", "REVIEW", "BLOCK", "ERROR", "NOT_EVALUATED"]);
const labels = Object.fromEntries(policy.business_bands.map(row => [row.code, row.label]));

function deriveAssessment(result, { target = "DAILY_CASHFLOW" } = {}) {
  const base = {
    assessment_version: "unified-risk-assessment.v1", policy_version: policy.policy_version,
    source_policy_version: result?.policy_version ?? null, target,
    source_risk_check_id: result?.risk_check_id ?? null,
    business_risk_band: "UNKNOWN", label_zh: labels.UNKNOWN, coverage: "UNAVAILABLE",
    risk_decision: validDecision(result?.decision) ? result.decision : null,
    engine_ran: false, execution_allowed: false, reason_codes: [], control_reason_codes: [], scenario_reason_codes: [],
    scope: "用户确认的虚构单资金池；不含真实账户、组合适当性或未来收益评级。",
    institutional_rating: "NOT_ASSESSED", safety_guarantee: false,
    limitations: ["评级不构成审批或执行授权。", "保留原引擎 ERROR 优先级及已签署回调，不以评级改写历史结论。"]
  };
  if (target !== "DAILY_CASHFLOW" || result?.contract_version !== "daily-risk-workbench.v1" || result?.policy_version !== daily.policy_version || !validDecision(result?.decision)) {
    return { ...base, limitations: [...base.limitations, "该结果尚未接入已验证的评级适配器。"] };
  }
  base.engine_ran = true;
  const channels = [result.reasons, result.warnings, result.info, result.gate_reasons];
  if (channels.some(rows => !Array.isArray(rows)) || !Array.isArray(result.checks)) return base;
  const rows = channels.flat();
  const wellFormed = row => row && typeof row === "object" && definitions.has(row.code) && row.rule_id === definitions.get(row.code).rule_id &&
    ["REVIEW", "BLOCK", "ERROR", "WARNING", "INFO", "GATE_WAIT", "GATE_DENY", "REPLAY"].includes(row.status);
  if (!rows.every(wellFormed)) return { ...base, limitations: [...base.limitations, "出现未知或格式异常的风险原因，须先核对规则版本。"] };
  base.reason_codes = [...new Set(rows.map(row => row.code))];
  base.control_reason_codes = base.reason_codes.filter(code => control.has(code));
  base.scenario_reason_codes = base.reason_codes.filter(code => code === "CASHFLOW_STRESS_GAP");
  const checksValid = result.checks.length === daily.rules.length && new Set(result.checks.map(row => row.rule_id)).size === daily.rules.length &&
    daily.rules.every(rule => result.checks.some(row => row.rule_id === rule.rule_id && states.has(row.status)));
  const metricsValid = result.metrics?.currency === "CNY" && result.metrics?.amount_unit === "MINOR" &&
    ["free_before_minor", "projected_free_after_minor", "shortfall_minor"].every(key => Number.isSafeInteger(result.metrics[key]));
  const missing = rows.some(row => row.status === "ERROR" || row.status === "REVIEW" && !(soft.has(row.code) && row.acceptance_allowed === true));
  const complete = checksValid && metricsValid && !missing && result.check_complete === true && !result.checks.some(row => ["ERROR", "NOT_EVALUATED"].includes(row.status));
  const hard = rows.some(row => financialHard.has(row.code) && row.status === "BLOCK");
  const financialEvidenceMissing = rows.some(row => ["D01", "D04"].includes(row.rule_id) && ["REVIEW", "ERROR"].includes(row.status));
  let band = "UNKNOWN";
  if (hard && checksValid && metricsValid && !financialEvidenceMissing) band = "HIGH";
  else if (complete) {
    if (rows.some(row => soft.has(row.code) && row.status === "REVIEW" && row.acceptance_allowed === true)) band = "ELEVATED";
    else if (rows.some(row => soft.has(row.code) && row.status === "WARNING")) band = "NOTICE";
    else if (result.decision !== "ERROR") band = "LOW";
  }
  return { ...base, business_risk_band: band, label_zh: labels[band], coverage: complete ? "FULL" : checksValid || metricsValid ? "PARTIAL" : "UNAVAILABLE" };
}

module.exports = { deriveAssessment };
