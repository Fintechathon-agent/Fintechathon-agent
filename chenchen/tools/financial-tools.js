"use strict";

const crypto = require("node:crypto");
const dataset = require("../data/demo-portfolio.json");

const TOOL_VERSION = "financial-tools@0.4.0";
const PERIODS_PER_YEAR = 252;
const DEFAULT_SCENARIO_PATHS = 2000;
const DEFAULT_SCENARIO_SEED = dataset.scenario_seed;
const paperReceipts = new Map();

class FinancialToolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FinancialToolError";
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function round(value, digits = 8) {
  const factor = 10 ** digits;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values) {
  return values.length ? sum(values) / values.length : 0;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(sum(values.map((value) => (value - average) ** 2)) / (values.length - 1));
}

function correlation(left, right) {
  if (left.length !== right.length || left.length < 2) return 0;
  const leftMean = mean(left);
  const rightMean = mean(right);
  const numerator = sum(left.map((value, index) => (value - leftMean) * (right[index] - rightMean)));
  const leftDenominator = Math.sqrt(sum(left.map((value) => (value - leftMean) ** 2)));
  const rightDenominator = Math.sqrt(sum(right.map((value) => (value - rightMean) ** 2)));
  if (!leftDenominator || !rightDenominator) return 0;
  return round(numerator / (leftDenominator * rightDenominator), 6);
}

function quantile(values, probability) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return round(sorted[lower]);
  return round(sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower));
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function makeToolResult(toolName, inputs, output, warnings = []) {
  return {
    tool_name: toolName,
    version: TOOL_VERSION,
    inputs_hash: hash(inputs),
    output,
    data_as_of: dataset.as_of,
    warnings: [...warnings, "Synthetic replay data: seven observations only; not suitable for investment decisions."],
    trace_id: `trace-${hash({ toolName, inputs }).slice(0, 16)}`
  };
}

function getDemoPortfolio() {
  return clone(dataset.portfolio);
}

function latestPrice(instrumentId) {
  const prices = dataset.price_history.prices[instrumentId];
  return prices ? prices[prices.length - 1] : null;
}

function validatePortfolio(input = getDemoPortfolio()) {
  const candidate = input && input.portfolio ? input.portfolio : input;
  const positions = Array.isArray(candidate && candidate.positions) ? candidate.positions : [];
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const normalizedPositions = [];

  if (!candidate || typeof candidate !== "object") errors.push("portfolio must be an object");
  const cash = candidate && candidate.cash;
  if (!Number.isFinite(cash) || cash < 0) errors.push("cash must be a non-negative number");
  if (!positions.length) errors.push("positions must contain at least one instrument");

  for (const position of positions) {
    const instrumentId = position && position.instrument_id;
    const metadata = dataset.instrument_metadata[instrumentId];
    const quantity = position && position.quantity;
    const price = position && position.price === undefined ? latestPrice(instrumentId) : position && position.price;
    if (!instrumentId || seen.has(instrumentId)) errors.push(`duplicate or missing instrument_id: ${instrumentId || "unknown"}`);
    if (instrumentId) seen.add(instrumentId);
    if (!metadata) errors.push(`unsupported instrument: ${instrumentId || "unknown"}`);
    if (!Number.isFinite(quantity) || quantity <= 0) errors.push(`quantity must be positive: ${instrumentId || "unknown"}`);
    if (!Number.isFinite(price) || price <= 0) errors.push(`price must be positive: ${instrumentId || "unknown"}`);
    if (metadata && position.type && position.type !== metadata.type) errors.push(`instrument type mismatch: ${instrumentId}`);
    if (metadata && Number.isFinite(quantity) && quantity % metadata.lot_size !== 0) {
      errors.push(`quantity must respect lot_size for ${instrumentId}`);
    }
    if (metadata && Number.isFinite(quantity) && Number.isFinite(price)) {
      normalizedPositions.push({
        instrument_id: instrumentId,
        name: position.name || instrumentId,
        type: metadata.type,
        sector: position.sector || "Unclassified",
        quantity,
        price: round(price, 4),
        market_value: round(quantity * price, 4)
      });
    }
  }

  const totalValue = cash + sum(normalizedPositions.map((position) => position.market_value));
  if (!Number.isFinite(totalValue) || totalValue <= 0) errors.push("total_value must be positive");
  if (candidate && candidate.total_value !== undefined && (!Number.isFinite(candidate.total_value) || Math.abs(candidate.total_value - totalValue) > 0.01)) {
    errors.push("declared total_value does not equal cash plus market value");
  }
  if (!candidate || candidate.as_of !== dataset.as_of) errors.push("snapshot date must match the fixed replay data_as_of");
  for (const position of normalizedPositions) {
    if (Math.abs(position.price - latestPrice(position.instrument_id)) > 0.0001) errors.push("price does not match fixed replay data: " + position.instrument_id);
  }

  const snapshot = {
    snapshot_id: `snapshot-${hash({ candidate, totalValue }).slice(0, 16)}`,
    portfolio_id: candidate && candidate.portfolio_id ? candidate.portfolio_id : "imported-portfolio",
    as_of: candidate && candidate.as_of ? candidate.as_of : dataset.as_of,
    positions: normalizedPositions.map((position) => ({
      ...position,
      weight: totalValue ? round(position.market_value / totalValue, 8) : 0
    })),
    cash: round(cash, 4),
    cash_weight: totalValue ? round(cash / totalValue, 8) : 0,
    total_value: round(totalValue, 4),
    data_quality: {
      status: errors.length ? "INVALID" : "VALID",
      errors,
      warnings
    }
  };

  return makeToolResult("portfolio.import", input, {
    valid: errors.length === 0,
    snapshot: errors.length ? null : snapshot,
    errors,
    warnings
  }, warnings);
}

function requireSnapshot(snapshotOrInput) {
  const result = validatePortfolio(snapshotOrInput || getDemoPortfolio());
  if (!result.output.valid) throw new FinancialToolError("INVALID_PORTFOLIO", "portfolio validation failed", result.output);
  if (snapshotOrInput && snapshotOrInput.snapshot_id) {
    const normalized = result.output.snapshot;
    for (const p of snapshotOrInput.positions) {
      const n = normalized.positions.find(v => v.instrument_id === p.instrument_id);
      if (!Number.isFinite(p.weight) || !Number.isFinite(p.market_value) || Math.abs(n.weight - p.weight) > 1e-6 || Math.abs(n.market_value - p.market_value) > 0.01)
        throw new FinancialToolError("INVALID_PORTFOLIO", "snapshot amounts and weights are inconsistent");
    }
    if (!Number.isFinite(snapshotOrInput.cash_weight) || Math.abs(normalized.cash_weight - snapshotOrInput.cash_weight) > 1e-6)
      throw new FinancialToolError("INVALID_PORTFOLIO", "cash weight is inconsistent");
    return { ...normalized, snapshot_id: snapshotOrInput.snapshot_id };
  }
  return result.output.snapshot;
}

function getPriceSeries(instrumentId) {
  const series = dataset.price_history.prices[instrumentId];
  if (!series || series.length !== dataset.price_history.dates.length) {
    throw new FinancialToolError("MISSING_MARKET_DATA", `price history unavailable: ${instrumentId}`);
  }
  return series;
}

function weightsFor(snapshot) {
  const weights = snapshot.positions.reduce((weights, position) => {
    weights[position.instrument_id] = position.weight;
    return weights;
  }, { CASH: snapshot.cash_weight });
  weights.CASH = round(1 - sum(snapshot.positions.map(position => position.weight)));
  return weights;
}

function buildPath(snapshot, weights) {
  return dataset.price_history.dates.map((date, index) => {
    const securityValue = sum(Object.keys(weights).filter(id => id !== "CASH").map((id) => {
      const prices = getPriceSeries(id);
      return (weights[id] || 0) * prices[index] / prices[0];
    }));
    return { date, value: round((weights.CASH || 0) + securityValue, 8) };
  });
}

function metricsFromPath(path, transactionCost = 0) {
  const values = path.map((point) => point.value);
  const returns = values.slice(1).map((value, index) => value / values[index] - 1);
  let peak = values[0] || 1;
  let maxDrawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
  }
  const volatility = standardDeviation(returns) * Math.sqrt(PERIODS_PER_YEAR);
  const annualizedReturn = returns.length ? (values[values.length - 1] ** (PERIODS_PER_YEAR / returns.length)) - 1 : 0;
  const riskFreeRate = 0.02;
  const sharpe = volatility ? (mean(returns) * PERIODS_PER_YEAR - riskFreeRate) / volatility : 0;
  return {
    cumulative_return: round(values[values.length - 1] - 1 - transactionCost),
    annualized_return: round(annualizedReturn),
    annualized_volatility: round(volatility),
    max_drawdown: round(maxDrawdown),
    sharpe_ratio: round(sharpe),
    ending_index: round(values[values.length - 1] - transactionCost)
  };
}

function diagnosePortfolio(snapshotOrInput) {
  const snapshot = requireSnapshot(snapshotOrInput);
  const weights = weightsFor(snapshot);
  const assetReturns = {};
  for (const position of snapshot.positions) {
    const prices = getPriceSeries(position.instrument_id);
    assetReturns[position.instrument_id] = prices.slice(1).map((price, index) => price / prices[index] - 1);
  }
  const path = buildPath(snapshot, weights);
  const metrics = metricsFromPath(path);
  const correlations = {};
  const hiddenClusters = [];
  const ids = snapshot.positions.map((position) => position.instrument_id);
  for (let leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
    correlations[ids[leftIndex]] = {};
    for (let rightIndex = 0; rightIndex < ids.length; rightIndex += 1) {
      correlations[ids[leftIndex]][ids[rightIndex]] = leftIndex === rightIndex
        ? 1
        : correlation(assetReturns[ids[leftIndex]], assetReturns[ids[rightIndex]]);
      if (rightIndex > leftIndex && correlations[ids[leftIndex]][ids[rightIndex]] >= 0.8) {
        hiddenClusters.push({
          instruments: [ids[leftIndex], ids[rightIndex]],
          correlation: correlations[ids[leftIndex]][ids[rightIndex]]
        });
      }
    }
  }
  const orderedWeights = Object.entries(weights).filter(([id]) => id !== "CASH").sort((left, right) => right[1] - left[1]);
  const hhi = sum(Object.values(weights).map((weight) => weight ** 2));
  const report = {
    report_id: `health-${hash({ snapshot: snapshot.snapshot_id, weights }).slice(0, 16)}`,
    snapshot_id: snapshot.snapshot_id,
    metrics,
    cash_weight: snapshot.cash_weight,
    concentration: {
      hhi: round(hhi),
      hhi_basis: "all assets including cash; top-N excludes cash",
      top_1: round(orderedWeights[0][1]),
      top_3: round(sum(orderedWeights.slice(0, 3).map((entry) => entry[1]))),
      largest_instrument: orderedWeights[0][0]
    },
    correlation_matrix: correlations,
    hidden_clusters: hiddenClusters,
    attention_points: [
      ...(orderedWeights[0][1] > 0.2 ? ["largest position exceeds 20%"] : []),
      ...(hiddenClusters.length ? ["multiple instruments move together in the fixed window"] : []),
      ...(snapshot.cash_weight < 0.1 ? ["cash buffer is below 10%"] : [])
    ],
    data_window: {
      start: dataset.price_history.dates[0],
      end: dataset.price_history.dates[dataset.price_history.dates.length - 1],
      observations: dataset.price_history.dates.length,
      annualization_factor: PERIODS_PER_YEAR
    }
  };
  return makeToolResult("portfolio.diagnose", snapshot, report);
}

function normalizeWeights(weights) {
  const total = sum(Object.values(weights));
  if (!total) throw new FinancialToolError("INVALID_WEIGHTS", "target weights must sum to a positive value");
  const normalized = Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, round(value / total, 8)]));
  const remainder = round(1 - sum(Object.values(normalized)), 8);
  normalized.CASH = round((normalized.CASH || 0) + remainder, 8);
  return normalized;
}

function capSecurityWeights(weights, maxSingleAssetWeight) {
  const capped = { ...weights };
  let released = 0;
  for (const [instrumentId, weight] of Object.entries(capped)) {
    if (instrumentId !== "CASH" && weight > maxSingleAssetWeight) {
      released += weight - maxSingleAssetWeight;
      capped[instrumentId] = maxSingleAssetWeight;
    }
  }
  capped.CASH = (capped.CASH || 0) + released;
  return normalizeWeights(capped);
}

function turnoverBetween(current, target) {
  const ids = new Set([...Object.keys(current), ...Object.keys(target)]);
  return round(sum([...ids].map((id) => Math.abs((target[id] || 0) - (current[id] || 0)))) / 2);
}

function validateProposal(proposal, { requireHash = false } = {}) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) return { valid: false, errors: ["proposal must be an object"] };
  const errors = [];
  const targetWeights = proposal && proposal.target_weights;
  const constraints = proposal && proposal.constraints;
  if (!proposal || typeof proposal !== "object") errors.push("proposal must be an object");
  if (!targetWeights || typeof targetWeights !== "object") errors.push("target_weights must be an object");
  if (!constraints || typeof constraints !== "object") errors.push("constraints must be an object");

  if (targetWeights && typeof targetWeights === "object") {
    const values = Object.values(targetWeights);
    if (!values.length) errors.push("target_weights must contain at least one asset");
    if (Array.isArray(targetWeights) || values.some((value) => !Number.isFinite(value) || value < 0)) errors.push("target_weights must contain finite non-negative numbers");
    if (Object.keys(targetWeights).some(id => id !== "CASH" && !Object.hasOwn(dataset.instrument_metadata, id))) errors.push("unknown instrument in target_weights");
    const weightSum = sum(values.map(Number));
    if (Math.abs(weightSum - 1) > 0.000001) errors.push(`target_weights must sum to 1, received ${round(weightSum)}`);
    const securityWeights = Object.entries(targetWeights).filter(([instrumentId]) => instrumentId !== "CASH").map(([, value]) => Number(value));
    if (constraints && Number.isFinite(Number(constraints.max_single_asset_weight)) && securityWeights.some((weight) => weight > Number(constraints.max_single_asset_weight) + 0.000001)) {
      errors.push("target_weights exceed max_single_asset_weight");
    }
  }
  if (!constraints || !Number.isFinite(constraints.max_turnover) || constraints.max_turnover < 0 || constraints.max_turnover > 1 ||
      !Number.isFinite(constraints.max_single_asset_weight) || constraints.max_single_asset_weight <= 0 || constraints.max_single_asset_weight > 1)
    errors.push("invalid numeric constraints");

  if (!Number.isFinite(proposal.turnover) || proposal.turnover < 0) errors.push("turnover must be a non-negative number");
  if (constraints && Number.isFinite(Number(constraints.max_turnover)) && Number(proposal.turnover) > Number(constraints.max_turnover) + 0.000001) {
    errors.push("turnover exceeds max_turnover");
  }

  if (!Array.isArray(proposal.actions) || !proposal.actions.length) errors.push("actions must be a non-empty array");
  if (Array.isArray(proposal.actions) && targetWeights) {
    const seen = new Set();
    for (const action of proposal.actions) {
      if (!action || typeof action.instrument_id !== "string" || seen.has(action.instrument_id) ||
          !Number.isFinite(action.from_weight) || !Number.isFinite(action.to_weight) || !Number.isFinite(action.delta_weight)) {
        errors.push("invalid or duplicate action"); continue;
      }
      seen.add(action.instrument_id);
      const target = Number(targetWeights[action.instrument_id] || 0);
      if (Math.abs(target - Number(action.to_weight)) > 0.000001) errors.push(`action target mismatch: ${action.instrument_id}`);
      if (Math.abs(action.to_weight - action.from_weight - action.delta_weight) > 0.000001) errors.push("action delta mismatch");
    }
    if (Object.keys(targetWeights).some(id => !seen.has(id))) errors.push("missing action for target asset");
  }

  if (requireHash || proposal && proposal.proposal_hash) {
    const unsigned = clone(proposal || {});
    delete unsigned.proposal_hash;
    delete unsigned.validation;
    if (!proposal.proposal_hash || proposal.proposal_hash !== hash(unsigned)) errors.push("proposal_hash does not match proposal contents");
  }
  return { valid: errors.length === 0, errors };
}

function buildProposal(planId, label, objective, currentWeights, targetWeights, constraints, rationale) {
  const target = normalizeWeights(targetWeights);
  const actions = Object.keys(target).sort().map((instrumentId) => ({
    instrument_id: instrumentId,
    from_weight: round(currentWeights[instrumentId] || 0),
    to_weight: round(target[instrumentId] || 0),
    delta_weight: round((target[instrumentId] || 0) - (currentWeights[instrumentId] || 0)),
    side: target[instrumentId] > (currentWeights[instrumentId] || 0) ? "BUY_OR_HOLD_CASH" : target[instrumentId] < (currentWeights[instrumentId] || 0) ? "SELL_OR_REDUCE" : "HOLD"
  }));
  const unsignedProposal = {
    proposal_id: `proposal-${planId.toLowerCase()}-${hash(target).slice(0, 10)}`,
    plan_id: planId,
    label,
    objective,
    target_weights: target,
    actions,
    constraints: { ...constraints, max_turnover: constraints.max_turnover },
    turnover: turnoverBetween(currentWeights, target),
    rationale,
    expected_metrics: {
      max_single_asset_weight: round(Math.max(...Object.entries(target).filter(([id]) => id !== "CASH").map((entry) => entry[1]))),
      cash_weight: round(target.CASH || 0)
    }
  };
  const proposal = {
    ...unsignedProposal,
    proposal_hash: hash(unsignedProposal)
  };
  proposal.validation = validateProposal(proposal, { requireHash: true });
  if (!proposal.validation.valid) {
    throw new FinancialToolError("INVALID_GENERATED_PROPOSAL", "当前组合无法同时满足演示方案的仓位与换手限制；未生成可执行调整。", proposal.validation);
  }
  return proposal;
}

function generateCandidates(snapshotOrInput, reportInput) {
  const snapshot = requireSnapshot(snapshotOrInput);
  const report = diagnosePortfolio(snapshot).output;
  if (reportInput && hash(reportInput) !== hash(report)) throw new FinancialToolError("INVALID_REPORT", "health report does not match this portfolio snapshot");
  const currentWeights = weightsFor(snapshot);
  const targetA = { ...currentWeights };
  const targetB = { ...currentWeights };
  let releasedByB = 0;
  for (const position of snapshot.positions) {
    if (targetB[position.instrument_id] > 0.2) {
      releasedByB += targetB[position.instrument_id] - 0.2;
      targetB[position.instrument_id] = 0.2;
    }
  }
  targetB.CASH += releasedByB;

  const targetC = { ...currentWeights };
  let releasedByC = 0;
  const riskClusterIds = new Set(report.hidden_clusters.flatMap((cluster) => cluster.instruments));
  for (const position of snapshot.positions) {
    if (riskClusterIds.has(position.instrument_id)) {
      const nextWeight = Math.min(targetC[position.instrument_id], 0.14);
      releasedByC += targetC[position.instrument_id] - nextWeight;
      targetC[position.instrument_id] = nextWeight;
    }
  }
  targetC.ETF_BOND = (targetC.ETF_BOND || 0) + releasedByC * 0.7;
  targetC.CASH = (targetC.CASH || 0) + releasedByC * 0.3;

  const candidates = [
    buildProposal("A", "Keep / minimum action", "preserve the current allocation and avoid unnecessary turnover", currentWeights, targetA, {
      max_single_asset_weight: 0.35,
      max_turnover: 0.05,
      objective: "minimum_action"
    }, ["No hard constraint is currently violated; keep the baseline for comparison."]),
    buildProposal("B", "Moderate rebalance", "reduce the largest position with bounded turnover", currentWeights, capSecurityWeights(targetB, 0.2), {
      max_single_asset_weight: 0.2,
      max_turnover: 0.1,
      objective: "concentration_control"
    }, ["Cap any security above 20% and move the difference to cash."]),
    buildProposal("C", "Risk priority", "reduce correlated exposure and increase the defensive sleeve", currentWeights, capSecurityWeights(targetC, 0.2), {
      max_single_asset_weight: 0.2,
      max_turnover: 0.25,
      objective: "risk_budget"
    }, ["Reduce the detected correlated cluster, then split released weight between bond ETF and cash."])
  ];
  return makeToolResult("strategy.generate", { snapshot, report }, {
    snapshot_id: snapshot.snapshot_id,
    report_id: report.report_id,
    candidates
  });
}

function evaluateCandidate(snapshot, proposal) {
  const validation = validateProposal(proposal, { requireHash: true });
  if (!validation.valid) {
    throw new FinancialToolError("INVALID_PROPOSAL", "simulation received an invalid ActionProposal", validation);
  }
  const currentWeights = weightsFor(snapshot);
  const actualTurnover = turnoverBetween(currentWeights, proposal.target_weights);
  for (const action of proposal.actions) {
    if (Math.abs(action.from_weight - (currentWeights[action.instrument_id] || 0)) > 1e-6)
      throw new FinancialToolError("INVALID_PROPOSAL", "action source weight does not match current portfolio");
  }
  if (Math.abs(actualTurnover - proposal.turnover) > 1e-6 || actualTurnover > proposal.constraints.max_turnover + 1e-6)
    throw new FinancialToolError("INVALID_PROPOSAL", "turnover does not match current portfolio");
  const transactionCost = actualTurnover * dataset.transaction_cost_rate;
  const grossPath = buildPath(snapshot, proposal.target_weights);
  const path = grossPath.map((point, i) => ({ ...point, value: i === 0 ? 1 : round(point.value * (1 - transactionCost)) }));
  return {
    plan_id: proposal.plan_id,
    proposal_id: proposal.proposal_id,
    label: proposal.label,
    turnover: proposal.turnover,
    transaction_cost: round(transactionCost),
    metrics: metricsFromPath(path),
    curve: path
  };
}

function scenarioDistribution(weights, transactionCost, seed, pathCount = DEFAULT_SCENARIO_PATHS) {
  const ids = Object.keys(weights).filter(id => id !== "CASH");
  const jointReturns = dataset.price_history.dates.slice(1).map((_, i) =>
    ids.map(id => getPriceSeries(id)[i + 1] / getPriceSeries(id)[i] - 1));
  const random = seededRandom(seed);
  const blockSize = 3;
  const horizon = 20;
  const outcomes = [];
  for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
    const holdings = ids.map(id => weights[id]);
    let steps = 0;
    while (steps < horizon) {
      const start = Math.floor(random() * Math.max(1, jointReturns.length - blockSize + 1));
      for (let offset = 0; offset < blockSize && steps < horizon; offset += 1) {
        const row = jointReturns[start + offset];
        holdings.forEach((value, i) => { holdings[i] = value * (1 + row[i]); });
        steps += 1;
      }
    }
    outcomes.push((sum(holdings) + (weights.CASH || 0)) * (1 - transactionCost) - 1);
  }
  return {
    method: "block_bootstrap",
    block_size: blockSize,
    paths: pathCount,
    seed,
    horizon_days: horizon,
    sampling: "joint asset daily returns; identical block indices across Current/A/B/C",
    p10: quantile(outcomes, 0.1),
    p50: quantile(outcomes, 0.5),
    p90: quantile(outcomes, 0.9)
  };
}

function runSimulation(snapshotOrInput, proposalsInput) {
  const snapshot = requireSnapshot(snapshotOrInput);
  const candidates = Array.isArray(proposalsInput)
    ? proposalsInput
    : generateCandidates(snapshot).output.candidates;
  const comparisons = candidates.map((proposal) => evaluateCandidate(snapshot, proposal));
  const currentProposal = buildProposal(
    "CURRENT",
    "Current portfolio",
    "use the current allocation as the baseline for comparison",
    weightsFor(snapshot),
    weightsFor(snapshot),
    { max_single_asset_weight: 1, max_turnover: 0, objective: "baseline" },
    ["Baseline has zero turnover and is used only for comparison."]
  );
  const current = evaluateCandidate(snapshot, currentProposal);
  const allComparisons = [current, ...comparisons];
  const scenarios = allComparisons.map((comparison, index) => ({
    plan_id: comparison.plan_id,
    distribution: scenarioDistribution([currentProposal, ...candidates][index].target_weights, comparison.transaction_cost, DEFAULT_SCENARIO_SEED)
  }));
  return makeToolResult("simulation.run", { snapshot, candidates, seed: DEFAULT_SCENARIO_SEED }, {
    simulation_id: `simulation-${hash({ snapshot: snapshot.snapshot_id, candidates }).slice(0, 16)}`,
    snapshot_id: snapshot.snapshot_id,
    historical_window: {
      start: dataset.price_history.dates[0],
      end: dataset.price_history.dates[dataset.price_history.dates.length - 1]
    },
    transaction_cost_rate: dataset.transaction_cost_rate,
    assumptions: {
      data_mode: "SYNTHETIC_REPLAY", initial_capital: snapshot.total_value, annualization_factor: 252,
      risk_free_rate: 0.02, portfolio_method: "buy-and-hold", cost_basis: "one-way turnover times rate charged once",
      sample_observations: dataset.price_history.dates.length,
      caveat: "Ex-post allocation comparison on a short synthetic window, not an out-of-sample strategy backtest."
    },
    comparisons: allComparisons,
    scenarios,
    limitation: "Historical replay and fixed-seed scenario simulation are not a prediction of future returns."
  });
}

function paperTrade({ snapshot: snapshotInput, proposal, approval, idempotency_key: idempotencyKey }) {
  if (!idempotencyKey) throw new FinancialToolError("IDEMPOTENCY_KEY_REQUIRED", "paper trade requires idempotency_key");
  if (paperReceipts.has(idempotencyKey)) {
    return makeToolResult("paper-trade.execute", { idempotencyKey }, {
      status: "IDEMPOTENT_REPLAY",
      receipt: clone(paperReceipts.get(idempotencyKey))
    });
  }
  if (!approval || approval.status !== "APPROVED" || !approval.token) {
    return makeToolResult("paper-trade.execute", { proposal, idempotencyKey }, {
      status: "REQUIRES_APPROVAL",
      reason: "Paper Trading tool accepts an approval contract but does not create or bypass Safety approval."
    });
  }
  const snapshot = requireSnapshot(snapshotInput || getDemoPortfolio());
  if (!proposal || !proposal.target_weights || !proposal.proposal_hash) {
    throw new FinancialToolError("INVALID_PROPOSAL", "paper trade requires a structured ActionProposal");
  }
  const validation = validateProposal(proposal, { requireHash: true });
  if (!validation.valid) throw new FinancialToolError("INVALID_PROPOSAL", "paper trade received an invalid ActionProposal", validation);
  const receipt = {
    receipt_id: `paper-${hash({ snapshot: snapshot.snapshot_id, proposal: proposal.proposal_hash, idempotencyKey }).slice(0, 16)}`,
    idempotency_key: idempotencyKey,
    status: "FILLED",
    mode: "PAPER",
    proposal_id: proposal.proposal_id,
    approval_token_hash: hash(approval.token).slice(0, 16),
    updated_portfolio: {
      ...clone(snapshot),
      target_weights: clone(proposal.target_weights),
      simulated_at: dataset.as_of
    }
  };
  paperReceipts.set(idempotencyKey, receipt);
  return makeToolResult("paper-trade.execute", { snapshot, proposal, idempotencyKey }, {
    status: "FILLED",
    receipt: clone(receipt)
  });
}

function resetPaperTrading() {
  paperReceipts.clear();
}

module.exports = {
  FinancialToolError,
  getDemoPortfolio,
  validatePortfolio,
  diagnosePortfolio,
  generateCandidates,
  runSimulation,
  validateProposal,
  paperTrade,
  resetPaperTrading,
  constants: {
    TOOL_VERSION,
    DATA_AS_OF: dataset.as_of,
    SCENARIO_SEED: DEFAULT_SCENARIO_SEED,
    SCENARIO_PATHS: DEFAULT_SCENARIO_PATHS
  }
};
