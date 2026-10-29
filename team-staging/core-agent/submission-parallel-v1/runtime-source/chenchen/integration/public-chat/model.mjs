import {randomUUID} from 'node:crypto';
import {PLAN_PROMPT,ANSWER_PROMPT,answerFacts} from './shared.mjs';
import {sha} from './risk.mjs';
import {PROMPT_VERSION} from './trace.mjs';
import {CLOUD_MAX_INPUT_TOKENS,requestInputTokenBound} from './gateway-policy.mjs';
import {classifyCloudflareError} from './cloud-transport.mjs';
export const MODEL='@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const fail=code=>{throw Object.assign(Error(code),{code});};
export async function gate(env,operation,body){
 const response=await cancellable(env.CHAT_GATE.get(env.CHAT_GATE.idFromName('global')).fetch(new Request('https://gate/'+operation,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})),AbortSignal.timeout(10000));
 const result=await response.json();if(!response.ok)throw Object.assign(Error(result.message||result.error?.message||result.error?.code||result.code||'GATE_UNAVAILABLE'),{code:result.error?.code||result.code||'GATE_UNAVAILABLE',status:response.status});return result;
}
function cancellable(promise,signal){
 return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason||Object.assign(Error('MODEL_ABORTED'),{code:'MODEL_ABORTED'}));if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
export function buildModelRequest(phase,context,maxChars=12000,maxInputTokens=Infinity){
 const payload=phase==='plan'?structuredClone(context):answerFacts(context),historyKey=phase==='plan'?'history':'conversation_history';
 const messages=[{role:'system',content:phase==='plan'?PLAN_PROMPT:ANSWER_PROMPT(context)},{role:'user',content:''}];
 const clipping={history_before:payload[historyKey]?.length||0,history_removed:0,assistant_character_limit:800,current_facts_clipped:false};
 const encode=()=>{messages[1].content=JSON.stringify(payload);return JSON.stringify(messages).length;};
 const overLimit=()=>encode()>maxChars||requestInputTokenBound(messages)>maxInputTokens;
 while(overLimit()&&payload[historyKey]?.length){payload[historyKey].shift();clipping.history_removed++;}
 if(overLimit())fail('CHAT_CONTEXT_TOO_LONG');
 return {messages,clipping};
}
export function createCloudModel(env,lease){
 async function invoke(messages,{stream=false,signal,onDelta=()=>{},binding,onEvent=()=>{},onCapture=()=>{},clipping=null}){
  if(env.MODEL_ENABLED!=='true'||env.MODEL_NAME!==MODEL||!env.AI)fail('CHAT_PROVIDER_NOT_CONFIGURED');
  const input_bound_tokens=requestInputTokenBound(messages);
  if(JSON.stringify(messages).length>12000||input_bound_tokens>CLOUD_MAX_INPUT_TOKENS)fail('CHAT_CONTEXT_TOO_LONG');signal.throwIfAborted();
  const request_id='chat-ai-'+randomUUID(),request_hash=sha({messages,stream,binding}),started=Date.now();
  const reserved=await gate(env,'reserve',{lease,request_id,phase:binding.phase,request_hash,input_bound_tokens});if(reserved.call_allowed!==true)fail('MODEL_ALREADY_RESERVED');
  const timeout=AbortSignal.timeout(70000),combined=AbortSignal.any([signal,timeout]);let text='',usage=null,provider_response_id=null,reported_model=null,delta_count=0,numeric_delta_count=0,first_delta_at=null,last_delta_at=null,status='UNKNOWN',error_code=null,reader,finish_reason=null;
  try{
   onEvent({type:'request',request_id,phase:binding.phase,provider:'cloudflare_workers_ai',model:MODEL,prompt_version:PROMPT_VERSION,messages_hash:sha(messages),request_hash,roles:messages.map(m=>m.role),message_characters:messages.map(m=>m.content.length),max_tokens:1024,temperature:0,clipping,at:new Date().toISOString()});onCapture({request_id,messages,parameters:{max_tokens:1024,temperature:0,stream},binding,messages_hash:sha(messages)});
   const raw=await cancellable(env.AI.run(MODEL,{messages,max_tokens:1024,temperature:0,stream}),combined);provider_response_id=env.AI.lastRequestId||null;
   if(!provider_response_id)fail('MODEL_RECEIPT_MISSING');
   if(stream){
    if(!raw||typeof raw.getReader!=='function')fail('MODEL_STREAM_REQUIRED');reader=raw.getReader();const decoder=new TextDecoder();let buffer='',done=false,eventData=[];
    const dispatch=()=>{const payload=eventData.join('\n').trim();eventData=[];if(!payload)return;if(payload==='[DONE]'){done=true;return;}let chunk;try{chunk=JSON.parse(payload);}catch{fail('MODEL_STREAM_INVALID');}if(chunk.error||chunk.errors?.length)fail('MODEL_STREAM_FAILED');
     const value=chunk.response??chunk.choices?.[0]?.delta?.content??'';let delta;if(typeof value==='string')delta=value;else if(typeof value==='number'&&Number.isFinite(value)){delta=String(value);numeric_delta_count++;}else fail('MODEL_STREAM_INVALID');
     if(delta){text+=delta;if(text.length>16000)fail('MODEL_OUTPUT_TOO_LONG');delta_count++;first_delta_at??=Date.now();last_delta_at=Date.now();onDelta(delta);}
     if(chunk.usage)usage=chunk.usage;if(chunk.model)reported_model=chunk.model;finish_reason=chunk.choices?.[0]?.finish_reason||chunk.finish_reason||finish_reason;
    };
    const line=value=>{value=value.replace(/\r$/,'');if(!value){dispatch();return;}if(value.startsWith('data:'))eventData.push(value.slice(5).replace(/^ /,''));};
    while(true){const part=await cancellable(reader.read(),combined);if(part.done){buffer+=decoder.decode();if(buffer)line(buffer);dispatch();break;}buffer+=decoder.decode(part.value,{stream:true});if(buffer.length>100000)fail('MODEL_STREAM_INVALID');let at;
     while((at=buffer.indexOf('\n'))>=0){line(buffer.slice(0,at));buffer=buffer.slice(at+1);}
    }if(!done||!text.trim())fail('MODEL_STREAM_INTERRUPTED');
   }else{finish_reason=raw?.choices?.[0]?.finish_reason||raw?.finish_reason||null;usage=raw?.usage||null;reported_model=raw?.model||null;text=raw?.choices?.[0]?.message?.content??(typeof raw?.response==='object'?JSON.stringify(raw.response):raw?.response);if(typeof text!=='string'||!text.trim())fail('MODEL_EMPTY_RESPONSE');}
   combined.throwIfAborted();if(finish_reason==='length')fail('MODEL_OUTPUT_TRUNCATED');status='COMPLETE';
  }catch(error){status=timeout.aborted?'TIMEOUT':signal.aborted?'ABORTED':'ERROR';if(timeout.aborted)error=Object.assign(Error('MODEL_TIMEOUT'),{code:'MODEL_TIMEOUT'});else if(signal.aborted)error=Object.assign(Error('MODEL_ABORTED'),{code:'MODEL_ABORTED'});else if(!/^MODEL_[A-Z0-9_]{1,70}$/.test(String(error.code||'')))error=classifyCloudflareError(error);error_code=error.code;throw error;
  }finally{
   if(reader){try{if(status!=='COMPLETE')await cancellable(reader.cancel(),AbortSignal.timeout(1000));reader.releaseLock();}catch{}}
   try{onEvent({type:'result',request_id,phase:binding.phase,status,error_code,provider_response_id,reported_model,usage,finish_reason:finish_reason||'NOT_REPORTED',terminal_marker:stream&&status==='COMPLETE',duration_ms:Date.now()-started,retry_count:0,output_hash:sha(text)});}
   finally{await gate(env,'receipt',{lease,request_id,request_hash,phase:binding.phase,provider:'cloudflare_workers_ai',model:MODEL,provider_response_id,usage,duration_ms:Date.now()-started,status,error_code,numeric_delta_count,attempt_count:1,retry_count:0,estimated_cost_cents:10});}
  }
  return {text,receipt:{request_id,request_hash,...binding,provider:'cloudflare_workers_ai',model:MODEL,reported_model,provider_response_id,usage,finish_reason:finish_reason||'NOT_REPORTED',prompt_version:PROMPT_VERSION,stream,delta_count,numeric_delta_count,first_delta_at,last_delta_at,duration_ms:Date.now()-started,retry_count:0,completed:true}};
 }
 return {evaluate(messages,options){if(!Array.isArray(messages)||messages.length!==2||messages[0]?.role!=='system'||messages[1]?.role!=='user'||messages.some(m=>typeof m.content!=='string'||Object.keys(m).some(k=>!['role','content'].includes(k))))fail('INVALID_EVALUATION_REQUEST');return invoke(messages,{...options,stream:true});},async plan(context,options){const request=buildModelRequest('plan',context,12000,CLOUD_MAX_INPUT_TOKENS),result=await invoke(request.messages,{...options,clipping:request.clipping});let value;try{value=JSON.parse(result.text.replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{fail('MODEL_PLAN_INVALID');}return {value,receipt:result.receipt};},answer(context,options){const request=buildModelRequest('answer',context,12000,CLOUD_MAX_INPUT_TOKENS);return invoke(request.messages,{...options,clipping:request.clipping,stream:true});}};
}
