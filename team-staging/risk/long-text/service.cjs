"use strict";

const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { parse, minor, isoDay, plusDays, plusMonths, hash, fail, TYPES } = require("./parser.cjs");
const { evaluateDaily, describePolicy } = require("./vendor/daily-engine.cjs");
const { normalizeReviewInput } = require("../../../chenchen/integrations/model-review");
const provenance = require("./vendor/provenance.json");
const clone = structuredClone;
const object = x => x && typeof x === "object" && !Array.isArray(x);
function only(value, fields, name) {
  if (!object(value) || Object.keys(value).some(k => !fields.includes(k))) fail("INVALID_FIELDS", `${name}包含不支持的字段`);
}
function binding(draft) { return { draft_id: draft.draft_id, revision: draft.revision, interpretation_sha256: draft.interpretation_sha256 }; }
function missing(draft) {
  const result = [];
  const add = (field, message, item_id = null) => result.push({ field, message, item_id });
  for (const [field, label] of Object.entries({ cash_minor: "当前账面现金", hard_floor_minor: "独立现金保底（明确不设置时填0）", existing_holds_minor: "已有任务冻结或占用（没有则明确填0）", fees_minor: "本次投资合计费用（确认无费用时填0）" })) {
    if (draft.profile[field] === null) add(field, `请确认${label}`);
  }
  for (const item of draft.items) {
    if (item.disposition === "UNRESOLVED") { add("disposition", "请确认这是待安排事项、已完成事项、条件假设还是更正", item.id); continue; }
    if (item.disposition === "EXCLUDE") {
      if (!item.exclusion_reason.trim()) add("exclusion_reason", "请说明不计入测算的原因", item.id);
      continue;
    }
    if (item.requires_split) { add("source_text", "本句包含多个资金用途，请在原文拆成独立事项后重新解析；不能只填写一个金额", item.id); continue; }
    if (item.type === "OTHER" || item.type === "ASSET") { add("type", "请明确事项类型，或说明排除原因", item.id); continue; }
    if (["CASH", "RESERVE"].includes(item.type)) continue;
    if (item.amount_minor === null || item.issues.length) add("amount_minor", item.issues.length ? item.issues.join("；") : item.amount_basis === "REMAINING" ? "已识别为使用余款投资，请在预留生活与旅游预算后明确投资金额" : "请补齐本事项的明确人民币金额", item.id);
    if (item.due_date === null) add("due_date", "请补齐具体日期，不能把下月或近期默认为某一天", item.id);
    else if (item.due_date < draft.as_of) add("due_date", "日期早于分析日，请核对是否已支付或仍逾期待付", item.id);
    else if (item.due_date > draft.through) add("horizon_days", "事项超出测算区间，请扩大区间或明确另行预留后排除", item.id);
    if (item.certainty === "UNCERTAIN" && item.type !== "INCOME") add("certainty", "请核对该条件支出是否要纳入本次计划", item.id);
    if (item.type === "INVESTMENT" && item.recurrence !== "ONCE") add("recurrence", "定投请按本测算区间内计划总额填写为一次占用，或逐笔写入原文", item.id);
  }
  return result;
}
function occurrences(item, through) {
  const out = [];
  let current = item.due_date, i = 0;
  while (current && current <= through) {
    if (out.length >= 200) fail("TOO_MANY_EVENTS", "周期展开超过200笔，请缩短测算区间");
    out.push({ ...item, occurrence_id: `${item.id}-${i}`, at: current });
    if (item.recurrence === "ONCE") break;
    i++;
    current = item.recurrence === "MONTHLY" ? plusMonths(item.due_date, i, item.anchor_day)
      : plusDays(item.due_date, i * (item.recurrence === "WEEKLY" ? 7 : 1));
  }
  return out;
}
function addMoney(values) {
  const total = values.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(total)) fail("AMOUNT_OVERFLOW", "金额合计超出精确计算范围");
  return total;
}
const EXPENSE_LABELS = { STUDY: "留学／教育", TRANSPORT: "机票／交通", LIVING: "生活费", HOUSING: "房租／住宿", TRAVEL: "旅游", OTHER: "其他支出" };
function planningPreview(draft) {
  // A partial budget is useful before payment dates are known. It never replaces
  // confirmation or supplies missing amounts to the authoritative risk engine.
  const included = draft.items.filter(x => x.disposition === "INCLUDE");
  const expenses = included.filter(x => x.type === "EXPENSE");
  const rows = expenses.map(item => {
    let range = item.amount_minor !== null && !item.issues.length ? { min: item.amount_minor, max: item.amount_minor }
      : item.issues.length === 1 && item.issues[0] === "金额有范围或估计，请确认用于测算的金额" ? item.amount_range_minor || null : null;
    if (item.requires_split) range = null;
    let count = 1;
    if (item.recurrence !== "ONCE") {
      if (!item.due_date || item.due_date < draft.as_of || item.due_date > draft.through) { range = null; count = null; }
      else {
        try { count = occurrences(item, draft.through).length; } catch { range = null; count = null; }
      }
    }
    if (range && count !== null) range = { min: range.min * count, max: range.max * count };
    return { item_id: item.id, label: EXPENSE_LABELS[item.expense_category] || "生活支出", text: item.text, range_minor: range, occurrence_count: count };
  });
  const known = rows.filter(x => x.range_minor);
  const total = known.length ? { min: addMoney(known.map(x => x.range_minor.min)), max: addMoney(known.map(x => x.range_minor.max)) } : null;
  const cash = draft.profile.cash_minor;
  const remaining = cash !== null && total ? { min: cash - total.max, max: cash - total.min } : null;
  const investments = included.filter(x => x.type === "INVESTMENT");
  const needs = [];
  for (const row of rows.filter(x => !x.range_minor)) needs.push(`${row.label}尚缺${row.occurrence_count === null ? "周期起始日期" : "预算金额"}，暂未计入合计。`);
  if (expenses.some(x => x.expense_category === "STUDY") && expenses.some(x => ["LIVING", "TRANSPORT"].includes(x.expense_category))) needs.push("请确认留学费用是否已包含生活费或机票；概览暂按各项独立相加，避免确认时重复预留。");
  if (investments.some(x => x.amount_minor === null && (x.amount_basis === "REMAINING" || x.allocation_intent === "ALL_IN"))) needs.push("“剩余资金／all in”已识别为投资意向；先确定旅游、独立保底和费用，再填写投资总额及各方向分配，同一笔余款不会重复计算。");
  else if (investments.some(x => x.amount_minor === null)) needs.push("投资方向已记录，请补充各笔投资金额；未填写的金额不会按零处理。");
  const annual = /(?:留学|出国)[^。！？；\n]{0,30}(?:一年|1\s*年)|(?:一年|1\s*年)[^。！？；\n]{0,20}(?:留学|生活费)/u.test(draft.source_text);
  if (annual && draft.horizon_days < 365) needs.push(`原文涉及一年安排，当前逐日测算区间是${draft.horizon_days}天；可切换365天后重新解析。年度总额不会自动当作每月金额。`);
  const unresolved = draft.items.filter(x => x.disposition === "UNRESOLVED" && !x.context_kind);
  if (unresolved.length) needs.push(`另有${unresolved.length}条资金事项待核对，尚未纳入预算合计。`);
  return { scope: "UNCONFIRMED_PARTIAL_BUDGET", cash_minor: cash, expense_rows: rows, known_expense_range_minor: total,
    remaining_after_known_expenses_minor: remaining, unknown_expense_ids: rows.filter(x => !x.range_minor).map(x => x.item_id),
    investment_items: investments.map(x => ({ item_id: x.id, text: x.text, amount_minor: x.amount_minor, amount_basis: x.amount_basis })),
    suggested_horizon_days: annual ? 365 : null, next_steps: needs,
    assumptions: ["金额区间保留上下限；未选择前不会变成确认金额。", "剩余区间只扣除上列已知支出，尚未扣除未知旅游预算、独立保底、已有占用、投资和费用。", "概览不要求先填付款日期；逐日测算与在线复核仍需确认金额、日期及是否重复。"],
    execution_allowed: false, risk_approval_granted: false };
}
function evaluate(draft) {
  const questions = missing(draft);
  const base = { result_version: "long-text-risk.result.v1", source_binding: binding(draft),
    data_mode: draft.data_mode, account_verified: false, policy_source: provenance.commit,
    execution_allowed: false, risk_approval_granted: false, memory_write_performed: false,
    calculation_scope: "USER_CONFIRMED_SYNTHETIC_ANALYSIS", questions };
  if (!draft.confirmation || questions.length) return { ...base, status: "NEEDS_CLARIFICATION", decision: "REVIEW", risk_level: "unknown", metrics: null, review: null,
    summary: "先核对原文与资金事实；缺失信息不会按零处理。" };
  const selected = draft.items.filter(x => x.disposition === "INCLUDE");
  const expenses = selected.filter(x => x.type === "EXPENSE").flatMap(x => occurrences(x, draft.through));
  const incomes = selected.filter(x => x.type === "INCOME" && x.certainty === "EXPECTED").flatMap(x => occurrences(x, draft.through));
  if (expenses.length > 200 || incomes.length > 200) fail("TOO_MANY_EVENTS", "收支展开后分别最多200笔，请缩短区间");
  const investments = selected.filter(x => x.type === "INVESTMENT");
  const total = addMoney(investments.map(x => x.amount_minor));
  const p = draft.profile;
  // Sum requested investments into a conservative current reservation, explicitly
  // disclosed by the UI. No return, redemption or unposted income funds it.
  const facts = {
    currency: "CNY", amount_unit: "MINOR", scope: "ANALYSIS", as_of: draft.as_of,
    cash_ledger_minor: p.cash_minor, cash_available_minor: p.cash_minor - p.existing_holds_minor,
    holds: p.existing_holds_minor ? [{ hold_id: "existing-tasks", amount_minor: p.existing_holds_minor, settlement_link: "VERIFIED", covered_reserved_minor: 0 }] : [],
    purposes: expenses.map(x => ({ purpose_id: x.occurrence_id, label: x.text.slice(0, 120), reserved_now_minor: x.amount_minor, remaining_due_minor: x.amount_minor, due_at: x.at, confirmed: true })),
    income_events: incomes.map(x => ({ event_id: x.occurrence_id, amount_minor: x.amount_minor, status: "EXPECTED", at: x.at, included_in_balance: false, time_precision: "DAY" })),
    action_type: investments.length ? "OPTIONAL_INVESTMENT" : "ANALYSIS_ONLY", action_amount_minor: total,
    fees_minor: investments.length ? p.fees_minor : 0, extra_nonoverlapping_hold_minor: 0, action_at: draft.as_of,
    hard_floor_state: p.hard_floor_minor ? "ENABLED_CONFIRMED" : "DISABLED_CONFIRMED", configured_hard_floor_minor: p.hard_floor_minor,
    required_evidence: "USER_CONFIRMED_SYNTHETIC", required_services: "AVAILABLE", ledger_revision: draft.revision,
    approval_state: "PENDING", versions_current: true, permission_granted: true, proposed_tool: "PAPER_ANALYSIS",
    gateway_connected: false, audit_intent_writable: false, idempotency_state: "NEW", stress_assumption: { salary_delay_days: 7 }
  };
  const review = evaluateDaily(facts, { now: draft.created_at });
  // The opening cash includes income already received. Only future dated income
  // reaches the engine; same-day income must be reconciled into the opening cash.
  const riskLevel = review.decision === "BLOCK" ? "high" : review.decision === "ERROR" ? "unknown"
    : review.decision === "REVIEW" || review.warnings.length ? "medium" : "low";
  const status = review.decision === "ERROR" ? "EVALUATION_ERROR" : "ANALYZED";
  return { ...base, status, decision: review.decision, risk_level: riskLevel, review,
    metrics: { ...review.metrics, requested_investment_minor: total, expense_total_minor: addMoney(expenses.map(x => x.amount_minor)),
      expected_income_minor: addMoney(incomes.map(x => x.amount_minor)), horizon_days: draft.horizon_days,
      protected_reserve_minor: p.hard_floor_minor, existing_holds_minor: p.existing_holds_minor },
    scheduled_expenses: expenses.map(x => ({ item_id: x.id, amount_minor: x.amount_minor, due_date: x.at })),
    excluded_items: draft.items.filter(x => x.disposition === "EXCLUDE").map(x => ({ id: x.id, reason: x.exclusion_reason })),
    uncertain_income_excluded: selected.filter(x => x.type === "INCOME" && x.certainty === "UNCERTAIN").map(x => x.id),
    assumptions: ["仅对已核对的虚构场景计算，不证明真实余额或授予执行权。", "投资计划合计按分析日一次性占用测算，未来工资不增加今天可用现金。", "区间内生活支出按全额保护；独立保底和已有占用须确认互不重叠。", "同日收付只有日期，按不利顺序检查；周期按所选区间展开，月末缺少对应日时取该月最后一天。", "工资延迟七天只是压力假设，不代表预测或发生概率。"],
    summary: ({ BLOCK: "这笔投资安排会影响已保护的生活资金，先调整金额或用款计划。", REVIEW: "存在待核实事项，请查看原因后补充信息。", ERROR: "风险计算未完成，当前结果不能用于继续安排。", ALLOW: "本次已确认输入未触发硬性资金冲突；仍需核对账户、后续支出与正式审批。" })[review.decision] };
}

class Sessions {
  constructor({ now = () => new Date(), ttlMs = 30 * 60 * 1000, capacity = 128 } = {}) {
    this.now = now; this.ttlMs = ttlMs; this.capacity = capacity; this.sessions = new Map();
  }
  prune() { for (const [id, row] of this.sessions) if (row.expires <= this.now().getTime()) this.sessions.delete(id); }
  output(draft) { return clone({ ...draft, planning_preview: planningPreview(draft), questions: missing(draft) }); }
  create(owner, input) {
    only(input, ["text", "data_mode", "as_of", "horizon_days", "channel", "is_final"], "输入");
    this.prune(); if (this.sessions.size >= this.capacity) fail("CAPACITY", "草稿已满，请稍后重试", 429);
    const draft = { ...parse(input, this.now), draft_id: "long-" + randomUUID(), revision: 1,
      created_at: this.now().toISOString(), confirmation: null, audit: [], result: null };
    draft.audit.push({ event: "DRAFT_CREATED", at: this.now().toISOString(), revision: 1, interpretation_sha256: draft.interpretation_sha256 });
    this.sessions.set(draft.draft_id, { owner, draft, expires: this.now().getTime() + this.ttlMs });
    return this.output(draft);
  }
  match(owner, input) {
    this.prune(); const row = this.sessions.get(input?.draft_id);
    if (!row || row.owner !== owner) fail("NOT_FOUND", "草稿不存在、已过期或不属于当前会话", 404);
    if (input.revision !== row.draft.revision || input.interpretation_sha256 !== row.draft.interpretation_sha256) fail("STALE_DRAFT", "输入已变化，请使用最新版本重新核对", 409);
    return row;
  }
  changed(row, draft, event) {
    draft.revision = row.draft.revision + 1; draft.confirmation = null; draft.result = null; draft.planning_review = null;
    draft.interpretation_sha256 = hash({ source: draft.source_text, items: draft.items, profile: draft.profile, as_of: draft.as_of, horizon: draft.horizon_days, revision: draft.revision });
    draft.audit = [...row.draft.audit, { event, at: this.now().toISOString(), revision: draft.revision, interpretation_sha256: draft.interpretation_sha256 }];
    row.draft = draft; return this.output(draft);
  }
  revise(owner, input) {
    only(input, ["draft_id", "revision", "interpretation_sha256", "text", "as_of", "horizon_days"], "修订");
    const row = this.match(owner, input);
    const parsed = parse({ text: input.text, as_of: input.as_of, horizon_days: input.horizon_days, data_mode: row.draft.data_mode }, this.now);
    return this.changed(row, { ...row.draft, ...parsed }, "TEXT_REVISED");
  }
  correct(owner, input) {
    only(input, ["draft_id", "revision", "interpretation_sha256", "items", "profile"], "纠错");
    const row = this.match(owner, input), draft = clone(row.draft);
    if (!Array.isArray(input.items) || input.items.length > 100) fail("INVALID_ITEMS", "纠错事项列表无效");
    const seen = new Set();
    for (const patch of input.items) {
      only(patch, ["id", "type", "amount_minor", "due_date", "recurrence", "certainty", "disposition", "exclusion_reason"], "事项");
      const target = draft.items.find(x => x.id === patch.id);
      if (!target || seen.has(patch.id)) fail("INVALID_ITEM", "事项编号不存在或重复");
      seen.add(patch.id);
      if (patch.type !== undefined && !TYPES.includes(patch.type)) fail("INVALID_TYPE", "事项类型无效");
      if (patch.amount_minor !== undefined) minor(patch.amount_minor);
      if (patch.due_date !== undefined) isoDay(patch.due_date, "事项日期", true);
      if (patch.recurrence !== undefined && !["ONCE", "MONTHLY", "WEEKLY", "DAILY"].includes(patch.recurrence)) fail("INVALID_RECURRENCE", "周期无效");
      if (patch.certainty !== undefined && !["EXPECTED", "UNCERTAIN"].includes(patch.certainty)) fail("INVALID_CERTAINTY", "确定性状态无效");
      if (patch.disposition !== undefined && !["INCLUDE", "EXCLUDE", "UNRESOLVED"].includes(patch.disposition)) fail("INVALID_DISPOSITION", "处理方式无效");
      if (patch.exclusion_reason !== undefined && (typeof patch.exclusion_reason !== "string" || patch.exclusion_reason.length > 240)) fail("INVALID_REASON", "排除原因最多240字");
      const changed = Object.entries(patch).some(([k, v]) => !isDeepStrictEqual(target[k], v));
      const dateChanged = patch.due_date !== undefined && patch.due_date !== target.due_date;
      Object.assign(target, patch);
      if (patch.amount_minor !== undefined && patch.amount_minor !== null) target.issues = [];
      if (dateChanged) target.anchor_day = patch.due_date ? Number(patch.due_date.slice(-2)) : null;
      if (changed) target.corrected = true;
    }
    if (input.profile !== undefined) {
      only(input.profile, Object.keys(draft.profile), "资金事实");
      for (const [k, v] of Object.entries(input.profile)) draft.profile[k] = minor(v, k);
    }
    if (isDeepStrictEqual(row.draft, draft)) return this.output(row.draft);
    return this.changed(row, draft, "FACTS_CORRECTED");
  }
  confirm(owner, input) {
    only(input, ["draft_id", "revision", "interpretation_sha256", "reviewed_item_ids", "confirmed", "nonoverlap_confirmed"], "确认");
    const { draft } = this.match(owner, input);
    const ids = draft.items.map(x => x.id).sort();
    if (input.confirmed !== true || input.nonoverlap_confirmed !== true || !Array.isArray(input.reviewed_item_ids) ||
      !isDeepStrictEqual([...input.reviewed_item_ids].sort(), ids)) fail("CONFIRMATION_REQUIRED", "请逐项核对，并确认现金保底、生活支出和已有占用没有重复计算");
    const questions = missing(draft);
    if (questions.length) fail("MISSING_INFORMATION", questions[0].message);
    if (draft.confirmation) return this.output(draft);
    const confirmation = { receipt_id: "checked-" + randomUUID(), at: this.now().toISOString(), scope: "SYNTHETIC_FACT_REVIEW_ONLY", risk_approved: false, memory_consent: false };
    const result = evaluate({ ...draft, confirmation });
    draft.confirmation = confirmation; draft.result = result;
    draft.audit.push({ event: "FACTS_REVIEWED_AND_ANALYZED", at: this.now().toISOString(), revision: draft.revision, decision: result.decision, risk_check_id: result.review?.risk_check_id || null });
    return this.output(draft);
  }
  reviewRequest(owner, input) {
    only(input, ["draft_id", "revision", "interpretation_sha256"], "复核请求");
    const { draft } = this.match(owner, input);
    if (!draft.confirmation || !draft.result) fail("CONFIRMATION_REQUIRED", "先完成本版本的事实核对");
    const context = { source_binding: binding(draft), input_authority: "USER_CONFIRMED_SYNTHETIC_UNVERIFIED_ACCOUNT", money_unit: "CNY_MINOR",
      profile: draft.profile, items: draft.items.map(x => ({ id: x.id, span: x.source_span, type: x.type, amount_minor: x.amount_minor, due_date: x.due_date, recurrence: x.recurrence, disposition: x.disposition })),
      risk_decision: draft.result.decision, metrics: draft.result.metrics, risk_approval_granted: false };
    if (JSON.stringify(context).length > 12000) fail("MODEL_CONTEXT_TOO_LARGE", "复核依据超出既有模型接口上限；本地测算仍可用，请缩短文字后复核");
    return { submitted: false, execution_allowed: false, request: normalizeReviewInput({ schema_version: "model-review.v1", text: draft.source_text,
      kind: "combined", source: "long-text-risk-staging-v1", data_mode: draft.data_mode, scenario: "FUNDING_CONFLICT", execution_mode: "PAPER", capability: "REVIEW_ONLY",
      memory_consent: false, allow_rule_fallback: false, output_formats: ["json"], idempotency_key: draft.interpretation_sha256,
      request_id: draft.confirmation.receipt_id, context }) };
  }
  export(owner, input) {
    only(input, ["draft_id", "revision", "interpretation_sha256"], "导出");
    return this.output(this.match(owner, input).draft);
  }
}

module.exports = { Sessions, evaluate, missing, occurrences, binding, describePolicy, planningPreview };
