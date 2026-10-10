"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const marketBrief = require("../tools/market-brief");
const brief = require("../data/market-brief-2026-10-08.json");
const briefNext = require("../data/market-brief-2026-10-09.json");
const tools = require("../tools/financial-tools");
const { Harness } = require("../core/harness");
const { createRequest } = require("../contracts/investment-contract");

const riskProfile = { investment_horizon_days: 365, max_drawdown: 0.1, liquidity_need: "medium" };

test("market brief fixture validates and flags abnormal moves without inventing attribution", () => {
  const result = marketBrief.validateMarketBrief(brief);
  assert.equal(result.valid, true);
  assert.equal(result.output.as_of, "2026-10-08");
  assert.deepEqual(result.output.abnormal_moves, [{ asset_id: "CHINEXT", change_pct: -3.15, threshold_pct: 3 }, { asset_id: "NYMEX_CRUDE", change_pct: 4.15, threshold_pct: 3 }]);
  assert.deepEqual(result.output.unresolved_conflicts.map((signal) => signal.signal_id), ["oil-message-conflict"]);
  assert.match(result.tool_result.warnings[0], /does not change Quant calculations/);
});

test("Core Agent carries market context to Risk while preserving Quant outputs", () => {
  const portfolio = tools.getDemoPortfolio();
  const plain = new Harness().runHealthCheckContract(createRequest({ requestId: "req-brief-plain-001", riskProfile, portfolio }));
  const contextual = new Harness().runHealthCheckContract(createRequest({ requestId: "req-brief-context-001", riskProfile, portfolio, marketContext: brief }));
  assert.equal(contextual.artifacts.market_context.brief_id, brief.brief_id);
  assert.equal(contextual.risk_handoff.evidence.market_context_id, contextual.artifacts.market_context.context_id);
  assert.equal(contextual.risk_handoff.execution_allowed, false);
  assert.deepEqual(contextual.artifacts.health_report.metrics, plain.artifacts.health_report.metrics);
  assert.deepEqual(contextual.artifacts.candidates.map((candidate) => candidate.target_weights), plain.artifacts.candidates.map((candidate) => candidate.target_weights));
  assert.deepEqual(contextual.artifacts.simulation.comparisons, plain.artifacts.simulation.comparisons);
  assert.ok(Object.values(contextual.tool_results).some((result) => result.tool_name === "market-brief.context"));
});

test("duplicate market observations stop at the Core Agent input boundary", () => {
  const invalid = structuredClone(brief);
  invalid.market[1].asset_id = invalid.market[0].asset_id;
  assert.throws(() => new Harness().runHealthCheckContract(createRequest({
    requestId: "req-brief-invalid-001",
    riskProfile,
    marketContext: invalid
  })), (error) => error.code === "INVALID_MARKET_CONTEXT" && error.details.errors.some((item) => item.path.endsWith(".asset_id")));
});

test("2026-10-09 market brief replays with source conflict evidence and no Quant drift", () => {
  const validation = marketBrief.validateMarketBrief(briefNext);
  assert.equal(validation.valid, true);
  assert.equal(validation.output.as_of, "2026-10-09");
  assert.deepEqual(validation.output.abnormal_moves, []);
  assert.deepEqual(validation.output.unresolved_conflicts.map(signal => signal.signal_id), ["rates-view-data-conflict"]);
  assert.equal(validation.output.source_checks.find(check => check.scope === "美债10Y与30Y官方数据").status, "OFFICIAL_SOURCE");

  const portfolio = tools.getDemoPortfolio();
  const plain = new Harness().runHealthCheckContract(createRequest({
    requestId: "req-brief-plain-20261009-001",
    riskProfile,
    portfolio
  }));
  const contextual = new Harness().runHealthCheckContract(createRequest({
    requestId: "req-brief-context-20261009-001",
    riskProfile,
    portfolio,
    marketContext: briefNext
  }));
  assert.equal(contextual.artifacts.market_context.brief_id, briefNext.brief_id);
  assert.deepEqual(contextual.artifacts.health_report.metrics, plain.artifacts.health_report.metrics);
  assert.deepEqual(contextual.artifacts.candidates.map(candidate => candidate.target_weights), plain.artifacts.candidates.map(candidate => candidate.target_weights));
  assert.deepEqual(contextual.artifacts.simulation.comparisons, plain.artifacts.simulation.comparisons);
  assert.equal(contextual.risk_handoff.execution_allowed, false);
  assert.equal(contextual.risk_handoff.evidence.audit_id, contextual.audit_evidence.audit_id);
});
