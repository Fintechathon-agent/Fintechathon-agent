"use strict";

const { createHash } = require("node:crypto");
const AS_OF = "2026-10-04";
const clone = (value) => structuredClone(value);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const day = (date, offset) => new Date(Date.parse(date + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
const validDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function fail(code, message) { throw Object.assign(new Error(message), { code, statusCode: 422 }); }
function demo() {
  const bill = (id, channel, kind, category, booked_on, due_on, amount_cents, extra = {}) => ({
    id, channel, kind, category, booked_on, due_on, amount_cents, fee_cents: 0,
    refund_cents: 0, status: "pending", source: channel + "演示账单/" + id,
    description: category, ...extra
  });
  return {
    version: "merchant-demo@1", shop: "巷口咖啡", currency: "CNY", as_of: AS_OF,
    balance_cents: 620000, balance_note: "10月4日收盘已核对银行与现金余额，已到账收支已包含其中",
    bills: [
      bill("WX-001", "微信", "income", "门店销售", "2026-10-02", "2026-10-03", 240000, { fee_cents: 1440, status: "settled" }),
      bill("ALI-001", "支付宝", "income", "门店销售", "2026-10-03", "2026-10-04", 180000, { fee_cents: 1080, status: "settled" }),
      bill("MT-001", "外卖平台", "income", "外卖销售", "2026-10-03", "2026-10-06", 320000, { fee_cents: 25600, refund_cents: 20000, description: "周末外卖结算批次" }),
      bill("WX-002", "微信", "income", "门店销售", "2026-10-04", "2026-10-05", 210000, { fee_cents: 1260 }),
      bill("ALI-002", "支付宝", "income", "门店销售", "2026-10-04", "2026-10-05", 160000, { fee_cents: 960, refund_cents: 10000 }),
      bill("GROUP-01", "团购平台", "income", "团购核销", "2026-10-01", "2026-10-03", 90000, { fee_cents: 4500, description: "已过预计到账日，需核对结算状态" }),
      bill("BEAN-P", "供应商", "expense", "咖啡豆", "2026-09-23", "2026-09-24", 160000, { status: "settled", quantity: 20, unit: "kg", item: "拼配豆A" }),
      bill("BEAN-C", "供应商", "expense", "咖啡豆", "2026-09-30", "2026-10-05", 220000, { quantity: 25, unit: "kg", item: "拼配豆A" }),
      bill("MILK-P", "供应商", "expense", "牛奶", "2026-09-24", "2026-09-25", 90000, { status: "settled", quantity: 100, unit: "L", item: "鲜奶A" }),
      bill("MILK-C", "供应商", "expense", "牛奶", "2026-10-01", "2026-10-07", 110000, { quantity: 110, unit: "L", item: "鲜奶A" }),
      bill("PACK-P", "供应商", "expense", "包装", "2026-09-25", "2026-09-26", 40000, { status: "settled", quantity: 500, unit: "个", item: "纸杯A" }),
      bill("PACK-C", "供应商", "expense", "包装", "2026-10-02", "2026-10-08", 40000, { quantity: 500, unit: "个", item: "纸杯A" }),
      bill("RENT", "银行", "expense", "房租", "2026-10-01", "2026-10-06", 700000),
      bill("WAGE", "银行", "expense", "工资", "2026-10-01", "2026-10-10", 480000),
      bill("UTIL", "银行", "expense", "水电", "2026-10-01", "2026-10-09", 65000)
    ]
  };
}
function validate(input) {
  if (!input || Array.isArray(input) || input.currency !== "CNY" || !validDay(input.as_of) ||
      !Number.isSafeInteger(input.balance_cents) || Math.abs(input.balance_cents) > 1e11 ||
      typeof input.shop !== "string" || !input.shop.trim() || input.shop.length > 100 ||
      !Array.isArray(input.bills) || input.bills.length > 5000) fail("INVALID_LEDGER", "请使用 CNY、有效日期、整数分金额与最多 5000 条账单。");
  const unique = new Map();
  let duplicates = 0;
  for (const bill of input.bills) {
    if (!bill || typeof bill !== "object") fail("INVALID_BILL", "账单必须为对象。");
    for (const key of ["id", "channel", "category", "source", "description"]) {
      if (typeof bill[key] !== "string" || !bill[key].trim() || bill[key].length > 500) fail("INVALID_BILL", key + " 缺失或过长。");
    }
    if (!["income", "expense"].includes(bill.kind) || !["pending", "settled"].includes(bill.status) ||
        !validDay(bill.booked_on) || !validDay(bill.due_on) || bill.booked_on > input.as_of ||
        bill.due_on < bill.booked_on || (bill.status === "settled" && bill.due_on > input.as_of)) fail("INVALID_BILL", bill.id + " 日期或状态无效。");
    for (const key of ["amount_cents", "fee_cents", "refund_cents"]) {
      if (!Number.isSafeInteger(bill[key]) || bill[key] < 0 || bill[key] > 1e10) fail("INVALID_MONEY", bill.id + " 金额必须是非负整数分。");
    }
    if (bill.fee_cents + bill.refund_cents > bill.amount_cents ||
        (bill.kind === "expense" && (bill.fee_cents || bill.refund_cents))) fail("INVALID_MONEY", bill.id + " 扣款与账单金额不一致。");
    if (bill.quantity !== undefined && (!(bill.quantity > 0) || !Number.isFinite(bill.quantity) || bill.quantity > 1e9 ||
        typeof bill.unit !== "string" || !bill.unit || bill.unit.length > 50 ||
        typeof bill.item !== "string" || !bill.item || bill.item.length > 200)) fail("INVALID_QUANTITY", "数量须为有效正数，并附单位与品名。");
    const normalized = Object.fromEntries(["id", "channel", "kind", "category", "booked_on", "due_on", "amount_cents", "fee_cents",
      "refund_cents", "status", "source", "description", "quantity", "unit", "item"].filter(k => bill[k] !== undefined).map(k => [k, bill[k]]));
    const key = bill.channel + ":" + bill.id;
    if (unique.has(key)) {
      if (JSON.stringify(unique.get(key)) !== JSON.stringify(normalized)) fail("DUPLICATE_CONFLICT", key + " 同一账单有不同金额或状态，请先核对。");
      duplicates++;
    } else unique.set(key, normalized);
  }
  const bills = [...unique.values()].sort((a, b) => (a.channel + a.id).localeCompare(b.channel + b.id, "en"));
  const ledger = { shop: input.shop, currency: "CNY", as_of: input.as_of, balance_cents: input.balance_cents, bills };
  const revision = createHash("sha256").update(JSON.stringify(ledger)).digest("hex");
  return { ledger, revision, duplicates };
}
function net(bill) { return bill.amount_cents - bill.fee_cents - bill.refund_cents; }
function ref(bill) { return bill.channel + ":" + bill.id; }
function costs(ledger) {
  const start = day(ledger.as_of, -6), previousStart = day(ledger.as_of, -13), previousEnd = day(ledger.as_of, -7);
  return [...new Set(ledger.bills.filter(b => b.kind === "expense").map(b => b.category))].map(category => {
    const relevant = ledger.bills.filter(b => b.kind === "expense" && b.category === category);
    const current = relevant.filter(b => b.booked_on >= start && b.booked_on <= ledger.as_of);
    const previous = relevant.filter(b => b.booked_on >= previousStart && b.booked_on <= previousEnd);
    const currentValue = sum(current.map(b => b.amount_cents)), previousValue = sum(previous.map(b => b.amount_cents));
    const all = [...previous, ...current];
    const comparable = previous.length && current.length && all.every(b => b.quantity && b.unit === all[0].unit && b.item === all[0].item);
    let decomposition = null;
    if (comparable) {
      const q0 = sum(previous.map(b => b.quantity)), q1 = sum(current.map(b => b.quantity));
      const p0 = previousValue / q0, p1 = currentValue / q1;
      const quantityEffect = Math.round((q1 - q0) * p0);
      decomposition = { unit: all[0].unit, previous_quantity: q0, current_quantity: q1,
        previous_unit_cents: Math.round(p0), current_unit_cents: Math.round(p1),
        quantity_effect_cents: quantityEffect, price_effect_cents: currentValue - previousValue - quantityEffect };
    }
    return { category, current_cents: currentValue, previous_cents: previousValue, delta_cents: currentValue - previousValue,
      change_ratio: previousValue ? (currentValue - previousValue) / previousValue : null, decomposition,
      current_window: [start, ledger.as_of], previous_window: [previousStart, previousEnd], evidence: all.map(ref) };
  }).sort((a, b) => b.delta_cents - a.delta_cents);
}
function forecast(ledger, delayDays = 0, singleRef = null) {
  if (![0, 3, 7].includes(delayDays)) fail("INVALID_DELAY", "到账延迟只支持 0、3、7 天。");
  const pending = ledger.bills.filter(b => b.status === "pending");
  let expected = ledger.balance_cents, conservative = ledger.balance_cents;
  const days = [];
  for (let i = 1; i <= 14; i++) {
    const date = day(ledger.as_of, i);
    // Overdue payments are reserved tomorrow; overdue receipts stay uncertain.
    const incoming = pending.filter(b => b.kind === "income" && b.due_on > ledger.as_of &&
      (singleRef && ref(b) !== singleRef ? b.due_on === date : day(b.due_on, delayDays) === date));
    const outgoing = pending.filter(b => b.kind === "expense" && (b.due_on <= ledger.as_of ? i === 1 : b.due_on === date));
    const incomingCents = sum(incoming.map(net)), outgoingCents = sum(outgoing.map(net));
    expected += incomingCents - outgoingCents; conservative -= outgoingCents;
    days.push({ date, incoming_cents: incomingCents, outgoing_cents: outgoingCents,
      expected_cents: expected, conservative_cents: conservative, evidence: [...incoming, ...outgoing].map(ref) });
  }
  const openingGap = ledger.balance_cents < 0 ? { date: ledger.as_of, expected_cents: ledger.balance_cents,
    conservative_cents: ledger.balance_cents, incoming_cents: 0, outgoing_cents: 0, evidence: [], opening: true } : null;
  return { delay_days: delayDays, days, first_gap: openingGap || days.find(d => d.expected_cents < 0) || null,
    min_expected_cents: Math.min(ledger.balance_cents, ...days.map(d => d.expected_cents)),
    excluded_overdue_receipts: pending.filter(b => b.kind === "income" && b.due_on <= ledger.as_of).map(ref) };
}
class MerchantSession {
  constructor(input = demo()) { this.replace(input); }
  replace(input) {
    const checked = validate(input);
    this.ledger = checked.ledger; this.revision = checked.revision; this.duplicates = checked.duplicates;
    this.reviewed = false; this.viewed = new Set(); this.followups = new Set(); this.noticeStates = new Map();
    return this.summary();
  }
  summary(delay = 0) {
    const l = this.ledger, pending = l.bills.filter(b => b.status === "pending");
    return { ledger: clone(l), revision: this.revision, reviewed: this.reviewed, duplicates: this.duplicates,
      viewed: [...this.viewed], followups: [...this.followups],
      totals: { balance_cents: l.balance_cents, receivable_cents: sum(pending.filter(b => b.kind === "income").map(net)),
        payable_cents: sum(pending.filter(b => b.kind === "expense").map(net)) },
      costs: costs(l), forecast: forecast(l, delay),
      warnings: ["账单基准日期 " + l.as_of + "；余额以手动核对为准。", "预计到账不等于承诺到账；这里只包含已知账单，不推测未来销售。"] };
  }
  detail(key) {
    const b = this.ledger.bills.find(b => ref(b) === key);
    if (!b) fail("BILL_NOT_FOUND", "账单不存在。");
    this.viewed.add(key);
    return { ...clone(b), net_cents: net(b), balance_effect: b.status === "settled" ? "已包含在当前余额" : "尚未进入当前余额" };
  }
  review(revision, confirmed) {
    if (revision !== this.revision) fail("STALE_REVIEW", "账单已更新，请重新查看。");
    if (confirmed !== true || this.viewed.size === 0) fail("REVIEW_REQUIRED", "请先打开一笔账单，再明确确认已看懂口径。");
    this.reviewed = true;
    return { reviewed: true, revision: this.revision };
  }
  insights(delay = 0) {
    if (!this.reviewed) fail("REVIEW_REQUIRED", "先看清账单，再查看提醒。");
    const s = this.summary(delay), notices = [];
    if (s.forecast.first_gap) notices.push({ id: "cash-gap", title: s.forecast.first_gap.date + (s.forecast.first_gap.opening ? " 当前余额已为负数" : " 已知账单可能形成资金缺口"),
      amount_cents: -s.forecast.first_gap.expected_cents,
      explanation: s.forecast.first_gap.opening ? "缺口来自输入的当前余额，不是未来账单造成的。请先核对银行余额、现金及透支记录。" :
        "按当前余额、预计到账和已知付款逐日计算。先核对到账，再与房东或供应商讨论付款时间。",
      evidence: [...new Set(s.forecast.days.filter(d => d.date <= s.forecast.first_gap.date).flatMap(d => d.evidence))] });
    const overdue = s.ledger.bills.filter(b => b.kind === "income" && b.status === "pending" && b.due_on <= s.ledger.as_of);
    if (overdue.length) notices.push({ id: "overdue", title: "有结算款已到预计到账日但未确认", amount_cents: sum(overdue.map(net)),
      explanation: "这部分未计入预计余额。请先对照平台结算单和银行记录，确认状态。", evidence: overdue.map(ref) });
    for (const c of s.costs.filter(c => c.change_ratio !== null && c.change_ratio > 0.1)) {
      notices.push({ id: "cost-" + c.category, title: c.category + " 本期采购支出增加",
        amount_cents: c.delta_cents, explanation: c.decomposition ?
          "同品同单位拆分数量和单价变化。先核对采购批次与单价，再考虑询价；采购支出不等于已消耗成本。" :
          "没有可比数量资料，暂时只能确认支出变化，不能判断单价上涨。", evidence: c.evidence });
    }
    return { notices: notices.map(n => ({ ...n, following: this.followups.has(n.id), status: this.noticeStates.get(n.id) || "open" })), revision: this.revision,
      digest: "本次已核对 " + this.viewed.size + " 笔来源，共 " + this.ledger.bills.length + " 笔账单。下次从未查看的账单开始。" };
  }
  setNoticeStatus(id, status) {
    if (!["open", "verified", "done"].includes(status)) fail("INVALID_NOTICE_STATUS", "提醒状态无效。");
    if (!this.insights().notices.some(n => n.id === id)) fail("NOTICE_NOT_FOUND", "提醒不存在。");
    this.noticeStates.set(id, status);
    return { id, status };
  }
  singleScenario(key, delayDays = 0) {
    if (![0, 3, 7].includes(delayDays)) fail("INVALID_DELAY", "单笔到账延迟只支持 0、3、7 天。");
    const bill = this.ledger.bills.find(item => ref(item) === key);
    if (!bill) fail("BILL_NOT_FOUND", "账单不存在。");
    if (bill.kind !== "income" || bill.status !== "pending" || bill.due_on <= this.ledger.as_of) {
      fail("INVALID_SCENARIO_BILL", "只能试算尚未到账且尚未过预计日期的收入账单。");
    }
    const baseline = forecast(this.ledger, 0), scenario = forecast(this.ledger, delayDays, key);
    const compact = value => ({ first_gap: value.first_gap, min_expected_cents: value.min_expected_cents });
    return { bill: { ...clone(bill), net_cents: net(bill) }, delay_days: delayDays,
      moved_from: bill.due_on, moved_to: day(bill.due_on, delayDays),
      baseline: compact(baseline), scenario: compact(scenario) };
  }
  follow(id, delay = 0) {
    if (!this.insights(delay).notices.some(n => n.id === id)) fail("NOTICE_NOT_FOUND", "提醒不存在。");
    this.followups.has(id) ? this.followups.delete(id) : this.followups.add(id);
    return { following: this.followups.has(id) };
  }
}
module.exports = { MerchantSession, demo, validate, net, costs, forecast, day };
