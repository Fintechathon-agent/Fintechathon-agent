"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluate, executionEligible } = require("../engine.cjs");
const h = require("./helpers.cjs");
const run = (i, extra = {}) => evaluate(i, { ...h.authority(i), ...extra }, { now: h.now });
const has = (r, code) => assert.ok(r.reasons.some((x) => x.code === code), JSON.stringify(r.reasons));

for (const [name, expected] of [["allow", "ALLOW"], ["review", "REVIEW"], ["block", "BLOCK"], ["error", "ERROR"]]) test(`R01-R07: actual engine returns ${expected} for ${name}`, () => {
  const i = h.input(name), result = run(i); assert.equal(result.decision, expected); assert.deepEqual(h.outputIssues(result, i), []); assert.equal(result.execution_allowed, false);
});
test("R01: no trusted identity denies access", () => has(evaluate(h.input(), {}, { now: h.now }), "PERMISSION_DENIED"));
test("R01: real trade and unauthorized tools remain blocked", () => {
  const i = h.input(); i.context.requested_operation = "REAL_TRADE"; i.context.requested_tool = "trade.real";
  const r = run(i); has(r, "REAL_TRADE_FORBIDDEN"); has(r, "TOOL_NOT_ALLOWED");
});
test("R02: malformed input is a protocol error and not ALLOW", () => assert.throws(() => evaluate({}), /contract/));
test("R02: stale current data fails closed", () => {
  const i = h.input(); i.plan.data_mode = "LATEST_AVAILABLE"; i.binding.plan_hash = h.hash(i.plan); i.data_context.usage = "CURRENT_ADVICE"; i.data_context.valid_until = "2020-01-01T00:00:00Z";
  has(run(i), "DATA_STALE");
});
test("R02: unknown user constraint remains non-acceptable REVIEW", () => {
  const i = h.input(); i.profile.reserve_cash = null; const r = run(i);
  has(r, "DATA_MISSING"); assert.equal(r.reasons.find((r) => r.code === "DATA_MISSING").acceptance_allowed, false);
});
test("R02: changed proposal without matching digest fails", () => {
  const i = h.input(); i.upstream.artifacts.candidates[0].target_weights.CASH = .8;
  assert.equal(run(i).decision, "ERROR");
});
test("R03: forbidden holding cannot be accepted", () => { const i = h.input(); i.profile.forbidden_instruments = ["ETF_GROWTH"]; has(run(i), "FORBIDDEN_ASSET"); });
test("R03: reserve boundary equal passes and one cent above blocks", () => {
  const i = h.input(); i.profile.reserve_cash = 10000; assert.equal(run(i).decision, "ALLOW");
  i.profile.reserve_cash = 10000.01; has(run(i), "RESERVE_CASH_VIOLATION");
});
function weighted(weights) {
  const i = h.input(); const p = i.upstream.artifacts.candidates[0];
  p.target_weights = weights; p.constraints.max_single_asset_weight = 1; p.constraints.max_turnover = 1;
  p.actions = Object.entries(weights).map(([instrument_id, to_weight]) => ({ instrument_id, from_weight: to_weight, to_weight, delta_weight: 0, side: "HOLD" }));
  delete p.proposal_hash; delete p.validation; p.proposal_hash = h.hash(p); p.validation = { valid: true, errors: [] }; i.binding.proposal_hash = p.proposal_hash;
  return i;
}
const projection = (i) => ({ steps: i.plan.steps.map((s) => ({ step_id: s.step_id, cash_after: s.cash_after, held_instruments: [] })), failures: [] });
test("R04: invested denominator blocks despite safe total denominator", () => {
  const i = weighted({ CASH: .6, EQUITY_ALPHA: .25, ETF_GROWTH: .05, ETF_CONSUMER: .05, ETF_BOND: .05 });
  const r = run(i, { project_plan: projection });
  assert.ok(r.reasons.some((x) => x.code === "SINGLE_ASSET_LIMIT_EXCEEDED" && x.measurements[0].basis === "INVESTED_ASSETS"));
});
test("R04: exact single-asset limit does not trigger and a larger value does", () => {
  const i = weighted({ CASH: 0, EQUITY_ALPHA: .35, ETF_GROWTH: .15, ETF_CONSUMER: .25, ETF_BOND: .25 });
  assert.equal(run(i, { project_plan: projection }).reasons.some((x) => x.code === "SINGLE_ASSET_LIMIT_EXCEEDED"), false);
  const j = weighted({ CASH: 0, EQUITY_ALPHA: .35001, ETF_GROWTH: .14999, ETF_CONSUMER: .25, ETF_BOND: .25 });
  has(run(j, { project_plan: projection }), "SINGLE_ASSET_LIMIT_EXCEEDED");
});
test("R05: known overshoot remains BLOCK alongside acceptable unknown sector REVIEW", () => {
  const i = weighted({ CASH: .2, EQUITY_ALPHA: .3, ETF_GROWTH: .25, ETF_CONSUMER: .15, ETF_BOND: .1 });
  i.data_context.classification[2].sector_weights = {}; i.data_context.classification[2].unknown_weight = 1;
  const r = run(i, { project_plan: projection }); has(r, "SECTOR_LIMIT_EXCEEDED"); has(r, "SECTOR_INFORMATION_INCOMPLETE"); assert.equal(r.decision, "BLOCK");
});
test("R06: equal drawdown tolerance passes; greater drawdown requires acceptance", () => {
  const i = h.input(); i.profile.max_historical_drawdown = .02789133; assert.equal(run(i).decision, "ALLOW");
  i.profile.max_historical_drawdown = .02789; has(run(i), "MAX_DRAWDOWN_EXCEEDED");
});
test("R07: threshold uses correlation >=.8 AND combined weight >.4", () => {
  for (const [weight, rho, expected] of [[.2,.8,false],[.21,.8,true],[.21,.79999,false]]) {
    const i = weighted({ CASH: .2, EQUITY_ALPHA: weight, ETF_GROWTH: .2, ETF_CONSUMER: .2, ETF_BOND: .4-weight });
    const matrix = i.upstream.artifacts.health_report.correlation_matrix;
    for (const a of Object.keys(matrix)) for (const b of Object.keys(matrix)) matrix[a][b] = a === b ? 1 : 0;
    matrix.EQUITY_ALPHA.ETF_GROWTH = matrix.ETF_GROWTH.EQUITY_ALPHA = rho;
    assert.equal(run(i, { project_plan: projection }).reasons.some((x) => x.code === "HIGH_CORRELATION_CONCENTRATION"), expected);
  }
});
test("R02: missing correlation does not become zero correlation", () => {
  const i = h.input(); delete i.upstream.artifacts.health_report.correlation_matrix.ETF_GROWTH.EQUITY_ALPHA;
  assert.equal(run(i).decision, "ERROR");
});
test("R08-R10: execution preflight denies missing approval/key/audit", () => {
  const i = h.input(); i.stage = "EXECUTION_PREFLIGHT"; const r = run(i);
  has(r, "APPROVAL_REQUIRED"); has(r, "IDEMPOTENCY_CONFLICT"); has(r, "PRE_EXECUTION_AUDIT_FAILED"); assert.equal(executionEligible(r), false);
});
test("R02: missing concrete execution steps for rebalance stays ERROR", () => {
  const { input: i } = h.fresh(); const p = i.upstream.artifacts.candidates[1]; i.binding.proposal_id = p.proposal_id; i.binding.proposal_hash = p.proposal_hash;
  assert.equal(run(i).decision, "ERROR");
});
function gradualInput(worsen = false) {
  const i = weighted(worsen ? { CASH: 0, EQUITY_ALPHA: .45, ETF_GROWTH: .3, ETF_CONSUMER: .15, ETF_BOND: .1 } : { CASH: 0, EQUITY_ALPHA: .45, ETF_GROWTH: .25, ETF_CONSUMER: .2, ETF_BOND: .1 });
  const before = [.5, .2, .2, .1], snapshot = i.upstream.artifacts.portfolio_snapshot;
  snapshot.cash = 0; snapshot.total_value = 100000;
  snapshot.positions.forEach((p, index) => { p.market_value = before[index] * 100000; p.quantity = p.market_value / p.price; p.weight = before[index]; });
  i.profile.reserve_cash = 0;
  i.plan.improvement_focus = { metric: "SINGLE_ASSET", basis: "TOTAL_ASSETS", subject_id: "EQUITY_ALPHA", baseline_evidence_ref: "/upstream/artifacts/portfolio_snapshot" };
  i.binding.plan_hash = h.hash(i.plan);
  return i;
}
test("R04/R05: strict focus improvement without worse limits permits acceptance", () => {
  const r = run(gradualInput(), { project_plan: projection });
  has(r, "GRADUAL_IMPROVEMENT_ACCEPTANCE"); assert.equal(r.reasons.some((x) => x.decision === "BLOCK"), false);
});
test("R04/R05: improving one asset cannot worsen industry overshoot", () => {
  const r = run(gradualInput(true), { project_plan: projection });
  has(r, "SECTOR_LIMIT_EXCEEDED"); assert.equal(r.decision, "BLOCK");
});
test("R05: unknown industry cannot establish gradual improvement", () => {
  const i = gradualInput(); i.data_context.classification[3].sector_weights = {}; i.data_context.classification[3].unknown_weight = 1;
  const r = run(i, { project_plan: projection }); assert.equal(r.reasons.some((x) => x.code === "GRADUAL_IMPROVEMENT_ACCEPTANCE"), false); assert.equal(r.decision, "BLOCK");
});
test("R04: unsafe intermediate allocation cannot be hidden by a safe endpoint", () => {
  const i = h.input(); i.plan.steps.push({ ...structuredClone(i.plan.steps[0]), step_id: "last-step" }); i.binding.plan_hash = h.hash(i.plan);
  const r = run(i, { project_plan: () => ({ failures: [], steps: [{ step_id: "temporary", cash_after: 0, quantities: { EQUITY_ALPHA: 1000 } }, { step_id: "last-step", cash_after: 10000 }] }) });
  has(r, "SINGLE_ASSET_LIMIT_EXCEEDED");
});
