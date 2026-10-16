"use strict";

const ERROR_CONTRACT_VERSION = "core-agent-error.v1";
const ERROR_OPERATION = "CORE_AGENT_ERROR";

function buildTrace({
  sourceContractVersion,
  requestId = null,
  taskId = null,
  sessionId = null,
  runId = null,
  auditId = null,
  handoffId = null,
  legacyContractVersion = sourceContractVersion
} = {}) {
  return {
    // Keep the source contract field for existing consumers while adding one
    // trace vocabulary for all Core Agent error producers.
    contract_version: legacyContractVersion,
    error_contract_version: ERROR_CONTRACT_VERSION,
    source_contract_version: sourceContractVersion,
    request_id: requestId,
    task_id: taskId,
    session_id: sessionId,
    run_id: runId,
    audit_id: auditId,
    handoff_id: handoffId
  };
}

function decorate(payload, {
  sourceContractVersion,
  requestId = null,
  taskId = null,
  sessionId = null,
  runId = null,
  auditId = null,
  handoffId = null,
  operation = ERROR_OPERATION,
  legacyContractVersion = sourceContractVersion
} = {}) {
  const resolvedRequestId = payload.request_id ?? requestId;
  return {
    ...payload,
    error_contract_version: ERROR_CONTRACT_VERSION,
    source_contract_version: sourceContractVersion,
    operation: payload.operation || operation,
    request_id: resolvedRequestId,
    trace: buildTrace({
      sourceContractVersion,
      requestId: resolvedRequestId,
      taskId,
      sessionId,
      runId,
      auditId,
      handoffId,
      legacyContractVersion
    })
  };
}

module.exports = { ERROR_CONTRACT_VERSION, ERROR_OPERATION, buildTrace, decorate };
