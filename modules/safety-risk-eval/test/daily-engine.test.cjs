"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateDaily, describePolicy, POLICY_VERSION } = require("../daily-engine.cjs");
const specification = require("../../../docs/safety-risk-eval/daily-policy-v1/eval-cases.v1.json");
const now = "2026-10-17T09:00:00+08:00";
const fixture = overrides => ({ ...structuredClone(specification.fixtures.funded), ...structuredClone(overrides || {}) });
const run = input => evaluateDaily(input, { now });
const allReasons = result => [...result.reasons, ...result.warnings, ...result.info, ...result.gate_reasons];
const has = (result, code) => assert.ok(allReasons(result).some(reason => reason.code === code), `${code}: ${JSON.stringify(allReasons(result))}`);

// These assertions come from the independently authored v1 specification, not
// generated expected values from the implementation under test.
for (const item of specification.cases) test(`daily specification ${item.case_id}: ${item.title}`, () => {
  const input = fixture(item.overrides), result = run(input), expected = item.expected;
  assert.equal(result.decision, expected.risk_status);
  assert.equal(result.execution_allowed, false);
  assert.equal(result.new_execution, false);
  assert.equal(result.checks.length, 8);
  for (const code of expected.required_reason_codes || []) has(result, code);
  for (const code of expected.warning_codes || []) assert.ok(result.warnings.some(reason => reason.code === code), code);
  for (const code of expected.info_codes || []) assert.ok(result.info.some(reason => reason.code === code), code);
  for (const [key, value] of Object.entries(expected)) {
    if (key === "metric_status") continue;
    if (Object.hasOwn(result.metrics, key)) assert.deepEqual(result.metrics[key], value, key);
    else if (Object.hasOwn(result, key)) assert.deepEqual(result[key], value, key);
  }
  if (expected.metric_status) for (const [key, value] of Object.entries(expected.metric_status)) assert.equal(result.metrics.metric_status[key], value, key);
  if (expected.acceptance_can_resolve === false) assert.ok(result.reasons.filter(reason => reason.status === "REVIEW").every(reason => !reason.acceptance_allowed));
  if (expected.acceptance_can_resolve === true) assert.ok(result.reasons.some(reason => reason.status === "REVIEW" && reason.acceptance_allowed));
  assert.deepEqual(input, fixture(item.overrides), "evaluation must not mutate the input snapshot");
});

test("policy description explicitly limits the runtime to synthetic daily cash-flow", () => {
  const policy = describePolicy();
  assert.equal(policy.policy_version, POLICY_VERSION);
  assert.equal(policy.contract_version, "daily-risk-workbench.v1");
  assert.equal(policy.real_transactions_allowed, false);
  assert.equal(policy.rules.length, 8);
});

test("integer minor units: reject fractional, unsafe or string money", () => {
  for (const value of [1.01, Number.MAX_SAFE_INTEGER + 1, "200000", NaN, Infinity]) {
    const result = run(fixture({ action_amount_minor: value }));
    assert.equal(result.decision, "ERROR"); has(result, "DAILY_DATA_INCONSISTENT");
  }
});

test("one extra cent blocks, equality passes without rounded-display tolerance", () => {
  assert.equal(run(fixture()).decision, "ALLOW");
  const result = run(fixture({ action_amount_minor: 200001 }));
  assert.equal(result.decision, "BLOCK"); assert.equal(result.metrics.incremental_shortfall_minor, 1);
});

test("unknown required fields cannot silently become zero", () => {
  for (const field of ["fees_minor", "cash_ledger_minor", "cash_available_minor", "action_amount_minor", "extra_nonoverlapping_hold_minor"]) {
    const input = fixture(); delete input[field];
    const result = run(input); assert.equal(result.decision, "REVIEW"); has(result, "DAILY_DATA_REQUIRED");
  }
});

test("unconfirmed hard floor and unsupported actions stay in repairable REVIEW", () => {
  assert.equal(run(fixture({ hard_floor_state: "UNSPECIFIED" })).decision, "REVIEW");
  assert.equal(run(fixture({ action_type: "MYSTERY_PAYMENT" })).decision, "REVIEW");
});

test("cash snapshot mismatch does not double subtract frozen money", () => {
  const result = run(fixture({ cash_available_minor: 1000000 }));
  assert.equal(result.decision, "REVIEW"); has(result, "SHARED_FUNDS_RECONCILIATION_REQUIRED");
});

test("duplicate event identifiers require reconciliation", () => {
  const input = fixture(); input.purposes.push(structuredClone(input.purposes[0]));
  const result = run(input); assert.equal(result.decision, "REVIEW"); has(result, "SHARED_FUNDS_RECONCILIATION_REQUIRED");
});

test("forged hold coverage is a calculation error rather than freed cash", () => {
  const input = fixture({ cash_available_minor: 1100000, holds: [{ hold_id: "bad", amount_minor: 100000, covered_reserved_minor: 600000, purpose_id: "tuition", settlement_link: "VERIFIED" }] });
  const result = run(input); assert.equal(result.decision, "ERROR"); has(result, "DAILY_DATA_INCONSISTENT");
});

test("posted salary already included in the opening snapshot is not added again", () => {
  const result = run(fixture({ action_amount_minor: 300000, income_events: [{ event_id: "posted-salary", amount_minor: 800000, status: "POSTED_INCLUDED", included_in_balance: true, at: now }] }));
  assert.equal(result.metrics.free_before_minor, 200000);
  assert.equal(result.decision, "BLOCK");
  assert.ok(!result.metrics.cashflow.some(row => row.event_id === "posted-salary"));
});

test("future income is excluded from current free money even if forecast remains solvent", () => {
  const result = run(fixture({ income_events: [{ event_id: "future-salary", amount_minor: 800000, status: "EXPECTED", at: "2026-10-18T08:00:00+08:00" }], action_amount_minor: 300000 }));
  assert.equal(result.metrics.free_before_minor, 200000); assert.equal(result.decision, "BLOCK");
});

test("partial linked settlement consumes only the matching portion once", () => {
  const input = fixture({ cash_available_minor: 600000, holds: [{ hold_id: "tuition", amount_minor: 600000, covered_reserved_minor: 600000, purpose_id: "tuition", settlement_link: "VERIFIED" }], action_type: "PURPOSE_PAYMENT", action_amount_minor: 300000, matched_purpose_id: "tuition", purpose_link: "VERIFIED_FOR_SETTLEMENT", settle_hold_id: "tuition" });
  const result = run(input);
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.projected_state.cash_ledger_minor, 900000);
  assert.equal(result.projected_state.holds[0].amount_minor, 300000);
  assert.equal(result.projected_state.purposes[0].reserved_now_minor, 300000);
  assert.equal(result.projected_state.purposes[0].remaining_due_minor, 300000);
  assert.equal(result.metrics.projected_free_after_minor, 200000);
});

test("paying one purpose cannot automatically sacrifice another already underfunded purpose", () => {
  const result = run(fixture({ cash_ledger_minor: 400000, cash_available_minor: 400000, purposes: [{ purpose_id: "tuition", reserved_now_minor: 500000, remaining_due_minor: 500000, due_at: "2026-10-20T12:00:00+08:00" }, { purpose_id: "rent", reserved_now_minor: 100000, remaining_due_minor: 100000, due_at: "2026-10-18T12:00:00+08:00" }], action_type: "PURPOSE_PAYMENT", action_amount_minor: 100000, matched_purpose_id: "rent", purpose_link: "VERIFIED_FOR_SETTLEMENT" }));
  assert.equal(result.decision, "BLOCK"); has(result, "PROTECTED_PURPOSE_CONFLICT");
});

test("unsupported currency, invalid calendar date and arithmetic overflow fail closed", () => {
  for (const overrides of [{ currency: "USD" }, { as_of: "2026-02-30T09:00:00+08:00" }, { action_amount_minor: Number.MAX_SAFE_INTEGER, fees_minor: 1 }]) {
    const result = run(fixture(overrides)); assert.equal(result.decision, "ERROR");
  }
});

test("unknown dates cannot be bypassed by accepting a reminder", () => {
  const input = fixture(); delete input.purposes[0].due_at;
  const result = run(input); assert.equal(result.decision, "REVIEW");
  assert.ok(result.reasons.every(reason => !reason.acceptance_allowed));
});

test("necessary data errors preserve independently known permission blocks", () => {
  const result = run(fixture({ fees_minor: 1.01, proposed_tool: "REAL_TRADE" }));
  assert.equal(result.decision, "ERROR"); has(result, "DAILY_DATA_INCONSISTENT"); has(result, "REAL_TRADING_FORBIDDEN");
});

test("an acceptance label alone cannot skip the mandatory new check", () => {
  const result = run(fixture({ action_type: "SUBSCRIPTION_PAYMENT", action_amount_minor: 16000, category_budget_remaining_minor: 10000, soft_goal_acceptance_required: true, soft_goal_acceptance_state: "ACCEPTED_CURRENT_VERSION", new_recheck_completed: false }));
  assert.equal(result.decision, "REVIEW"); has(result, "PERSONAL_BUDGET_EXCEEDED");
});

test("a planned future action is shown at its date, not charged in the opening snapshot", () => {
  const result = run(fixture({ action_at: "2026-10-19T09:00:00+08:00" }));
  assert.equal(result.metrics.cashflow[0].balance_minor, 1200000);
  const rent = result.metrics.cashflow.find(row => row.event_id === "rent");
  const action = result.metrics.cashflow.find(row => row.kind === "ACTION");
  assert.equal(rent.balance_minor, 1050000);
  assert.equal(action.balance_minor, 850000);
  assert.equal(action.at, "2026-10-19T09:00:00+08:00");
});

test("moving a purpose payment after its due time is not a successful due-date plan", () => {
  const result = run(fixture({ action_type: "PURPOSE_PAYMENT", action_amount_minor: 600000, matched_purpose_id: "tuition", purpose_link: "VERIFIED_FOR_SETTLEMENT", action_at: "2026-10-21T09:00:00+08:00" }));
  assert.equal(result.decision, "BLOCK"); has(result, "PAYMENT_DATE_GAP");
});

test("overdue unposted income and unmodeled restricted income need reconciliation", () => {
  for (const event of [
    { event_id: "yesterday", amount_minor: 800000, at: "2026-10-16T09:00:00+08:00", status: "EXPECTED" },
    { event_id: "earmarked", amount_minor: 800000, at: "2026-10-25T09:00:00+08:00", status: "EXPECTED", restricted_purpose_id: "tuition" }
  ]) {
    const result = run(fixture({ income_events: [event] })); assert.equal(result.decision, "REVIEW");
  }
});

test("a model cannot name an arbitrary executable tool", () => {
  const result = run(fixture({ proposed_tool: "wire.transfer" }));
  assert.equal(result.decision, "BLOCK"); has(result, "PERMISSION_DENIED");
});

test("zero income and zero essential-expense denominators stay explicitly inapplicable", () => {
  const result = run(fixture({ budget_reference_enabled: true, period_take_home_minor: 0, budget_buckets_minor: { needs: 0, goals: 0, wants: 0 }, emergency_target_enabled: true, emergency_allocation_before_minor: 0, action_uses_emergency_allocation_minor: 0, monthly_essential_minor: 0, target_months: 3 }));
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.metrics.metric_status.budget_reference, "NOT_APPLICABLE");
  assert.equal(result.metrics.metric_status.emergency_months, "NOT_APPLICABLE");
  assert.ok(!JSON.stringify(result).includes("Infinity"));
});
