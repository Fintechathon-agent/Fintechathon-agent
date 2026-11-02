"use strict";
const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual: equal } = require("node:util");
const { GatewayError, emptyApproval } = require("./gateway.cjs");
const { hash } = require("../../docs/safety-risk-eval/contracts/validate.cjs");

const VERSION = "daily-risk-workbench.v1";
const POLICY_VERSION = "daily-cashflow-policy.v1.0";
const clone = structuredClone;
// Imported synthetic holds are cash constraints, never execution receipts or verified account evidence.
function reportedHolds(value) {
  amount(value, "用户报告已有占用");
  return value ? [{ hold_id: "long-text-reported", amount_minor: value, covered_reserved_minor: 0, purpose_id: null, settlement_link: "UNVERIFIED", source: "USER_REPORTED_SYNTHETIC" }] : [];
}
const object = value => value && typeof value === "object" && !Array.isArray(value);
const id = value => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,180}$/.test(value);
const date = value => typeof value === "string" && /^(?:\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) && Number.isFinite(Date.parse(value));
const fail = (code, message, decision = "ERROR", status = 422) => new GatewayError(code, message, decision, status);
function only(value, allowed, name) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw fail("DAILY_INVALID_INPUT", `${name}包含不支持的字段；身份、权限和执行状态仅由服务端决定。`);
}
function amount(value, name) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 1000000000000)) throw fail("DAILY_INVALID_AMOUNT", `${name}必须是非负整数分或明确的未知值null。`);
}
function moment(value, name) { if (value !== null && !date(value)) throw fail("DAILY_INVALID_DATE", `${name}必须是明确日期、含时区的时间或null。`); }
function label(value, name) { if (typeof value !== "string" || !value.trim() || value.length > 120) throw fail("DAILY_INVALID_INPUT", `${name}需要1到120字的名称。`); }
function snapshot(value) {
  only(value, ["currency", "cash_ledger_minor", "as_of", "purposes", "hard_floor", "income_events"], "资金事实");
  if (value.currency !== "CNY") throw fail("DAILY_UNSUPPORTED_CURRENCY", "此版只支持人民币整数分，不混加币种。");
  amount(value.cash_ledger_minor, "账面现金"); moment(value.as_of, "余额时点");
  if (!Array.isArray(value.purposes) || value.purposes.length > 20 || !Array.isArray(value.income_events) || value.income_events.length > 40) throw fail("DAILY_INVALID_INPUT", "用途最多20项，收入事件最多40项。");
  const seen = new Set();
  for (const purpose of value.purposes) {
    only(purpose, ["purpose_id", "label", "reserved_now_minor", "remaining_due_minor", "due_at"], "资金用途");
    if (!id(purpose.purpose_id) || seen.has(purpose.purpose_id)) throw fail("DAILY_DUPLICATE_PURPOSE", "每个资金用途必须有独立编号。");
    seen.add(purpose.purpose_id); label(purpose.label, "用途");
    amount(purpose.reserved_now_minor, "现在保护额"); amount(purpose.remaining_due_minor, "尚欠金额"); moment(purpose.due_at, "付款日");
  }
  only(value.hard_floor, ["state", "amount_minor", "covered_by_purpose_id"], "硬性保底");
  if (!["DISABLED_CONFIRMED", "ENABLED_CONFIRMED", "UNKNOWN", "UNSPECIFIED"].includes(value.hard_floor.state)) throw fail("DAILY_INVALID_INPUT", "请选择硬性保底状态。");
  amount(value.hard_floor.amount_minor, "硬性保底");
  if (value.hard_floor.covered_by_purpose_id !== undefined && (!id(value.hard_floor.covered_by_purpose_id) || !seen.has(value.hard_floor.covered_by_purpose_id))) throw fail("DAILY_INVALID_INPUT", "保底覆盖必须关联现有用途。");
  const eventIds = new Set();
  for (const income of value.income_events) {
    only(income, ["event_id", "label", "amount_minor", "status", "at", "included_in_balance"], "收入事件");
    if (!id(income.event_id) || eventIds.has(income.event_id) || !["RECEIVED", "EXPECTED"].includes(income.status) || typeof income.included_in_balance !== "boolean") throw fail("DAILY_INVALID_INPUT", "收入事件编号、到账状态和是否已计余额必须明确。");
    eventIds.add(income.event_id); label(income.label, "收入"); amount(income.amount_minor, "收入金额"); moment(income.at, "到账日");
    if (income.status === "EXPECTED" && income.included_in_balance) throw fail("DAILY_INCOME_INCONSISTENT", "预计收入不能声称已计入当前余额。");
  }
  return clone(value);
}
function options(value, fields, name) {
  if (value === undefined) return undefined;
  only(value, fields, name);
  if (typeof value.enabled !== "boolean" || typeof value.require_acceptance !== "boolean") throw fail("DAILY_INVALID_INPUT", `${name}启用状态和是否需逐项接受必须明确。`);
  for (const field of fields.filter(field => field.endsWith("_minor"))) if (value[field] !== undefined) amount(value[field], field);
  if ("target_months" in value && value.target_months !== null && (!Number.isFinite(value.target_months) || value.target_months <= 0 || value.target_months > 60)) throw fail("DAILY_INVALID_INPUT", "储备目标月数须大于0且不超过60。");
  return clone(value);
}
function parse(payload) {
  only(payload, ["contract_version", "snapshot", "action", "facts_confirmed", "purposes_confirmed", "budget", "emergency", "note", "ledger_id", "expected_ledger_revision", "task_id"], "请求");
  if (payload.contract_version !== VERSION) throw fail("DAILY_CONTRACT_VERSION", "请使用daily-risk-workbench.v1日常资金契约。");
  if (typeof payload.facts_confirmed !== "boolean" || typeof payload.purposes_confirmed !== "boolean") throw fail("DAILY_INVALID_INPUT", "请分别确认事实和资金用途。");
  only(payload.action, ["type", "amount_minor", "fees_minor", "at", "matched_purpose_id", "depends_on_redemption", "latest_reliable_available_at"], "拟议动作");
  if (!["INVESTMENT", "PURPOSE_PAYMENT", "SUBSCRIPTION_PAYMENT", "CONSUMPTION"].includes(payload.action.type)) throw fail("REAL_TRADING_FORBIDDEN", "只支持日常资金分析及虚构沙箱安排；没有真实交易入口。", "BLOCK");
  amount(payload.action.amount_minor, "本金"); amount(payload.action.fees_minor, "费用"); moment(payload.action.at, "操作日");
  if (payload.action.matched_purpose_id !== undefined && !id(payload.action.matched_purpose_id)) throw fail("DAILY_INVALID_INPUT", "同用途付款需要有效用途编号。");
  if (payload.action.depends_on_redemption !== undefined && typeof payload.action.depends_on_redemption !== "boolean") throw fail("DAILY_INVALID_INPUT", "变现依赖必须明确。");
  if (payload.action.latest_reliable_available_at !== undefined) moment(payload.action.latest_reliable_available_at, "最晚可靠到账日");
  if (payload.note !== undefined && (typeof payload.note !== "string" || payload.note.length > 5000)) throw fail("DAILY_INVALID_INPUT", "备注最多5000字，仅作为不可信业务文字。");
  if ((payload.ledger_id === undefined) !== (payload.expected_ledger_revision === undefined) || (payload.ledger_id !== undefined && (!id(payload.ledger_id) || !Number.isSafeInteger(payload.expected_ledger_revision) || payload.expected_ledger_revision < 1))) throw fail("DAILY_LEDGER_REFERENCE_REQUIRED", "共享账本需要同时提供账本编号及所见版本。");
  return { ...clone(payload), ...(payload.snapshot === undefined ? {} : { snapshot: snapshot(payload.snapshot) }),
    budget: options(payload.budget, ["enabled", "period_take_home_minor", "needs_minor", "goals_minor", "wants_minor", "category_remaining_minor", "require_acceptance"], "预算"),
    emergency: options(payload.emergency, ["enabled", "allocation_minor", "monthly_essential_minor", "target_months", "require_acceptance"], "应急储备") };
}

class DailyGateway {
  static VERSION = VERSION;
  constructor({ store, evaluate, now = () => new Date().toISOString(), approvalTtlMs = 15 * 60 * 1000, beforeExecute = async () => null } = {}) {
    if (!store) throw new Error("DAILY_STORE_REQUIRED");
    Object.assign(this, { store, now, approvalTtlMs, beforeExecute });
    this.evaluate = evaluate || ((facts, options) => require("./daily-engine.cjs").evaluateDaily(facts, options));
    this.busy = new Set();
  }
  event(type, record, details = {}) {
    return this.store.append({ ...clone(details), event_id: `daily-audit-${randomUUID()}`, event_type: type, occurred_at: this.now(), task_id: record.input.binding.task_id, user_id: record.input.binding.user_id, binding: clone(record.input.binding), correlation_id: record.input.audit_context.correlation_id, contract_version: VERSION, ledger_id: record.ledger_id });
  }
  owner(taskId, actor) {
    const record = this.store.data.tasks?.[taskId];
    if (!record || record.kind !== "DAILY_CASHFLOW" || record.input.binding.user_id !== actor) throw fail("PERMISSION_DENIED", "任务不存在或无权访问。", "BLOCK", 403);
    return clone(record);
  }
  ledger(record, actor, expected) {
    const ledger = this.store.data.daily_ledgers?.[record.ledger_id];
    if (!ledger || ledger.user_id !== actor) throw fail("PERMISSION_DENIED", "账本不存在或无权访问。", "BLOCK", 403);
    if (expected !== undefined && ledger.revision !== expected) throw fail("DAILY_APPROVAL_STALE", "共享账本已变化，请加载当前余额重新检查。", "REVIEW", 409);
    return clone(ledger);
  }
  facts(record, ledger, accepted = [], preflight = false) {
    const input = record.input, s = ledger.snapshot, a = input.action;
    return { ...clone(s), snapshot: clone(s), action: clone(a), budget: clone(input.budget), emergency: clone(input.emergency), note: input.note || "",
      facts_confirmed: input.facts_confirmed, purposes_confirmed: input.purposes_confirmed,
      currency: "CNY", scope: preflight ? "PAPER_PREFLIGHT" : "ANALYSIS", as_of: s.as_of, evaluation_at: this.now(), cash_ledger_minor: s.cash_ledger_minor, cash_available_minor: s.cash_ledger_minor === null ? null : s.cash_ledger_minor - (ledger.holds || []).reduce((total, hold) => total + hold.amount_minor, 0),
      holds: clone(ledger.holds || []), ledger_revision: ledger.revision, versions_current: ledger.revision === record.input.binding.ledger_revision,
      task_id: record.input.binding.task_id, action_type: ({ INVESTMENT: "OPTIONAL_INVESTMENT", CONSUMPTION: "OPTIONAL_PAYMENT" })[a.type] || a.type, action_amount_minor: a.amount_minor, fees_minor: a.fees_minor, extra_nonoverlapping_hold_minor: 0, action_at: a.at,
      matched_purpose_id: a.matched_purpose_id || null, purpose_link: a.type === "PURPOSE_PAYMENT" && input.purposes_confirmed && s.purposes.some(p => p.purpose_id === a.matched_purpose_id) ? "VERIFIED_FOR_SETTLEMENT" : "UNVERIFIED_EXTERNAL_LABEL",
      hard_floor_state: s.hard_floor.state === "UNKNOWN" ? "UNSPECIFIED" : s.hard_floor.state, configured_hard_floor_minor: s.hard_floor.amount_minor,
      hard_floor_covered_by_purpose: s.hard_floor.covered_by_purpose_id || null, independent_hard_floor_minor: 0,
      required_evidence: input.facts_confirmed && input.purposes_confirmed ? "USER_CONFIRMED_SYNTHETIC" : "USER_CONFIRMATION_REQUIRED", required_services: "AVAILABLE",
      approval_state: record.approval.status === "CONFIRMED" ? "APPROVED" : ["REJECTED", "REVOKED"].includes(record.approval.status) ? record.approval.status : "PENDING", gateway_connected: true, audit_intent_writable: true, idempotency_state: "NEW",
      budget_reference_enabled: input.budget?.enabled === true && [input.budget.period_take_home_minor, input.budget.needs_minor, input.budget.goals_minor, input.budget.wants_minor].some(value => value != null), period_take_home_minor: input.budget?.period_take_home_minor ?? null,
      budget_buckets_minor: { needs: input.budget?.needs_minor ?? null, goals: input.budget?.goals_minor ?? null, wants: input.budget?.wants_minor ?? null }, ...(input.budget?.enabled !== true || input.budget?.category_remaining_minor === null || input.budget?.category_remaining_minor === undefined ? {} : { category_budget_remaining_minor: input.budget.category_remaining_minor }),
      emergency_target_enabled: input.emergency?.enabled === true, emergency_within_free_cash: true, emergency_allocation_before_minor: input.emergency?.allocation_minor ?? null, action_uses_emergency_allocation_minor: 0, monthly_essential_minor: input.emergency?.monthly_essential_minor ?? null, target_months: input.emergency?.target_months ?? null,
      soft_goal_acceptance_required: input.budget?.require_acceptance === true || input.emergency?.require_acceptance === true,
      soft_goal_acceptance_state: accepted.length ? "ACCEPTED_CURRENT_VERSION" : "PENDING", accepted_reason_ids: accepted, new_recheck_completed: accepted.length > 0,
      plan_depends_on_redeeming_other_asset: a.depends_on_redemption === true, latest_reliable_available_at: a.latest_reliable_available_at ?? null,
      external_note: input.note || "", external_note_authority: "UNTRUSTED_BUSINESS_DATA", proposed_tool: "PAPER_ANALYSIS" };
  }
  check(record, ledger, accepted = [], preflight = false) {
    let value;
    try { value = this.evaluate(this.facts(record, ledger, accepted, preflight), { now: this.now() }); }
    catch { throw fail("DAILY_CHECK_UNAVAILABLE", "必要日常风险计算失败，暂停此安排。", "ERROR", 503); }
    if (!value || !["ALLOW", "REVIEW", "BLOCK", "ERROR"].includes(value.decision) || !Array.isArray(value.reasons)) throw fail("DAILY_CHECK_UNAVAILABLE", "日常计算未返回有效四态结果。", "ERROR", 503);
    return { ...clone(value), contract_version: VERSION, risk_check_id: `daily-check-${randomUUID()}`, checked_at: this.now(), binding: clone(record.input.binding), policy_version: POLICY_VERSION };
  }
  binding(actor, taskId, ledger, payload, previous) {
    const plan = { action: payload.action, budget: payload.budget || null, emergency: payload.emergency || null };
    return { contract_version: VERSION, user_id: actor, task_id: taskId, request_id: previous?.request_id || `daily-request-${randomUUID()}`, run_id: previous?.run_id || `daily-run-${randomUUID()}`, audit_id: previous?.audit_id || `daily-audit-chain-${randomUUID()}`, handoff_id: previous?.handoff_id || `daily-handoff-${randomUUID()}`, session_id: null,
      ledger_id: ledger.ledger_id, ledger_revision: ledger.revision, plan_id: taskId, plan_version: `daily-plan-${randomUUID()}`, plan_hash: hash(plan), ledger_hash: hash({ snapshot: ledger.snapshot, holds: ledger.holds || [] }), constraints_version: hash({ purposes: ledger.snapshot.purposes, hard_floor: ledger.snapshot.hard_floor, confirmed: payload.purposes_confirmed }), profile_version: hash({ facts: payload.facts_confirmed, purposes: payload.purposes_confirmed }), policy_version: POLICY_VERSION, rules_version: POLICY_VERSION };
  }
  create(actor, raw, { reportedHoldMinor = 0 } = {}) {
    const payload = parse(raw); if (payload.task_id !== undefined) throw fail("DAILY_INVALID_INPUT", "创建任务不能指定旧任务编号。");
    if (Object.values(this.store.data.tasks).filter(task => task.kind === "DAILY_CASHFLOW" && task.input.binding.user_id === actor).length >= 30) throw fail("DEMO_TASK_LIMIT", "此会话已达到30个日常演示任务上限。", "REVIEW", 429);
    let ledger;
    if (payload.ledger_id) {
      ledger = this.ledger({ ledger_id: payload.ledger_id }, actor, payload.expected_ledger_revision);
      if (payload.snapshot && !equal(payload.snapshot, ledger.snapshot)) throw fail("DAILY_LEDGER_CHANGED", "旧表单不能覆盖当前账本；请显式修订资金事实。", "REVIEW", 409);
    } else {
      if (!payload.snapshot) throw fail("DAILY_DATA_REQUIRED", "新建账本需要完整资金事实。");
      ledger = { ledger_id: `daily-ledger-${randomUUID()}`, user_id: actor, revision: 1, snapshot: payload.snapshot, holds: reportedHolds(reportedHoldMinor), created_at: this.now() };
    }
    const taskId = `daily-task-${randomUUID()}`, approval = emptyApproval();
    const record = { kind: "DAILY_CASHFLOW", contract_version: VERSION, mode: "SYNTHETIC_PAPER_ONLY", ledger_id: ledger.ledger_id, ledger_revision: ledger.revision,
      input: { binding: this.binding(actor, taskId, ledger, payload), snapshot: clone(ledger.snapshot), action: clone(payload.action), facts_confirmed: payload.facts_confirmed, purposes_confirmed: payload.purposes_confirmed, budget: payload.budget || null, emergency: payload.emergency || null, note: payload.note || "", approval, audit_context: { correlation_id: taskId }, data_mode: "SYNTHETIC_REPLAY", execution_mode: "PAPER" },
      approval: clone(approval), execution: { status: "NOT_STARTED", execution_allowed: false, receipt: null }, review: null, review_history: [], execution_allowed: false, trusted_memory: false };
    record.review = this.check(record, ledger);
    this.event("DAILY_TASK_CREATED", record, { review: record.review, snapshot_digest: hash(ledger.snapshot), data_authority: "DEMO_USER_INPUT_NOT_TRUSTED_MEMORY" });
    this.store.transaction(data => { data.daily_ledgers ||= {}; data.daily_ledgers[ledger.ledger_id] = ledger; data.tasks[taskId] = record; return null; });
    return this.inspect(taskId, actor);
  }
  inspect(taskId, actor) {
    const record = this.owner(taskId, actor), ledger = this.ledger(record, actor);
    record.current_ledger = clone(ledger); record.ledger_revision = ledger.revision;
    record.ledger_stale = ledger.revision !== record.input.binding.ledger_revision;
    const source = record.long_text_source?.binding;
    const row = source ? this.store.data.long_text_drafts?.[source.draft_id] : null;
    record.source_stale = Boolean(source && (!row || row.owner !== actor || row.expires <= Date.parse(this.now()) || !row.draft.confirmation || row.draft.revision !== source.revision || row.draft.interpretation_sha256 !== source.interpretation_sha256));
    if (record.ledger_stale && record.execution.status === "NOT_STARTED" && record.approval.status === "CONFIRMED") { record.approval.status = "INVALIDATED"; record.input.approval.status = "INVALIDATED"; }
    return record;
  }
  revise(taskId, actor, raw, { sourceBinding = null, reportedHoldMinor } = {}) {
    const old = this.owner(taskId, actor), payload = parse(raw);
    if (old.long_text_source) {
      const row = this.store.data.long_text_drafts?.[old.long_text_source.binding.draft_id];
      if (!row || row.owner !== actor || !row.draft.confirmation || !equal(sourceBinding, { draft_id: row.draft.draft_id, revision: row.draft.revision, interpretation_sha256: row.draft.interpretation_sha256 })) throw fail("LONG_TEXT_REVISION_REQUIRED", "长文本任务请从原文入口重新核对，不能用普通表单替换来源。", "REVIEW", 409);
    }
    if ((payload.task_id !== undefined && payload.task_id !== taskId) || payload.ledger_id !== old.ledger_id) throw fail("DAILY_LEDGER_REFERENCE_REQUIRED", "修订必须引用本任务当前账本。");
    if (this.busy.has(old.ledger_id) || old.execution.status !== "NOT_STARTED") throw fail("DAILY_TASK_ALREADY_ATTEMPTED", "已启动或已完成的计划不回灌旧表单；请用当前账本创建新任务。", "REVIEW", 409);
    const ledger = this.ledger(old, actor, payload.expected_ledger_revision);
    const nextHolds = reportedHoldMinor === undefined ? ledger.holds : [...ledger.holds.filter(h => h.hold_id !== "long-text-reported"), ...reportedHolds(reportedHoldMinor)];
    const changed = payload.snapshot && !equal(payload.snapshot, ledger.snapshot) || !equal(nextHolds, ledger.holds);
    if (changed) { if (payload.snapshot) ledger.snapshot = payload.snapshot; ledger.holds = nextHolds; ledger.revision += 1; }
    const record = clone(old), approval = { ...emptyApproval(), status: "INVALIDATED" };
    if (record.model_review) { record.model_review_history ||= []; record.model_review_history.push(record.model_review); delete record.model_review; }
    record.input = { ...record.input, binding: this.binding(actor, taskId, ledger, payload, old.input.binding), snapshot: clone(ledger.snapshot), action: payload.action, facts_confirmed: payload.facts_confirmed, purposes_confirmed: payload.purposes_confirmed, budget: payload.budget || null, emergency: payload.emergency || null, note: payload.note || "", approval };
    record.approval = clone(approval); record.ledger_revision = ledger.revision;
    record.review_history.push(old.review); record.review = this.check(record, ledger);
    this.event("DAILY_PLAN_REVISED", record, { prior_binding: old.input.binding, review: record.review, ledger_changed: Boolean(changed) });
    this.store.transaction(data => { data.daily_ledgers[ledger.ledger_id] = ledger; data.tasks[taskId] = record;
      if (changed) for (const task of Object.values(data.tasks)) if (task.kind === "DAILY_CASHFLOW" && task.ledger_id === ledger.ledger_id && task.input.binding.task_id !== taskId && task.approval.status === "CONFIRMED") { task.approval.status = "INVALIDATED"; task.input.approval.status = "INVALIDATED"; }
      return null; });
    return this.inspect(taskId, actor);
  }
  confirm(taskId, actor, payload) {
    if (this.inspect(taskId, actor).source_stale) throw fail("LONG_TEXT_SOURCE_STALE", "长文本已修改或核对已过期，请回到长文本入口重新核对并提交。", "REVIEW", 409);
    only(payload, ["task_id", "risk_check_id", "binding", "accepted_reason_ids", "confirmed"], "确认请求");
    const record = this.owner(taskId, actor), ledger = this.ledger(record, actor, record.input.binding.ledger_revision);
    if (this.busy.has(record.ledger_id) || record.execution.status !== "NOT_STARTED") throw fail("DAILY_TASK_ALREADY_ATTEMPTED", "此计划已经启动，不能重新确认。", "REVIEW", 409);
    if (payload.confirmed !== true || !Array.isArray(payload.accepted_reason_ids) || payload.accepted_reason_ids.some(value => typeof value !== "string")) throw fail("EXPLICIT_CONFIRMATION_REQUIRED", "请明确确认完整计划并逐项选择需接受的风险。", "REVIEW", 409);
    if (payload.risk_check_id !== record.review.risk_check_id || !equal(payload.binding, record.input.binding)) throw fail("DAILY_APPROVAL_STALE", "方案、账本或检查版本变化，请重新检查确认。", "REVIEW", 409);
    if (["BLOCK", "ERROR"].includes(record.review.decision) || record.review.reasons.some(reason => !reason.acceptance_allowed)) throw fail("RISK_NOT_ACCEPTABLE", "硬冲突或待修复事项不能通过勾选放行。", "BLOCK", 409);
    const required = record.review.reasons.map(reason => reason.reason_id).sort();
    if (!equal([...new Set(payload.accepted_reason_ids)].sort(), required)) throw fail("RISK_ACCEPTANCE_REQUIRED", "只能接受当前检查列出的全部可接受风险。", "REVIEW", 409);
    const fresh = this.check(record, ledger, required);
    if (fresh.decision !== "ALLOW") throw fail("DAILY_APPROVAL_STALE", "确认时重新检查发现变化或缺项，请先修复。", "REVIEW", 409);
    const approval = { status: "CONFIRMED", approval_id: `daily-approval-${randomUUID()}`, confirmed_by: actor, confirmed_at: this.now(), expires_at: new Date(Date.parse(this.now()) + this.approvalTtlMs).toISOString(), risk_check_id: fresh.risk_check_id, binding: clone(record.input.binding), accepted_risks: required.map(reason_id => ({ reason_id, risk_check_id: record.review.risk_check_id, user_id: actor, binding: clone(record.input.binding), accepted_at: this.now() })), authority: "LOCAL_SYNTHETIC_SESSION_ONLY" };
    this.event("DAILY_PLAN_CONFIRMED", record, { approval, recheck: fresh, original_review_preserved: true });
    this.store.transaction(data => { const task = data.tasks[taskId]; task.approval = approval; task.input.approval = clone(approval); task.confirmation_recheck = fresh; task.review_history.push(clone(record.review)); task.review = fresh; return null; });
    return clone(approval);
  }
  reject(taskId, actor, revoke = false) {
    const record = this.owner(taskId, actor);
    if (this.busy.has(record.ledger_id) || record.execution.status !== "NOT_STARTED") throw fail("ALREADY_RUNNING", "此计划已经启动，不能将已完成动作声称为撤回。", "REVIEW", 409);
    const approval = { ...emptyApproval(), status: revoke ? "REVOKED" : "REJECTED" };
    this.event(revoke ? "DAILY_PLAN_REVOKED" : "DAILY_PLAN_REJECTED", record, { approval });
    this.store.transaction(data => { data.tasks[taskId].approval = approval; data.tasks[taskId].input.approval = clone(approval); return null; });
    return clone(approval);
  }
  async execute(taskId, actor, key) {
    const record = this.owner(taskId, actor);
    if (typeof key !== "string" || key.length < 8 || key.length > 128) throw fail("IDEMPOTENCY_KEY_REQUIRED", "执行标识须为8到128字符。", "BLOCK", 409);
    const scope = `${actor}:${key}`, contentHash = hash(record.input.binding), prior = this.store.data.executions[scope];
    if (prior) {
      if (prior.content_hash !== contentHash) throw fail("IDEMPOTENCY_CONTENT_CONFLICT", "此执行标识已绑定其他内容。", "BLOCK", 409);
      this.event("DAILY_DUPLICATE_REQUEST", record, { execution_id: prior.execution_id, status: prior.status });
      return { ...clone(prior), replay: true };
    }
    const same = Object.values(this.store.data.executions).find(entry => entry.content_hash === contentHash && entry.user_id === actor);
    if (same) { this.event("DAILY_DUPLICATE_REQUEST", record, { execution_id: same.execution_id, status: same.status }); return { ...clone(same), replay: true }; }
    if (this.inspect(taskId, actor).source_stale) throw fail("LONG_TEXT_SOURCE_STALE", "长文本已修改或核对已过期，旧计划不能执行。", "REVIEW", 409);
    if (this.busy.has(record.ledger_id)) throw fail("SHARED_FUNDS_BUSY", "同一资金池正在核验执行，请稍后加载当前账本。", "REVIEW", 409);
    this.busy.add(record.ledger_id);
    let execution, committed = false;
    try {
      const ledger = this.ledger(record, actor, record.input.binding.ledger_revision), approval = record.approval;
      if (["REJECTED", "REVOKED"].includes(approval.status)) throw fail("APPROVAL_REJECTED", "用户已拒绝或撤回此计划。", "BLOCK", 409);
      if (approval.status !== "CONFIRMED") throw fail("APPROVAL_REQUIRED", "风险检查通过仍需确认完整计划。", "REVIEW", 409);
      if (!equal(approval.binding, record.input.binding) || Date.parse(approval.expires_at) <= Date.parse(this.now())) throw fail("DAILY_APPROVAL_STALE", "确认已过期或方案发生变化，请重新确认。", "REVIEW", 409);
      const accepted = approval.accepted_risks.map(item => item.reason_id), fresh = this.check(record, ledger, accepted, true);
      if (fresh.decision !== "ALLOW" || fresh.preflight_eligible !== true) throw fail("RISK_NOT_ACCEPTABLE", "执行前检查未通过，不能继续。", fresh.decision === "ERROR" ? "ERROR" : "BLOCK", 409);
      const a = record.input.action;
      // Date-only inputs use the same Beijing calendar day as the long-text UI.
      const actionTime = a.at?.length === 10 ? Date.parse(a.at + "T00:00:00+08:00") : Date.parse(a.at);
      if (!Number.isSafeInteger(a.amount_minor) || !Number.isSafeInteger(a.fees_minor) || a.at === null || actionTime > Date.parse(this.now())) throw fail("FUTURE_PLAN_NOT_EXECUTABLE_NOW", "未来安排或未知金额只可分析，不能计作今天已执行。", "REVIEW", 409);
      const pending = Object.values(this.store.data.executions).find(entry => entry.ledger_id === record.ledger_id && ["RUNNING", "UNKNOWN"].includes(entry.status));
      if (pending) throw fail("EXECUTION_STATUS_UNKNOWN", "同资金池有待核查执行，不能开启第二次资金安排。", "REVIEW", 409);
      execution = { execution_id: `daily-execution-${randomUUID()}`, task_id: taskId, ledger_id: record.ledger_id, user_id: actor, content_hash: contentHash, idempotency_key: key, status: "RUNNING", execution_allowed: false, side_effects: false, mode: "SYNTHETIC_PAPER_ONLY", started_at: this.now(), result: null };
      this.event("DAILY_EXECUTION_INTENT", record, { execution, recheck: fresh });
      this.store.transaction(data => { data.executions[scope] = execution; data.tasks[taskId].execution = clone(execution); return null; });
      await this.beforeExecute(record, execution);
      const current = this.owner(taskId, actor), latest = this.ledger(current, actor, ledger.revision);
      if (this.inspect(taskId, actor).source_stale) throw fail("LONG_TEXT_SOURCE_STALE", "持久化核验期间长文本发生变化或核对已过期。", "REVIEW", 409);
      if (!equal(current.input.binding, record.input.binding) || !equal(current.approval, approval) || Date.parse(approval.expires_at) <= Date.parse(this.now())) throw fail("DAILY_APPROVAL_STALE", "持久化核验期间计划或确认发生变化。", "REVIEW", 409);
      const payment = a.type === "PURPOSE_PAYMENT" ? latest.snapshot.purposes.find(purpose => purpose.purpose_id === a.matched_purpose_id) : null;
      const projection = fresh.projected_state;
      if (!projection || !Number.isSafeInteger(projection.cash_ledger_minor) || !Array.isArray(projection.holds) || !Array.isArray(projection.purposes)) throw fail("DAILY_CHECK_UNAVAILABLE", "缺少可核验的沙箱账本投影。", "ERROR", 503);
      const next = { ...clone(latest.snapshot), cash_ledger_minor: projection.cash_ledger_minor, purposes: clone(projection.purposes) };
      const holds = clone(projection.holds).map(hold => hold.task_id === taskId ? { ...hold, hold_id: `daily-hold-${randomUUID()}` } : hold);
      const receipt = { receipt_id: `daily-receipt-${randomUUID()}`, execution_id: execution.execution_id, task_id: taskId, plan_hash: record.input.binding.plan_hash, ledger_id: record.ledger_id, ledger_revision_before: ledger.revision, ledger_revision_after: ledger.revision + 1, amount_minor: a.amount_minor, fees_minor: a.fees_minor, cash_before_minor: ledger.snapshot.cash_ledger_minor, cash_after_minor: next.cash_ledger_minor, available_after_minor: projection.cash_available_minor, holds_after_minor: holds.reduce((total, hold) => total + hold.amount_minor, 0), matched_purpose_id: payment?.purpose_id || null, mode: "SYNTHETIC_PAPER_ONLY", side_effects: false, occurred_at: this.now() };
      execution = { ...execution, status: "SUCCEEDED", completed_at: this.now(), result: { status: "SUCCEEDED", receipt }, receipt };
      this.store.transaction(data => { const l = data.daily_ledgers[record.ledger_id]; if (l.revision !== ledger.revision) throw fail("SHARED_FUNDS_CONFLICT", "资金池版本变化，停止本次记账。", "REVIEW", 409); l.snapshot = next; l.holds = holds; l.revision += 1; data.executions[scope] = execution; data.tasks[taskId].execution = clone(execution);
        for (const task of Object.values(data.tasks)) if (task.kind === "DAILY_CASHFLOW" && task.ledger_id === record.ledger_id && task.input.binding.task_id !== taskId && task.approval.status === "CONFIRMED") { task.approval.status = "INVALIDATED"; task.input.approval.status = "INVALIDATED"; }
        return null; });
      committed = true;
      this.event("DAILY_EXECUTION_SUCCEEDED", record, { execution, original_review: record.review.decision, preflight_recheck: fresh });
      await this.beforeExecute(record, execution);
      return { ...clone(execution), risk: fresh, replay: false };
    } catch (error) {
      if (execution) {
        const status = committed ? "UNKNOWN" : "ABORTED", code = committed ? "AUDIT_WRITE_FAILED" : error.code || "AUDIT_WRITE_FAILED";
        const failed = { ...execution, status, decision: "ERROR", code, execution_allowed: false, message_zh: committed ? "沙箱记账回执已保留，但结果审计或持久化待核查；不能再次扣款。" : "必要检查或持久化失败，未进行沙箱扣款。" };
        try { this.store.transaction(data => { data.executions[scope] = failed; data.tasks[taskId].execution = clone(failed); return null; }); } catch { /* Retain the durable intent for reconciliation. */ }
        try { this.event(committed ? "DAILY_EXECUTION_UNKNOWN" : "DAILY_EXECUTION_ABORTED", record, { execution: failed }); } catch { /* Never fabricate a successful audit. */ }
        return clone(failed);
      }
      try { this.event("DAILY_EXECUTION_HELD", record, { code: error.code || "DAILY_CHECK_UNAVAILABLE", decision: error.decision || "ERROR" }); } catch { /* A failed audit must not permit dispatch. */ }
      if (error instanceof GatewayError) throw error;
      throw fail("AUDIT_WRITE_FAILED", "必要审计失败，操作暂停。", "ERROR", 503);
    } finally { this.busy.delete(record.ledger_id); }
  }
}
module.exports = { DailyGateway, VERSION };
