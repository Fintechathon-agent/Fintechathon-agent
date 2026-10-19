import fs from "node:fs";

const portfolio = JSON.parse(fs.readFileSync(new URL("../../data/demo-portfolio.json", import.meta.url), "utf8")).portfolio;
export const SEED = 20261019;
export const AS_OF = "2026-10-19T12:00:00Z";
const chinese = "零一二三四五六七八九";
const yuan = minor => (minor / 100).toFixed(2);

export function generateCases(seed = SEED) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError("seed must be uint32");
  let state = seed;
  const random = max => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % max; };
  const result = [];
  function add(group, template, input, expected) {
    result.push({ case_id: "synthetic-" + String(result.length + 1).padStart(4, "0"), group, template,
      data_mode: "SYNTHETIC_REPLAY", input, expected });
  }
  for (let i = 0; i < 150; i++) {
    const cents = 1 + random(99), jiao = Math.floor(cents / 10), fen = cents % 10;
    const forms = [yuan(cents) + "元", yuan(cents).slice(1) + "元", chinese[jiao] + "角" + chinese[fen] + "分",
      cents % 9 + 1 + "分", "1元" + jiao + "角" + fen + "分", "￥" + yuan(cents)];
    const mention = forms[i % forms.length];
    add("small_amount", "amount-" + i % 6, { text: "样例" + i + "：我今天支付餐费" + mention + "。" }, { mentions: [mention] });
  }
  for (let i = 0; i < 100; i++) {
    const n = 100 + random(10000);
    const forms = [
      ["我不想买基金" + n + "元。", ["NEGATED"]],
      ["我不准备买基金" + n + "元。", ["CANCELLED"]],
      ["我没有取消会员" + n + "元。", ["NEGATED"]],
      ["我申请取消会员" + n + "元。", ["CANCELLATION_REQUESTED"]],
      ["如果工资到账，我计划投资" + n + "元。", ["CONDITIONAL", "CONDITIONAL"]],
      ["朋友想投资" + n + "元，下月要交房租" + n + "元。", ["PLANNED", "PLANNED"], ["THIRD_PARTY", "THIRD_PARTY"]],
      ["我计划投资" + n + "元；已付房租" + n + "元。", ["PLANNED", "COMPLETED"]],
      ["房租" + n + "元，改成" + (n + 100) + "元。", ["UNSPECIFIED", "CORRECTION"]],
      ["我不愿意买基金" + n + "元。", ["NEGATED"]],
      ["我没打算投资" + n + "元。", ["NEGATED"]]
    ];
    const [text, statuses, subjects] = forms[i % 10];
    add("life_semantics", "meaning-" + i % 10, { text }, { statuses, ...(subjects ? { subjects } : {}) });
  }
  for (let i = 0; i < 150; i++) {
    const initial = 1000000 + random(10000000), change = (i % 2 ? -1 : 1) * (100 + random(50000));
    const input = { created_on: "2026/10/16", created_days: 1, initial_assets: yuan(initial), total_assets: yuan(initial + change),
      available_funds: yuan(Math.floor(initial / 2)), cumulative_pnl: yuan(change),
      cumulative_return: (Math.round(change * 10000 / initial) / 100).toFixed(2) + "%", daily_return: "0.00%" };
    const variant = i % 6;
    if (variant === 2) input.cumulative_pnl = yuan(change + 1);
    if (variant === 3) input.total_assets = "1,00.00";
    if (variant === 4) Object.assign(input, { initial_assets: "0", total_assets: "0", available_funds: "0", cumulative_pnl: "0", cumulative_return: "0%" });
    if (variant === 5) input.available_funds = yuan(initial + Math.abs(change) + 100);
    add("account_summary", "summary-" + variant, input, { status: variant === 3 ? "INVALID_ACCOUNT_SUMMARY" : [2, 5].includes(variant) ? "DISPLAY_CONFLICT" : "PARTIAL_MATCH" });
  }
  for (let i = 0; i < 100; i++) {
    const input = structuredClone(portfolio);
    input.cash = (1 + random(1000000)) / 100;
    input.positions.forEach(p => { p.quantity = 100 * (1 + random(20)); });
    const variant = i % 5;
    if (variant === 1) input.positions[0].instrument_id = "UNKNOWN_" + i;
    if (variant === 2) input.positions[0].quantity = 101;
    if (variant === 3) input.as_of = "2026-10-19T12:00:00Z";
    if (variant === 4) input.positions[1].instrument_id = input.positions[0].instrument_id;
    add("portfolio_validation", "portfolio-" + variant, input, { valid: variant === 0 });
  }
  for (let i = 0; i < 50; i++) {
    const input = { portfolio: structuredClone(portfolio), risk_profile: { investment_horizon_days: 30 + random(1000), max_drawdown: .1, liquidity_need: "medium" } };
    input.portfolio.cash = random(100000);
    input.portfolio.positions.forEach(p => { p.quantity = (1 + random(15)) * 100; });
    if (i % 2) delete input.risk_profile.liquidity_need;
    add("portfolio_chain", i % 2 ? "needs-preference" : "full-replay", input, { status: i % 2 ? "WAITING_INPUT" : "HANDOFF_REQUIRED" });
  }
  for (let i = 0; i < 100; i++) {
    const protectedMinor = 1 + random(900000), available = 1 + random(500000);
    const requested = i % 2 ? available + 1 : 1 + random(available);
    add("funding_conflict", i % 2 ? "one-cent-short" : "within-reserve", { cash_minor: protectedMinor + available, protected_minor: protectedMinor, requested_minor: requested },
      { status: i % 2 ? "BLOCKED" : "AVAILABLE", available_minor: available });
  }
  for (let i = 0; i < 50; i++) {
    const available = 100 + random(500000), reserve = 10000 + random(300000), requested = Math.floor(available / 2) + 1;
    add("funding_multitask", "competing-tasks", { available_minor: available, protected_minor: reserve, requested_minor: requested }, { receipts: 1 });
  }
  for (let i = 0; i < 100; i++) {
    const modes = ["approved", "rejected", "more-info", "no-risk-service"], mode = modes[i % 4];
    add("risk_workflow", mode, { mode, text: "虚构投资" + (1 + random(100000)) + "元，先保留生活用途，请复核。" },
      { status: { approved: "SIMULATED", rejected: "REJECTED", "more-info": "PENDING_RISK", "no-risk-service": "PENDING_RISK" }[mode] });
  }
  for (let i = 0; i < 100; i++) {
    const modes = ["model-failure", "model-timeout", "duplicate", "changed-approval", "expired-approval"], mode = modes[i % 5];
    add("reliability", mode, { mode, text: "虚构第" + i + "笔投资计划，拟用" + (1 + random(50000)) + "元。" },
      { status: mode.startsWith("model-") ? "MODEL_FAILED" : mode === "expired-approval" ? "EXPIRED" : mode === "changed-approval" ? "READY_FOR_SIMULATION" : "PENDING_RISK" });
  }
  for (let i = 0; i < 100; i++) {
    const base = 1 + random(99), discount = 1 + random(base), variant = i % 5;
    const quotes = [0, 1, 2].map(n => ({ quote_id: "screenshot-" + n, platform: "合成平台" + n, source_ref: "synthetic-transcription-" + i + "-" + n,
      comparison_key: "same-meal", match_confirmed: true, currency: "CNY", quantity: 1,
      unit_price_minor: base + n * 100, shipping_minor: n * 5, fees_minor: 1, quoted_at: "2026-10-19T11:00:00Z", valid_until: "2026-10-19T13:00:00Z",
      coupons: [{ coupon_id: "coupon-" + n, threshold_minor: 0, discount_minor: discount, eligible: true,
        starts_at: "2026-10-19T10:00:00Z", ends_at: "2026-10-19T13:00:00Z" }] }));
    if (variant === 1) quotes[0].shipping_minor = null;
    if (variant === 2) quotes[0].coupons[0].eligible = null;
    if (variant === 3) quotes[0].valid_until = "2026-10-19T12:00:00Z";
    if (variant === 4) Object.assign(quotes[1], { unit_price_minor: base, shipping_minor: 0 });
    const billAmount = 1 + random(99);
    add("quote_subscription", "quote-" + variant, { data_mode: "SYNTHETIC_REPLAY", as_of: AS_OF,
      comparison: { comparison_key: "same-meal", quantity: 1, quotes },
      subscriptions: { through: "2026-10-21T12:00:00Z", bills: [{ bill_id: "subscription-" + i, service: "合成订阅", source_ref: "synthetic-bill-" + i,
        currency: "CNY", amount_minor: billAmount, due_at: "2026-10-20T12:00:00Z", status: "CANCELLATION_REQUESTED" }] } },
      { lowest_minor: [1, 3].includes(variant) ? base + 106 - discount : variant === 2 ? base + 1 : base + 1 - discount,
        bill_minor: billAmount, comparison_status: [1, 2, 3].includes(variant) ? "PARTIAL_COMPARISON" : "COMPARABLE_INPUTS" });
  }
  return result;
}
