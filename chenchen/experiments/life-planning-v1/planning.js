"use strict";

const { MODES, fail, hash } = require("./intake");
const LIMIT = 1000000000000;
function money(value, field) {
  if (!Number.isSafeInteger(value) || value < 0 || value > LIMIT) fail("INVALID_INPUT", field + " must be non-negative CNY integer cents");
  return value;
}
function iso(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    fail("INVALID_INPUT", field + " must be an ISO date-time with timezone");
  }
  const day = value.slice(0, 10);
  if (new Date(day + "T00:00:00Z").toISOString().slice(0, 10) !== day) fail("INVALID_INPUT", field + " contains an invalid calendar date");
  return Date.parse(value);
}
function label(value, field) {
  if (typeof value !== "string" || !value.trim() || value.length > 200) fail("INVALID_INPUT", field + " must be a non-empty string <= 200 characters");
  return value;
}
function list(value, field, max = 100) {
  if (!Array.isArray(value) || value.length > max) fail("INVALID_INPUT", field + " must be a bounded array");
  return value;
}
function unique(items, field) {
  const ids = items.map(item => label(item?.[field], field));
  if (new Set(ids).size !== ids.length) fail("INVALID_INPUT", "Duplicate " + field);
}
function header(input) {
  if (!MODES.includes(input?.data_mode)) fail("INVALID_INPUT", "data_mode must be explicit");
  iso(input.as_of, "as_of");
  return { data_mode: input.data_mode, as_of: input.as_of, currency: "CNY", money_unit: "CNY_MINOR",
    input_authority: "UNVERIFIED_CALLER_INPUT", platform_data_fetched: false, execution_allowed: false, side_effects: false };
}

function compareQuotes(input) {
  const common = header(input);
  label(input.comparison_key, "comparison_key");
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 1000) fail("INVALID_INPUT", "Invalid quantity");
  const quotes = list(input.quotes, "quotes", 30);
  unique(quotes, "quote_id");
  const current = iso(input.as_of, "as_of");
  const results = quotes.map(quote => {
    label(quote.platform, "platform");
    label(quote.source_ref, "source_ref");
    const reasons = [];
    if (quote.comparison_key !== input.comparison_key || quote.match_confirmed !== true) reasons.push("PRODUCT_MATCH_UNCONFIRMED");
    if (quote.currency !== "CNY" || quote.quantity !== input.quantity) reasons.push("CURRENCY_OR_QUANTITY_MISMATCH");
    const quotedAt = iso(quote.quoted_at, "quoted_at");
    const validUntil = iso(quote.valid_until, "valid_until");
    if (quotedAt > current || validUntil <= current || validUntil <= quotedAt) reasons.push("QUOTE_NOT_CURRENT");
    if (quote.shipping_minor == null || quote.fees_minor == null) reasons.push("COST_INCOMPLETE");
    const subtotal = money(quote.unit_price_minor, "unit_price_minor") * input.quantity;
    const shipping = quote.shipping_minor == null ? null : money(quote.shipping_minor, "shipping_minor");
    const fees = quote.fees_minor == null ? null : money(quote.fees_minor, "fees_minor");
    const coupons = list(quote.coupons, "coupons", 20);
    unique(coupons, "coupon_id");
    const options = [{ coupon_id: null, discount_minor: 0 }];
    const couponChecks = coupons.map(coupon => {
      const discount = money(coupon.discount_minor, "discount_minor");
      const threshold = money(coupon.threshold_minor, "threshold_minor");
      const starts = iso(coupon.starts_at, "starts_at");
      const ends = iso(coupon.ends_at, "ends_at");
      if (ends <= starts) fail("INVALID_INPUT", "Invalid coupon window");
      if (![true, false, null].includes(coupon.eligible)) fail("INVALID_INPUT", "coupon eligible must be true, false or null");
      let status = starts > current || ends <= current ? "OUTSIDE_WINDOW"
        : subtotal < threshold ? "BELOW_THRESHOLD" : coupon.eligible === false ? "INELIGIBLE"
          : coupon.eligible == null ? "NEEDS_ELIGIBILITY" : "APPLICABLE";
      if (discount > subtotal) status = "INVALID_DISCOUNT";
      if (status === "APPLICABLE") options.push({ coupon_id: coupon.coupon_id, discount_minor: discount });
      return { coupon_id: coupon.coupon_id, status };
    });
    options.sort((a, b) => b.discount_minor - a.discount_minor);
    const best = options[0];
    return { quote_id: quote.quote_id, platform: quote.platform, source_ref: quote.source_ref,
      quoted_at: quote.quoted_at, valid_until: quote.valid_until,
      status: reasons.length ? "EXCLUDED" : "COMPARABLE", reasons, coupon_checks: couponChecks,
      selected_coupon_id: reasons.length ? null : best.coupon_id,
      subtotal_minor: subtotal, shipping_minor: shipping, fees_minor: fees,
      discount_minor: reasons.length ? null : best.discount_minor,
      total_minor: reasons.length ? null : subtotal + shipping + fees - best.discount_minor };
  });
  const ranked = results.filter(q => q.status === "COMPARABLE").sort((a, b) => a.total_minor - b.total_minor || a.quote_id.localeCompare(b.quote_id));
  const incomplete = results.some(q => q.status !== "COMPARABLE" || q.coupon_checks.some(c => ["NEEDS_ELIGIBILITY", "INVALID_DISCOUNT"].includes(c.status)));
  return { ...common, contract_version: "quote-comparison.draft.v1", comparison_key: input.comparison_key,
    quantity: input.quantity, status: !ranked.length ? "NEEDS_QUOTES" : incomplete ? "PARTIAL_COMPARISON" : "COMPARABLE_INPUTS",
    quotes: results, ranked_quote_ids: ranked.map(q => q.quote_id),
    lowest_known_quote_ids: ranked.filter(q => q.total_minor === ranked[0]?.total_minor).map(q => q.quote_id),
    lowest_known_total_minor: ranked[0]?.total_minor ?? null,
    coupon_policy: "ONE_IMMEDIATE_COUPON_NO_STACKING_NO_CASHBACK",
    explanation: "仅比较所提供且条件明确的报价；不是全网最低价。需再次核实实际结算页。" };
}

function subscriptionSchedule(input) {
  const common = header(input);
  const start = iso(input.as_of, "as_of");
  const end = iso(input.through, "through");
  if (end < start || end - start > 366 * 86400000) fail("INVALID_INPUT", "Window must be within 366 days");
  const bills = list(input.bills, "bills");
  unique(bills, "bill_id");
  const result = bills.map(bill => {
    label(bill.service, "service");
    label(bill.source_ref, "source_ref");
    if (bill.currency !== "CNY") fail("INVALID_INPUT", "Only CNY is supported");
    if (!["SCHEDULED", "PAID", "CANCELLED", "CANCELLATION_REQUESTED", "UNKNOWN"].includes(bill.status)) fail("INVALID_INPUT", "Invalid bill status");
    const amount = bill.amount_minor == null ? null : money(bill.amount_minor, "amount_minor");
    const due = bill.due_at == null ? null : iso(bill.due_at, "due_at");
    const status = ["PAID", "CANCELLED"].includes(bill.status) ? "EXCLUDED_REPORTED_SETTLED"
      : due != null && due > end ? "OUTSIDE_WINDOW"
        : amount == null || due == null || bill.status === "UNKNOWN" ? "NEEDS_DETAILS"
          : due < start ? "OVERDUE_NEEDS_CHECK" : "UPCOMING";
    return { bill_id: bill.bill_id, service: bill.service, currency: bill.currency, status: bill.status,
      source_ref: bill.source_ref, amount_minor: amount, due_at: bill.due_at ?? null, schedule_status: status,
      reminder: bill.status === "CANCELLATION_REQUESTED" ? "申请取消尚不等于取消成功，仍保留可能扣款。" : null };
  });
  result.sort((a, b) => (a.due_at == null ? Infinity : Date.parse(a.due_at)) - (b.due_at == null ? Infinity : Date.parse(b.due_at)) || a.bill_id.localeCompare(b.bill_id));
  const upcoming = result.filter(b => b.schedule_status === "UPCOMING");
  const unresolved = result.filter(b => ["NEEDS_DETAILS", "OVERDUE_NEEDS_CHECK"].includes(b.schedule_status));
  const sum = upcoming.reduce((total, b) => total + b.amount_minor, 0);
  return { ...common, contract_version: "subscription-schedule.draft.v1", through: input.through,
    bills: result, upcoming_known_total_minor: sum, incomplete: unresolved.length > 0,
    unresolved_bill_ids: unresolved.map(b => b.bill_id),
    next_due_at: upcoming[0]?.due_at ?? null, cancellation_performed: false,
    reminder_delivery: "NOT_CONNECTED", explanation: "只整理已提供的下一笔账单；不会自动取消、扣费或推送提醒。" };
}

function planPurchases(input) {
  const comparison = compareQuotes({ ...input.comparison, data_mode: input.data_mode, as_of: input.as_of });
  const subscriptions = subscriptionSchedule({ ...input.subscriptions, data_mode: input.data_mode, as_of: input.as_of });
  const base = comparison.lowest_known_total_minor;
  return { contract_version: "life-planning.draft.v1", data_mode: input.data_mode, as_of: input.as_of,
    plan_sha256: hash(input), comparison, subscriptions,
    known_purchase_and_bills_minor: base == null ? null : base + subscriptions.upcoming_known_total_minor,
    incomplete: base == null || comparison.status !== "COMPARABLE_INPUTS" || subscriptions.incomplete,
    affordability: "NOT_ASSESSED", risk_decision: null, execution_allowed: false, side_effects: false,
    follow_up: ["核实商品、优惠和下一次扣费", "确认房租、学费等资金用途", "由既有 Risk 使用可信余额和用途检查", "实际购买、续费或取消需另走原有审批与执行接口"] };
}

module.exports = { compareQuotes, subscriptionSchedule, planPurchases, iso, money };
