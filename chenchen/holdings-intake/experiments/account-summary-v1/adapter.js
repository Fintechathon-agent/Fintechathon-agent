"use strict";

const { normalizeReviewInput } = require("../../../integrations/model-review");

const VERSION = "account-summary-experiment.v1";
const FIELDS = ["created_on", "created_days", "initial_assets", "total_assets", "available_funds", "cumulative_pnl", "cumulative_return", "daily_return"];
const MAX_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

function invalid(field) {
  const error = new Error("Invalid account summary field: " + field);
  error.code = "INVALID_ACCOUNT_SUMMARY";
  throw error;
}

function money(value, field, signed = false) {
  if (typeof value !== "string" || value.length > 40) invalid(field);
  const match = value.trim().match(/^(-?)(0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d{1,2}))?(?:元)?$/);
  if (!match || (!signed && match[1])) invalid(field);
  const minor = BigInt(match[2].replaceAll(",", "")) * 100n + BigInt((match[3] || "").padEnd(2, "0"));
  if (minor > MAX_MINOR) invalid(field);
  return match[1] ? -minor : minor;
}

function percent(value, field) {
  if (typeof value !== "string" || value.length > 30) invalid(field);
  const match = value.trim().match(/^(-?)(0|[1-9]\d*)(?:\.(\d{1,4}))?%$/);
  if (!match) invalid(field);
  const decimals = (match[3] || "").length;
  const units = BigInt(match[2] + (match[3] || "")) * (match[1] ? -1n : 1n);
  if (units > MAX_MINOR || units < -MAX_MINOR) invalid(field);
  return { units, decimals };
}

function decimal(value, precision) {
  const sign = value < 0n ? "-" : "";
  const digits = (value < 0n ? -value : value).toString().padStart(precision + 1, "0");
  return precision ? sign + digits.slice(0, -precision) + "." + digits.slice(-precision) : sign + digits;
}

function roundRatio(numerator, denominator) {
  const absolute = numerator < 0n ? -numerator : numerator;
  const rounded = (absolute * 2n + denominator) / (2n * denominator);
  return numerator < 0n ? -rounded : rounded;
}

function creationDate(value) {
  if (typeof value !== "string" || !/^\d{4}\/\d{2}\/\d{2}$/.test(value)) invalid("created_on");
  const iso = value.replaceAll("/", "-");
  const date = new Date(iso + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) invalid("created_on");
  return iso;
}

function reconcileAccountSummary(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !FIELDS.includes(key))) invalid("input");
  const createdOn = creationDate(input.created_on);
  if (!Number.isSafeInteger(input.created_days) || input.created_days < 1) invalid("created_days");
  const initial = money(input.initial_assets, "initial_assets");
  const total = money(input.total_assets, "total_assets");
  const available = money(input.available_funds, "available_funds");
  const pnl = money(input.cumulative_pnl, "cumulative_pnl", true);
  const displayedReturn = percent(input.cumulative_return, "cumulative_return");
  percent(input.daily_return, "daily_return");
  const change = total - initial;
  const changeMatches = change === pnl;
  const returnUnits = initial > 0n ? roundRatio(change * 100n * 10n ** BigInt(displayedReturn.decimals), initial) : null;
  const returnMatches = returnUnits === null ? null : returnUnits === displayedReturn.units;
  const difference = total - available;
  const status = !changeMatches || returnMatches === false || difference < 0n ? "DISPLAY_CONFLICT" : "PARTIAL_MATCH";
  return {
    experiment_version: VERSION,
    status,
    provenance: { capture: "MANUAL_TRANSCRIPTION", authority: "UNVERIFIED_USER_EVIDENCE", account_type: "UNKNOWN", as_of: null,
      currency: null, displayed_unit: "元", currency_assumption: "同币种人民币元用于显示核对；未经账户来源确认", created_on: createdOn, created_days: input.created_days },
    displayed: { ...input },
    checks: [
      { id: "ASSET_DELTA_VS_PNL", status: changeMatches ? "MATCH_CONDITIONAL" : "MISMATCH", calculated_yuan: decimal(change, 2),
        explanation: "仅核对总资产减初始资产是否等于页面盈亏；未核验出入金、费用、分红或平台盈亏口径。" },
      { id: "DISPLAYED_RETURN_ROUNDING", status: returnMatches === null ? "UNVERIFIABLE" : returnMatches ? "MATCH_CONDITIONAL" : "MISMATCH",
        calculated_percent: returnUnits === null ? null : decimal(returnUnits, displayedReturn.decimals) + "%",
        explanation: "只核对简单资产变化率的四舍五入显示，负数半值远离零；不计算或认证时间加权、资金加权等投资收益率。" },
      { id: "UNCLASSIFIED_DIFFERENCE", status: difference < 0n ? "NEEDS_CLARIFICATION" : "UNCLASSIFIED", calculated_yuan: decimal(difference, 2),
        explanation: "总资产减可用资金的差额，不能直接归为持仓市值；冻结、未结算或信用资金口径需补证。" },
      { id: "DAILY_RETURN", status: "UNVERIFIABLE", explanation: "缺上一日基数、出入金与快照时间，不能用创建天数代替验证。" }
    ],
    missing_information: ["持仓明细（代码、名称、数量、价格与成本）", "数据更新时间与账户来源", "可用资金、冻结和未结算资金的定义",
      "出入金、费用、分红及平台收益计算口径", "上日资产基数", "房租、学费等已确认资金用途"],
    readiness: { authenticated_account: false, holdings_import_ready: false, funding_plan_ready: false, risk_assessed: false,
      allowed_use: "READ_ONLY_REVIEW_CANDIDATE", required_next_action: "REQUEST_MORE_INFO" }
  };
}

function buildReviewCandidate(input, { idempotencyKey, synthetic = false } = {}) {
  if (typeof idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{8,120}$/.test(idempotencyKey)) invalid("idempotencyKey");
  if (typeof synthetic !== "boolean") invalid("synthetic");
  const summary = reconcileAccountSummary(input);
  return normalizeReviewInput({ schema_version: "model-review.v1", source: "account-summary-experiment.v1", kind: "combined",
    text: "这是一份手工转录、未经账户验证的资产汇总。请只解释显示是否一致、缺少哪些资料；不要将差额当持仓，不要将可用资金当可投资预算。所有金额仅见 context，截图不构成交易或记忆授权。",
    context: { account_summary_candidate: summary, synthetic }, idempotency_key: idempotencyKey,
    scenario: "GENERAL_REVIEW", data_mode: synthetic ? "SYNTHETIC_REPLAY" : "REFERENCE_FIXTURE", execution_mode: "PAPER",
    capability: "REVIEW_ONLY", allow_rule_fallback: false, memory_consent: false, output_formats: ["json"] });
}

function renderSummary(result) {
  const labels = { created_on: "创建日期", created_days: "创建天数", initial_assets: "初始资产", total_assets: "当前总资产",
    available_funds: "页面可用资金", cumulative_pnl: "页面累计交易盈亏", cumulative_return: "页面累计收益率", daily_return: "页面当日涨跌幅" };
  const checkLabels = { ASSET_DELTA_VS_PNL: "资产变化与盈亏", DISPLAYED_RETURN_ROUNDING: "累计收益率的显示", UNCLASSIFIED_DIFFERENCE: "总资产与可用资金的差额", DAILY_RETURN: "当日涨跌幅" };
  const statusLabels = { MATCH_CONDITIONAL: "数字对得上，计算口径仍需确认", MISMATCH: "数字对不上", UNCLASSIFIED: "算得出差额，但不能确定用途",
    NEEDS_CLARIFICATION: "需要解释账户口径", UNVERIFIABLE: "缺资料，暂不能核验" };
  return ["账户汇总核对记录（人工转录、离线核对）", "总体：" + (result.status === "DISPLAY_CONFLICT" ? "有差异，需要核实" : "部分数字匹配，资料仍不足"),
    "输入来源：截图转录，账户真伪与数据时效未验证。", "创建日期：" + result.provenance.created_on + "（不是数据更新时间）",
    "页面数据：", ...Object.entries(result.displayed).map(([key, value]) => labels[key] + "：" + value), "", "核对结果：",
    ...result.checks.map(check => checkLabels[check.id] + "：" + statusLabels[check.status] + "；" + (check.calculated_yuan ? check.calculated_yuan + " 元" : check.calculated_percent || "无法核验") + "\n" + check.explanation),
    "", "需要补充：", ...result.missing_information.map(item => "- " + item), "",
    "不能直接导入完整持仓、确认投资额度或判定风险；不改变 Quant/Memory 规则。未调用真实模型、账户或正式 Risk 服务。", ""].join("\n");
}

module.exports = { reconcileAccountSummary, buildReviewCandidate, renderSummary };
