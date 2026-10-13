"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Harness } = require("../core/harness");
const tools = require("../tools/financial-tools");
const contract = require("../contracts/investment-contract");
const { buildRiskWorkbenchHandoff } = require("../integrations/risk-workbench-adapter");

const examples = path.join(__dirname, "..", "contracts", "examples");

test("public contract examples validate and preserve the request id", () => {
  const request = JSON.parse(fs.readFileSync(path.join(examples, "health-check.request.json"), "utf8"));
  const responseExample = JSON.parse(fs.readFileSync(path.join(examples, "health-check.response.json"), "utf8"));
  assert.equal(contract.assertHealthCheckRequest(request).contract_version, contract.CONTRACT_VERSION);
  assert.equal(contract.assertHealthCheckResponse(responseExample).request_id, request.request_id);
});

test("Agent output creates a Risk handoff from the same contract", () => {
  const request = contract.createRequest({
    requestId: "req-contract-test-001",
    riskProfile: { investment_horizon_days: 365, max_drawdown: 0.1, liquidity_need: "medium" },
    portfolio: tools.getDemoPortfolio()
  });
  const response = new Harness().runHealthCheckContract(request);
  assert.equal(response.contract_version, contract.CONTRACT_VERSION);
  assert.equal(response.request_id, request.request_id);
  assert.equal(response.risk_handoff.status, "PENDING_REVIEW");
  assert.equal(response.risk_handoff.execution_allowed, false);
  assert.equal(response.trace.task_id, response.task_state.task_id);
  assert.equal(response.trace.session_id, response.task_state.session_id);
  assert.equal(response.audit_evidence.task_id, response.task_state.task_id);
  assert.ok(response.audit_evidence.events.some(event => event.event_type === "contract.accepted"));
  assert.equal(response.risk_handoff.evidence.audit_id, response.audit_evidence.audit_id);
  assert.equal(response.risk_handoff.evidence.health_report_id, response.artifacts.health_report.report_id);
  assert.deepEqual(response.risk_handoff.evidence.proposal_ids, response.artifacts.candidates.map(candidate => candidate.proposal_id));
  assert.doesNotThrow(() => contract.assertHealthCheckResponseSemantics(response));
});

test("response semantics reject broken references and authorization changes", () => {
  const request = contract.createRequest({
    requestId: "req-contract-semantics-001",
    riskProfile: { investment_horizon_days: 365, max_drawdown: 0.1, liquidity_need: "medium" },
    portfolio: tools.getDemoPortfolio()
  });
  const response = new Harness().runHealthCheckContract(request);
  const brokenReference = structuredClone(response);
  brokenReference.task_state.checkpoint.result_refs.DIAGNOSE = "missing-tool-result";
  assert.throws(() => contract.assertHealthCheckResponseSemantics(brokenReference), error =>
    error.code === "INVALID_CONTRACT" && error.details.issues.some(issue => issue.path.includes("result_refs.DIAGNOSE")));

  const brokenAuthorization = structuredClone(response);
  brokenAuthorization.risk_handoff.execution_allowed = true;
  assert.throws(() => contract.assertHealthCheckResponseSemantics(brokenAuthorization), error =>
    error.code === "INVALID_CONTRACT" && error.details.issues.some(issue => issue.path === "$.risk_handoff" || issue.path.endsWith("execution_allowed")));
});

test("contract rejects the old unversioned bare request", () => {
  assert.throws(() => contract.assertHealthCheckRequest({
    risk_profile: { investment_horizon_days: 365, max_drawdown: 0.1, liquidity_need: "medium" },
    portfolio: tools.getDemoPortfolio()
  }), error => error.code === "INVALID_CONTRACT" && error.details.issues.some(issue => issue.path.endsWith(".contract_version")));
});

test("contract keeps investment errors traceable", () => {
  const error = contract.assertHealthCheckError({
    contract_version: contract.CONTRACT_VERSION,
    request_id: "req-contract-error-001",
    operation: contract.OPERATION,
    error: {
      code: "INVALID_CONTRACT",
      message: "request shape is invalid",
      retryable: false,
      stage: "BACKEND",
      recovery: "Correct the request contract and retry.",
      details: { field: "contract_version" }
    }
  });
  assert.equal(error.request_id, "req-contract-error-001");
});

test("failed task errors carry task, session and audit trace", () => {
  const failingTools = {
    ...tools,
    diagnosePortfolio: () => { throw new Error("temporary market data timeout"); }
  };
  const harness = new Harness({ toolset: failingTools });
  const request = contract.createRequest({
    requestId: "req-contract-failure-001",
    riskProfile: { investment_horizon_days: 365, max_drawdown: 0.1, liquidity_need: "medium" }
  });
  let failure;
  try {
    harness.runHealthCheckContract(request);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure);
  assert.equal(failure.requestId, request.request_id);
  assert.match(failure.taskId, /^task-/);
  assert.match(failure.sessionId, /^session-/);
  assert.equal(failure.auditId, "audit-" + failure.taskId);
  const task = harness.getTask(failure.taskId);
  assert.equal(task.task_state.request_id, request.request_id);
  assert.equal(task.task_state.status, "FAILED");
  assert.ok(task.audit_evidence.events.filter(event => event.event_type === "stage.failed").every(event => event.payload.request_id === request.request_id));
  const errorResponse = contract.buildErrorResponse(failure);
  assert.equal(errorResponse.trace.task_id, failure.taskId);
  assert.equal(errorResponse.trace.session_id, failure.sessionId);
  assert.equal(errorResponse.trace.audit_id, failure.auditId);
  assert.equal(contract.assertHealthCheckError(errorResponse).trace.request_id, request.request_id);
});

test("Risk Workbench adapter preserves evidence and stays read-only", () => {
  const request = contract.createRequest({
    requestId: "req-risk-workbench-test-001",
    riskProfile: { investment_horizon_days: 365, max_drawdown: 0.1, liquidity_need: "medium" },
    portfolio: tools.getDemoPortfolio()
  });
  const response = new Harness().runHealthCheckContract(request);
  const handoff = buildRiskWorkbenchHandoff(response);
  assert.equal(handoff.integration_mode, "READ_ONLY_HANDOFF_PREVIEW");
  assert.equal(handoff.source.request_id, response.request_id);
  assert.equal(handoff.source.task_id, response.task_state.task_id);
  assert.equal(handoff.source.audit_id, response.audit_evidence.audit_id);
  assert.equal(handoff.evidence.health_report_id, response.risk_handoff.evidence.health_report_id);
  assert.equal(handoff.decision.execution_allowed, false);
  assert.equal(handoff.remote_capability.can_import_external_handoff, false);
});
