import { getState, updateState, sourceState, readSources, appendEvent, draftTask } from './workspace-store.mjs';
import { navigate } from './workspace.js?v=20261024-shell';
import { createArchiveScene } from './archive.js';
const scene=createArchiveScene({density:'quiet'});scene.classList.add('workspace-scene');document.body.prepend(scene);
const $ = id => document.getElementById(id);
const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatTime = value => { const date=new Date(value); return Number.isNaN(date.valueOf())?String(value||'未提供'):new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(date); };
const money = cents => cents==null?'未提供':new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(cents/100);
const link = (view,id,label) => `<a href="#${view}" data-trace="${esc(id)}">${esc(label)}</a>`;
let frameReady=false,busy=false,lastScope='';
const labels={UNKNOWN:'尚未验证',CONNECTED:'已连接本机服务',READY:'服务端模型已配置 · 本轮连接以实际调用结果为准',UNAVAILABLE:'当前不可用',NOT_DEPLOYED:'尚未部署',NOT_CONNECTED:'未连接',CONNECTED_FIXTURE:'已连接固定演示数据'};
function contextSnapshot() {
  const portfolio=$('use-portfolio').checked&&sourceState.portfolio?structuredClone(sourceState.portfolio):null;
  const budget=$('use-budget').checked&&sourceState.budget?structuredClone(sourceState.budget):null;
  const goals=$('use-goal').checked?structuredClone(getState().goals):null;
  return {portfolio,budget,goals};
}
function preview() {
  const context=contextSnapshot();
  const serialized=JSON.stringify(context,null,2);
  if(lastScope&&lastScope!==serialized)$('context-consent').checked=false;
  lastScope=serialized;$('context-preview').textContent=serialized;
  return context;
}
function render() {
  const state=getState();
  $('shared-user').textContent='本机会话 · 正式角色未验证';
  document.querySelector('.preview-notice').textContent=sourceState.workspace?'本地集成候选 · 持仓为固定演示、预算为用户自述 · 不执行交易':'统一工作空间预览 · 后端状态以各模块提示为准 · 不执行交易';
  $('shared-portfolio').textContent=sourceState.portfolio?sourceState.portfolio.id:'尚未读取';
  $('shared-budget').textContent=money(sourceState.budget?.summary?.available_cents);
  $('shared-tasks').textContent=String(state.tasks.length);
  $('portfolio-source-copy').textContent=sourceState.portfolio?`固定演示 · ${formatTime(sourceState.portfolio.asOf)}`:'组合服务未连接；不会补造持仓';
  $('budget-source-copy').textContent=sourceState.budget?'本机账本 · 用户自述 · 刚刚读取':'预算未提供；不会自动补全';
  $('use-portfolio').disabled=!sourceState.portfolio;
  $('use-budget').disabled=!sourceState.budget;
  $('life-connection').textContent=labels[sourceState.connections.assistant]||'尚未验证';
  $('qwen-connection').textContent=labels[sourceState.connections.analysis]||'尚未验证';
  const lastLive=sourceState.workspace?.analyses?.find(a=>a.mode==='REAL_MODEL'&&a.provider?.http_status===200);
  if(lastLive)$('qwen-connection').textContent=`${lastLive.model} · 最近一次真实分析成功：${formatTime(lastLive.createdAt)}`;
  $('qwen-connection').dataset.status=sourceState.connections.analysis;
  $('unified-analyze').disabled=busy||sourceState.connections.analysis!=='READY';
  if(sourceState.connections.analysis==='READY')$('analysis-status').textContent='已连接隔离的只读分析适配器。发送前请核对来源；正式Risk未接入，任何资金执行保持关闭。';
  $('unified-task-list').innerHTML=state.tasks.length?state.tasks.map(task=>`<article class="local-record" id="${esc(task.id)}"><small>${task.mode==='LOCAL_CANDIDATE'?'隔离服务端已保存 · 本人已确认核对任务':'浏览器DEMO草案'} · 未执行</small><h3>${esc(task.title)}</h3><p>待正式风险审查 · 用户确认不替代风险授权</p><div class="trace-links">${link('analysis',task.analysisId,'查看关联分析')}${link('safety',task.id,'查看关联记录')}</div></article>`).join(''):'<p class="shared-note">还没有跨模块草案。分析建议需要核对来源并经过风险审查。</p>';
  $('unified-audit-list').innerHTML=state.events.length?state.events.slice().sort((a,b)=>b.at.localeCompare(a.at)).map(event=>`<article class="local-record" id="${esc(event.id)}" data-analysis-ref="${esc(event.analysisId||'')}" data-task-ref="${esc(event.taskId||'')}"><small>${esc(formatTime(event.at))} · ${event.mode==='LOCAL_CANDIDATE'?'本机服务端候选记录':'浏览器DEMO记录'}</small><p>${esc(({'draft.created':'已生成待审查草案','analysis.demo':'已查看DEMO流程','analysis.succeeded':'取得真实模型分析 · 本地候选预检查 REVIEW','analysis.failed':'分析未取得结果','task.confirmed':'用户确认了核对任务 · 正式风险待接入','local.guard.blocked':'本地限制 BLOCK · 阻止敏感资金操作'})[event.type]||event.type)}</p><div class="trace-links">${event.analysisId?link('analysis',event.analysisId,'关联分析'):''}${event.taskId?link('tasks',event.taskId,'关联草案'):''}</div></article>`).join(''):'<p class="shared-note">尚无跨模块事件。正式Owner审计未接入，不将候选记录作为正式回执。</p>';
  $('unified-analysis-list').innerHTML=state.analyses.map(analysis=>`<article class="analysis-entry" id="${esc(analysis.id)}"><small>${esc(analysis.mode==='DEMO'?'DEMO · 未调用模型':analysis.model||'服务端分析')} · ${esc(formatTime(analysis.createdAt))}</small><h2>${esc(analysis.title)}</h2><p class="analysis-text">${esc(analysis.text)}</p><details><summary>查看本次来源与边界</summary><pre class="source-preview">${esc(JSON.stringify(analysis.sources,null,2))}</pre></details><p class="shared-note">${analysis.mode==='DEMO'?'此内容只用于展示协作流程，没有真实模型或正式风控结果。':'模型建议不是用户授权；正式风险审查仍待对齐。'}</p><div class="workspace-actions"><button type="button" data-draft="${esc(analysis.id)}" class="secondary">生成待审查草案</button>${link('banking',analysis.id,'核对投资组合')}${link('life',analysis.id,'核对生活预算')}</div></article>`).join('');
  preview();
}
function ensureFrame() {
  if(frameReady)return;
  $('life-frame').src='conversation.html?embed=1';frameReady=true;
}
export function startAnalysis(kind,question) {
  $('analysis-question').value=question||getState().drafts.question||'';
  updateState(s=>{s.drafts.analysisQuestion=$('analysis-question').value;});
  $('use-portfolio').checked=kind!=='budget';$('use-budget').checked=kind!=='portfolio';
  $('use-goal').checked=kind!=='portfolio';$('context-consent').checked=false;
  navigate('analysis',true);preview();
}
function createDemo() {
  const question=$('analysis-question').value.trim();
  if(!question){$('analysis-status').textContent='请先填写这次想了解的问题。';return;}
  const analysis={id:'demo-analysis-'+crypto.randomUUID(),sessionId:getState().clientId,title:question.slice(0,40),mode:'DEMO',
    text:'DEMO 流程：先核对持仓来源与生活必要预留，再补充缺失资料。这是演示草案，没有调用模型，没有正式风控决策，也没有执行资金操作。',
    sources:contextSnapshot(),createdAt:new Date().toISOString()};
  updateState(s=>s.analyses.unshift(analysis));appendEvent('analysis.demo',{analysisId:analysis.id});
}
$('shared-analyze').addEventListener('click',()=>startAnalysis('combined',$('task-intent').value));
$('portfolio-analyze').addEventListener('click',()=>startAnalysis('portfolio','请分析当前已提供的持仓，说明集中度、流动性约束与缺失资料。'));
$('budget-analyze').addEventListener('click',()=>startAnalysis('budget','请结合当前预算和储蓄目标，分析如何安排生活必要预留。'));
$('demo-closed-loop').addEventListener('click',createDemo);
for(const id of ['use-portfolio','use-budget','use-goal'])$(id).addEventListener('change',preview);
$('task-intent').value=getState().drafts.question;
$('analysis-question').value=getState().drafts.analysisQuestion||'';
$('analysis-question').addEventListener('input',()=>{$('context-consent').checked=false;updateState(s=>{s.drafts.analysisQuestion=$('analysis-question').value;});});
$('task-intent').addEventListener('input',()=>updateState(s=>{s.drafts.question=$('task-intent').value;}));
for(const [id,key] of [['horizon','horizon'],['drawdown','drawdown'],['liquidity','liquidity']]){
  $(id).value=getState().drafts[key]||'';
  $(id).addEventListener('input',()=>updateState(s=>{s.drafts[key]=$(id).value;}));
}
$('check-form').addEventListener('submit',()=>updateState(s=>{
  for(const id of ['horizon','drawdown','liquidity'])s.drafts[id]=$(id).value;
}));
for(const [id,key] of [['goal-name','name'],['goal-amount','amountCents'],['goal-deadline','deadline']]){
  $(id).value=key==='amountCents'?(getState().goals[key]==null?'':getState().goals[key]/100):getState().goals[key];
  $(id).addEventListener('input',()=>updateState(s=>{s.goals[key]=key==='amountCents'?($(id).value===''?null:Math.round(Number($(id).value)*100)):$(id).value;}));
}
$('refresh-shared').addEventListener('click',async()=>{await readSources();render();});
addEventListener('workspace:state',render);addEventListener('workspace:sources',render);
addEventListener('workspace:viewchange',event=>{if(event.detail.view==='life')ensureFrame();render();});
addEventListener('workspace:portfolio',()=>readSources());
addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==$('life-frame').contentWindow||event.data?.type!=='finance:life-updated')return;
  // Read the authenticated same-origin service instead of trusting posted finance values.
  readSources();
});
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-draft]');
  if(button){const analysis=getState().analyses.find(a=>a.id===button.dataset.draft);if(analysis){
    if(analysis.mode==='DEMO'){draftTask(analysis);navigate('tasks',true);}
    else confirmTask(analysis);
  }}
  const trace=event.target.closest('[data-trace]');
  if(trace){requestAnimationFrame(()=>{
    const panel=document.querySelector('section[data-panel]:not([hidden])');
    const target=[...(panel?.querySelectorAll('[id],[data-task-ref],[data-analysis-ref]')||[])].find(el=>el.id===trace.dataset.trace||el.dataset.taskRef===trace.dataset.trace||el.dataset.analysisRef===trace.dataset.trace);
    target?.scrollIntoView({block:'center'});
  });}
});
async function post(path,body){
  const response=await fetch('/api/assistant/workspace/'+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Finance-Request':'1'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  let data;try{data=await response.json();}catch{throw new Error('服务没有返回有效结果。');}
  if(!response.ok)throw new Error(data.error?.message||'本次操作未完成。');
  return data;
}
async function confirmTask(analysis){
  if(!confirm('确认生成资料核对任务？任务将等待正式风险审查，不执行交易、转账或账户修改。'))return;
  try{await post('task',{analysisId:analysis.id,confirm:true});await readSources();navigate('tasks',true);}
  catch(error){$('analysis-status').textContent=error.message;}
}
$('unified-analysis-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  const question=$('analysis-question').value.trim();
  if(!question||!$('context-consent').checked){$('analysis-status').textContent='请填写问题，并确认本次发送范围。';return;}
  const snapshot=preview(),refs={};
  if(!$('context-consent').checked){$('analysis-status').textContent='来源范围已变化，请重新核对并确认。';return;}
  for(const key of ['portfolio','budget'])if(snapshot[key])refs[key]={id:snapshot[key].id,revision:snapshot[key].revision};
  const input={question,consent:true,sources:refs,goal:snapshot.goals};
  const fingerprint=JSON.stringify(input),pending=getState().drafts.pendingAnalysis;
  const request=pending?.fingerprint===fingerprint?pending.request:{requestId:'workspace-'+crypto.randomUUID(),...input};
  updateState(s=>{s.drafts.pendingAnalysis={fingerprint,request};});
  busy=true;$('unified-analyze').disabled=true;$('analysis-status').textContent='正在通过服务端请求模型；不会自动重复调用。';
  try{
    await post('analysis',request);updateState(s=>{delete s.drafts.pendingAnalysis;});await readSources();$('context-consent').checked=false;
    $('analysis-status').textContent='已取得真实模型分析。请核对来源，再决定是否生成待审查任务。';
  }catch(error){await readSources();$('analysis-status').textContent=error.message;}
  finally{busy=false;$('unified-analyze').disabled=sourceState.connections.analysis!=='READY';}
});
if(location.hash==='#life')ensureFrame();
render();await readSources();render();
