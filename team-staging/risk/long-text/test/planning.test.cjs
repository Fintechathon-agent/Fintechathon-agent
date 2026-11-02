"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parse, parseAmount } = require("../parser.cjs");
const { Sessions, binding } = require("../service.cjs");
const input = text => ({ text, data_mode: "FIXTURE", as_of: "2026-10-18", horizon_days: 90 });
// Entirely synthetic planning fixture, intentionally not a saved user draft.
const scenario = `我目前有 24 万现金，帮我规划一下资金怎么安排吧。
我的资金规划与想法如下：
1. 留学开销：出国留学一年要花 9 万人民币，往返机票要花 1.5 万，生活费还要花 4 到 6 万。
2. 投资计划：剩下的钱我想留着 all in 科技基金，还想去投资指数基金。
3. 旅游计划：我还想去旅游。我留学的地方在法国，想去欧洲的一些地方，比如去瑞士、英国等地。
但是现在感觉资金很紧张，我该怎么办呢？`;

test("spaces, fullwidth digits and numbered bullets preserve monetary units", () => {
  for (const [text, value] of [["现金 24 万", 24000000], ["现金２４　万人民币", 24000000], ["1. 学费 9 万人民币", 9000000], ["2、机票 1.5 万", 1500000], ["（3）生活费四万元", 4000000], ["4) 现金2 W", 2000000], ["1.5万元现金", 1500000], ["每月 5 号房租 3 千", 300000]]) assert.equal(parseAmount(text).amount_minor, value, text);
  for (const text of ["2. 投资计划：all in AI", "3. 旅游计划", "万人民币", "费用-3 千元", "4到5个月后支付"]) assert.equal(parseAmount(text).amount_minor, null, text);
});

test("ranges infer a shared unit while preserving explicit units and currency", () => {
  for (const [text, range] of [["生活费 4 到 6 万", [4000000, 6000000]], ["生活费四至六万元", [4000000, 6000000]], ["房租3000-4000元", [300000, 400000]], ["生活费4万元至6万元", [4000000, 6000000]], ["预算4元到6万元", [400, 6000000]]]) {
    const parsed = parseAmount(text);
    assert.equal(parsed.amount_minor, null);
    assert.deepEqual(parsed.amount_range_minor, { min: range[0], max: range[1] }, text);
  }
  for (const text of ["生活费6到4万", "费用-3000到4000元", "收益率4到6%", "生活费4到6万欧元", "房租0.001到0.002元", "生活费4到6万还有机票2万", "预算一万二到三万", "预算四千五到六千元", "2026-11-05交房租"]) assert.equal(parseAmount(text).amount_range_minor, null, text);
});

test("a narrative becomes a useful partial budget with no invented travel or investments", () => {
  const draft = new Sessions().create("test", input(scenario)), p = draft.planning_preview;
  assert.equal(draft.profile.cash_minor, 24000000);
  assert.equal(draft.items.filter(x => !x.context_kind).length, 7);
  assert.equal(draft.items.filter(x => x.context_kind).length, 7);
  assert.equal(draft.items.filter(x => x.type === "OTHER" && x.disposition !== "EXCLUDE").length, 0);
  assert.deepEqual(p.known_expense_range_minor, { min: 14500000, max: 16500000 });
  assert.deepEqual(p.remaining_after_known_expenses_minor, { min: 7500000, max: 9500000 });
  assert.equal(p.unknown_expense_ids.length, 1);
  assert.deepEqual(p.investment_items.map(x => x.amount_minor), [null, null]);
  assert.equal(p.investment_items[0].amount_basis, "REMAINING");
  assert.equal(p.suggested_horizon_days, 365);
  assert.equal(p.risk_approval_granted, false);
  assert.equal(draft.confirmation, null);
  for (const item of draft.items) assert.equal(scenario.slice(item.source_span.start, item.source_span.end), item.text);
  assert.ok(draft.questions.some(x => x.field === "due_date"));
  assert.ok(draft.questions.some(x => x.field === "amount_minor"));
  assert.ok(draft.items.filter(x => x.context_kind).every(x => !draft.questions.some(q => q.item_id === x.id)));
});

test("context recognition never removes a priced or uncertain financial obligation", () => {
  const draft = parse(input("我还想去旅游。比如去法国要花2万元。帮我安排学费3万元。什么是期权。未知费用1500元。如果留学要花4万元。"));
  for (const item of draft.items) assert.equal(item.context_kind, null, item.text);
  assert.equal(draft.items.at(-1).disposition, "UNRESOLVED");
});

test("choosing a range endpoint updates the preview but does not bypass confirmation", () => {
  const store = new Sessions(); let draft = store.create("test", input(scenario));
  const living = draft.items.find(x => x.expense_category === "LIVING");
  draft = store.correct("test", { ...binding(draft), items: [{ id: living.id, amount_minor: 6000000 }] });
  assert.deepEqual(draft.planning_preview.known_expense_range_minor, { min: 16500000, max: 16500000 });
  assert.equal(draft.items.find(x => x.id === living.id).corrected, true);
  assert.throws(() => store.confirm("test", { ...binding(draft), reviewed_item_ids: draft.items.map(x => x.id), confirmed: true, nonoverlap_confirmed: true }), e => e.code === "MISSING_INFORMATION");
  draft = store.correct("test", { ...binding(draft), items: [{ id: living.id, disposition: "EXCLUDE", exclusion_reason: "Included in study budget" }] });
  assert.deepEqual(draft.planning_preview.known_expense_range_minor, { min: 10500000, max: 10500000 });
});

test("partial budget excludes completed and conditional items and counts monthly occurrences", () => {
  const draft = new Sessions().create("test", input("现金10万元。学费2万元已经交了。如果旅游要花3万元。每月5号房租3000元。"));
  assert.deepEqual(draft.planning_preview.known_expense_range_minor, { min: 900000, max: 900000 });
  assert.equal(draft.planning_preview.expense_rows[0].occurrence_count, 3);
  const ambiguous = new Sessions().create("test", input("现金10万元。明天房租和学费各3000元。"));
  assert.equal(ambiguous.planning_preview.known_expense_range_minor, null);
});

test("the narrative can progress through correction and confirmation without modifying its source", () => {
  const store = new Sessions(); let draft = store.create("test", input(scenario));
  const patches = draft.items.filter(x => x.disposition === "INCLUDE" && ["EXPENSE", "INVESTMENT"].includes(x.type)).map(x => ({ id: x.id, due_date: "2026-11-01", amount_minor: x.type === "INVESTMENT" ? 1000000 : x.expense_category === "TRAVEL" ? 1000000 : x.amount_range_minor?.max ?? x.amount_minor }));
  draft = store.correct("test", { ...binding(draft), items: patches, profile: { hard_floor_minor: 2000000, existing_holds_minor: 0, fees_minor: 0 } });
  assert.deepEqual(draft.questions, []);
  draft = store.confirm("test", { ...binding(draft), reviewed_item_ids: draft.items.map(x => x.id), confirmed: true, nonoverlap_confirmed: true });
  assert.equal(draft.source_text, scenario);
  assert.equal(draft.result.metrics.expense_total_minor, 17500000);
  assert.equal(draft.result.metrics.projected_free_after_minor, 2500000);
  assert.equal(draft.result.execution_allowed, false);
});
