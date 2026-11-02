// Read-only projections of existing contracts. These objects never authorize actions.
export const taskLabels = Object.freeze({
  PENDING_RISK:'等待风险审查', PENDING_APPROVAL:'等待本人审批', READY_FOR_SIMULATION:'具备模拟阶段条件 · 本页执行关闭',
  SIMULATED:'已有 PAPER 模拟回执', REJECTED:'已拒绝', EXPIRED:'审批已过期', MODEL_FAILED:'模型分析失败',
  FUNDING_BLOCKED:'资金条件阻断', CANCELLED:'已取消', WAITING_INPUT:'等待补充资料', RUNNING:'处理中',
  HANDOFF_REQUIRED:'Core 已交接 · 等待 Risk', WAITING_OWNER_RISK:'候选任务 · 等待正式 Risk',
  BLOCKED:'已阻断', FAILED:'处理失败', CIRCUIT_OPEN:'服务已安全停止', UNKNOWN:'结果待核查'
});
export const riskLabels = Object.freeze({ALLOW:'允许进入下一审核阶段', REVIEW:'需补资料或复核', BLOCK:'风险阻断', ERROR:'风险检查异常', UNVERIFIED:'未取得可信风险结论'});
const string = value => typeof value === 'string' && value.length > 0 && value.length <= 500 ? value : null;
const fields = ['request_id','task_id','session_id','run_id','audit_id','handoff_id'];
function same(values, field) {
  const present = values.filter(v => v != null);
  if (present.some(v => !string(v)) || new Set(present).size > 1) throw new Error('追踪字段不一致：' + field);
  return present[0] || null;
}
export function traceOf(data) {
  const t=data.task_state, a=data.audit_evidence || data.audit, h=data.risk_handoff;
  return Object.fromEntries(fields.map(key => [key,same([data[key],data.trace?.[key],t?.[key],a?.[key],h?.[key],key==='audit_id'?h?.evidence?.audit_id:null],key)]));
}
function eventsOf(audit, trace) {
  if (!audit) return [];
  if (audit.task_id !== trace.task_id || !Array.isArray(audit.events)) throw new Error('审计不属于当前任务');
  return audit.events.map(event => {
    if (event.task_id !== trace.task_id || !string(event.event_id) || !string(event.event_type)) throw new Error('审计事件关联无效');
    // Historical requests may differ on the same task; retain their original trace.
    if (event.payload?.trace?.task_id && event.payload.trace.task_id !== trace.task_id) throw new Error('审计追踪串单');
    return {id:event.event_id,mode:'CORE_SERVICE',taskId:trace.task_id,type:event.event_type,at:event.timestamp,
      actor:event.actor,trace:{...trace,...event.payload?.trace,request_id:event.payload?.request_id || trace.request_id}};
  });
}
export function paperReceipt(execution, trace, planHash) {
  const r=execution?.receipt;
  if (!r) return null;
  if (execution.status!=='SIMULATED' || r.mode!=='SIMULATED' || r.task_id!==trace.task_id ||
      !string(r.execution_id) || r.execution_id!==execution.execution_id || r.side_effects!==false ||
      !planHash || r.proposal_sha256!==planHash || execution.execution_allowed!==false) throw new Error('模拟回执缺失或关联无效');
  return structuredClone(r);
}
export function projectCore(data, kind='health') {
  const health=kind==='health', t=health?data.task_state:data;
  if (health ? t?.contract_version!=='investment-agent.v1' : data.workflow_version!=='review-workflow.v1' || data.schema_version!=='model-review.v1')
    throw new Error('未识别的团队任务契约');
  const trace=traceOf(data);
  if (!trace.task_id || !trace.session_id || !trace.request_id) throw new Error('任务追踪信息不完整');
  if (!health && (data.execution_mode!=='PAPER' || data.execution?.execution_allowed===true || data.risk_handoff?.execution_allowed===true))
    throw new Error('服务响应超出只读 PAPER 边界，已安全停止');
  const status=t.status, audit=health?data.audit_evidence:data.audit;
  const events=eventsOf(audit,trace), hash=data.proposed_action?.proposal_sha256;
  if (!health && ((data.plan_hash&&data.plan_hash!==hash) || (data.risk_handoff?.evidence?.proposal_sha256&&data.risk_handoff.evidence.proposal_sha256!==hash) ||
      (data.execution?.task_id&&data.execution.task_id!==trace.task_id))) throw new Error('计划版本或执行对象关联不一致');
  let risk='UNVERIFIED',reportedRisk=null,riskVerified=false,reason=data.risk_handoff?.reason || '尚未取得正式 Risk 回执';
  if (!health && data.risk_decision) {
    const decision=data.risk_decision;
    if (decision.task_id!==trace.task_id || !hash || decision.proposal_sha256!==hash) throw new Error('风险决定与计划版本不一致');
    // This mapping is defined by the existing Core/Risk callback vocabulary.
    reportedRisk=({APPROVE:'ALLOW',REQUEST_MORE_INFO:'REVIEW',REJECT:'BLOCK'})[decision.decision] || 'ERROR';
    riskVerified=decision.auth?.verified===true;
    risk=riskVerified?reportedRisk:'UNVERIFIED';
    reason=decision.reason || '服务端未提供原因';
  }
  if (!health && data.approval && (data.approval.task_id!==trace.task_id || (data.approval.proposal_sha256 && data.approval.proposal_sha256!==hash)))
    throw new Error('审批与当前计划版本不一致');
  const receipt=health?null:paperReceipt(data.execution,trace,hash);
  // A bare SIMULATED status is not a receipt and cannot be presented as completion.
  const phase=status==='SIMULATED'&&!receipt?'UNKNOWN':Object.hasOwn(taskLabels,status)?status:'UNKNOWN';
  return {id:trace.task_id,kind,mode:'CORE_SERVICE',title:health?'理财健康检查':data.proposed_action?.requested_action || 'Core 计划复核',
    status:phase,rawStatus:status,trace,risk,reportedRisk,riskVerified,reason,approval:health?'NOT_CONNECTED':data.approval?.status || 'UNKNOWN',
    expiresAt:data.approval?.expires_at || null,receipt,events,planHash:hash || null,
    source:health?'Core · 固定演示组合':`Core · ${data.data_mode || '来源未提供'}`,
    updatedAt:events.at(-1)?.at || null,sourceTaskId:data.source_task_id || null,
    canExecute:false,execution_allowed:false,raw:structuredClone(data)};
}
export function projectCandidate(task, analyses=[]) {
  const analysis=analyses.find(a=>a.id===task.analysisId);
  if (!string(task.id) || task.mode!=='LOCAL_CANDIDATE') throw new Error('未知候选任务');
  return {...structuredClone(task),kind:'candidate',status:Object.hasOwn(taskLabels,task.status)?task.status:'UNKNOWN',
    trace:{request_id:analysis?.requestId || null,task_id:task.id,session_id:task.sessionId || null,run_id:analysis?.id || null,audit_id:null,handoff_id:null},
    source:'隔离服务端候选 · 非正式任务',updatedAt:task.updatedAt || task.createdAt || null,risk:'UNVERIFIED',
    reason:'本地 REVIEW 仅为候选预检查，不能替代正式 Risk',receipt:null,canExecute:false,execution_allowed:false};
}
export function taskPresentation(task, {stale=false, unavailable=false, now=Date.now()}={}) {
  let status=task.status;
  const expires=Date.parse(task.expiresAt);
  const expired=Number.isFinite(expires)&&expires<=now&&['PENDING_APPROVAL','READY_FOR_SIMULATION'].includes(status);
  const stopped=unavailable || stale || expired;
  const next=unavailable?'服务不可用：仅查询原任务，禁止重复操作':stale?'输入已变化：旧风险结论仅供回看，需重新审查':expired?'审批期限已到：请查询后端最终状态':({
    PENDING_RISK:'等待 Risk Owner 返回决定',HANDOFF_REQUIRED:'等待 Risk Owner 接收交接',WAITING_OWNER_RISK:'等待 Core / Risk Owner 联调',
    PENDING_APPROVAL:'等待后端验证本人身份和完整计划版本',READY_FOR_SIMULATION:'等待受控 PAPER 网关与可信授权验收',
    SIMULATED:'查看同任务回执与审计',REJECTED:'核对拒绝原因，修改方案后重新审查',EXPIRED:'重新核对计划并获取有效审批',
    MODEL_FAILED:'核查模型服务及原任务记录',FUNDING_BLOCKED:'核对可信资金来源与保护用途',CANCELLED:'保留取消记录，不再推进',
    WAITING_INPUT:'补充缺失资料',BLOCKED:'核对阻断原因',FAILED:'核查原任务记录',UNKNOWN:'只读查询原任务状态'
  })[status] || '等待服务端状态';
  return {label:taskLabels[status] || taskLabels.UNKNOWN,risk:stopped?'UNVERIFIED':task.risk || 'UNVERIFIED',next,stopped,expired,
    canExecute:false,execution_allowed:false};
}
export function scopeFingerprint(question, sources, goals) {
  // Consent follows the exact selected snapshot and question, not a checkbox alone.
  return JSON.stringify({question:question.trim(),sources,goals});
}
export function modelEvidence(analysis) {
  const p=analysis.provider;
  const real=analysis.mode==='REAL_MODEL' && p?.http_status===200 && string(analysis.model) && string(p.provider_response_id);
  return {real:Boolean(real),model:real?analysis.model:null,durationMs:real&&Number.isFinite(p.duration_ms)?p.duration_ms:null,
    responseId:real?p.provider_response_id:null,label:real?'真实模型响应':analysis.mode==='DEMO'?'DEMO · 未调用模型':'模型响应证据待核验'};
}
