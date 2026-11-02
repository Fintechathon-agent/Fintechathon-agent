import {randomUUID} from 'node:crypto';
import {sha} from './risk.mjs';
export const PROMPT_VERSION='quality-20261024-r1';
export function ensureTrace(t,c,env){
 if(t.trace)return t.trace;
 t.trace_id='trace-'+randomUUID();
 return t.trace={trace_id:t.trace_id,request_id:t.request_id||null,conversation_id:c.id,turn_id:t.id,release:env.RELEASE_ID||'unrecorded',started_at:t.created_at||new Date().toISOString(),task:null,path:null,decision_summary:null,modules:Object.fromEntries(['core','session_memory','confirmed_memory','preference_memory','model','tools','risk'].map(k=>[k,{status:'NOT_NEEDED',used:false}])),model_steps:{},model_calls:[],tools:[],memory:[],answer:{source:'NOT_PRODUCED',validation:'NOT_RUN',result_use:'NOT_VERIFIED'},retry_of:t.retry_of||null};
}
export function mark(trace,module,status,extra={}){trace.modules[module]={...trace.modules[module],status,...extra};}
export function remember(trace,state,history){
 mark(trace,'session_memory','SUCCEEDED',{used:true});trace.memory=[{kind:'CURRENT_INPUT',version:state.version,as_of:state.metadata?.as_of||null,confirmation:'DRAFT',content_hash:state.review_hash||null},...history.map(x=>({kind:'RECENT_TURN',turn_id:x.turn_id,status:'COMPLETE',assistant_clipped:x.assistant_clipped||false}))];
}
export function modelEvent(trace,event){
 if(event.type==='request'){trace.model_steps[event.phase]={status:'REQUIRED_NOT_CALLED',request_id:event.request_id,used:false};trace.model_calls.push({...event,type:undefined,status:'STARTED',used:false});mark(trace,'model','REQUIRED_NOT_CALLED');}
 else {trace.model_steps[event.phase]={...trace.model_steps[event.phase],status:event.status==='COMPLETE'?'SUCCEEDED':'FAILED',error:event.error_code||null};const call=trace.model_calls.find(x=>x.request_id===event.request_id);if(call)Object.assign(call,event,{type:undefined});mark(trace,'model',event.status==='COMPLETE'?'SUCCEEDED':'FAILED',{used:false});}
}
export function finishTrace(t){
 const trace=t.trace;if(!trace)return;
 trace.completed_at=new Date().toISOString();trace.duration_ms=Date.parse(trace.completed_at)-Date.parse(trace.started_at);trace.status=t.status;trace.error=t.error?.code||null;
 if(t.status==='COMPLETE'){trace.answer.source=t.source||'LIVE_MODEL';trace.answer.validation='PASSED';trace.answer.result_use=t.tool||t.context?.actual_tool||t.context?.comparison?(trace.answer.validated_numeric_reference_observed?'FACTS_SUPPLIED_AND_VALIDATED_NUMERIC_REFERENCE_OBSERVED':'FACTS_SUPPLIED_USE_NOT_VERIFIED'):'NO_TOOL_REQUIRED';}
 else {trace.answer.validation=t.trace.answer.validation==='REJECTED'?'REJECTED':'NOT_COMPLETED';trace.answer.source=t.assistant?'PARTIAL_MODEL_UNVERIFIED':'NO_SUCCESSFUL_ANSWER';}
 trace.answer.output_hash=sha(t.assistant||'');
}
export function boundedHistory(turns,id){return turns.filter(t=>t.id!==id&&t.status==='COMPLETE').slice(-5).map(t=>({turn_id:t.id,user:t.user,assistant:t.assistant.slice(0,800),assistant_clipped:t.assistant.length>800}));}
