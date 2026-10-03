"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const tools = require("../tools/financial-tools");
const { Harness } = require("../core/harness");

const riskProfile = {
  investment_horizon_days: 365,
  max_drawdown: 0.1,
  liquidity_need: "medium"
};

function demoHealthCheck() {
  const imported = tools.validatePortfolio(tools.getDemoPortfolio());
  assert.equal(imported.output.valid, true);
  const report = tools.diagnosePortfolio(imported.output.snapshot).output;
  const candidates = tools.generateCandidates(imported.output.snapshot, report).output.candidates;
  const simulation = tools.runSimulation(imported.output.snapshot, candidates).output;
  return { snapshot: imported.output.snapshot, report, candidates, simulation };
}

test("demo portfolio validates and preserves the weight invariant", () => {
  const imported = tools.validatePortfolio(tools.getDemoPortfolio());
  assert.equal(imported.output.valid, true);
  const snapshot = imported.output.snapshot;
  const weightSum = snapshot.cash_weight + snapshot.positions.reduce((total, position) => total + position.weight, 0);
  assert.ok(Math.abs(weightSum - 1) < 0.000001);
  assert.equal(snapshot.data_quality.status, "VALID");
});

test("invalid market values stop the tool instead of being guessed", () => {
  const portfolio = tools.getDemoPortfolio();
  portfolio.positions[0].price = 0;
  const imported = tools.validatePortfolio(portfolio);
  assert.equal(imported.output.valid, false);
  assert.match(imported.output.errors.join(";"), /price must be positive/);
});

test("diagnosis is deterministic and exposes hidden concentration", () => {
  const first = demoHealthCheck();
  const second = demoHealthCheck();
  assert.deepEqual(first.report.metrics, second.report.metrics);
  assert.deepEqual(first.report.correlation_matrix, second.report.correlation_matrix);
  assert.ok(first.report.hidden_clusters.length >= 1);
  assert.ok(first.report.attention_points.length >= 1);
});

test("candidate generation creates three structured plans", () => {
  const { candidates } = demoHealthCheck();
  assert.deepEqual(candidates.map((candidate) => candidate.plan_id), ["A", "B", "C"]);
  for (const candidate of candidates) {
    assert.ok(candidate.proposal_hash);
    assert.equal(candidate.validation.valid, true);
    assert.ok(candidate.actions.length >= 4);
    const weightSum = Object.values(candidate.target_weights).reduce((total, weight) => total + weight, 0);
    assert.ok(Math.abs(weightSum - 1) < 0.000001);
    assert.ok(candidate.turnover <= candidate.constraints.max_turnover || candidate.plan_id === "A");
    const maxSecurityWeight = Math.max(...Object.entries(candidate.target_weights).filter(([instrumentId]) => instrumentId !== "CASH").map(([, weight]) => weight));
    assert.ok(maxSecurityWeight <= candidate.constraints.max_single_asset_weight + 0.000001);
  }
});

test("simulation rejects a tampered ActionProposal", () => {
  const { snapshot, candidates } = demoHealthCheck();
  const tampered = { ...candidates[1], target_weights: { ...candidates[1].target_weights, EQUITY_ALPHA: 0.5 } };
  assert.throws(() => tools.runSimulation(snapshot, [tampered]), /invalid ActionProposal/);
});

test("simulation returns reproducible quantiles with fixed seed", () => {
  const first = demoHealthCheck().simulation;
  const second = demoHealthCheck().simulation;
  assert.equal(first.scenarios[0].distribution.seed, tools.constants.SCENARIO_SEED);
  assert.equal(first.scenarios[0].distribution.paths, tools.constants.SCENARIO_PATHS);
  assert.deepEqual(first.scenarios, second.scenarios);
  for (const scenario of first.scenarios) {
    assert.ok(scenario.distribution.p10 <= scenario.distribution.p50);
    assert.ok(scenario.distribution.p50 <= scenario.distribution.p90);
  }
});

test("harness stops at the ownership boundary and supports clarification", () => {
  const harness = new Harness();
  const waiting = harness.runHealthCheck({});
  assert.equal(waiting.task_state.status, "WAITING_INPUT");
  assert.deepEqual(waiting.task_state.missing_fields, ["investment_horizon_days", "max_drawdown", "liquidity_need"]);

  const completed = harness.runHealthCheck({
    task_id: waiting.task_state.task_id,
    session_id: waiting.task_state.session_id,
    risk_profile: riskProfile
  });
  assert.equal(completed.task_state.stage, "RISK_CHECK");
  assert.equal(completed.task_state.status, "HANDOFF_REQUIRED");
  assert.equal(completed.task_state.handoff.owner, "Safety/Risk/Eval");
  assert.equal(completed.task_state.checkpoint.stage, "RISK_CHECK");
  assert.equal(completed.artifacts.candidates.length, 3);
});

test("harness resumes from the last completed checkpoint after a tool failure", () => {
  const flakyToolset = { ...tools, diagnosePortfolio: () => { throw new Error("temporary market data timeout"); } };
  const harness = new Harness({ toolset: flakyToolset });
  const session = harness.createSession({ risk_profile: riskProfile });
  assert.throws(() => harness.runHealthCheck({ task_id: session.task_state.task_id }), /temporary market data timeout/);
  const failed = harness.getTask(session.task_state.task_id);
  assert.equal(failed.task_state.status, "FAILED");
  assert.deepEqual(failed.task_state.checkpoint.completed, ["VALIDATE_INPUT"]);

  harness.toolset.diagnosePortfolio = tools.diagnosePortfolio;
  harness.resume(session.task_state.task_id);
  const resumed = harness.runHealthCheck({ task_id: session.task_state.task_id });
  assert.equal(resumed.task_state.stage, "RISK_CHECK");
  assert.equal(resumed.task_state.status, "HANDOFF_REQUIRED");
  const audit = harness.getAudit(session.task_state.task_id);
  assert.ok(audit.events.some((event) => event.event_type === "stage.reused" && event.payload.stage === "VALIDATE_INPUT"));
});

test("memory requires explicit consent and is session-only", () => {
  const harness = new Harness();
  const session = harness.createSession({ risk_profile: riskProfile });
  assert.throws(() => harness.saveMemory(session.task_state.task_id, { type: "preference", value: { max_turnover: 0.1 } }), /explicit consent/);
  const entry = harness.saveMemory(session.task_state.task_id, {
    type: "preference",
    key: "risk_style",
    value: { max_turnover: 0.1 },
    consent: true
  });
  assert.equal(entry.source, "user_confirmed");
  assert.equal(harness.listMemory(session.task_state.session_id).length, 1);
  harness.reset();
  assert.equal(harness.listMemory(session.task_state.session_id).length, 0);
});

test("paper trading fails closed and is idempotent", () => {
  const { snapshot, candidates } = demoHealthCheck();
  const proposal = candidates[1];
  const blocked = tools.paperTrade({ snapshot, proposal, idempotency_key: "demo-key" });
  assert.equal(blocked.output.status, "REQUIRES_APPROVAL");
  const executed = tools.paperTrade({ snapshot, proposal, approval: { status: "APPROVED", token: "one-time-token" }, idempotency_key: "demo-key" });
  assert.equal(executed.output.status, "FILLED");
  const replay = tools.paperTrade({ snapshot, proposal, approval: { status: "APPROVED", token: "different-token" }, idempotency_key: "demo-key" });
  assert.equal(replay.output.status, "IDEMPOTENT_REPLAY");
  tools.resetPaperTrading();
});
