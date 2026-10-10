"use strict";

const contract = require("../contracts/investment-contract");

const BRIDGE_VERSION = "risk-workbench.bridge@0.1.0";
const DEFAULT_WORKBENCH_URL = "https://fund-risk-workbench.panxintian44.chatgpt.site/risk";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildRiskWorkbenchHandoff(response, { workbenchUrl = DEFAULT_WORKBENCH_URL } = {}) {
  contract.assertHealthCheckResponse(response);
  const state = response.task_state;
  const handoff = response.risk_handoff;
  const market = response.artifacts.market_context;
  const evidence = handoff?.evidence || {};

  return {
    bridge_version: BRIDGE_VERSION,
    integration_mode: "READ_ONLY_HANDOFF_PREVIEW",
    workbench_url: workbenchUrl,
    source: {
      contract_version: response.contract_version,
      operation: response.operation,
      request_id: response.request_id,
      task_id: state.task_id,
      session_id: state.session_id,
      audit_id: response.audit_evidence.audit_id
    },
    decision: {
      status: handoff?.status || state.status,
      decision: handoff?.decision || "NOT_READY",
      execution_allowed: false,
      reason: handoff?.reason || state.error_state?.message || "任务尚未到达 Risk Handoff。"
    },
    evidence: {
      portfolio_snapshot_id: evidence.portfolio_snapshot_id || null,
      health_report_id: evidence.health_report_id || null,
      proposal_ids: clone(evidence.proposal_ids || []),
      simulation_id: evidence.simulation_id || null,
      market_context_id: evidence.market_context_id || null,
      audit_id: response.audit_evidence.audit_id,
      market_review_items: clone(market?.unresolved_conflicts || [])
    },
    controls: {
      no_execution: true,
      no_quant_recalculation: true,
      no_memory_rule_change: true,
      external_content_is_not_authoritative: true
    },
    remote_capability: {
      can_import_external_handoff: false,
      action: "OPEN_WORKBENCH_FOR_MANUAL_REVIEW",
      note: "当前工作台没有公开的外部 Handoff 导入接口；此 Demo 只生成可核对的联调包，不伪造远程写入结果。"
    }
  };
}

module.exports = { BRIDGE_VERSION, DEFAULT_WORKBENCH_URL, buildRiskWorkbenchHandoff };
