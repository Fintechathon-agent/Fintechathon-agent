"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CONTRACT_VERSION = "investment-agent.v1";
const OPERATION = "PORTFOLIO_HEALTH_CHECK";
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "investment-agent.v1.schema.json"), "utf8"));

class ContractError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ContractError";
    this.code = "INVALID_CONTRACT";
    this.statusCode = 422;
    this.details = details;
  }
}

function typeMatches(value, expected) {
  if (expected === "null") return value === null;
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (expected === "array") return Array.isArray(value);
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === expected;
}

function resolveRef(ref) {
  const prefix = "#/$defs/";
  if (!ref.startsWith(prefix)) throw new Error("unsupported schema reference: " + ref);
  return schema.$defs[ref.slice(prefix.length)];
}

function validateSchema(value, definition, location = "$", issues = []) {
  if (definition && definition.$ref) {
    return validateSchema(value, resolveRef(definition.$ref), location, issues);
  }
  if (definition && definition.anyOf) {
    const branchErrors = definition.anyOf.map((branch) => {
      const branchIssues = [];
      validateSchema(value, branch, location, branchIssues);
      return branchIssues;
    });
    if (!branchErrors.some((branch) => branch.length === 0)) {
      issues.push({ path: location, message: "does not match any allowed shape" });
    }
    return issues;
  }
  if (definition && definition.const !== undefined && value !== definition.const) {
    issues.push({ path: location, message: "must equal " + JSON.stringify(definition.const) });
    return issues;
  }
  if (definition && definition.enum && !definition.enum.includes(value)) {
    issues.push({ path: location, message: "must be one of " + definition.enum.join(", ") });
    return issues;
  }
  if (definition && definition.type) {
    const types = Array.isArray(definition.type) ? definition.type : [definition.type];
    if (!types.some((type) => typeMatches(value, type))) {
      issues.push({ path: location, message: "has an invalid type" });
      return issues;
    }
  }
  if (value === null || value === undefined) return issues;
  if (definition.minLength !== undefined && typeof value === "string" && value.length < definition.minLength)
    issues.push({ path: location, message: "is shorter than the minimum length" });
  if (definition.maxLength !== undefined && typeof value === "string" && value.length > definition.maxLength)
    issues.push({ path: location, message: "is longer than the maximum length" });
  if (definition.minimum !== undefined && typeof value === "number" && value < definition.minimum)
    issues.push({ path: location, message: "is below the minimum" });
  if (definition.exclusiveMinimum !== undefined && typeof value === "number" && value <= definition.exclusiveMinimum)
    issues.push({ path: location, message: "must be greater than the exclusive minimum" });
  if (definition.maximum !== undefined && typeof value === "number" && value > definition.maximum)
    issues.push({ path: location, message: "is above the maximum" });
  if (definition.required && typeMatches(value, "object")) {
    for (const key of definition.required) {
      if (!Object.hasOwn(value, key)) issues.push({ path: location + "." + key, message: "is required" });
    }
  }
  if (definition.properties && typeMatches(value, "object")) {
    for (const [key, child] of Object.entries(definition.properties)) {
      if (Object.hasOwn(value, key)) validateSchema(value[key], child, location + "." + key, issues);
    }
    if (definition.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(definition.properties, key)) issues.push({ path: location + "." + key, message: "is not allowed" });
      }
    }
  }
  if (definition.additionalProperties && definition.additionalProperties !== true && typeMatches(value, "object")) {
    for (const [key, childValue] of Object.entries(value)) {
      if (!definition.properties || !Object.hasOwn(definition.properties, key))
        validateSchema(childValue, definition.additionalProperties, location + "." + key, issues);
    }
  }
  if (definition.items && Array.isArray(value)) {
    value.forEach((item, index) => validateSchema(item, definition.items, location + "[" + index + "]", issues));
  }
  if (definition.minItems !== undefined && Array.isArray(value) && value.length < definition.minItems)
    issues.push({ path: location, message: "has fewer items than the minimum" });
  return issues;
}

function assertAgainst(name, value) {
  const definition = schema.$defs[name];
  if (!definition) throw new Error("unknown contract shape: " + name);
  const issues = validateSchema(value, definition);
  if (issues.length) throw new ContractError(name + " does not satisfy investment-agent.v1", { shape: name, issues: issues.slice(0, 20) });
  return value;
}

function createRequest({ requestId = "req-" + crypto.randomUUID(), taskId = null, sessionId = null, riskProfile = null, portfolio = null, marketContext = null } = {}) {
  const request = {
    contract_version: CONTRACT_VERSION,
    request_id: requestId,
    operation: OPERATION,
    context: {
      actor: "agent",
      environment: "demo",
      data_mode: "SYNTHETIC_REPLAY",
      task_id: taskId,
      session_id: sessionId
    },
    input: { risk_profile: riskProfile, portfolio, market_context: marketContext }
  };
  return assertAgainst("HealthCheckRequest", request);
}

function buildRiskHandoff(result) {
  if (result.task_state.status !== "HANDOFF_REQUIRED") return null;
  const artifacts = result.artifacts || {};
  const auditEvidence = result.audit_evidence || {};
  return {
    contract_version: CONTRACT_VERSION,
    handoff_id: "handoff-" + result.task_state.task_id,
    task_id: result.task_state.task_id,
    session_id: result.task_state.session_id,
    status: "PENDING_REVIEW",
    decision: "REQUIRED",
    owner: "Safety/Risk/Eval",
    reason: result.task_state.handoff?.reason || "Risk decision is outside Agent Core and Tools ownership.",
    evidence: {
      portfolio_snapshot_id: result.task_state.portfolio_snapshot_id,
      health_report_id: artifacts.health_report?.report_id || "",
      proposal_ids: (artifacts.candidates || []).map((candidate) => candidate.proposal_id),
      simulation_id: artifacts.simulation?.simulation_id || "",
      ...(artifacts.market_context ? { market_context_id: artifacts.market_context.context_id } : {}),
      ...(auditEvidence.audit_id ? { audit_id: auditEvidence.audit_id } : {})
    },
    execution_allowed: false
  };
}

function buildResponse(request, result) {
  const taskState = result.task_state;
  const auditEvidence = result.audit_evidence || {
    audit_id: "audit-" + taskState.task_id,
    contract_version: CONTRACT_VERSION,
    request_id: request.request_id,
    task_id: taskState.task_id,
    session_id: taskState.session_id,
    events: []
  };
  const response = {
    contract_version: CONTRACT_VERSION,
    request_id: request.request_id,
    operation: OPERATION,
    trace: {
      contract_version: CONTRACT_VERSION,
      request_id: request.request_id,
      task_id: taskState.task_id,
      session_id: taskState.session_id
    },
    task_state: taskState,
    artifacts: result.artifacts || {},
    tool_results: result.tool_results || {},
    audit_evidence: auditEvidence,
    risk_handoff: buildRiskHandoff(result)
  };
  return assertAgainst("HealthCheckResponse", response);
}

function assertHealthCheckRequest(request) {
  return assertAgainst("HealthCheckRequest", request);
}

function assertHealthCheckResponse(response) {
  return assertAgainst("HealthCheckResponse", response);
}

function assertHealthCheckError(response) {
  return assertAgainst("HealthCheckErrorResponse", response);
}

module.exports = {
  CONTRACT_VERSION,
  OPERATION,
  ContractError,
  schema,
  createRequest,
  assertHealthCheckRequest,
  buildResponse,
  assertHealthCheckResponse,
  assertHealthCheckError
};
