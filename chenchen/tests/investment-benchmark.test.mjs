import assert from "node:assert/strict";
import test from "node:test";
import { generateCases } from "../experiments/investment-benchmark-v1/cases.mjs";
import intake from "../experiments/life-planning-v1/intake.js";
import amounts from "../experiments/life-planning-v1/money-mentions.js";

test("benchmark has exactly 1000 reproducible inputs across ten named groups", () => {
  const cases = generateCases();
  assert.equal(cases.length, 1000);
  assert.equal(new Set(cases.map(c => c.case_id)).size, 1000);
  assert.equal(new Set(cases.map(c => c.group)).size, 10);
  assert.deepEqual(generateCases(), cases);
  assert.notDeepEqual(generateCases(20261020), cases);
  assert.ok(cases.every(c => c.data_mode === "SYNTHETIC_REPLAY"));
});

test("small currency evidence retains decimal points, jiao/fen and exact UTF-16 offsets", () => {
  const phrases = [".07元", "￥.29", "两角五分", "九分", "1元8角2分", "0.001元", "-0.05元", "+.09元", "3,000.07元", "三千元", "2.5万元"];
  for (const phrase of phrases) {
    const text = "💬我支付餐费" + phrase + "。";
    const draft = intake.extract({ text, data_mode: "SYNTHETIC_REPLAY" });
    const mentions = draft.candidates.flatMap(c => c.amount_mentions);
    assert.deepEqual(mentions.map(m => m.text), [phrase]);
    for (const m of mentions) {
      assert.equal(text.slice(m.source_span.start, m.source_span.end), phrase);
      assert.equal(m.status, "NEEDS_CONFIRMATION");
      assert.equal(Object.hasOwn(m, "amount_minor"), false);
    }
    assert.equal(draft.execution_allowed, false);
  }
});

test("non-money minutes and fractions do not become fen expenses", () => {
  for (const text of ["等5分钟", "五分之一", "用时5分30秒"]) assert.deepEqual(amounts.extractMoneyMentions(text), []);
});

test("negative intent and refusal to cancel do not become a purchase or a cancellation", () => {
  for (const text of ["我不想买基金900元", "我不愿意再投资", "我没打算投资基金", "我没有打算继续投资", "我不想取消会员", "我没准备取消订阅"]) {
    const result = intake.extract({ text, data_mode: "SYNTHETIC_REPLAY" });
    assert.equal(result.candidates[0].classification.status, "NEGATED", text);
    assert.equal(result.memory_write_performed, false);
    assert.equal(result.risk_decision, null);
  }
});

test("genuine purchase intent still differs from negated intent in separate clauses", () => {
  const result = intake.extract({ text: "我想买基金900元；我不想买股票800元；我申请取消会员5元。", data_mode: "SYNTHETIC_REPLAY" });
  assert.deepEqual(result.candidates.map(c => c.classification.status), ["PLANNED", "NEGATED", "CANCELLATION_REQUESTED"]);
});

test("newly recognized small amounts update clarification but never grant permission", () => {
  const store = new intake.IntakeSessions();
  const draft = store.create({ text: "餐费五角三分", data_mode: "SYNTHETIC_REPLAY" });
  assert.equal(draft.candidates[0].confirmation_questions.some(question => question.startsWith("金额是多少")), false);
  const binding = { draft_id: draft.draft_id, revision: draft.revision, interpretation_sha256: draft.interpretation_sha256 };
  assert.throws(() => store.reviewRequest(binding), { code: "INTAKE_UNCONFIRMED" });
  store.confirm({ ...binding, confirmed: true, reviewed_candidate_ids: ["candidate-1"] });
  const request = store.reviewRequest(binding).request;
  assert.equal(request.text, "餐费五角三分");
  assert.deepEqual(request.action_parameters, {});
  assert.equal(request.memory_consent, false);
  assert.equal(request.allow_rule_fallback, false);
});
