"use strict";

const crypto = require("node:crypto");

const CONTRACT_VERSION = "investment-agent.v1";
const OPERATION = "PORTFOLIO_HEALTH_CHECK";
const schema = require("./investment-agent.v1.schema.json");

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
  return assertHealthCheckResponseSemantics(response);
}

function assertHealthCheckRequest(request) {
  return assertAgainst("HealthCheckRequest", request);
}

function assertHealthCheckResponse(response) {
  return assertAgainst("HealthCheckResponse", response);
}

function assertHealthCheckResponseSemantics(response) {
  assertHealthCheckResponse(response);
  const issues = [];
  const issue = (path, message) => issues.push({ path, message });
  const state = response.task_state;
  const audit = response.audit_evidence;
  const trace = response.trace;
  const checkpoint = state.checkpoint;
  const artifacts = response.artifacts || {};
  const toolResults = response.tool_results || {};

  if (trace.contract_version !== response.contract_version) issue("$.trace.contract_version", "must match $.contract_version");
  if (trace.request_id !== response.request_id) issue("$.trace.request_id", "must match $.request_id");
  if (trace.task_id !== state.task_id) issue("$.trace.task_id", "must match $.task_state.task_id");
  if (trace.session_id !== state.session_id) issue("$.trace.session_id", "must match $.task_state.session_id");
  if (state.contract_version !== undefined && state.contract_version !== response.contract_version)
    issue("$.task_state.contract_version", "must match $.contract_version");
  if (state.request_id !== undefined && state.request_id !== response.request_id)
    issue("$.task_state.request_id", "must match $.request_id");
  if (audit.contract_version !== response.contract_version) issue("$.audit_evidence.contract_version", "must match $.contract_version");
  if (audit.request_id !== response.request_id) issue("$.audit_evidence.request_id", "must match $.request_id");
  if (audit.task_id !== state.task_id) issue("$.audit_evidence.task_id", "must match $.task_state.task_id");
  if (audit.session_id !== state.session_id) issue("$.audit_evidence.session_id", "must match $.task_state.session_id");

  for (const [stage, resultRef] of Object.entries(checkpoint.result_refs || {})) {
    if (resultRef !== null && (!toolResults[resultRef] || toolResults[resultRef].trace_id !== resultRef))
      issue("$.task_state.checkpoint.result_refs." + stage, "must reference a matching tool_results.trace_id");
  }
  for (const stage of checkpoint.completed || []) {
    if (!checkpoint.result_refs || !checkpoint.result_refs[stage]) issue("$.task_state.checkpoint.completed", "completed stage " + stage + " must have a result reference");
  }
  for (const [key, result] of Object.entries(toolResults)) {
    if (result.trace_id !== key) issue("$.tool_results." + key + ".trace_id", "must match its map key");
  }
  for (const event of audit.events || []) {
    if (event.task_id !== state.task_id) issue("$.audit_evidence.events", "every event must belong to task_state.task_id");
    if (!Object.hasOwn(event.payload || {}, "request_id")) issue("$.audit_evidence.events", "every event payload must contain request_id");
  }

  const handoff = response.risk_handoff;
  if (state.status === "HANDOFF_REQUIRED") {
    if (!handoff) issue("$.risk_handoff", "is required when task_state.status is HANDOFF_REQUIRED");
    else {
      if (handoff.task_id !== state.task_id) issue("$.risk_handoff.task_id", "must match $.task_state.task_id");
      if (handoff.session_id !== state.session_id) issue("$.risk_handoff.session_id", "must match $.task_state.session_id");
      if (handoff.execution_allowed !== false) issue("$.risk_handoff.execution_allowed", "must remain false");
      const evidence = handoff.evidence || {};
      if (artifacts.portfolio_snapshot && evidence.portfolio_snapshot_id !== artifacts.portfolio_snapshot.snapshot_id)
        issue("$.risk_handoff.evidence.portfolio_snapshot_id", "must reference artifacts.portfolio_snapshot.snapshot_id");
      if (artifacts.health_report && evidence.health_report_id !== artifacts.health_report.report_id)
        issue("$.risk_handoff.evidence.health_report_id", "must reference artifacts.health_report.report_id");
      if (artifacts.simulation && evidence.simulation_id !== artifacts.simulation.simulation_id)
        issue("$.risk_handoff.evidence.simulation_id", "must reference artifacts.simulation.simulation_id");
      const proposalIds = (artifacts.candidates || []).map(candidate => candidate.proposal_id);
      if (JSON.stringify(evidence.proposal_ids) !== JSON.stringify(proposalIds)) issue("$.risk_handoff.evidence.proposal_ids", "must match artifacts.candidates proposal IDs");
      if (artifacts.market_context && evidence.market_context_id !== artifacts.market_context.context_id)
        issue("$.risk_handoff.evidence.market_context_id", "must reference artifacts.market_context.context_id");
      if (evidence.audit_id !== audit.audit_id) issue("$.risk_handoff.evidence.audit_id", "must match $.audit_evidence.audit_id");
    }
  } else if (handoff !== null) {
    issue("$.risk_handoff", "must be null before HANDOFF_REQUIRED");
  }

  if (issues.length) throw new ContractError("HealthCheckResponse semantic validation failed", { shape: "HealthCheckResponse", issues: issues.slice(0, 20) });
  return response;
}

function assertHealthCheckError(response) {
  return assertAgainst("HealthCheckErrorResponse", response);
}

const SENSITIVE_DETAIL_KEY = /token|secret|authorization|cookie|password|account|bank|portfolio|position|quantity|price|cash|body|input/i;

function sanitizeErrorDetails(value, depth = 0, key = "") {
  if (SENSITIVE_DETAIL_KEY.test(key)) return "[redacted]";
  if (depth >= 4) return "[truncated]";
  if (typeof value === "string") return value.length > 500 ? value.slice(0, 500) + "..." : value;
  if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitizeErrorDetails(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 30).map(([childKey, childValue]) => [childKey, sanitizeErrorDetails(childValue, depth + 1, childKey)]));
  }
  return value;
}

function buildErrorResponse(error, { requestId = null, taskId = null, sessionId = null, auditId = null } = {}) {
  const resolvedRequestId = error.requestId ?? requestId;
  const response = {
    contract_version: CONTRACT_VERSION,
    request_id: resolvedRequestId,
    operation: OPERATION,
    trace: {
      contract_version: CONTRACT_VERSION,
      request_id: resolvedRequestId,
      task_id: error.taskId ?? taskId,
      session_id: error.sessionId ?? sessionId,
      audit_id: error.auditId ?? auditId
    },
    error: {
      code: error.code || "REQUEST_FAILED",
      message: error.message || "request failed",
      retryable: Boolean(error.retryable),
      stage: error.stage || "BACKEND",
      recovery: error.recovery || "Review the request and retry after correcting the reported issue.",
      details: error.details ? sanitizeErrorDetails(error.details) : null
    }
  };
  return assertHealthCheckError(response);
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
  assertHealthCheckResponseSemantics,
  assertHealthCheckError,
  buildErrorResponse,
  sanitizeErrorDetails
};
