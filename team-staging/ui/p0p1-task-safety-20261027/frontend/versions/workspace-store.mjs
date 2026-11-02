import { projectCore, projectCandidate } from './workspace-adapter.mjs';
import { request } from './workspace-api.mjs';
// Extend the existing draft store; service records exist only in the read-only projection.
const key='finance-workspace-drafts.v1:'+new URL('../',import.meta.url).pathname;
const refKey=key+':service-refs';
const uid=prefix=>prefix+'-'+crypto.randomUUID();
const empty=()=>({version:1,clientId:uid('client'),user:{name:'本机会话',role:'UNKNOWN',verified:false},
  drafts:{question:'',horizon:'',drawdown:'',liquidity:''},goals:{name:'',amountCents:null,deadline:''},analyses:[],tasks:[],events:[]});
function draftOnly(saved) {
  const clean=empty();
  if(saved?.version!==1)return clean;
  clean.drafts={...clean.drafts,...saved.drafts};clean.goals={...clean.goals,...saved.goals};
  // Never recover an alleged service response or authenticated identity from localStorage.
  clean.analyses=(Array.isArray(saved.analyses)?saved.analyses:[]).filter(a=>a.mode==='DEMO'&&a.id?.startsWith('demo-analysis-')).map(a=>({...a,mode:'DEMO'}));
  clean.tasks=(Array.isArray(saved.tasks)?saved.tasks:[]).filter(t=>t.id?.startsWith('draft-task-')).map(t=>({...t,mode:'BROWSER_DRAFT',source:'浏览器 DEMO 草案',status:'PENDING_RISK',risk:'UNVERIFIED',reportedRisk:null,riskVerified:false,approval:'NOT_CONNECTED',trace:null,execution_allowed:false,receipt:null}));
  clean.events=(Array.isArray(saved.events)?saved.events:[]).filter(e=>e.id?.startsWith('demo-event-')).map(e=>({...e,mode:'BROWSER_DRAFT',trace:null,actor:null}));
  return clean;
}
let state=empty(),refs=[];
try{state=draftOnly(JSON.parse(localStorage.getItem(key)));refs=JSON.parse(sessionStorage.getItem(refKey)) || [];}catch{/* Storage is optional. */}
refs=Array.isArray(refs)?refs.filter(r=>['health','review'].includes(r.kind)&&typeof r.id==='string').slice(0,24):[];
export const sourceState={portfolio:null,budget:null,assistant:null,workspace:null,core:[],coreErrors:[],
  connections:{assistant:'UNKNOWN',portfolio:'UNKNOWN',analysis:'UNKNOWN'},errors:{},readAt:null};
export const getState=()=>structuredClone({...state,
  analyses:[...(sourceState.workspace?.analyses || []),...state.analyses],
  tasks:[...sourceState.core,...(sourceState.workspace?.tasks || []).map(t=>projectCandidate(t,sourceState.workspace.analyses)),...state.tasks],
  events:[...state.events,...(sourceState.workspace?.events || []).map(e=>({...e,mode:'LOCAL_CANDIDATE',trace:null})),...sourceState.core.flatMap(t=>t.events)]});
function emit(){dispatchEvent(new CustomEvent('workspace:state',{detail:getState()}));}
export function updateState(mutator){
  const next=structuredClone(state);mutator(next);state=next;
  try{localStorage.setItem(key,JSON.stringify(next));}catch{/* Keep current-tab drafts usable. */}emit();
}
export function appendEvent(type,detail={}){
  const event={...detail,id:uid('demo-event'),mode:'BROWSER_DRAFT',type,at:new Date().toISOString()};
  updateState(s=>s.events.push(event));return event;
}
export function draftTask(analysis){
  const prior=state.tasks.find(t=>t.analysisId===analysis.id);if(prior)return prior;
  const task={id:uid('draft-task'),analysisId:analysis.id,title:analysis.title || '核对分析建议',status:'PENDING_RISK',risk:'UNVERIFIED',
    execution_allowed:false,mode:'BROWSER_DRAFT',createdAt:new Date().toISOString(),source:'浏览器 DEMO 草案'};
  updateState(s=>s.tasks.unshift(task));appendEvent('draft.created',{taskId:task.id,analysisId:analysis.id});return task;
}
export function rememberServiceRecord(data,kind='health'){
  const task=projectCore(data,kind);
  task.inputStale=sourceState.core.find(t=>t.id===task.id)?.inputStale || refs.find(r=>r.id===task.id)?.stale || false;
  sourceState.core=[task,...sourceState.core.filter(t=>t.id!==task.id)];
  refs=[{id:task.id,kind,stale:task.inputStale},...refs.filter(r=>r.id!==task.id)].slice(0,24);
  try{sessionStorage.setItem(refKey,JSON.stringify(refs));}catch{/* IDs alone are not persistence. */}
  sourceState.coreErrors=sourceState.coreErrors.filter(e=>e.id!==task.id);emit();return task;
}
export async function queryServiceTask(id,kind='health'){
  try{
    const data=await request((kind==='review'?'/api/review/task/':'/api/task/')+encodeURIComponent(id),{timeout:8000});
    const task=projectCore(data,kind);if(task.id!==id)throw new Error('返回了其他任务，已停止采用。');
    rememberServiceRecord(data,kind);return data;
  }catch(error){
    sourceState.core=sourceState.core.filter(t=>t.id!==id);
    sourceState.coreErrors=[{id,kind,message:error.message},...sourceState.coreErrors.filter(e=>e.id!==id)];emit();
    dispatchEvent(new CustomEvent('workspace:sources',{detail:sourceState}));throw error;
  }
}
export function invalidateContext(){
  // Staleness is a UI warning, never a mutation of the server Risk decision.
  for(const task of sourceState.core)task.inputStale=true;
  refs=refs.map(r=>({...r,stale:true}));
  try{sessionStorage.setItem(refKey,JSON.stringify(refs));}catch{/* Staleness still applies in this tab. */}
  dispatchEvent(new Event('workspace:context-invalidated'));emit();
}
let readRevision=0;
export async function readSources(){
  const revision=++readRevision;
  const sourceVersion=()=>JSON.stringify([sourceState.portfolio?.revision || sourceState.portfolio?.snapshot,sourceState.budget?.revision || sourceState.budget?.summary]);
  const previousVersion=sourceVersion(),hadSources=Boolean(sourceState.portfolio || sourceState.budget);
  if(location.hostname.endsWith('github.io')){
    sourceState.connections={assistant:'NOT_DEPLOYED',portfolio:'NOT_CONNECTED',analysis:'NOT_DEPLOYED'};
    sourceState.workspace=null;sourceState.core=[];
    dispatchEvent(new CustomEvent('workspace:sources',{detail:sourceState}));return sourceState;
  }
  const paths=['/api/assistant/state','/api/demo/portfolio','/api/assistant/workspace/state'];
  const results=await Promise.allSettled(paths.map(path=>request(path,{timeout:8000})));
  if(revision!==readRevision)return sourceState;
  sourceState.errors={};sourceState.readAt=new Date().toISOString();
  results.forEach((r,i)=>{if(r.status==='rejected')sourceState.errors[['assistant','portfolio','analysis'][i]]=r.reason;});
  const assistant=results[0].status==='fulfilled'?results[0].value.state:null;
  sourceState.assistant=assistant&&Array.isArray(assistant.records)&&assistant.summary?assistant:null;
  sourceState.budget=sourceState.assistant?{id:'assistant-budget:'+assistant.summary.month,mode:'USER_REPORTED',asOf:sourceState.readAt,summary:assistant.summary}:null;
  sourceState.connections.assistant=sourceState.assistant?'CONNECTED':'UNAVAILABLE';
  const snapshot=results[1].status==='fulfilled'?results[1].value.output?.snapshot:null;
  sourceState.portfolio=snapshot?{id:snapshot.portfolio_id,mode:'FIXTURE',asOf:snapshot.as_of,snapshot}:null;
  sourceState.connections.portfolio=snapshot?'CONNECTED_FIXTURE':'NOT_CONNECTED';
  const workspace=results[2].status==='fulfilled'?results[2].value:null;
  let valid=workspace?.sessionId&&Array.isArray(workspace.analyses)&&Array.isArray(workspace.tasks)&&Array.isArray(workspace.events)&&workspace.sources&&
    workspace.tasks.every(t=>t.mode==='LOCAL_CANDIDATE'&&t.sessionId===workspace.sessionId)&&workspace.analyses.every(a=>a.sessionId===workspace.sessionId);
  if(valid){try{workspace.tasks.forEach(t=>projectCandidate(t,workspace.analyses));}catch{valid=false;}}
  if(workspace&&!valid)sourceState.errors.analysis=new Error('服务端状态结构无效，已安全停止。');
  sourceState.workspace=valid?workspace:null;
  if(valid){sourceState.portfolio=workspace.sources.portfolio;sourceState.budget=workspace.sources.budget;}
  if(hadSources&&previousVersion!==sourceVersion())invalidateContext();
  sourceState.connections.analysis=valid&&workspace.provider?.configured?'READY':'NOT_CONNECTED';
  const old=sourceState.core;
  const restored=await Promise.allSettled(refs.map(async ref=>{
    const data=await request((ref.kind==='review'?'/api/review/task/':'/api/task/')+encodeURIComponent(ref.id),{timeout:8000});
    const task=projectCore(data,ref.kind);if(task.id!==ref.id)throw new Error('任务关联不一致');
    task.inputStale=old.find(t=>t.id===task.id)?.inputStale || ref.stale || false;return task;
  }));
  if(revision!==readRevision)return sourceState;
  sourceState.core=restored.filter(r=>r.status==='fulfilled').map(r=>r.value);
  sourceState.coreErrors=restored.flatMap((r,i)=>r.status==='rejected'?[{...refs[i],message:r.reason.message}]:[]);
  dispatchEvent(new CustomEvent('workspace:sources',{detail:sourceState}));return sourceState;
}
addEventListener('storage',event=>{
  if(event.key!==key)return;
  try{state=draftOnly(JSON.parse(event.newValue));dispatchEvent(new Event('workspace:context-invalidated'));emit();}catch{/* Ignore corrupted drafts. */}
});
