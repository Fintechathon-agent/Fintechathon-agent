"use strict";
const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual: equal } = require("node:util");
const { hash } = require("../../docs/safety-risk-eval/contracts/validate.cjs");
const { evaluate, executionEligible } = require("./engine.cjs");
const policyModule = require("./policy.cjs");
const clone = structuredClone;
class GatewayError extends Error {
  constructor(code, message, decision = "BLOCK", status = 409) { super(message); Object.assign(this, { code, decision, status }); }
}
const emptyApproval = () => ({ status: "UNCONFIRMED", approval_id: null, confirmed_by: null, confirmed_at: null, expires_at: null, risk_check_id: null, binding: null, accepted_risks: [] });

class ActionGateway {
  constructor({ store, projectPlan, executePlan, now = () => new Date().toISOString(), approvalTtlMs = 15 * 60 * 1000, onSuccess = () => null, beforeExecute = async () => null, getPolicy = policyModule.currentPolicy }) {
    Object.assign(this, { store, projectPlan, executePlan, now, approvalTtlMs, onSuccess, beforeExecute, getPolicy });
    this.busy = new Set();
    this.toolCalls = new Map();
  }
  event(type, record, details = {}) {
    return this.store.append({ ...details, event_id: `audit-${randomUUID()}`, event_type: type, occurred_at: this.now(), task_id: record.input.binding.task_id, user_id: record.input.binding.user_id, binding: clone(record.input.binding), correlation_id: record.input.audit_context.correlation_id });
  }
  owner(taskId, actor) {
    const record = this.store.data.tasks[taskId];
    if (!record || record.input.binding.user_id !== actor) throw new GatewayError("PERMISSION_DENIED", "任务不存在或无权访问。", "BLOCK", 403);
    return clone(record);
  }
  authority(record) {
    return { user_id: record.input.binding.user_id, allowed_tools: ["portfolio.review", "paper_trade"], expected_binding: record.input.binding, project_plan: this.projectPlan, approval_check_id: record.review?.risk_check_id, action_source: record.action_source || "USER", supports_real_data: false };
  }
  policyCheck(record, actor, stage, riskEligible = false, memory = false) {
    let policy;
    try { policy = this.getPolicy(); } catch { policy = null; }
    const requestHash = policyModule.snapshot(record.input);
    let digest = null;
    try { digest = policyModule.fingerprint(policy); } catch { /* The evaluator returns ERROR. */ }
    const receipt = record.approval_policy;
    const result = policyModule.decide({ subject: actor, owner: record.input.binding.user_id,
      source: record.action_source, scenario: memory ? "MEMORY" : "SIMULATION", tool: memory ? "memory.write" : "paper_trade",
      operation: memory ? "MEMORY_WRITE" : record.input.context.requested_operation === "REAL_TRADE" ? "REAL_TRADE" : "PAPER_TRADE",
      stage, request_hash: requestHash, memory_consent: record.memory_consent, provenance_verified: !record.handoff_import,
      approval_matches: record.input.approval.status === "CONFIRMED" && receipt?.policy_digest === digest && receipt?.request_hash === requestHash && receipt?.approval_id === record.input.approval.approval_id,
      risk_eligible: riskEligible }, policy ?? null, this.now());
    this.event("POLICY_DECIDED", record, { policy: result });
    return result;
  }
  register(input, { actionSource = "USER", memoryConsent = false, external = [], deferReview = false } = {}) {
    // Internal adapter only. HTTP callers cannot supply Risk input, authority or stored approval.
    const taskId = input.binding.task_id;
    if (this.store.data.tasks[taskId]) throw new GatewayError("TASK_EXISTS", "任务已存在。", "BLOCK");
    const record = { input: clone(input), review: null, action_source: actionSource, memory_consent: memoryConsent, external: clone(external), invalidated: false };
    this.event("TASK_REGISTERED", record, { external_count: external.length });
    this.store.transaction((data) => { data.tasks[taskId] = record; return null; });
    return deferReview ? null : this.review(taskId, input.binding.user_id);
  }
  review(taskId, actor) {
    const record = this.owner(taskId, actor);
    if (this.busy.has(taskId)) throw new GatewayError("TASK_RUNNING", "任务正在执行。", "REVIEW");
    const input = clone(record.input); input.stage = "PLAN_REVIEW"; input.requested_at = this.now();
    input.approval = emptyApproval();
    const result = evaluate(input, this.authority(record), { now: this.now() });
    const policy = this.policyCheck(record, actor, "REVIEW");
    this.store.transaction((data) => { data.snapshots[hash(input)] = input; return null; });
    result.audit_event.record_status = "PERSISTED";
    this.store.append(result.audit_event);
    this.store.transaction((data) => {
      data.tasks[taskId].input = input; data.tasks[taskId].review = result; data.tasks[taskId].invalidated = false;
      data.tasks[taskId].policy = policy; data.tasks[taskId].approval_policy = null;
      return null;
    });
    return clone(result);
  }
  confirm(taskId, actor, { risk_check_id, binding, accepted_reason_ids, confirmed }) {
    const record = this.owner(taskId, actor);
    if (confirmed !== true || !Array.isArray(accepted_reason_ids)) throw new GatewayError("EXPLICIT_CONFIRMATION_REQUIRED", "必须明确确认完整计划。", "REVIEW");
    if (this.busy.has(taskId) || record.invalidated || risk_check_id !== record.review?.risk_check_id || !equal(binding, record.input.binding)) throw new GatewayError("APPROVAL_INVALIDATED", "检查或方案版本已变化，请重新检查与确认。", "REVIEW");
    const reasons = record.review.reasons;
    if (["ERROR", "BLOCK"].includes(record.review.decision) || reasons.some((r) => !r.acceptance_allowed)) throw new GatewayError("RISK_NOT_ACCEPTABLE", "该方案存在不可接受的阻止或需修复事项。");
    const required = reasons.map((r) => r.reason_id).sort();
    if (!equal([...new Set(accepted_reason_ids)].sort(), required)) throw new GatewayError("RISK_ACCEPTANCE_REQUIRED", "请逐项接受当前风险，不能接受未知或旧版本风险。", "REVIEW");
    const policy = this.policyCheck(record, actor, "REVIEW");
    if (!policy.allow) throw new GatewayError(policy.reasons[0].code, policy.reasons[0].message_zh, policy.decision);
    if (record.policy?.policy_digest !== policy.policy_digest || record.policy?.request_hash !== policy.request_hash) throw new GatewayError("POLICY_APPROVAL_STALE", "策略或业务内容已变化，请重新检查再确认。", "REVIEW");
    const now = this.now();
    const approval = { status: "CONFIRMED", approval_id: `approval-${randomUUID()}`, confirmed_by: actor, confirmed_at: now, expires_at: new Date(Date.parse(now) + this.approvalTtlMs).toISOString(), risk_check_id, binding: clone(binding), accepted_risks: required.map((reason_id) => ({ reason_id, risk_check_id, user_id: actor, accepted_at: now, binding: clone(binding) })) };
    const approvalPolicy = { policy_digest: policy.policy_digest, policy_version: policy.policy_version, request_hash: policy.request_hash, decision_id: policy.decision_id, approval_id: approval.approval_id };
    this.event("PLAN_CONFIRMED", record, { approval, approval_policy: approvalPolicy });
    this.store.transaction((data) => { data.tasks[taskId].input.approval = approval; data.tasks[taskId].approval_policy = approvalPolicy; return null; });
    return approval;
  }
  reject(taskId, actor, revoked = false) {
    const record = this.owner(taskId, actor);
    if (this.busy.has(taskId)) throw new GatewayError("ALREADY_RUNNING", "计划已经启动，不能假称已经撤回执行。", "REVIEW");
    const approval = { ...emptyApproval(), status: revoked ? "REVOKED" : "REJECTED" };
    this.event(revoked ? "PLAN_REVOKED" : "PLAN_REJECTED", record, { approval });
    this.store.transaction((data) => { data.tasks[taskId].input.approval = approval; return null; });
    return approval;
  }
  replace(taskId, actor, input) {
    const record = this.owner(taskId, actor);
    if (this.busy.has(taskId) || input.binding.task_id !== taskId || input.binding.user_id !== actor) throw new GatewayError("INVALID_REPLACEMENT", "不能更换任务归属或修改正在执行的任务。");
    if (equal(input.binding, record.input.binding) && (hash(input.plan) !== hash(record.input.plan) || hash(input.profile) !== hash(record.input.profile) || hash(input.upstream) !== hash(record.input.upstream) || hash(input.data_context) !== hash(record.input.data_context))) throw new GatewayError("VERSION_REQUIRED", "相关内容改变必须升级对应版本。");
    this.event("PLAN_INVALIDATED", record, { new_binding: input.binding });
    this.store.transaction((data) => { data.tasks[taskId].input = clone(input); data.tasks[taskId].input.approval = { ...emptyApproval(), status: "INVALIDATED" }; data.tasks[taskId].invalidated = true; return null; });
  }
  inspect(taskId, actor) { return this.owner(taskId, actor); }
  async execute(taskId, actor, key) {
    const record = this.owner(taskId, actor);
    if (typeof key !== "string" || key.length < 8 || key.length > 128) throw new GatewayError("IDEMPOTENCY_KEY_REQUIRED", "必须提供8到128字符的执行标识。");
    const scope = `${actor}:${key}`, contentHash = hash(record.input.binding);
    const prior = this.store.data.executions[scope];
    if (prior) {
      if (prior.content_hash !== contentHash) { this.event("EXECUTION_BLOCKED", record, { code: "IDEMPOTENCY_CONFLICT", decision: "BLOCK" }); throw new GatewayError("IDEMPOTENCY_CONFLICT", "同一执行标识已绑定另一计划。"); }
      this.event("DUPLICATE_REQUEST", record, { execution_id: prior.execution_id, status: prior.status });
      return { replay: true, ...clone(prior) };
    }
    const samePlan = Object.values(this.store.data.executions).find((e) => e.content_hash === contentHash && e.user_id === actor);
    if (samePlan) { this.event("DUPLICATE_REQUEST", record, { execution_id: samePlan.execution_id, status: samePlan.status }); return { replay: true, ...clone(samePlan) }; }
    if (this.busy.has(taskId)) throw new GatewayError("EXECUTION_IN_PROGRESS", "已有请求正在核查或执行。", "REVIEW");
    this.busy.add(taskId);
    let started = false, execution;
    try {
      const input = clone(record.input);
      input.stage = "EXECUTION_PREFLIGHT"; input.requested_at = this.now();
      input.context.requested_operation = "PAPER_TRADE"; input.context.requested_tool = "paper_trade";
      if (record.input.context.requested_operation === "REAL_TRADE") input.context.requested_operation = "REAL_TRADE";
      input.execution = { status: "NOT_STARTED", execution_id: `execution-${randomUUID()}`, idempotency_key: key, content_hash: contentHash, previous_result_ref: null };
      const preEvent = this.event("EXECUTION_REQUESTED", record, { execution: input.execution, approval: input.approval });
      input.audit_context.pre_execution_record_status = "RECORDED"; input.audit_context.pre_execution_record_id = preEvent.event_id;
      if (record.invalidated) input.approval = { ...emptyApproval(), status: "INVALIDATED" };
      const result = evaluate(input, this.authority(record), { now: this.now() });
      this.store.transaction((data) => { data.snapshots[hash(input)] = input; return null; });
      result.audit_event.record_status = "PERSISTED";
      this.store.append(result.audit_event);
      const policy = this.policyCheck(record, actor, "EXECUTE", executionEligible(result));
      if (!executionEligible(result) || !policy.allow) {
        this.event("EXECUTION_BLOCKED", record, { decision: policy.allow ? result.decision : policy.decision, policy, risk_check_id: result.risk_check_id, reasons: result.reasons, execution: input.execution });
        return { status: "NOT_STARTED", execution_allowed: false, risk: result, policy };
      }
      execution = { ...input.execution, status: "RUNNING", user_id: actor, task_id: taskId, result: null };
      this.store.transaction((data) => { data.executions[scope] = execution; return null; });
      this.event("EXECUTION_STARTED", record, { execution, policy, risk_check_id: result.risk_check_id });
      await this.beforeExecute(record, execution);
      // Revalidate after the asynchronous durable fence, without another await before dispatch.
      const latest = this.owner(taskId, actor);
      if (policyModule.fingerprint(this.getPolicy()) !== policy.policy_digest || policyModule.snapshot(latest.input) !== policy.request_hash || latest.action_source !== record.action_source || !equal(latest.input.approval, input.approval) || Date.parse(input.approval.expires_at) <= Date.parse(this.now())) throw new GatewayError("POLICY_DISPATCH_INVALIDATED", "执行前策略或授权已变化，未调用工具。", "ERROR");
      started = true;
      this.toolCalls.set(taskId, (this.toolCalls.get(taskId) || 0) + 1);
      const output = await this.executePlan(clone(input), { approvalId: input.approval.approval_id, idempotencyKey: `${actor}:${key}` });
      if (!output || output.status !== "SUCCEEDED" || !output.receipt) throw new Error("EXECUTOR_RESULT_UNVERIFIED");
      execution = { ...execution, status: "SUCCEEDED", result: output };
      this.store.transaction((data) => { data.executions[scope] = execution; return null; });
      this.event("EXECUTION_SUCCEEDED", record, { execution });
      let memory = null;
      if (record.memory_consent) {
        try { const memoryPolicy = this.policyCheck(record, actor, "EXECUTE", true, true); if (!memoryPolicy.allow) throw new Error("MEMORY_POLICY_DENIED"); memory = await this.onSuccess(record, output); this.event("MEMORY_UPDATED", record, { memory, policy: memoryPolicy }); }
        catch { this.event("MEMORY_UPDATE_FAILED", record, { execution_id: execution.execution_id }); }
      }
      return { ...execution, memory, risk: result, policy, replay: false };
    } catch (error) {
      const failureCode = started ? "EXECUTION_RESULT_UNKNOWN" : error instanceof GatewayError ? error.code : "PRE_EXECUTION_AUDIT_FAILED";
      if (execution) {
        execution = { ...execution, status: started ? "UNKNOWN" : "ABORTED", error: "Execution or durable recording could not be completed" };
        try { this.store.transaction((data) => { data.executions[scope] = execution; return null; }); } catch { /* Keep the durable RUNNING claim for reconciliation after restart. */ }
      }
      try { this.event(started ? "EXECUTION_UNKNOWN" : "EXECUTION_ABORTED", record, { decision: "ERROR", code: failureCode, execution: execution || null }); } catch { /* Failure is returned; no fabricated successful audit entry. */ }
      return { status: started ? "UNKNOWN" : "NOT_STARTED", execution_allowed: false, decision: "ERROR", code: failureCode, message_zh: started ? "执行或结果记录出现异常，先核查，不自动重试。" : "必要检查或持久化失败，未调用执行工具。" };
    } finally { this.busy.delete(taskId); }
  }
  reconcile(taskId, actor, key, verifiedReceipt) {
    // Internal trusted executor callback only; deliberately not exposed as an HTTP endpoint.
    const record = this.owner(taskId, actor), scope = `${actor}:${key}`;
    const entry = this.store.data.executions[scope];
    if (!entry || entry.task_id !== taskId || !["UNKNOWN", "RUNNING"].includes(entry.status)) throw new GatewayError("NOT_RECONCILABLE", "该执行不需要核查。");
    if (!verifiedReceipt || verifiedReceipt.execution_id !== entry.execution_id || verifiedReceipt.content_hash !== entry.content_hash || verifiedReceipt.status !== "SUCCEEDED") throw new GatewayError("EVIDENCE_REQUIRED", "缺少可信执行回执，继续保持未知状态。", "REVIEW");
    this.event("EXECUTION_RECONCILED", record, { execution_id: entry.execution_id, receipt: verifiedReceipt });
    return this.store.transaction((data) => { data.executions[scope] = { ...entry, status: "SUCCEEDED", result: verifiedReceipt }; return data.executions[scope]; });
  }
}
module.exports = { ActionGateway, GatewayError, emptyApproval };
