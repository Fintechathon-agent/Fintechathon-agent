// Browser draft state is never an authenticated role, Risk decision or trade receipt.
const key = 'finance-workspace-drafts.v1:' + new URL('../', import.meta.url).pathname;
const uid = prefix => prefix + '-' + crypto.randomUUID();
const empty = () => ({ version:1, clientId:uid('client'), user:{ name:'本机会话', role:'UNKNOWN', verified:false },
  drafts:{ question:'', horizon:'', drawdown:'', liquidity:'' }, goals:{ name:'', amountCents:null, deadline:'' },
  analyses:[], tasks:[], events:[] });
let saved;
try { saved=JSON.parse(localStorage.getItem(key)); } catch { /* Keep navigation usable without storage. */ }
let state = saved?.version===1 && Array.isArray(saved.analyses) && Array.isArray(saved.tasks) && Array.isArray(saved.events) ? saved : empty();
export const sourceState = { portfolio:null, budget:null, assistant:null, workspace:null, connections:{ assistant:'UNKNOWN', portfolio:'UNKNOWN', analysis:'UNKNOWN' } };
export const getState = () => structuredClone({...state,
  analyses:[...(sourceState.workspace?.analyses||[]),...state.analyses],
  tasks:[...(sourceState.workspace?.tasks||[]),...state.tasks],
  events:[...state.events,...(sourceState.workspace?.events||[])]});
export function updateState(mutator) {
  const next=structuredClone(state); mutator(next); state=next;
  try { localStorage.setItem(key,JSON.stringify(next)); } catch { /* Surface state in the current tab even when storage is full. */ }
  dispatchEvent(new CustomEvent('workspace:state',{detail:getState()}));
}
export function appendEvent(type, detail={}) {
  const event={ id:uid('demo-event'), mode:'BROWSER_DRAFT', type, at:new Date().toISOString(), ...detail };
  updateState(s=>s.events.push(event)); return event;
}
export function draftTask(analysis) {
  const prior=state.tasks.find(t=>t.analysisId===analysis.id);
  if(prior)return prior;
  const task={id:uid('draft-task'),analysisId:analysis.id,sessionId:analysis.sessionId||null,title:analysis.title||'核对分析建议',
    status:'PENDING_RISK',risk:'UNVERIFIED',execution_allowed:false,mode:'BROWSER_DRAFT',createdAt:new Date().toISOString()};
  updateState(s=>s.tasks.unshift(task));appendEvent('draft.created',{taskId:task.id,analysisId:analysis.id});return task;
}
export async function readSources() {
  const isLocal=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
  if(!isLocal){ sourceState.connections={assistant:'NOT_DEPLOYED',portfolio:'NOT_CONNECTED',analysis:'NOT_DEPLOYED'};return sourceState; }
  const load=async path=>{
    const response=await fetch(path,{credentials:'same-origin',signal:AbortSignal.timeout(8000)});
    if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw new Error('UNAVAILABLE');
    return response.json();
  };
  const results=await Promise.allSettled([load('/api/assistant/state'),load('/api/demo/portfolio'),load('/api/assistant/workspace/state')]);
  if(results[0].status==='fulfilled'){
    const assistant=results[0].value.state;
    if(assistant&&Array.isArray(assistant.records)&&assistant.summary){
      sourceState.assistant=assistant;
      sourceState.budget={id:'assistant-budget:'+assistant.summary.month,mode:'USER_REPORTED',asOf:new Date().toISOString(),summary:assistant.summary};
      sourceState.connections.assistant='CONNECTED';
    }
  }else{sourceState.assistant=null;sourceState.budget=null;sourceState.connections.assistant='UNAVAILABLE';}
  if(results[1].status==='fulfilled'&&results[1].value.output?.snapshot){
    const snapshot=results[1].value.output.snapshot;
    sourceState.portfolio={id:snapshot.portfolio_id,mode:'FIXTURE',asOf:snapshot.as_of,snapshot};
    sourceState.connections.portfolio='CONNECTED_FIXTURE';
  }else{sourceState.portfolio=null;sourceState.connections.portfolio='NOT_CONNECTED';}
  if(results[2].status==='fulfilled'&&results[2].value.sessionId&&Array.isArray(results[2].value.analyses)){
    sourceState.workspace=results[2].value;
    sourceState.portfolio=results[2].value.sources.portfolio;
    sourceState.budget=results[2].value.sources.budget;
    sourceState.connections.analysis=results[2].value.provider?.configured?'READY':'UNAVAILABLE';
  }else{sourceState.workspace=null;sourceState.connections.analysis='NOT_CONNECTED';}
  dispatchEvent(new CustomEvent('workspace:sources',{detail:sourceState}));return sourceState;
}
addEventListener('storage',event=>{
  if(event.key!==key||!event.newValue)return;
  try{const next=JSON.parse(event.newValue);if(next.version===1){state=next;dispatchEvent(new CustomEvent('workspace:state',{detail:getState()}));}}catch{/* Ignore corrupted external storage. */}
});
