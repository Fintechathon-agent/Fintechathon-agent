import { getState, updateState, sourceState, readSources, appendEvent, draftTask, queryServiceTask, invalidateContext } from './workspace-store.mjs';
import { taskPresentation, riskLabels, modelEvidence, scopeFingerprint } from './workspace-adapter.mjs';
import { request } from './workspace-api.mjs';
import { navigate } from './workspace.js?v=20261027-safety';
import { createArchiveScene } from './archive.js';
const scene=createArchiveScene({density:'quiet'});scene.classList.add('workspace-scene');document.body.prepend(scene);
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatTime=value=>{const d=new Date(value);return !value||Number.isNaN(d.valueOf())?'未提供':new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(d);};
const money=cents=>cents==null?'未提供':new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(cents/100);
const link=(view,id,label)=>`<a href="#${view}" data-trace="${esc(id)}">${esc(label)}</a>`;
let frameReady=false,busy=false,lastScope='',consentScope=null,selectedAnalysis=null;
const taskWrites=new Set();
const approvalCopy={NOT_CONNECTED:'待接入',UNKNOWN:'待核查',PENDING:'等待本人审批',BLOCKED:'已阻止',APPROVED:'服务端记录已批准 · 身份以证据为准',REJECTED:'已拒绝',EXPIRED:'已过期',NOT_REQUIRED:'服务端标记无需审批'};
const eventCopy={'session.created':'任务会话已创建','contract.accepted':'已校验任务契约','stage.started':'阶段开始','stage.completed':'阶段完成','stage.failed':'阶段失败','checkpoint.saved':'已保存检查点','task.handoff':'已生成风险交接','risk.handoff.created':'已生成风险交接','workflow.created':'Core 计划已创建','risk.approved':'Risk 已记录通过','risk.rejected':'Risk 已记录拒绝','execution.blocked':'执行已阻止','execution.simulated':'已返回 PAPER 模拟回执','draft.created':'已生成 DEMO 草案','analysis.demo':'已查看 DEMO 流程','analysis.succeeded':'候选服务取得模型响应','analysis.failed':'分析未取得结果','task.confirmed':'已创建资料核对待办 · 非审批','local.guard.blocked':'候选服务阻止敏感操作'};
const labels={UNKNOWN:'尚未验证',CONNECTED:'已连接本机服务',READY:'服务端模型已配置 · 本轮请求尚未验证',UNAVAILABLE:'当前不可用',NOT_DEPLOYED:'尚未部署',NOT_CONNECTED:'未连接',CONNECTED_FIXTURE:'固定演示数据已读取'};
function status(message){$('analysis-status').textContent=message;}
function contextSnapshot(){return {
  portfolio:$('use-portfolio').checked&&sourceState.portfolio?structuredClone(sourceState.portfolio):null,
  budget:$('use-budget').checked&&sourceState.budget?structuredClone(sourceState.budget):null,
  goals:$('use-goal').checked?structuredClone(getState().goals):null
};}
function currentScope(){const c=contextSnapshot();return scopeFingerprint($('analysis-question').value,{portfolio:c.portfolio,budget:c.budget},c.goals);}
function revoke(){consentScope=null;$('context-consent').checked=false;}
function preview(){
  const context=contextSnapshot(),fingerprint=currentScope();
  if(lastScope&&lastScope!==fingerprint)revoke();lastScope=fingerprint;
  $('context-preview').textContent=JSON.stringify(context,null,2);return context;
}
function isAnalysisStale(analysis){
  const binding=getState().drafts.analysisBindings?.[analysis.id];
  if(binding&&binding!==currentScope())return true;
  if(!binding&&analysis.title!==$('analysis-question').value.trim().slice(0,80))return true;
  return ['portfolio','budget'].some(key=>analysis.sources?.[key]&&analysis.sources[key].revision!==sourceState[key]?.revision);
}
function renderTasks(state){
  $('unified-task-list').innerHTML=state.tasks.length?state.tasks.map(task=>{
    const parent=state.analyses.find(a=>a.id===task.analysisId);
    const view=taskPresentation(task,{stale:task.inputStale || (parent&&isAnalysisStale(parent))});
    return `<article class="local-record" id="record-${esc(task.id)}" data-task-ref="${esc(task.id)}"><small>${esc(task.source || '浏览器 DEMO 草案')} · 真实资金执行关闭</small><h3>${esc(task.title)}</h3><p class="task-phase" data-phase="${esc(task.status)}">${esc(view.label)}</p><p>业务风险：${esc(riskLabels[view.risk])}</p><p class="shared-note">服务端业务决定：${esc(task.reportedRisk || '未提供')} · Risk 身份：${task.riskVerified?'服务端已验证':'未验证或待接入'}</p><p>${esc(task.reason || '尚无正式风险证据')}</p><p class="shared-note">最后更新：${esc(formatTime(task.updatedAt || task.createdAt))} · 审批：${esc(approvalCopy[task.approval] || '未接入')}</p><p>${esc(view.next)}</p>${task.trace?`<details><summary>追踪编号与风险证据</summary><pre class="source-preview">${esc(JSON.stringify({trace:task.trace,source_task_id:task.sourceTaskId || null,plan_hash:task.planHash || null,risk_decision:task.raw?.risk_decision || null,approval:task.raw?.approval || null},null,2))}</pre></details>`:''}${task.receipt?`<details><summary>实际 PAPER 模拟回执 · 未发生真实交易</summary><pre class="source-preview">${esc(JSON.stringify(task.receipt,null,2))}</pre></details>`:''}<div class="trace-links">${task.analysisId?link('analysis',task.analysisId,'查看关联分析'):link('banking',task.id,'核对投资资料')}${link('safety',task.id,'查看关联记录')}${task.mode==='CORE_SERVICE'?`<button type="button" class="secondary" data-query-task="${esc(task.id)}" data-kind="${esc(task.kind)}">只读查询原任务</button>`:''}</div></article>`;
  }).join(''):'<p class="shared-note">还没有可核验任务。请先进行理财健康检查，或查看明确标记的 DEMO 草案。</p>';
  $('task-query-errors').textContent=sourceState.coreErrors.map(e=>`${e.id}：${e.message}。未恢复旧成功结果；可重新查询。`).join('\n');
  $('unified-audit-list').innerHTML=state.events.length?state.events.slice().sort((a,b)=>String(b.at||'').localeCompare(String(a.at||''))).map(event=>`<article class="local-record" data-analysis-ref="${esc(event.analysisId||'')}" data-task-ref="${esc(event.taskId||'')}"><small>${esc(formatTime(event.at))} · ${event.mode==='CORE_SERVICE'?'Core 服务端事件 · 持久性以部署为准':event.mode==='LOCAL_CANDIDATE'?'隔离服务端候选记录':'浏览器 DEMO 记录'}</small><p>${esc(eventCopy[event.type] || '服务端业务事件')}<small class="event-code">${esc(event.type)}</small></p>${event.trace?`<details><summary>真实事件追踪</summary><pre class="source-preview">${esc(JSON.stringify({event_id:event.id,actor:event.actor,...event.trace},null,2))}</pre></details>`:''}<div class="trace-links">${event.analysisId?link('analysis',event.analysisId,'关联分析'):''}${event.taskId?link('tasks',event.taskId,'关联任务'):''}</div></article>`).join(''):'<p class="shared-note">尚无关联事件；没有生成或伪造正式审计。</p>';
}
function renderAnalyses(state){
  $('unified-analysis-list').innerHTML=state.analyses.map(analysis=>{
    const evidence=modelEvidence(analysis),stale=isAnalysisStale(analysis),proposal=analysis.proposal;
    const existingTask=state.tasks.some(t=>t.analysisId===analysis.id);
    return `<article class="analysis-entry" id="analysis-${esc(analysis.id)}" data-analysis-ref="${esc(analysis.id)}"><small>${esc(evidence.label)} · ${esc(formatTime(analysis.createdAt))}</small><h2>${esc(analysis.title)}</h2>${evidence.real?`<p class="shared-note">实际模型：${esc(evidence.model)} · 请求耗时：${evidence.durationMs==null?'未提供':esc(evidence.durationMs)+' ms'} · 响应编号：${esc(evidence.responseId)}</p>`:''}<p class="analysis-text">${esc(analysis.text)}</p>${proposal?`<dl class="analysis-evidence"><dt>依据</dt><dd>${esc((Array.isArray(proposal.evidence)?proposal.evidence.join('；'):null) || '模型未提供依据')}</dd><dt>缺失信息</dt><dd>${esc((Array.isArray(proposal.missing_information)?proposal.missing_information.join('；'):null) || '模型未列出，仍需人工核对')}</dd><dt>风险</dt><dd>${esc(proposal.risk_level || '未提供')} · ${esc(proposal.action_reason || '未提供原因')}</dd></dl>`:''}<details><summary>本次授权数据与来源时间</summary><pre class="source-preview">${esc(JSON.stringify(analysis.sources,null,2))}</pre></details><p class="shared-note">${stale?'资料或问题已变化：旧分析仅供回看，请重新授权和分析。':analysis.mode==='DEMO'?'未调用模型；流程在正式 Risk 前停止。':'模型建议不代表正式风控或审批；任何资金执行保持关闭。'}</p><div class="workspace-actions"><button type="button" data-draft="${esc(analysis.id)}" class="secondary" ${stale||existingTask||(!evidence.real&&analysis.mode!=='DEMO')?'disabled':''}>${existingTask?'已创建待办，请在我的任务查询':analysis.mode==='DEMO'?'生成 DEMO 草案':'创建资料核对待办 · 非审批'}</button>${link('banking',analysis.id,'核对投资组合')}${link('life',analysis.id,'核对生活预算')}</div></article>`;
  }).join('');
}
function render(){
  const state=getState();preview();
  $('shared-user').textContent='本机会话 · 正式角色未验证';
  document.querySelector('.preview-notice').textContent=sourceState.workspace?'隔离集成候选 · 固定演示持仓 / 自述预算 · 真实资金执行关闭':'统一任务候选 · 各步骤以服务端证据为准 · 真实资金执行关闭';
  $('shared-portfolio').textContent=sourceState.portfolio?.id || '尚未读取';$('shared-budget').textContent=money(sourceState.budget?.summary?.available_cents);
  $('shared-tasks').textContent=String(state.tasks.length);
  const active=state.tasks.find(t=>t.id===state.drafts.activeTrace||t.analysisId===state.drafts.activeTrace)||state.tasks[0];
  $('active-task-context').innerHTML=active?`${esc(active.mode==='CORE_SERVICE'?'服务端查询任务':active.mode==='LOCAL_CANDIDATE'?'隔离候选任务':'浏览器 DEMO 草案')} · ${esc(active.title)} · ${link('tasks',active.id,'查看同一任务')}`:'当前为本机输入草稿；取得服务端任务后可在六模块间继续核对。';
  $('portfolio-source-copy').textContent=sourceState.portfolio?`固定演示 · ${formatTime(sourceState.portfolio.asOf)}`:'组合服务未连接；不会补造持仓';
  $('budget-source-copy').textContent=sourceState.budget?`用户自述 · 读取时间 ${formatTime(sourceState.readAt)}`:'预算未提供；不会自动补全';
  $('use-portfolio').disabled=!sourceState.portfolio;$('use-budget').disabled=!sourceState.budget;
  $('life-connection').textContent=sourceState.errors.assistant?.message || labels[sourceState.connections.assistant];
  const live=sourceState.workspace?.analyses?.find(a=>modelEvidence(a).real);
  $('qwen-connection').textContent=(sourceState.errors.analysis?.message || labels[sourceState.connections.analysis])+(live?` · 最近存储响应：${live.model} / ${formatTime(live.createdAt)}（历史记录）`:'');
  $('qwen-connection').dataset.status=sourceState.connections.analysis;
  const pending=state.drafts.pendingAnalysis;
  $('unified-analyze').disabled=busy || Boolean(pending) || sourceState.connections.analysis!=='READY';
  $('query-pending').hidden=!pending;$('query-pending').disabled=busy;
  $('pending-request').textContent=pending?`客户端请求关联号：${pending.request.requestId} · ${pending.status==='UNKNOWN'?'结果待核查':'已记录发送意图'}；刷新后仅查询，不自动重发。`:'';
  renderTasks(state);renderAnalyses(state);
}
function ensureFrame(){if(!frameReady){$('life-frame').src='conversation.html?embed=1';frameReady=true;}}
export function startAnalysis(kind,question){
  $('analysis-question').value=question || getState().drafts.question || '';
  $('use-portfolio').checked=kind!=='budget';$('use-budget').checked=kind!=='portfolio';$('use-goal').checked=kind!=='portfolio';revoke();
  updateState(s=>{s.drafts.analysisQuestion=$('analysis-question').value;s.drafts.scope={portfolio:$('use-portfolio').checked,budget:$('use-budget').checked,goals:$('use-goal').checked};});
  navigate('analysis',true);preview();
}
function createDemo(){
  const question=$('analysis-question').value.trim();if(!question){status('请先填写这次想了解的问题。');$('analysis-question').focus();return;}
  const analysis={id:'demo-analysis-'+crypto.randomUUID(),title:question.slice(0,80),mode:'DEMO',
    text:'DEMO：核对来源、缺失资料与生活必要预留。未调用模型；Core 计划、正式 Risk、本人审批和 PAPER 回执等待接入。',sources:contextSnapshot(),createdAt:new Date().toISOString()};
  updateState(s=>s.analyses.unshift(analysis));appendEvent('analysis.demo',{analysisId:analysis.id});
}
$('shared-analyze').addEventListener('click',()=>startAnalysis('combined',$('task-intent').value));
$('portfolio-analyze').addEventListener('click',()=>startAnalysis('portfolio','请分析当前已提供的持仓，说明集中度、流动性约束与缺失资料。'));
$('budget-analyze').addEventListener('click',()=>startAnalysis('budget','请结合当前预算和储蓄目标，分析如何安排生活必要预留。'));
$('demo-closed-loop').addEventListener('click',createDemo);
const saved=getState();$('task-intent').value=saved.drafts.question;$('analysis-question').value=saved.drafts.analysisQuestion || '';
for(const [id,key] of [['use-portfolio','portfolio'],['use-budget','budget'],['use-goal','goals']]){
  $(id).checked=Boolean(saved.drafts.scope?.[key]);$(id).addEventListener('change',()=>{revoke();updateState(s=>{s.drafts.scope={portfolio:$('use-portfolio').checked,budget:$('use-budget').checked,goals:$('use-goal').checked};});});
}
$('context-consent').addEventListener('change',()=>{consentScope=$('context-consent').checked?currentScope():null;});
$('analysis-question').addEventListener('input',()=>{revoke();invalidateContext();updateState(s=>{s.drafts.analysisQuestion=$('analysis-question').value;});});
$('task-intent').addEventListener('input',()=>{revoke();updateState(s=>{s.drafts.question=$('task-intent').value;});});
for(const id of ['horizon','drawdown','liquidity']){$(id).value=saved.drafts[id] || '';$(id).addEventListener('input',()=>{revoke();invalidateContext();updateState(s=>{s.drafts[id]=$(id).value;});});}
for(const [id,key] of [['goal-name','name'],['goal-amount','amountCents'],['goal-deadline','deadline']]){
  $(id).value=key==='amountCents'?(saved.goals[key]==null?'':saved.goals[key]/100):saved.goals[key];
  $(id).addEventListener('input',()=>{revoke();invalidateContext();updateState(s=>{s.goals[key]=key==='amountCents'?($(id).value===''?null:Math.round(Number($(id).value)*100)):$(id).value;});});
}
$('check-form').addEventListener('submit',()=>updateState(s=>{for(const id of ['horizon','drawdown','liquidity'])s.drafts[id]=$(id).value;}));
for(const id of ['refresh-shared','analysis-refresh'])$(id).addEventListener('click',async()=>{await readSources();await recoverPending();});
addEventListener('workspace:state',render);addEventListener('workspace:sources',render);addEventListener('workspace:context-invalidated',revoke);
addEventListener('workspace:viewchange',event=>{if(event.detail.view==='life')ensureFrame();render();});
addEventListener('workspace:portfolio',()=>readSources());
addEventListener('message',event=>{if(event.origin===location.origin&&event.source===$('life-frame').contentWindow&&event.data?.type==='finance:life-updated'){revoke();invalidateContext();readSources();}});
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-draft]');
  if(button){const analysis=getState().analyses.find(a=>a.id===button.dataset.draft);if(analysis&&!isAnalysisStale(analysis)){
    if(analysis.mode==='DEMO'){draftTask(analysis);navigate('tasks',true);}
    else {selectedAnalysis=analysis;$('task-draft-consent').checked=false;$('task-draft-dialog').showModal();}
  }}
  const query=event.target.closest('[data-query-task]');
  if(query){query.disabled=true;try{await queryServiceTask(query.dataset.queryTask,query.dataset.kind);$('task-query-errors').textContent='已读取服务端原任务。';}catch(error){sourceState.core=sourceState.core.filter(t=>t.id!==query.dataset.queryTask);render();$('task-query-errors').textContent=error.message;}}
  const trace=event.target.closest('[data-trace]');
  if(trace){const id=trace.dataset.trace;updateState(s=>{s.drafts.activeTrace=id;});requestAnimationFrame(()=>{
    const panel=document.querySelector('section[data-panel]:not([hidden])');
    const target=[...(panel?.querySelectorAll('[data-task-ref],[data-analysis-ref]') || [])].find(el=>el.dataset.taskRef===id||el.dataset.analysisRef===id);
    target?.scrollIntoView({block:'center'});if(target){target.tabIndex=-1;target.focus({preventScroll:true});}
  });}
});
$('task-draft-form').addEventListener('submit',async event=>{
  event.preventDefault();const analysis=selectedAnalysis;
  if(!analysis||!$('task-draft-consent').checked||isAnalysisStale(analysis)||taskWrites.has(analysis.id))return;
  taskWrites.add(analysis.id);$('task-draft-submit').disabled=true;
  try{await request('/api/assistant/workspace/task',{body:{analysisId:analysis.id,confirm:true}});await readSources();$('task-draft-dialog').close();navigate('tasks',true);}
  catch(error){$('task-draft-error').textContent=error.message+' 请先刷新查询核对待办，不自动重发。';}
  finally{taskWrites.delete(analysis.id);$('task-draft-submit').disabled=false;}
});
$('task-draft-cancel').onclick=()=>$('task-draft-dialog').close();
async function recoverPending(){
  const pending=getState().drafts.pendingAnalysis;if(!pending)return;
  const analysis=sourceState.workspace?.analyses.find(a=>a.requestId===pending.request.requestId);
  const failed=sourceState.workspace?.events.find(e=>e.requestId===pending.request.requestId&&['analysis.failed','local.guard.blocked'].includes(e.type));
  if(analysis||failed){updateState(s=>{delete s.drafts.pendingAnalysis;if(analysis){s.drafts.analysisBindings={...s.drafts.analysisBindings,[analysis.id]:pending.fingerprint};}});status(analysis?'已查询到原请求分析；未重复调用模型。':'原请求已由服务端记录停止；未生成替代分析。');}
  else status('原请求结果仍未知。只读查询未找到终态，继续安全停止；请由服务 Owner 核查。');
}
$('query-pending').onclick=async()=>{await readSources();await recoverPending();};
$('unified-analysis-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||getState().drafts.pendingAnalysis)return;
  const question=$('analysis-question').value.trim();
  if(!question||!$('context-consent').checked||consentScope!==currentScope()){status('请填写问题，并重新确认本次发送范围。');return;}
  const snapshot=preview(),refs={};
  if(!$('context-consent').checked)return;
  for(const key of ['portfolio','budget'])if(snapshot[key]){
    if(!snapshot[key].revision){revoke();status('选中的来源没有可核验版本，等待 Owner 提供版本后再发送。');return;}
    refs[key]={id:snapshot[key].id,revision:snapshot[key].revision};
  }
  const fingerprint=currentScope(),body={requestId:'workspace-'+crypto.randomUUID(),question,consent:true,sources:refs,goal:snapshot.goals};
  // This client correlation ID is required by the existing candidate contract; it is not a server task ID.
  busy=true;updateState(s=>{s.drafts.pendingAnalysis={fingerprint,request:body,status:'SENT'};});
  status('正在通过服务端请求模型；不会自动重发。');
  try{
    await request('/api/assistant/workspace/analysis',{body});await readSources();await recoverPending();revoke();
  }catch(error){
    updateState(s=>{s.drafts.pendingAnalysis.status='UNKNOWN';});revoke();await readSources();await recoverPending();
    if([401,403,422,423,429].includes(error.status))updateState(s=>{delete s.drafts.pendingAnalysis;});
    status(error.message);
  }finally{busy=false;render();}
});
if(location.hash==='#life')ensureFrame();
render();await readSources();await recoverPending();render();
