"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const coreError = require("../contracts/core-agent-error");
const contract = require("../contracts/investment-contract");

test("the shared error contract uses one trace vocabulary", () => {
  const example = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "contracts", "examples", "core-agent-error.response.json"), "utf8"));
  assert.equal(example.error_contract_version, coreError.ERROR_CONTRACT_VERSION);
  assert.equal(example.trace.error_contract_version, coreError.ERROR_CONTRACT_VERSION);
  assert.equal(example.trace.request_id, example.request_id);
  for (const field of ["task_id", "session_id", "run_id", "audit_id", "handoff_id"]) assert.ok(Object.hasOwn(example.trace, field));
});

test("health errors carry the shared envelope and retain the health source contract", () => {
  const error = new Error("bad request");
  error.code = "INVALID_CONTRACT";
  error.statusCode = 422;
  const response = contract.buildErrorResponse(error, { requestId: "req-error-test-001" });
  assert.equal(response.error_contract_version, coreError.ERROR_CONTRACT_VERSION);
  assert.equal(response.source_contract_version, contract.CONTRACT_VERSION);
  assert.equal(response.trace.source_contract_version, contract.CONTRACT_VERSION);
  assert.equal(response.trace.run_id, null);
  assert.equal(response.trace.handoff_id, null);
  assert.doesNotThrow(() => contract.assertHealthCheckError(response));
});
