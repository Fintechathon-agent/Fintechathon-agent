"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parse, parseAmount } = require("../parser.cjs");
const { Sessions, binding, occurrences } = require("../service.cjs");
const input = text => ({ text, as_of: "2027-02-01", horizon_days: 90, data_mode: "FIXTURE" });
test("colloquial k/w suffixes preserve their actual units", () => {
  assert.equal(parseAmount("工资8k").amount_minor, 800000);
  assert.equal(parseAmount("现金2W").amount_minor, 2000000);
});
test("saving an unchanged clamped monthly date retains day 31", () => {
  const store = new Sessions(); let draft = store.create("a", input("每月31号交房租3000元"));
  draft = store.correct("a", { ...binding(draft), items: [{ id: "item-0", due_date: "2027-02-28" }] });
  assert.equal(occurrences(draft.items[0], "2027-03-31")[1].at, "2027-03-31");
});
test("shared each-amount and mixed financial intents require rewriting", () => {
  for (const text of ["明天房租和学费各3000元", "我打算把学费2万元拿去买基金"]) {
    const store = new Sessions(); let draft = store.create("a", input(text));
    assert.equal(draft.items[0].requires_split, true);
    draft = store.correct("a", { ...binding(draft), items: [{ id: "item-0", disposition: "INCLUDE", amount_minor: 300000, due_date: "2027-02-02" }], profile: { cash_minor: 5000000, hard_floor_minor: 0, existing_holds_minor: 0, fees_minor: 0 } });
    assert.ok(draft.questions.some(x => x.field === "source_text"));
  }
});
test("identical repeated obligations require a duplicate decision", () => {
  const draft = parse(input("明天房租3000元。明天房租3000元。"));
  assert.equal(draft.items[1].duplicate_of, "item-0");
  assert.equal(draft.items[1].disposition, "UNRESOLVED");
});
test("pathological numeric runs are rejected before expensive tokenization", () => {
  assert.throws(() => parse(input("现金" + "9".repeat(19000))), e => e.code === "NUMBER_TOKEN_TOO_LONG");
});

test("256 seeded scenarios conserve money and more cash never worsens capacity", () => {
  let seed = 7927;
  const rand = n => { seed = (1664525 * seed + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 256; i++) {
    const cash = 500000 + rand(20000000), holds = rand(100000), floor = rand(1000000), rent = 1 + rand(500000), invest = 1 + rand(15000000), fees = rand(10000);
    const store = new Sessions(); let draft = store.create("a", input(`现金${cash / 100}元。保底${floor / 100}元。明天房租${rent / 100}元。想投资${invest / 100}元。`));
    draft = store.correct("a", { ...binding(draft), items: [], profile: { existing_holds_minor: holds, fees_minor: fees } });
    const check = d => store.confirm("a", { ...binding(d), confirmed: true, nonoverlap_confirmed: true, reviewed_item_ids: d.items.map(x => x.id) });
    draft = check(draft);
    const expected = cash - holds - floor - rent - invest - fees;
    assert.equal(draft.result.metrics.projected_free_after_minor, expected, `scenario ${i}`);
    assert.equal(draft.result.metrics.shortfall_minor, Math.max(0, -expected));
    assert.equal(draft.result.decision, expected < 0 ? "BLOCK" : "ALLOW");
    const before = draft.result.metrics.available_for_new_action_minor;
    draft = store.correct("a", { ...binding(draft), items: [], profile: { cash_minor: cash + 1000000 } });
    const after = check(draft).result.metrics.available_for_new_action_minor;
    assert.equal(after, Math.max(0, cash + 1000000 - holds - floor - rent));
    assert.ok(after >= before);
  }
});
