import assert from "node:assert/strict";
import test from "node:test";
import { investmentCases, otherCases, INVESTMENT_SEED, OTHER_SEED } from "../experiments/dual-benchmark-v3/cases.mjs";
import intake from "../experiments/life-planning-v1/intake.js";
import amounts from "../experiments/life-planning-v1/money-mentions.js";

test("two separately seeded suites contain exactly 5000 cases each and disjoint IDs", () => {
  const a = investmentCases(), b = otherCases();
  assert.equal(a.length, 5000);
  assert.equal(b.length, 5000);
  assert.equal(new Set([...a, ...b].map(c => c.case_id)).size, 10000);
  assert.equal(new Set(a.map(c => c.group)).size, 7);
  assert.equal(new Set(b.map(c => c.group)).size, 7);
  assert.deepEqual(investmentCases(), a);
  assert.deepEqual(otherCases(), b);
  assert.notDeepEqual(investmentCases(INVESTMENT_SEED + 23), a);
  assert.notDeepEqual(otherCases(OTHER_SEED + 23), b);
});

test("unsupported numeric notation never becomes a partial currency amount", () => {
  for (const phrase of ["2e-3元", "￥2e+3", "0Xff元", "3 / 4元", "￥4..9", "2026/10/19元"]) {
    const text = "💬餐费" + phrase + "；公交.29元。";
    const draft = intake.extract({ text, data_mode: "SYNTHETIC_REPLAY" });
    assert.deepEqual(draft.candidates.flatMap(c => c.amount_mentions).map(m => m.text), [".29元"], phrase);
    assert.equal(draft.source_text, text);
    assert.ok(draft.candidates[0].confirmation_questions.some(q => q.startsWith("金额是多少")));
    assert.equal(draft.execution_allowed, false);
    assert.equal(draft.memory_write_performed, false);
  }
});

test("supported signed decimals, compound yuan and fen keep their complete source spans", () => {
  for (const phrase of ["￥-0.12", "+.05元", "三元五角九分", "1,200.35元", "2.5万元", "￥0.001"]) {
    const text = "📒合成支付" + phrase;
    const [mention] = amounts.extractMoneyMentions(text, 7);
    assert.equal(mention.text, phrase);
    assert.equal(text.slice(mention.source_span.start - 7, mention.source_span.end - 7), phrase);
    assert.equal(mention.status, "NEEDS_CONFIRMATION");
  }
});
