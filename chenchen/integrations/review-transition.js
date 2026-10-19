"use strict";

const { randomUUID, createHash } = require("node:crypto");
const { WorkflowError } = require("./review-workflow");
const VERSION = "review-transition.v1";
const taskKey = id => "review-transition:task:" + id;
const planKey = id => "review-transition:funding:" + id;

function unavailable(entry = null) {
  const error = new WorkflowError("REVIEW_SERVICE_UNAVAILABLE", "任务或资金安排的变更尚未确认保存，已阻止沿用旧状态。", {
    statusCode: 503, retryable: false, stage: "BACKEND",
    recovery: "保留任务编号，由后端核查变更登记及存储记录。不要自动重试、换任务绕过、清除登记或继续执行。"
  });
  error.requestId = entry?.request_id || null;
  error.taskId = entry?.task_id || null;
  error.runId = entry?.run_id || null;
  error.sessionId = entry?.session_id || null;
  error.auditId = entry?.audit_id || null;
  error.handoffId = entry?.handoff_id || null;
  return error;
}

// Internal admission markers, serialized by ReviewService's existing queue.
// A PENDING marker has no automatic expiry and never grants execution rights.
class ReviewTransitions {
  constructor(storage) { this.storage = storage; }

  async assertKeys(keys) {
    for (const key of keys) {
      const entry = await this.storage.get(key);
      if (entry && (entry.transition_version !== VERSION || entry.state !== "COMPLETED")) throw unavailable(entry);
    }
  }

  async assertRecord(record) {
    if (!record) return;
    await this.assertKeys([taskKey(record.task_id), ...(record.proposed_action?.funding?.plan_id ? [planKey(record.proposed_action.funding.plan_id)] : [])]);
  }

  async assertTask(taskId) {
    if (typeof taskId === "string") await this.assertKeys([taskKey(taskId)]);
  }

  async assertPlan(planId) {
    if (typeof planId === "string") await this.assertKeys([planKey(planId)]);
  }

  async begin({ operation, body, record = null, planId = null }) {
    const keys = [...(record ? [taskKey(record.task_id)] : []), ...(planId ? [planKey(planId)] : [])];
    if (!keys.length) throw new Error("Transition needs a stored task or funding plan");
    await this.assertKeys(keys);
    const entry = { transition_version: VERSION, transition_id: "transition-" + randomUUID(), state: "PENDING",
      operation, keys, task_id: record?.task_id || null, request_id: record?.request_id || null,
      session_id: record?.session_id || null, run_id: record?.run_id || null, audit_id: record?.audit?.audit_id || null,
      handoff_id: record?.risk_handoff?.handoff_id || null, plan_id: planId,
      request_sha256: createHash("sha256").update(JSON.stringify(body)).digest("hex"), created_at: new Date().toISOString() };
    try { await this.storage.put(Object.fromEntries(keys.map(key => [key, entry]))); }
    catch { throw unavailable(entry); }
    return entry;
  }

  completedEntries(entry, record = null) {
    if (!entry) return {};
    if (entry.task_id && (record?.task_id !== entry.task_id || record?.run_id !== entry.run_id || record?.audit?.audit_id !== entry.audit_id)) throw unavailable(entry);
    const completed = { ...entry, state: "COMPLETED", completed_at: new Date().toISOString() };
    return Object.fromEntries(entry.keys.map(key => [key, completed]));
  }
}

module.exports = { VERSION, ReviewTransitions, unavailable };
