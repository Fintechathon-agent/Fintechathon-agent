"use strict";

const crypto = require("node:crypto");
const modelReview = require("./model-review");

const WORKFLOW_VERSION = "review-workflow.v1";
const RISK_DECISIONS = ["APPROVE", "REJECT", "REQUEST_MORE_INFO"];
const APPROVAL_DECISIONS = ["APPROVE", "REJECT"];

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function id(prefix) {
  return prefix + (globalThis.crypto?.randomUUID?.() || crypto.randomUUID());
}

function now() {
  return new Date().toISOString();
}

class WorkflowError extends Error {
  constructor(code, message, { statusCode = 409, retryable = false, stage = "WORKFLOW", recovery = "Review the task state and retry the allowed next step.", details = null, record = null } = {}) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.stage = stage;
    this.recovery = recovery;
    this.details = details;
    this.record = record;
    this.taskId = record?.task_id || null;
    this.runId = record?.run_id || null;
    this.auditId = record?.audit?.audit_id || null;
  }
}

function decisionValue(value, allowed, field) {
  const result = String(value || "").trim().toUpperCase();
  if (!allowed.includes(result)) {
    throw new WorkflowError("INVALID_WORKFLOW_INPUT", `${field} must be ${allowed.join(", ")}`, {
      statusCode: 422,
      stage: "VALIDATION",
      recovery: `Use one of: ${allowed.join(", ")}.`
    });
  }
  return result;
}

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkflowError("INVALID_WORKFLOW_INPUT", `${field} is required`, {
      statusCode: 422,
      stage: "VALIDATION",
      recovery: `Provide ${field} and retry.`
    });
  }
  return value.trim().slice(0, 500);
}

async function hash(value) {
  const data = new TextEncoder().encode(JSON.stringify(value));
  const digest = await (globalThis.crypto?.subtle || crypto.webcrypto.subtle).digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function event(record, eventType, payload = {}, actor = "core-agent") {
  record.audit.events.push({
    event_id: id("event-"),
    task_id: record.task_id,
    actor,
    event_type: eventType,
    payload: { ...clone(payload), request_id: record.request_id, run_id: record.run_id },
    timestamp: now()
  });
}

function proposalPayload(input, review) {
  return {
    proposed_action: review.model_response?.proposal?.proposed_action || null,
    action_reason: review.model_response?.proposal?.action_reason || null,
    risk_level: review.model_response?.proposal?.risk_level || "unknown",
    requested_action: input.requested_action || null,
    action_parameters: input.action_parameters || {},
    model_response_id: review.model_response?.provider_response_id || null
  };
}

function isApprovalRequired(proposal) {
  return proposal.proposed_action !== "NO_ACTION";
}

function completeErrorRecord(error, input, taskId, runId, auditId) {
  const timestamp = now();
  const record = {
    workflow_version: WORKFLOW_VERSION,
    task_id: taskId,
    request_id: input.request_id || null,
    run_id: runId,
    status: "MODEL_FAILED",
    model: { status: "FAILED", response: null },
    proposed_action: null,
    risk_handoff: {
      handoff_id: id("handoff-"),
      task_id: taskId,
      status: "BLOCKED",
      decision: "MODEL_FAILED",
      execution_allowed: false,
      reason: "模型调用失败，不能交给 Risk 或执行端。"
    },
    risk_decision: null,
    approval: { approval_id: id("approval-"), required: true, status: "BLOCKED", decision: null },
    execution: { execution_id: null, status: "BLOCKED", simulation_allowed: false, execution_allowed: false, receipt: null },
    audit: {
      audit_id: auditId,
      workflow_version: WORKFLOW_VERSION,
      task_id: taskId,
      request_id: input.request_id || null,
      run_id: runId,
      events: []
    },
    error: { code: error.code || "MODEL_FAILED", message: error.message || "model failed", retryable: Boolean(error.retryable) }
  };
  event(record, "task.created", { stage: "MODEL" });
  event(record, "model.failed", record.error);
  event(record, "risk.blocked", { reason: "model_failed" }, "risk-gateway");
  event(record, "execution.blocked", { reason: "model_failed" }, "execution-gateway");
  return record;
}

class ReviewWorkflowStore {
  constructor({ modelRunner = modelReview.runReview } = {}) {
    this.modelRunner = modelRunner;
    this.records = new Map();
    this.byTask = new Map();
  }

  save(record) {
    const snapshot = clone(record);
    this.records.set(snapshot.run_id, snapshot);
    this.byTask.set(snapshot.task_id, snapshot.run_id);
    return clone(snapshot);
  }

  getByRunId(runId) {
    const record = this.records.get(runId);
    return record ? clone(record) : null;
  }

  getByTaskId(taskId) {
    const runId = this.byTask.get(taskId);
    return runId ? this.getByRunId(runId) : null;
  }

  async start(input = {}, env = {}, options = {}) {
    const taskId = input.task_id || id("review-task-");
    const requestId = input.request_id || id("req-");
    const modelInput = { ...input, task_id: taskId, request_id: requestId };
    const runId = id("review-");
    let review;
    try {
      review = await this.modelRunner(modelInput, env, options);
    } catch (error) {
      const failed = completeErrorRecord(error, modelInput, taskId, error.reviewRecord?.run_id || runId, error.reviewRecord?.audit?.audit_id || error.auditId || id("audit-"));
      if (error.reviewRecord) {
        failed.model.response = clone(error.reviewRecord);
        failed.model.status = "FAILED";
      }
      this.save(failed);
      error.workflowRecord = clone(failed);
      error.taskId = taskId;
      error.runId = failed.run_id;
      error.auditId = failed.audit?.audit_id || error.auditId;
      throw error;
    }

    const proposal = proposalPayload(modelInput, review);
    const proposalSha256 = await hash(proposal);
    const approvalRequired = isApprovalRequired(proposal);
    const record = {
      workflow_version: WORKFLOW_VERSION,
      task_id: taskId,
      request_id: requestId,
      run_id: review.run_id,
      status: "PENDING_RISK",
      model: {
        status: review.status,
        source: review.source,
        model_response: review.model_response,
        input: review.input
      },
      proposed_action: { ...proposal, proposal_sha256: proposalSha256 },
      risk_handoff: {
        contract_version: modelReview.REVIEW_VERSION,
        handoff_id: id("handoff-"),
        task_id: taskId,
        run_id: review.run_id,
        status: "PENDING_REVIEW",
        decision: "REQUIRED",
        owner: "Unified Risk",
        reason: "模型输出只是拟议动作，必须由统一 Risk 决定是否进入审批。",
        evidence: {
          input_sha256: review.input.input_sha256,
          model_response_id: review.model_response.provider_response_id || null,
          proposal_sha256: proposalSha256,
          audit_id: review.audit.audit_id
        },
        execution_allowed: false
      },
      risk_decision: null,
      approval: {
        approval_id: id("approval-"),
        task_id: taskId,
        required: approvalRequired,
        status: approvalRequired ? "PENDING" : "NOT_REQUIRED",
        decision: null,
        proposal_sha256: proposalSha256,
        approver: null,
        decided_at: null
      },
      execution: {
        execution_id: null,
        task_id: taskId,
        status: "BLOCKED",
        simulation_allowed: false,
        execution_allowed: false,
        receipt: null
      },
      audit: {
        audit_id: review.audit.audit_id,
        workflow_version: WORKFLOW_VERSION,
        task_id: taskId,
        request_id: requestId,
        run_id: review.run_id,
        events: clone(review.audit.events)
      }
    };
    event(record, "workflow.created", { stage: "MODEL" });
    event(record, "model.completed", { source: review.source, proposal_sha256: proposalSha256 });
    event(record, "risk.handoff.created", { handoff_id: record.risk_handoff.handoff_id }, "risk-gateway");
    event(record, "execution.blocked", { reason: "risk_pending", execution_allowed: false }, "execution-gateway");
    return this.save(record);
  }

  requireRecord(taskId) {
    const record = this.getByTaskId(taskId);
    if (!record) throw new WorkflowError("WORKFLOW_NOT_FOUND", "review task not found", { statusCode: 404, stage: "LOOKUP", recovery: "Use the task_id returned by POST /api/review." });
    return record;
  }

  async decideRisk(input = {}) {
    const taskId = requiredString(input.task_id, "task_id");
    const record = this.requireRecord(taskId);
    const decision = decisionValue(input.decision, RISK_DECISIONS, "decision");
    const reviewer = requiredString(input.reviewer, "reviewer");
    if (input.proposal_sha256 !== record.proposed_action.proposal_sha256) {
      throw new WorkflowError("PROPOSAL_CHANGED", "proposal hash does not match the task", { stage: "RISK", recovery: "Reload the task and review the current proposal before deciding.", record });
    }
    if (record.status === "MODEL_FAILED") throw new WorkflowError("RISK_BLOCKED", "model failure cannot be approved", { stage: "RISK", record });
    if (record.risk_decision?.decision && record.risk_decision.decision !== decision) {
      throw new WorkflowError("RISK_DECISION_IMMUTABLE", "risk decision is already recorded", { stage: "RISK", record });
    }
    record.risk_decision = {
      risk_decision_id: record.risk_decision?.risk_decision_id || id("risk-decision-"),
      task_id: taskId,
      decision,
      status: decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "PENDING_REVIEW",
      reviewer,
      reason: requiredString(input.reason || "Risk decision recorded against the model proposal.", "reason"),
      proposal_sha256: record.proposed_action.proposal_sha256,
      decided_at: now()
    };
    record.risk_handoff.status = record.risk_decision.status === "APPROVED" ? "APPROVED" : record.risk_decision.status === "REJECTED" ? "REJECTED" : "PENDING_REVIEW";
    record.risk_handoff.decision = decision;
    record.risk_handoff.execution_allowed = false;
    if (decision === "REJECT") {
      record.status = "REJECTED";
      record.approval.status = "BLOCKED";
      record.execution.status = "BLOCKED";
      record.execution.simulation_allowed = false;
      event(record, "risk.rejected", { reason: record.risk_decision.reason }, "risk");
      event(record, "execution.blocked", { reason: "risk_rejected" }, "execution-gateway");
    } else if (decision === "REQUEST_MORE_INFO") {
      record.status = "PENDING_RISK";
      event(record, "risk.more_info_requested", { reason: record.risk_decision.reason }, "risk");
      event(record, "execution.blocked", { reason: "risk_more_info" }, "execution-gateway");
    } else {
      record.status = record.approval.required ? "PENDING_APPROVAL" : "READY_FOR_SIMULATION";
      record.execution.simulation_allowed = !record.approval.required;
      event(record, "risk.approved", { approval_required: record.approval.required }, "risk");
      if (record.approval.required) event(record, "approval.pending", { approval_id: record.approval.approval_id }, "approval-gateway");
      else event(record, "execution.ready_for_simulation", {}, "execution-gateway");
    }
    return this.save(record);
  }

  async decideApproval(input = {}) {
    const taskId = requiredString(input.task_id, "task_id");
    const record = this.requireRecord(taskId);
    const decision = decisionValue(input.decision, APPROVAL_DECISIONS, "decision");
    const approver = requiredString(input.approver, "approver");
    if (input.proposal_sha256 !== record.proposed_action.proposal_sha256) {
      throw new WorkflowError("PROPOSAL_CHANGED", "proposal hash does not match the task", { stage: "APPROVAL", recovery: "Reload the task and approve the current proposal only.", record });
    }
    if (record.risk_decision?.decision !== "APPROVE" || record.risk_decision.status !== "APPROVED") {
      throw new WorkflowError("APPROVAL_BLOCKED", "approval requires an approved Risk decision", { stage: "APPROVAL", recovery: "Wait for Risk APPROVE before recording approval.", record });
    }
    if (!record.approval.required) throw new WorkflowError("APPROVAL_NOT_REQUIRED", "this task does not require approval", { stage: "APPROVAL", record });
    record.approval.decision = decision;
    record.approval.approver = approver;
    record.approval.decided_at = now();
    record.approval.status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
    if (decision === "REJECT") {
      record.status = "REJECTED";
      record.execution.status = "BLOCKED";
      record.execution.simulation_allowed = false;
      event(record, "approval.rejected", { reason: input.reason || "审批人拒绝" }, "approval");
      event(record, "execution.blocked", { reason: "approval_rejected" }, "execution-gateway");
    } else {
      record.status = "READY_FOR_SIMULATION";
      record.execution.status = "READY";
      record.execution.simulation_allowed = true;
      event(record, "approval.approved", { approval_id: record.approval.approval_id }, "approval");
      event(record, "execution.ready_for_simulation", {}, "execution-gateway");
    }
    return this.save(record);
  }

  async simulate(input = {}) {
    const taskId = requiredString(input.task_id, "task_id");
    const record = this.requireRecord(taskId);
    if (input.proposal_sha256 !== record.proposed_action.proposal_sha256) {
      throw new WorkflowError("PROPOSAL_CHANGED", "proposal hash does not match the task", { stage: "EXECUTION", recovery: "Reload the task and simulate the current approved proposal only.", record });
    }
    if (record.status !== "READY_FOR_SIMULATION" || !record.execution.simulation_allowed) {
      event(record, "execution.blocked", { reason: record.status.toLowerCase(), execution_allowed: false }, "execution-gateway");
      const saved = this.save(record);
      throw new WorkflowError("EXECUTION_BLOCKED", "execution is blocked until Risk and approval are complete", { stage: "EXECUTION", recovery: "Resolve the Risk and approval states, then retry simulation.", record: saved });
    }
    const executionId = id("sim-exec-");
    record.execution = {
      execution_id: executionId,
      task_id: taskId,
      status: "SIMULATED",
      simulation_allowed: false,
      execution_allowed: false,
      receipt: {
        mode: "SIMULATED",
        execution_id: executionId,
        task_id: taskId,
        proposal_sha256: record.proposed_action.proposal_sha256,
        side_effects: false,
        message: "模拟执行完成；未调用真实交易、付款或账户网关。",
        completed_at: now()
      }
    };
    record.status = "SIMULATED";
    event(record, "execution.simulated", { execution_id: executionId, side_effects: false }, "execution-gateway");
    return this.save(record);
  }

  reset() {
    this.records.clear();
    this.byTask.clear();
  }
}

module.exports = { WORKFLOW_VERSION, RISK_DECISIONS, APPROVAL_DECISIONS, WorkflowError, ReviewWorkflowStore };
