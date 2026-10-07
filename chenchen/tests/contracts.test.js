"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { Harness } = require("../core/harness");
const tools = require("../tools/financial-tools");
const contract = require("../contracts/investment-contract");

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
  assert.equal(response.risk_handoff.evidence.health_report_id, response.artifacts.health_report.report_id);
  assert.deepEqual(response.risk_handoff.evidence.proposal_ids, response.artifacts.candidates.map(candidate => candidate.proposal_id));
});

test("contract rejects the old unversioned bare request", () => {
  assert.throws(() => contract.assertHealthCheckRequest({
    risk_profile: { investment_horizon_days: 365, max_drawdown: 0.1, liquidity_need: "medium" },
    portfolio: tools.getDemoPortfolio()
  }), error => error.code === "INVALID_CONTRACT" && error.details.issues.some(issue => issue.path.endsWith(".contract_version")));
});
