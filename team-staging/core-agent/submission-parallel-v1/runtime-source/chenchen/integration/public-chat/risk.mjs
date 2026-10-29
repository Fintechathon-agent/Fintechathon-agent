import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
export const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export const sha=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
export const sign=(key,text)=>createHmac('sha256',key).update(text).digest('hex');
export const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function assessAmount(body,now=new Date().toISOString()){
 if(body.operation!=='AMOUNT_HEALTH_CHECK'||typeof body.task_id!=='string'||typeof body.run_id!=='string'||!Number.isInteger(body.input_version)||body.tool_hash!==sha(body.tool)||!/^[a-f0-9]{64}$/.test(body.input_hash||'')||typeof body.question!=='string')throw Error('RISK_REQUEST_INVALID');
 const data=body.tool?.output;if(!data||!Array.isArray(data.rows)||!Array.isArray(data.warnings))throw Error('RISK_TOOL_INVALID');
 const reasons=[];let decision='ALLOW';
 if(!data.calculation_available||data.warnings.length){decision='REVIEW';reasons.push({code:'INPUT_INCOMPLETE'});}
 if(data.rows.some(p=>p.kind!=='cash'&&(p.weight_pct||0)>50)){decision='REVIEW';reasons.push({code:'SINGLE_HOLDING_OVER_HALF'});}
 if(data.cash_gap_cents){decision='REVIEW';reasons.push({code:'CASH_NEED_EXCEEDS_STATED_CASH'});}
 if(['买入','卖出','下单','转账','提现','buy','sell','transfer','trade','忽略限制','忽略规则'].some(word=>body.question.toLowerCase().includes(word))){decision='BLOCK';reasons.push({code:'EXECUTION_NOT_PERMITTED'});}
 return {contract_version:'amount-risk.v1',policy_version:'amount-readonly.1',task_id:body.task_id,run_id:body.run_id,input_version:body.input_version,input_hash:body.input_hash,tool_hash:body.tool_hash,decision,reasons,execution_allowed:false,timestamp:now,source:'Independent cloud amount-readonly policy; exact port of local amount policy, no sector/return inference'};
}
export default {async fetch(request,env){
 try{
  if(new URL(request.url).pathname==='/health'&&request.method==='GET')return Response.json({status:'ok',policy:'amount-readonly.1',execution_allowed:false});
  if(request.method!=='POST'||new URL(request.url).pathname!=='/assess'||request.headers.has('Origin')||!env.RISK_HMAC_SECRET||env.RISK_HMAC_SECRET.length<32)return new Response(null,{status:403});
  const raw=await request.text();if(raw.length>60000)return new Response(null,{status:413});
  if(!equal(request.headers.get('X-Risk-Signature'),sign(env.RISK_HMAC_SECRET,raw)))return new Response(null,{status:403});
  const body=JSON.parse(raw),payload=JSON.stringify({request_sha256:sha(body),result:assessAmount(body)});
  return Response.json({payload,signature:sign(env.RISK_HMAC_SECRET,payload)});
 }catch{return Response.json({error:{code:'RISK_UNAVAILABLE'}},{status:503});}
}};
export async function checkRisk(env,body){
 const raw=JSON.stringify(body),signal=AbortSignal.timeout(10000);
 const response=await new Promise((resolve,reject)=>{const abort=()=>reject(Object.assign(Error('RISK_TIMEOUT'),{code:'RISK_TIMEOUT'}));signal.addEventListener('abort',abort,{once:true});env.AMOUNT_RISK.fetch(new Request('https://risk/assess',{method:'POST',headers:{'Content-Type':'application/json','X-Risk-Signature':sign(env.RISK_HMAC_SECRET,raw)},body:raw,signal})).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
 if(!response.ok)throw Error('RISK_UNAVAILABLE');const envelope=await response.json();
 if(!equal(envelope.signature,sign(env.RISK_HMAC_SECRET,envelope.payload||'')))throw Error('RISK_SIGNATURE_INVALID');
 const parsed=JSON.parse(envelope.payload),r=parsed.result;
 if(parsed.request_sha256!==sha(body)||r.task_id!==body.task_id||r.run_id!==body.run_id||r.input_version!==body.input_version||r.input_hash!==body.input_hash||r.tool_hash!==body.tool_hash||r.policy_version!=='amount-readonly.1'||r.execution_allowed!==false||!['ALLOW','REVIEW','BLOCK','ERROR'].includes(r.decision)||!Number.isFinite(Date.parse(r.timestamp))||Math.abs(Date.now()-Date.parse(r.timestamp))>10000)throw Error('RISK_BINDING_INVALID');
 return {result:r,auth:{verified:true,transport:'CLOUDFLARE_SERVICE_BINDING_HMAC',production_identity_verified:true}};
}
