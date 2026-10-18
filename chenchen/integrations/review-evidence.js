"use strict";

const { createHash } = require("node:crypto");
const sha256 = value => createHash("sha256").update(value).digest("hex");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const display = value => JSON.stringify(value ?? null);
const labels = { PENDING_RISK: "等待风控", PENDING_APPROVAL: "等待人工审批", READY_FOR_SIMULATION: "可进行模拟",
  SIMULATED: "模拟完成（没有真实资金动作）", REJECTED: "已拒绝", EXPIRED: "批准已过期",
  MODEL_FAILED: "模型失败", FUNDING_BLOCKED: "资金安排冲突，已阻断", CANCELLED: "已取消" };

// Offline consistency checking only. This is not authorization or signature verification.
function buildReviewEvidence(record, { includeContent = false, sourceSha256 = null } = {}) {
  if (!object(record) || record.workflow_version !== "review-workflow.v1" || !object(record.audit) || !Array.isArray(record.audit.events)) {
    throw new Error("需要 GET /api/review/task/{task_id} 返回的完整工作流 JSON，不能使用旧版摘要或交接包。");
  }
  const findings = [];
  const issue = (code, location, severity = "ERROR") => findings.push({ code, location, severity });
  const equal = (actual, expected, location) => { if (actual !== expected) issue("TRACE_MISMATCH", location); };
  const trace = { task_id: record.task_id, request_id: record.request_id, run_id: record.run_id,
    audit_id: record.audit.audit_id, handoff_id: record.risk_handoff?.handoff_id };
  for (const [key, value] of Object.entries(trace)) if (typeof value !== "string" || !value.trim()) issue("MISSING_TRACE", key);
  for (const key of ["task_id", "request_id", "run_id"]) equal(record.audit[key], trace[key], "audit." + key);
  if (!Object.hasOwn(labels, record.status)) issue("UNKNOWN_WORKFLOW_STATUS", "status");
  if (record.execution_mode !== "PAPER") issue("UNSUPPORTED_EXECUTION_MODE", "execution_mode");
  for (const name of ["risk_handoff", "approval", "execution"]) {
    if (!object(record[name])) issue("MISSING_STAGE", name);
    else equal(record[name].task_id, record.task_id, name + ".task_id");
  }
  equal(record.risk_handoff?.run_id, record.run_id, "risk_handoff.run_id");
  equal(record.risk_handoff?.evidence?.audit_id, record.audit.audit_id, "risk_handoff.evidence.audit_id");
  if (record.execution?.execution_allowed !== false || record.risk_handoff?.execution_allowed !== false) issue("REAL_EXECUTION_NOT_ALLOWED", "execution_allowed");
  if (record.status !== "READY_FOR_SIMULATION" && record.execution?.simulation_allowed !== false) issue("UNSAFE_SIMULATION_FLAG", "execution.simulation_allowed");
  const proposal = record.proposed_action;
  if (object(proposal)) {
    const { proposal_sha256, ...bound } = proposal;
    if (sha256(JSON.stringify(bound)) !== proposal_sha256) issue("PROPOSAL_HASH_MISMATCH", "proposed_action");
    equal(record.risk_handoff?.evidence?.proposal_sha256, proposal_sha256, "risk_handoff.evidence.proposal_sha256");
    equal(record.approval?.proposal_sha256, proposal_sha256, "approval.proposal_sha256");
    if (record.risk_decision) {
      equal(record.risk_decision.task_id, record.task_id, "risk_decision.task_id");
      equal(record.risk_decision.proposal_sha256, proposal_sha256, "risk_decision.proposal_sha256");
    }
  } else if (record.status !== "MODEL_FAILED") issue("MISSING_PROPOSAL", "proposed_action");

  const events = record.audit.events, eventIds = new Set();
  if (!events.length) issue("MISSING_AUDIT_EVENTS", "audit.events");
  events.forEach((event, index) => {
    const location = "audit.events[" + index + "]";
    if (!object(event)) { issue("INVALID_EVENT", location); return; }
    equal(event.task_id, record.task_id, location + ".task_id");
    if (!event.event_id || eventIds.has(event.event_id)) issue("MISSING_OR_DUPLICATE_EVENT_ID", location);
    eventIds.add(event.event_id);
    if (typeof event.event_type !== "string" || !Number.isFinite(Date.parse(event.timestamp))) issue("INVALID_EVENT_METADATA", location);
    for (const [key, expected] of Object.entries(trace)) {
      equal(event.payload?.[key], expected, location + ".payload." + key);
      equal(event.payload?.trace?.[key], expected, location + ".payload.trace." + key);
    }
  });
  const receipt = record.execution?.receipt;
  if (record.status === "SIMULATED") {
    if (!object(receipt)) issue("MISSING_RECEIPT", "execution.receipt");
    if (record.execution?.status !== "SIMULATED" || receipt?.mode !== "SIMULATED" || receipt?.side_effects !== false) issue("INVALID_SIMULATION_RECEIPT", "execution");
    equal(receipt?.task_id, record.task_id, "execution.receipt.task_id");
    equal(receipt?.proposal_sha256, proposal?.proposal_sha256, "execution.receipt.proposal_sha256");
    equal(receipt?.execution_id, record.execution?.execution_id, "execution.receipt.execution_id");
    if (typeof receipt?.execution_id !== "string" || !receipt.execution_id) issue("MISSING_EXECUTION_ID", "execution.receipt.execution_id");
    if (record.risk_decision?.decision !== "APPROVE" || record.risk_decision?.status !== "APPROVED") issue("RISK_NOT_APPROVED", "risk_decision");
    if (record.approval?.required !== true && record.approval?.required !== false) issue("MISSING_APPROVAL_REQUIREMENT", "approval.required");
    if (record.approval?.required) {
      if (record.approval.status !== "APPROVED" || record.approval.decision !== "APPROVE") issue("APPROVAL_NOT_APPROVED", "approval");
      const completed = Date.parse(receipt?.completed_at), expires = Date.parse(record.approval.expires_at);
      if (!Number.isFinite(completed) || !Number.isFinite(expires) || completed >= expires) issue("EXPIRED_OR_UNVERIFIABLE_APPROVAL", "approval.expires_at");
    }
    const executed = events.findIndex(e => e?.event_type === "execution.simulated");
    const risk = events.findIndex(e => e?.event_type === "risk.approved");
    const approved = events.findIndex(e => e?.event_type === "approval.approved");
    if (executed < 0 || risk < 0 || risk >= executed || (record.approval?.required && (approved <= risk || approved >= executed))) issue("INCOMPLETE_GATE_SEQUENCE", "audit.events");
    if (events.filter(e => e?.event_type === "execution.simulated").length !== 1) issue("DUPLICATE_OR_MISSING_EXECUTION", "audit.events");
  } else if (receipt !== null && receipt !== undefined) issue("RECEIPT_WITHOUT_COMPLETED_TASK", "execution.receipt");

  if (record.status === "MODEL_FAILED") {
    if (proposal || record.model?.status !== "FAILED") issue("MODEL_FAILURE_STATE_MISMATCH", "model");
  } else {
    if (!record.model?.model_response?.provider_response_id) issue("PROVIDER_RECEIPT_MISSING", "model.model_response.provider_response_id", "WARNING");
    if (typeof record.model?.model_response?.raw_text !== "string") issue("MODEL_RAW_RESPONSE_MISSING", "model.model_response.raw_text", "WARNING");
  }
  for (const [name, actor, owner] of [["risk_decision", "reviewer", "risk"], ["approval", "approver", "approval"]]) {
    if (!record[name]?.decision) continue;
    const auth = record[name].auth;
    if (!auth?.verified) issue("ACTOR_NOT_VERIFIED_IN_RECORD", name + ".auth", "WARNING");
    else if (auth.owner !== owner || auth.actor !== record[name][actor] || auth.mode !== "HMAC_SHA256") issue("AUTH_CLAIM_MISMATCH", name + ".auth");
  }
  if (["PENDING", "FAILED", "UNAVAILABLE"].includes(record.memory_write_status)) issue("MEMORY_NOT_COMPLETED", "memory_write_status", "WARNING");
  const status = findings.some(x => x.severity === "ERROR") ? "INCONSISTENT" : "CONSISTENT_WITH_LIMITS";
  const manifest = { report_version: "review-evidence-export.v1", exported_at: new Date().toISOString(),
    source_sha256: sourceSha256, trace, workflow_status: record.status, data_mode: record.data_mode,
    consistency_status: status, content_included: includeContent, findings,
    event_count: events.length, record_is_not_authenticated: true, signatures_reverified: false, joint_acceptance: false,
    note: "仅核对所提供文件的内部一致性；不证明模型真实调用、审批准许或服务真实性，不替代正式 Schema 与联合验收。" };
  const lines = ["Core Agent 任务记录", "", manifest.note,
    "检查结果：" + status, "任务状态：" + (Object.hasOwn(labels, record.status) ? labels[record.status] : "未知"),
    "数据模式（来自输入记录）：" + display(record.data_mode), "原文件 SHA-256：" + display(sourceSha256), "",
    ...Object.entries(trace).map(([key, value]) => key + "：" + display(value)), "",
    "模型状态：" + display(record.model?.status), "供应商回执：" + display(record.model?.model_response?.provider_response_id),
    "风控结果：" + display(record.risk_decision?.decision), "审批状态：" + display(record.approval?.status),
    "模拟回执编号：" + display(receipt?.execution_id), "记忆状态：" + display(record.memory_write_status),
    "", "检查发现（ERROR 为不一致；WARNING 为缺少证据或未完成）：",
    ...(findings.length ? findings.map(item => item.severity + " | " + item.code + " | " + item.location) : ["未发现所检查范围内的不一致；仍非真实服务验收。"]),
    "", "按记录顺序列出事件（自由文本默认不导出）：",
    ...events.map((event, index) => (index + 1) + " | " + display(event?.timestamp) + " | " + display(event?.event_type) + " | " + display(event?.event_id))];
  if (includeContent) lines.push("", "以下为用户明确选择导出的原始内容，可能包含个人财务信息，请仅在获授权范围内分享：",
    JSON.stringify({ reviewed_input: record.reviewed_input, model: record.model, proposed_action: proposal,
      risk_decision: record.risk_decision, approval: record.approval, execution: record.execution, audit: record.audit, error: record.error }, null, 2));
  return { manifest, text: lines.join("\n") + "\n" };
}

module.exports = { buildReviewEvidence, sha256 };
