import assert from "node:assert/strict";
import test from "node:test";
import { generateCases, SEED } from "../experiments/investment-benchmark-v2/cases.mjs";
import intake from "../experiments/life-planning-v1/intake.js";
import amounts from "../experiments/life-planning-v1/money-mentions.js";

test("extended suite is reproducible with 2000 unique case IDs and 100 post-approval changes", () => {
  const cases = generateCases();
  assert.equal(cases.length, 2000);
  assert.equal(new Set(cases.map(c => c.case_id)).size, 2000);
  assert.deepEqual(generateCases(), cases);
  assert.notDeepEqual(generateCases(SEED + 17), cases);
  const modified = cases.filter(c => c.template.startsWith("post-approval-change-"));
  assert.equal(modified.length, 100);
  assert.equal(new Set(modified.map(c => c.template)).size, 5);
  assert.equal(new Set(cases.map(c => c.group + ":" + c.template)).size, 71);
});

test("held-out score and time wording is excluded without suppressing nearby real fen", () => {
  for (const text of ["得分为八十分", "视频耗时约3分", "本题打分：9分"]) {
    assert.deepEqual(amounts.extractMoneyMentions(text), [], text);
  }
  for (const phrase of ["九分", "￥9分", "1元9分"]) {
    const text = "评分为9分的餐食花了" + phrase + "。";
    assert.deepEqual(amounts.extractMoneyMentions(text).map(m => m.text), [phrase]);
  }
  const text = "💬用时5分支付两角三分";
  const [mention] = amounts.extractMoneyMentions(text, 10);
  assert.equal(mention.text, "两角三分");
  assert.equal(text.slice(mention.source_span.start - 10, mention.source_span.end - 10), mention.text);
});

test("held-out uncertainty and mixed intent ask for clarification without authorizing action", () => {
  for (const text of ["我并非没准备投资基金", "我没有说不付房租", "我也许要买股票", "我要不要投资基金",
    "我想付房租但不想付", "我不想买基金但又想买"]) {
    const draft = intake.extract({ text, data_mode: "SYNTHETIC_REPLAY" });
    assert.equal(draft.candidates[0].classification.status, "AMBIGUOUS", text);
    assert.ok(draft.candidates[0].confirmation_questions.some(q => q.includes("最终")));
    assert.equal(draft.execution_allowed, false);
    assert.equal(draft.memory_write_performed, false);
    assert.equal(draft.risk_decision, null);
  }
});

test("explicit negation, normal intent and conditional scope keep their existing meaning", () => {
  const draft = intake.extract({ text: "我不想付房租；我想付房租；我不想取消会员；如果有钱，我也许买基金。",
    data_mode: "SYNTHETIC_REPLAY" });
  assert.deepEqual(draft.candidates.map(c => c.classification.status), ["NEGATED", "PLANNED", "NEGATED", "CONDITIONAL", "CONDITIONAL"]);
});
