"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers.cjs");
const { projectPlan } = require("../core-adapter.cjs");
function withOrder(side, quantity) {
  const i = h.input();
  i.data_context.trading_rules = { version: "demo-trading.v1", source: "SYNTHETIC_DEMO_RULES_ONLY", as_of: i.data_context.as_of, instruments: [{ instrument_id: "EQUITY_ALPHA", lot_size: 1, calendar_ref: "demo-snapshot-day", settlement_ref: "demo-next-step", fee_schedule_ref: "demo-zero-fee" }] };
  i.binding.trading_rules_version = "demo-trading.v1";
  i.plan.steps[0].orders = [{ instrument_id: "EQUITY_ALPHA", side, quantity, reference_price: 47.2, estimated_fee: 0 }];
  i.binding.plan_hash = h.hash(i.plan); return i;
}
test("R03: insufficient cash is computed rather than trusted from client cash_after", () => {
  assert.equal(projectPlan(withOrder("BUY", 1000)).failures[0].code, "INSUFFICIENT_CASH");
});
test("R03: sellable quantity overflow is blocked", () => {
  assert.equal(projectPlan(withOrder("SELL", 101)).failures[0].code, "INSUFFICIENT_SELLABLE_QUANTITY");
});
test("R02: unknown trading model is not silently simplified", () => {
  const i = withOrder("BUY", 1); i.data_context.trading_rules = null;
  assert.throws(() => projectPlan(i), /缺少/);
});
test("R02: manufactured selling capacity is rejected", () => {
  const i = withOrder("SELL", 101); i.plan.steps[0].sellable_quantities.EQUITY_ALPHA = 10000;
  assert.throws(() => projectPlan(i), /可卖数量/);
});
