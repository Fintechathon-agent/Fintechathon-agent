"use strict";
const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual: equal } = require("node:util");
const contract = require("../../docs/safety-risk-eval/contracts/validate.cjs");
const tools = require("../../chenchen/tools/financial-tools.js");
const { hash, ruleIds, rules } = contract;
const clone = structuredClone;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const numeric = (x) => typeof x === "number" && Number.isFinite(x);
const EPS = 1e-8;
const measure = (name, actual, threshold, basis = "TOTAL_ASSETS", denominator = null, unit = "RATIO", operator = "GT") => ({ name, actual, threshold, basis, denominator, unit, operator });
class RiskInputError extends Error {
  constructor(details) { super("Risk input does not satisfy the draft contract"); this.code = "INVALID_RISK_INPUT"; this.details = details; }
}

function exposures(weights, classifications) {
  const invested = 1 - (weights.CASH || 0);
  const assets = Object.entries(weights).filter(([id, w]) => id !== "CASH" && w > 0).sort((a, b) => b[1] - a[1]);
  const sectors = {};
  let unknown = 0;
  for (const [id, weight] of assets) {
    const c = classifications.find((x) => x.instrument_id === id);
    if (!c) { unknown += weight; continue; }
    unknown += weight * c.unknown_weight;
    for (const [sector, part] of Object.entries(c.sector_weights)) sectors[sector] = (sectors[sector] || 0) + weight * part;
  }
  return { assets, sectors, unknown, invested };
}

function evaluate(input, authority = {}, options = {}) {
  const malformed = contract.shape("input", input);
  if (malformed.length) throw new RiskInputError(malformed);
  const now = options.now || new Date().toISOString();
  const checks = ruleIds.map((rule_id) => ({ rule_id, status: input.stage === "PLAN_REVIEW" && ["R08", "R09", "R10"].includes(rule_id) ? "NOT_APPLICABLE" : "PASS", reason_ids: [], scope_note: input.stage, measurements: [] }));
  const reasons = [];
  const check = (id) => checks.find((x) => x.rule_id === id);
  function add(id, code, decision, message, refs, measurements = [], acceptable = false, action = "RECHECK", owner = "RISK") {
    const reason = { reason_id: `reason-${hash({ id, code, refs, measurements }).slice(0, 20)}`, rule_id: id, code, decision, message_zh: message, measurements, evidence_refs: refs, acceptance_allowed: acceptable, recovery: { action, owner, message_zh: acceptable ? "逐项接受该风险后，确认当前完整计划；也可修改方案重检。" : "暂停相关执行；按原因补齐信息或修改方案后重新检查。" } };
    reasons.push(reason); check(id).reason_ids.push(reason.reason_id);
    check(id).status = ["ERROR", "BLOCK", "REVIEW"].find((d) => reasons.some((r) => r.rule_id === id && r.decision === d));
  }
  const b = input.binding;
  const c = input.context;
  if (!authority.user_id || authority.user_id !== b.user_id || authority.user_id !== c.actor_user_id || c.portfolio_owner_id !== authority.user_id) add("R01", "PERMISSION_DENIED", "BLOCK", "身份或持仓归属未获得可信授权。", ["/context"], [], false, "DENY_ACTION");
  if (c.requested_operation === "REAL_TRADE") add("R01", "REAL_TRADE_FORBIDDEN", "BLOCK", "当前系统禁止真实投资交易。", ["/context/requested_operation"], [], false, "DENY_ACTION");
  if (!(authority.allowed_tools || []).includes(c.requested_tool) || !c.authorized_tools.includes(c.requested_tool)) add("R01", "TOOL_NOT_ALLOWED", "BLOCK", "拟调用工具不在可信授权范围内。", ["/context/requested_tool"], [], false, "DENY_ACTION");
  if (authority.action_source === "EXTERNAL_CONTENT") add("R01", "EXTERNAL_PERMISSION_OVERRIDE", "BLOCK", "外部业务内容无权发起投资操作或改变权限。", ["/context/external_content_may_grant_permission"], [], false, "DENY_ACTION");
  for (const issue of contract.inputIssues(input)) add("R02", issue.code === "VERSION_MISMATCH" ? "VERSION_MISMATCH" : "EVIDENCE_MISMATCH", "ERROR", `必要证据校验失败：${issue.message || issue.code}`, ["/upstream", "/binding"]);
  if (!input.profile.confirmed_by_user || ["reserve_cash", "max_historical_drawdown", "forbidden_instruments", "allowed_instruments"].some((key) => input.profile[key] === null)) add("R02", "DATA_MISSING", "REVIEW", "用户硬约束尚未补齐或确认，不能默认视为零或无限制。", ["/profile"], [], false, "SUPPLY_INFORMATION", "USER");
  if (input.plan.data_mode === "LATEST_AVAILABLE" && (!input.data_context.valid_until || Date.parse(input.data_context.valid_until) <= Date.parse(now))) add("R02", "DATA_STALE", "ERROR", "当前建议所需行情已过期。", ["/data_context/valid_until"], [], false, "REFRESH_DATA", "TOOLS");
  if (input.plan.data_mode !== "SYNTHETIC_REPLAY" && authority.supports_real_data !== true) add("R02", "UNSUPPORTED_DATA_MODE", "ERROR", "当前集成仅验证虚构历史回放，不能把演示数据当作真实行情。", ["/plan/data_mode"]);
  if (authority.expected_binding && !equal(authority.expected_binding, b)) add("R02", "VERSION_MISMATCH", "ERROR", "服务器当前版本与待检查版本不一致。", ["/binding"]);

  let projected = null;
  const snapshot = input.upstream.artifacts.portfolio_snapshot;
  const candidate = input.upstream.artifacts.candidates?.find((x) => x.proposal_id === b.proposal_id);
  try {
    if (!candidate || !tools.validateProposal(candidate, { requireHash: true }).valid) throw new Error("候选方案内容摘要不匹配");
    if (!snapshot || !numeric(snapshot.total_value) || snapshot.total_value <= 0 || !numeric(snapshot.cash) || snapshot.cash < 0 || snapshot.positions.some((p) => !numeric(p.market_value) || !numeric(p.quantity) || !numeric(p.price) || p.market_value < 0 || p.quantity < 0 || p.price <= 0 || Math.abs(p.market_value - p.quantity * p.price) > .01) || Math.abs(sum(snapshot.positions.map((p) => p.market_value)) + snapshot.cash - snapshot.total_value) > .01) throw new Error("持仓估值或总资产不一致");
    if (new Set(input.data_context.classification.map((x) => x.instrument_id)).size !== input.data_context.classification.length) throw new Error("行业记录重复");
    if (Object.keys(candidate.target_weights).some((id) => id !== "CASH" && !snapshot.positions.some((p) => p.instrument_id === id))) throw new Error("缺少候选资产行情");
    const window = input.upstream.artifacts.health_report?.data_window;
    if (!window || window.observations < 2 || !window.start || !window.end) throw new Error("缺少历史测算样本");
    if (typeof authority.project_plan !== "function") throw new Error("执行计划验证器尚未提供");
    projected = authority.project_plan(input);
    if (!projected || !Array.isArray(projected.steps) || projected.steps.length !== input.plan.steps.length) throw new Error("步骤测算不完整");
    for (const failure of projected.failures || []) add("R03", failure.code, "BLOCK", failure.message, ["/plan/steps", "/profile"], failure.measurements || [], false, "REVISE_PLAN", "USER");
    for (const step of projected.steps) {
      if (!numeric(step.cash_after)) throw new Error("步骤现金不是有限数值");
      const m = measure(`cash_after:${step.step_id}`, step.cash_after, input.profile.reserve_cash, "CASH", null, "CNY", "LT");
      check("R03").measurements.push(m);
      if (input.profile.reserve_cash !== null && step.cash_after + EPS < input.profile.reserve_cash) add("R03", "RESERVE_CASH_VIOLATION", "BLOCK", "计划步骤剩余现金低于用户确认的备用金。", ["/plan/steps", "/profile/reserve_cash"], [m], false, "REVISE_PLAN", "USER");
    }
    const heldIds = new Set([...Object.entries(candidate.target_weights).filter(([id, w]) => id !== "CASH" && w > 0).map(([id]) => id), ...projected.steps.flatMap((step) => (step.held_instruments || [])), ...input.plan.steps.flatMap((step) => step.orders.filter((o) => o.side === "BUY").map((o) => o.instrument_id))]);
    for (const id of heldIds) if (input.profile.forbidden_instruments?.includes(id) || (input.profile.allowed_instruments && !input.profile.allowed_instruments.includes(id))) add("R03", "FORBIDDEN_ASSET", "BLOCK", `资产 ${id} 不满足用户允许范围。`, ["/profile", "/plan/steps"], [], false, "REVISE_PLAN", "USER");
  } catch (error) { add("R02", "CALCULATION_FAILED", "ERROR", `计划/数据测算无法完成：${error.message}`, ["/plan", "/upstream"], [], false, "RECHECK", "TOOLS"); if (check("R03").status === "PASS") check("R03").status = "NOT_EVALUATED"; }

  try {
    if (!candidate || !snapshot) throw new Error("缺少候选方案或持仓");
    const weights = candidate.target_weights;
    const current = Object.fromEntries(snapshot.positions.map((p) => [p.instrument_id, p.market_value / snapshot.total_value]));
    current.CASH = snapshot.cash / snapshot.total_value;
    const target = exposures(weights, input.data_context.classification);
    const before = exposures(current, input.data_context.classification);
    const entries = [];
    function metrics(exposure, prefix) {
      const top = sum(exposure.assets.slice(0, 3).map(([, w]) => w));
      const result = {};
      for (const [basis, denom] of [["TOTAL_ASSETS", 1], ["INVESTED_ASSETS", exposure.invested]]) {
        if (denom <= EPS) continue;
        const thresholds = basis === "TOTAL_ASSETS" ? [.35, .75, .4] : [.5, .9, .6];
        for (const [id, w] of exposure.assets) result[`R04:SINGLE_ASSET:${basis}:${id}`] = { value: w / denom, threshold: thresholds[0] };
        result[`R04:TOP_THREE:${basis}:TOP_THREE`] = { value: top / denom, threshold: thresholds[1] };
        for (const [id, w] of Object.entries(exposure.sectors)) result[`R05:SECTOR:${basis}:${id}`] = { value: w / denom, threshold: thresholds[2] };
      }
      return result;
    }
    const oldMetrics = metrics(before), newMetrics = metrics(target);
    const focus = input.plan.improvement_focus;
    const focusKey = focus ? `${focus.metric === "SECTOR" ? "R05" : "R04"}:${focus.metric}:${focus.basis}:${focus.subject_id}` : null;
    const focusImproved = focusKey && oldMetrics[focusKey] && (newMetrics[focusKey]?.value || 0) < oldMetrics[focusKey].value - EPS;
    const noWorse = Object.entries(newMetrics).every(([key, m]) => m.value <= m.threshold + EPS || (oldMetrics[key] && m.value <= oldMetrics[key].value + EPS));
    const gradual = Boolean(focusImproved && noWorse && before.unknown <= EPS && target.unknown <= EPS && !reasons.some((r) => ["R01", "R03"].includes(r.rule_id) && r.decision === "BLOCK"));
    for (const [key, metric] of Object.entries(newMetrics)) {
      const [id, kind, basis, subject] = key.split(":");
      const m = measure(`${kind}:${subject}`, metric.value, metric.threshold, basis, snapshot.total_value * (basis === "TOTAL_ASSETS" ? 1 : target.invested));
      check(id).measurements.push(m);
      if (metric.value > metric.threshold + EPS) {
        const code = gradual ? "GRADUAL_IMPROVEMENT_ACCEPTANCE" : kind === "SINGLE_ASSET" ? "SINGLE_ASSET_LIMIT_EXCEEDED" : kind === "TOP_THREE" ? "TOP_THREE_LIMIT_EXCEEDED" : "SECTOR_LIMIT_EXCEEDED";
        add(id, code, gradual ? "REVIEW" : "BLOCK", `${subject} 在 ${basis} 口径超过演示上限。${gradual ? "符合逐步改善前提，剩余风险须明确接受。" : "修改方案后重检。"}`, ["/upstream/artifacts/candidates", "/data_context/classification"], [m], gradual, gradual ? "ACCEPT_RISK" : "REVISE_PLAN", "USER");
      }
    }
    let priorMetrics = oldMetrics;
    for (const step of (projected?.steps || []).slice(0, -1)) {
      if (!step.quantities) throw new Error("缺少中间步骤持仓测算");
      const values = Object.fromEntries(Object.entries(step.quantities).map(([id, qty]) => [id, qty * snapshot.positions.find((p) => p.instrument_id === id)?.price]));
      const total = sum(Object.values(values)) + step.cash_after;
      if (!numeric(total) || total <= 0) throw new Error("中间步骤总资产无效");
      const stepWeights = Object.fromEntries(Object.entries(values).map(([id, v]) => [id, v / total])); stepWeights.CASH = step.cash_after / total;
      const stepMetrics = metrics(exposures(stepWeights, input.data_context.classification));
      for (const [key, metric] of Object.entries(stepMetrics)) if (metric.value > metric.threshold + EPS && (!gradual || !priorMetrics[key] || metric.value > priorMetrics[key].value + EPS)) {
        const [id, kind, basis, subject] = key.split(":");
        const m = measure(`${step.step_id}:${kind}:${subject}`, metric.value, metric.threshold, basis, total * (basis === "TOTAL_ASSETS" ? 1 : 1 - stepWeights.CASH));
        check(id).measurements.push(m);
        add(id, kind === "SINGLE_ASSET" ? "SINGLE_ASSET_LIMIT_EXCEEDED" : kind === "TOP_THREE" ? "TOP_THREE_LIMIT_EXCEEDED" : "SECTOR_LIMIT_EXCEEDED", "BLOCK", "中间步骤产生了不能接受或加重的硬超限。", ["/plan/steps"], [m], false, "REVISE_PLAN", "USER");
      }
      priorMetrics = stepMetrics;
    }
    if (target.unknown > EPS) add("R05", "SECTOR_INFORMATION_INCOMPLETE", "REVIEW", "部分行业信息未知；接受未知不能覆盖已知超限。", ["/data_context/classification"], [measure("unknown_sector_weight", target.unknown, null)], true, "ACCEPT_RISK", "USER");
    const comparison = input.upstream.artifacts.simulation.comparisons.find((x) => x.proposal_id === b.proposal_id);
    const dd = -comparison.metrics.max_drawdown;
    const ddm = measure("historical_drawdown_magnitude", dd, input.profile.max_historical_drawdown, "SAMPLE");
    check("R06").measurements.push(ddm);
    if (input.profile.max_historical_drawdown !== null && dd > input.profile.max_historical_drawdown + EPS) add("R06", "MAX_DRAWDOWN_EXCEEDED", "REVIEW", "历史回撤超过用户容忍值；历史值不是未来损失上限。", ["/upstream/artifacts/simulation/comparisons", "/profile/max_historical_drawdown"], [ddm], true, "ACCEPT_RISK", "USER");
    const matrix = input.upstream.artifacts.health_report.correlation_matrix;
    for (let i = 0; i < target.assets.length; i++) for (let j = i + 1; j < target.assets.length; j++) {
      const [a, wa] = target.assets[i], [z, wz] = target.assets[j];
      const rho = matrix?.[a]?.[z];
      if (!numeric(rho) || rho < -1 || rho > 1 || !numeric(matrix?.[z]?.[a]) || Math.abs(rho - matrix[z][a]) > EPS) throw new Error("相关性样本缺失或不一致");
      const ms = [measure(`${a}+${z}:rho`, rho, .8, "SAMPLE", null, "CORRELATION", "GTE"), measure(`${a}+${z}:weight`, wa + wz, .4, "TOTAL_ASSETS", snapshot.total_value)];
      check("R07").measurements.push(...ms);
      if (rho >= .8 && wa + wz > .4 + EPS) add("R07", "HIGH_CORRELATION_CONCENTRATION", "REVIEW", "指定样本内高相关资产合计占比超过40%。", ["/upstream/artifacts/health_report/correlation_matrix", "/upstream/artifacts/candidates"], ms, true, "ACCEPT_RISK", "USER");
    }
  } catch (error) {
    add("R02", "CALCULATION_FAILED", "ERROR", `风险测算失败：${error.message}`, ["/upstream"], [], false, "RECHECK", "TOOLS");
    for (const id of ["R04", "R05", "R06", "R07"]) if (check(id).status === "PASS") check(id).status = "NOT_EVALUATED";
  }

  if (input.stage === "EXECUTION_PREFLIGHT") {
    const a = input.approval;
    if (["REJECTED", "REVOKED"].includes(a.status)) add("R08", "APPROVAL_REJECTED", "BLOCK", "用户已拒绝或撤回此计划。", ["/approval"], [], false, "RECONFIRM", "USER");
    else if (a.status !== "CONFIRMED") add("R08", a.status === "UNCONFIRMED" ? "APPROVAL_REQUIRED" : "APPROVAL_INVALIDATED", "REVIEW", "完整计划尚未获得有效确认。", ["/approval"], [], false, "RECONFIRM", "USER");
    else if (!equal(a.binding, b) || a.confirmed_by !== authority.user_id || a.risk_check_id !== authority.approval_check_id || Date.parse(a.confirmed_at) > Date.parse(now) || Date.parse(a.expires_at) <= Date.parse(now)) add("R08", "APPROVAL_INVALIDATED", "REVIEW", "确认版本、确认人或有效期不匹配。", ["/approval", "/binding"], [], false, "RECONFIRM", "USER");
    for (const r of reasons.filter((r) => r.acceptance_allowed)) {
      if (!a.accepted_risks.some((x) => x.reason_id === r.reason_id && x.user_id === authority.user_id && x.risk_check_id === authority.approval_check_id && equal(x.binding, b) && Date.parse(x.accepted_at) <= Date.parse(now))) add("R08", "RISK_ACCEPTANCE_REQUIRED", "REVIEW", "存在尚未明确接受的风险项。", ["/approval/accepted_risks"], [], false, "RECONFIRM", "USER");
    }
    if (authority.idempotency_conflict) add("R09", "IDEMPOTENCY_CONFLICT", "BLOCK", "相同执行标识对应了不同内容。", ["/execution"], [], false, "DENY_ACTION");
    else if (["RUNNING", "UNKNOWN"].includes(input.execution.status)) add("R09", "EXECUTION_RESULT_UNKNOWN", "REVIEW", "执行结果需核查，不得盲目重试。", ["/execution"], [], false, "RECONCILE_EXECUTION", "TOOLS");
    else if (["SUCCEEDED", "FAILED", "ABORTED"].includes(input.execution.status)) add("R09", "DUPLICATE_EXECUTION", "REVIEW", "已有执行记录，返回原结果，不再次写入。", ["/execution"], [], false, "RECONCILE_EXECUTION", "TOOLS");
    else if (!input.execution.idempotency_key || input.execution.content_hash !== hash(b)) add("R09", "IDEMPOTENCY_CONFLICT", "BLOCK", "缺少有效幂等标识或执行内容摘要不匹配。", ["/execution"], [], false, "DENY_ACTION");
    if (input.audit_context.pre_execution_record_status !== "RECORDED" || !input.audit_context.pre_execution_record_id) add("R10", "PRE_EXECUTION_AUDIT_FAILED", "ERROR", "必要执行前审计未可靠写入，暂停执行。", ["/audit_context"], [], false, "RESTORE_AUDIT", "CORE_MEMORY");
  }
  const decision = ["ERROR", "BLOCK", "REVIEW"].find((d) => reasons.some((r) => r.decision === d)) || "ALLOW";
  const output = { contract_version: input.contract_version, schema_status: "DRAFT", risk_request_id: input.risk_request_id, risk_check_id: options.checkId || `risk-${randomUUID()}`, checked_at: now, binding: clone(b), stage: input.stage, decision, check_complete: decision !== "ERROR", execution_allowed: false, execution_authorization: "NOT_GRANTED_BY_RISK_RESULT", checks, reasons, allowed_functions: ["VIEW_DIAGNOSIS", "COMPARE", ...(["ALLOW", "REVIEW"].includes(decision) ? ["REQUEST_CONFIRMATION"] : ["REPAIR_INPUT"])], paused_functions: ["PAPER_TRADE", "REAL_TRADE"], approval: clone(input.approval), execution: clone(input.execution) };
  output.audit_event = { input_sha256: hash(input), input_snapshot_ref: `risk-input:${input.risk_request_id}`, checks: clone(checks), reason_details: clone(reasons), event_id: `event-${randomUUID()}`, correlation_id: input.audit_context.correlation_id, event_type: "RISK_CHECK_COMPLETED", occurred_at: now, actor: "RISK_ENGINE", binding: clone(b), risk_check_id: output.risk_check_id, stage: input.stage, decision, rule_ids: ruleIds, reason_ids: reasons.map((r) => r.reason_id), evidence_refs: [...new Set(reasons.flatMap((r) => r.evidence_refs))], data_mode: input.plan.data_mode, metrics_and_thresholds: checks.flatMap((x) => x.measurements), improvement_focus: input.plan.improvement_focus ? JSON.stringify(input.plan.improvement_focus) : null, unknown_fields: clone(input.profile.unknown_fields), approval: clone(input.approval), execution: clone(input.execution), record_status: "DEMO_NOT_PERSISTED" };
  const errors = contract.outputIssues(output, input);
  if (errors.length) throw new RiskInputError(errors);
  return output;
}

function executionEligible(result) {
  return result.stage === "EXECUTION_PREFLIGHT" && result.check_complete && !["ERROR", "BLOCK"].includes(result.decision) && result.reasons.every((r) => r.decision === "REVIEW" && r.acceptance_allowed) && ["R08", "R09", "R10"].every((id) => result.checks.find((x) => x.rule_id === id)?.status === "PASS");
}
module.exports = { evaluate, executionEligible, exposures, RiskInputError, measure, EPS };
