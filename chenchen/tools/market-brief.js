"use strict";

const crypto = require("node:crypto");

const TOOL_VERSION = "market-brief.context@0.1.0";
const MAX_ABNORMAL_MOVE_PCT = 3;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function issue(path, message) {
  return { path, message };
}

function validateMarketBrief(input) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, output: null, errors: [issue("$", "market brief must be an object")] };
  }
  for (const field of ["brief_id", "as_of", "published_at", "data_mode", "market", "signals", "source_checks"]) {
    if (!(field in input)) errors.push(issue("$." + field, "is required"));
  }
  if (input.data_mode !== "REFERENCE_FIXTURE") errors.push(issue("$.data_mode", "must be REFERENCE_FIXTURE"));
  if (!Array.isArray(input.market) || input.market.length === 0) errors.push(issue("$.market", "must contain at least one observation"));
  if (!Array.isArray(input.signals)) errors.push(issue("$.signals", "must be an array"));
  if (!Array.isArray(input.source_checks) || input.source_checks.length === 0) errors.push(issue("$.source_checks", "must contain at least one source check"));

  const seen = new Set();
  for (const [index, observation] of (input.market || []).entries()) {
    const path = "$.market[" + index + "]";
    if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
      errors.push(issue(path, "must be an object"));
      continue;
    }
    for (const field of ["asset_id", "name", "latest", "change_pct", "data_time", "source_status"]) {
      if (!(field in observation)) errors.push(issue(path + "." + field, "is required"));
    }
    if (!observation.asset_id || seen.has(observation.asset_id)) errors.push(issue(path + ".asset_id", "must be unique and non-empty"));
    seen.add(observation.asset_id);
    if (!Number.isFinite(observation.latest) || observation.latest <= 0) errors.push(issue(path + ".latest", "must be a positive number"));
    if (observation.change_pct !== null && !Number.isFinite(observation.change_pct)) errors.push(issue(path + ".change_pct", "must be a number or null"));
    if (!["CROSS_CHECKED", "OFFICIAL_SOURCE", "REFERENCE_ONLY"].includes(observation.source_status)) errors.push(issue(path + ".source_status", "has an unsupported source status"));
  }

  for (const [index, signal] of (input.signals || []).entries()) {
    const path = "$.signals[" + index + "]";
    if (!signal || typeof signal !== "object" || Array.isArray(signal)) {
      errors.push(issue(path, "must be an object"));
      continue;
    }
    for (const field of ["signal_id", "type", "status", "asset_ids", "reason"]) {
      if (!(field in signal)) errors.push(issue(path + "." + field, "is required"));
    }
    if (!Array.isArray(signal.asset_ids)) errors.push(issue(path + ".asset_ids", "must be an array"));
    if (!["OBSERVED", "REVIEW_REQUIRED", "CONFIRMED"].includes(signal.status)) errors.push(issue(path + ".status", "has an unsupported status"));
  }

  if (errors.length) return { valid: false, output: null, errors: errors.slice(0, 30) };

  const abnormalMoves = input.market
    .filter((observation) => Number.isFinite(observation.change_pct) && Math.abs(observation.change_pct) >= MAX_ABNORMAL_MOVE_PCT)
    .map((observation) => ({ asset_id: observation.asset_id, change_pct: observation.change_pct, threshold_pct: MAX_ABNORMAL_MOVE_PCT }));
  const unresolvedConflicts = input.signals
    .filter((signal) => signal.status === "REVIEW_REQUIRED")
    .map((signal) => ({ signal_id: signal.signal_id, type: signal.type, asset_ids: [...signal.asset_ids], reason: signal.reason }));
  const contextId = "market-context-" + hash({ brief_id: input.brief_id, as_of: input.as_of }).slice(0, 16);
  const output = {
    context_id: contextId,
    brief_id: input.brief_id,
    as_of: input.as_of,
    data_mode: input.data_mode,
    source_reference: input.source_reference || "reference fixture",
    market: clone(input.market),
    abnormal_moves: abnormalMoves,
    unresolved_conflicts: unresolvedConflicts,
    source_checks: clone(input.source_checks),
    limitations: clone(input.limitations || [])
  };
  return {
    valid: true,
    output,
    errors: [],
    tool_result: {
      tool_name: "market-brief.context",
      version: TOOL_VERSION,
      inputs_hash: hash(input),
      output,
      data_as_of: input.as_of,
      warnings: ["Reference fixture only; this context does not change Quant calculations or authorize execution."],
      trace_id: "trace-" + hash({ tool: TOOL_VERSION, input }).slice(0, 16)
    }
  };
}

module.exports = { TOOL_VERSION, MAX_ABNORMAL_MOVE_PCT, validateMarketBrief };
