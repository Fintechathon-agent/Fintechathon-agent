"use strict";
const { randomUUID } = require("node:crypto");
const validate = require("./validate.cjs");
const adapter = require("../core-adapter.cjs");
const { GatewayError } = require("../gateway.cjs");
const { hash, inputIssues } = require("../../../docs/safety-risk-eval/contracts/validate.cjs");
const VERSION = "risk-handoff.import.v1";
const reject = (code, message, status = 422) => { throw new GatewayError(code, message, "ERROR", status); };
function inspect(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some((k) => !["import_version", "agent_response"].includes(k)) || payload.import_version !== VERSION) reject("HANDOFF_ENVELOPE_INVALID", "请提交 risk-handoff.import.v1 和完整 agent_response，不能提交身份、权限或审批字段。", 400);
  const u = payload.agent_response;
  if (!validate(u)) reject("HANDOFF_SCHEMA_INVALID", "Core 响应不符合统一契约，需要完整 trace、artifacts、tool_results 和 audit_evidence；仅含编号的适配摘要无法导入。");
  if (!u.risk_handoff || u.task_state.stage !== "RISK_CHECK" || u.task_state.status !== "HANDOFF_REQUIRED") reject("HANDOFF_NOT_READY", "Core 尚未到达待风控交接阶段。");
  for (const key of ["request_id", "task_id", "session_id"]) {
    const value = key === "request_id" ? u.request_id : u.task_state[key];
    if (u.trace[key] !== value || u.audit_evidence[key] !== value) reject("HANDOFF_TRACE_MISMATCH", "Core trace、任务和审计关联编号不一致。");
  }
  if (u.risk_handoff.task_id !== u.task_state.task_id || u.risk_handoff.session_id !== u.task_state.session_id || u.risk_handoff.evidence.audit_id !== u.audit_evidence.audit_id || u.audit_evidence.events.some((e) => e.task_id !== u.task_state.task_id)) reject("HANDOFF_TRACE_MISMATCH", "交接或审计事件引用了其他任务。");
  if (u.task_state.request_id != null && u.task_state.request_id !== u.request_id) reject("HANDOFF_TRACE_MISMATCH", "任务请求编号不一致。");
  const a = u.artifacts, h = u.risk_handoff.evidence;
  if (!a.candidates?.length || h.proposal_ids.length !== a.candidates.length || new Set(h.proposal_ids).size !== h.proposal_ids.length) reject("HANDOFF_EVIDENCE_INVALID", "候选方案清单缺失或重复。");
  if (!a.candidates.some((c) => c.plan_id === "A") || new Set(a.candidates.map((c) => c.plan_id)).size !== a.candidates.length || new Set(a.candidates.map((c) => c.proposal_id)).size !== a.candidates.length) reject("HANDOFF_EVIDENCE_INVALID", "方案编号重复或缺少用于初始评审的 A 方案。");
  const projection = structuredClone(u);
  delete projection.trace; delete projection.audit_evidence; delete projection.risk_handoff.evidence.audit_id;
  // Validate every candidate with the existing evidence contract, before any task is written.
  for (const candidate of a.candidates) {
    let input;
    try { input = adapter.fromHandoff(projection, "handoff-validation-only", { planId: candidate.plan_id }); }
    catch { reject("HANDOFF_EVIDENCE_INVALID", "缺少持仓、候选方案或模拟结果。"); }
    if (inputIssues(input).length) reject("HANDOFF_EVIDENCE_INVALID", "方案、证据引用或测算口径不一致，请由 Core 修复后重发。");
  }
  return { raw: structuredClone(u), projection, digest: hash(u), source: { contract_version: u.contract_version, request_id: u.request_id, task_id: u.task_state.task_id, session_id: u.task_state.session_id, handoff_id: u.risk_handoff.handoff_id, audit_id: u.audit_evidence.audit_id } };
}
function receive({ payload, actor, gateway }) {
  let packet;
  try { packet = inspect(payload); }
  catch (error) {
    gateway.store.append({ event_id: `audit-${randomUUID()}`, event_type: "HANDOFF_IMPORT_REJECTED", user_id: actor, occurred_at: gateway.now(), code: error.code || "HANDOFF_IMPORT_FAILED", execution_allowed: false });
    throw error;
  }
  const { audit_id: unusedAuditId, ...sourceIdentity } = packet.source;
  const key = hash({ actor, source: sourceIdentity });
  const previous = Object.values(gateway.store.data.tasks).find((r) => r.input.binding.user_id === actor && r.handoff_import?.import_key === key);
  if (previous) {
    if (previous.handoff_import.source_digest !== packet.digest) { gateway.event("HANDOFF_IMPORT_REJECTED", previous, { code: "HANDOFF_IMPORT_CONFLICT", source: packet.source, source_digest: packet.digest }); reject("HANDOFF_IMPORT_CONFLICT", "相同来源编号对应不同内容，请由 Core 生成新任务编号。", 409); }
    gateway.event("HANDOFF_IMPORT_REPLAY", previous, { source: packet.source, source_digest: packet.digest });
    return result(previous, true);
  }
  if (Object.keys(gateway.store.data.tasks).length >= 20) reject("DEMO_TASK_LIMIT", "当前会话已达20个任务上限。", 429);
  const localTask = `import-task-${randomUUID()}`, localSession = `import-session-${randomUUID()}`;
  const u = packet.projection;
  u.task_state.task_id = localTask; u.task_state.session_id = localSession;
  u.risk_handoff.task_id = localTask; u.risk_handoff.session_id = localSession; u.risk_handoff.handoff_id = `handoff-${localTask}`;
  const input = adapter.fromHandoff(u, actor, { confirmed: false, now: gateway.now() });
  gateway.register(input, { deferReview: true, memoryConsent: false });
  const provenance = { import_version: VERSION, import_key: key, source: packet.source, source_digest: packet.digest, provenance: "UNVERIFIED_EXTERNAL_RESPONSE", imported_at: gateway.now(), original_response: packet.raw, execution_allowed: false };
  gateway.store.transaction((data) => { data.tasks[localTask].handoff_import = provenance; return null; });
  const record = gateway.inspect(localTask, actor);
  gateway.event("HANDOFF_IMPORTED", record, { source: packet.source, source_digest: packet.digest, provenance: provenance.provenance, local_task_id: localTask, local_session_id: localSession, execution_allowed: false });
  gateway.review(localTask, actor);
  return result(gateway.inspect(localTask, actor), false);
}
function result(record, replay) {
  return { import_version: VERSION, task_id: record.input.binding.task_id, source: record.handoff_import.source, source_digest: record.handoff_import.source_digest, provenance: record.handoff_import.provenance, replay, execution_allowed: false, risk: record.review, policy: record.policy, workbench_path: `/risk?task_id=${encodeURIComponent(record.input.binding.task_id)}` };
}
module.exports = { VERSION, inspect, receive };
