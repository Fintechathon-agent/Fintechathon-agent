import {randomUUID} from 'node:crypto';
import holdings from '../../core/holdings-conversation.js';
import {sessionFor} from './session.mjs';
import {sha,sign,equal,checkRisk} from './risk.mjs';
import {applyPlan,relevantAnswer,validateAnswer,preflightReviewPlan} from './shared.mjs';
import {gate} from './model.mjs';
import {createModelGateway} from './llm-gateway.mjs';
import {ensureTrace,mark,remember,modelEvent,finishTrace,boundedHistory} from './trace.mjs';
import {validateBaselineConfirmation} from './confirmation.mjs';
import {normalizeReview,buildReview,createSnapshot,compareSnapshots,compareCurrentReview} from './review-tools.mjs';
import accountHub from '../../integrations/account-hub.js';
export {ChatGate} from './gate.mjs';
const safeCode=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,80}$/.test(value)?value:'SERVICE_UNAVAILABLE';
const clone=x=>structuredClone(x),fail=(code,status=422)=>{throw Object.assign(Error(code),{code,status});};
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",'Strict-Transport-Security':'max-age=31536000','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
const json=(body,status=200,extra={})=>Response.json(body,{status,headers:{...headers,...extra}});
function errorResponse(error){const code=safeCode(error.code);return json({error:{code,message:errorMessages[code]||gatewayErrorMessages[code]||cloudErrorMessages[code]||'请求暂时无法处理，请稍后重试。已保存历史不受影响。'},execution_allowed:false},error.status||503);}
async function bodyOf(request){if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))fail('JSON_REQUIRED',415);const reader=request.body?.getReader();if(!reader)fail('BODY_REQUIRED');let size=0,chunks=[];while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>16000){await reader.cancel();fail('BODY_TOO_LARGE',413);}chunks.push(p.value);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('INVALID_JSON',400);}}
const chatRoute=/^\/api\/local\/chats(?:\/([\w-]{1,100})(?:\/(turns|confirm|review)(?:\/([\w-]{1,100})(?:\/(events|stop|trace))?)?)?)?$/;
const snapshotRoute=/^\/api\/local\/snapshots(?:\/([\w-]{1,100})(?:\/(restore|update|delete|compare))?)?$/;
const accountRoute=/^\/api\/local\/accounts(?:\/(demo|plan|[A-Za-z0-9_-]{1,100}))?$/;
export default {async fetch(request,env){try{
 const url=new URL(request.url);if(url.origin!==env.PUBLIC_ORIGIN)fail('WRONG_HOST',421);
 if(url.pathname==='/api/admin/evaluate'&&request.method==='POST'){
  if(!env.ADMIN_TOKEN||!equal(request.headers.get('Authorization'),'Bearer '+env.ADMIN_TOKEN))fail('ADMIN_REQUIRED',403);
  if(!env.QUALITY_EVAL_RUN)fail('EVALUATION_DISABLED',403);
  const body=await bodyOf(request);if(body.run!==env.QUALITY_EVAL_RUN||!Array.isArray(body.messages)||JSON.stringify(body.messages).length>12000)fail('INVALID_EVALUATION_REQUEST');
  const request_id='eval-'+randomUUID(),trace_id='trace-'+randomUUID(),events=[];
  const admission=await gate(env,'begin',{owner:'quality-evaluation',ip_hash:sha('quality-evaluation'),turn_id:request_id,request_id,evaluation_run:body.run});let status='ERROR';
  try{const result=await createModelGateway(env,admission.lease).evaluate(body.messages,{signal:AbortSignal.timeout(75000),binding:{trace_id,conversation_id:'synthetic-evaluation',turn_id:request_id,phase:'answer',input_hash:sha(body.messages)},onEvent:e=>events.push(e)});status='COMPLETE';return json({...result,trace_id,events,release:env.RELEASE_ID,source:'LIVE_MODEL_EVALUATION',execution_allowed:false});}
  finally{await gate(env,'release',{lease:admission.lease,status}).catch(()=>{});}
 }
 if(url.pathname==='/api/admin/status'&&request.method==='GET'){
  if(!env.ADMIN_TOKEN||!equal(request.headers.get('Authorization'),'Bearer '+env.ADMIN_TOKEN))fail('ADMIN_REQUIRED',403);
  const budget=await gate(env,'status',{});return json({version:env.RELEASE_ID||'unrecorded',model:env.LLM_GATEWAY_MODE==='external'?env[`LLM_${env.LLM_PRIMARY==='B'?'B':'A'}_MODEL`]:env.MODEL_NAME,gateway_mode:env.LLM_GATEWAY_MODE||'cloudflare',model_enabled:env.MODEL_ENABLED==='true',budget,execution_allowed:false});
 }
 if(url.pathname==='/health'&&request.method==='GET')return json({status:'ok',service:'personal-ai-fund-chat',execution_allowed:false});
 if(!url.pathname.startsWith('/api/')){if(!['/','/health.js','/health.css'].includes(url.pathname)||!['GET','HEAD'].includes(request.method))fail('NOT_FOUND',404);const served=await env.ASSETS.fetch(request),response=new Response(served.body,served);for(const[k,v]of Object.entries(headers))response.headers.set(k,v);response.headers.set('X-App-Release',env.RELEASE_ID||'unrecorded');return response;}
 if(request.headers.get('Sec-Fetch-Site')==='cross-site'||url.search)fail('CROSS_SITE_DENIED',403);
 const sessionRoute=url.pathname==='/api/session'&&request.method==='GET',matched=chatRoute.exec(url.pathname),snapshotMatched=snapshotRoute.exec(url.pathname),accountMatched=accountRoute.exec(url.pathname);
 if(!sessionRoute&&(!(matched||snapshotMatched||accountMatched)||!['GET','POST'].includes(request.method)))fail('NOT_FOUND',404);
 const ip_hash=sign(env.SESSION_SECRET,'ip:'+(request.headers.get('CF-Connecting-IP')||'unknown'));
 const kind=sessionRoute?'session':accountMatched?'account':request.method==='GET'?(url.pathname.endsWith('/events')?'stream':'read'):matched&&!matched[1]?'create':'mutation';
 await gate(env,'admit',{ip_hash,kind});
 const session=sessionFor(request,env.SESSION_SECRET);
 if(url.pathname==='/api/session'&&request.method==='GET')return json({csrf:session.csrf,workspace:'private-browser-records',expires_in_days:30,execution_allowed:false},200,{'Set-Cookie':session.cookie});
 if(session.fresh)fail('SESSION_REQUIRED',401);
 if(request.method==='POST'&&(request.headers.get('Origin')!==env.PUBLIC_ORIGIN||!equal(request.headers.get('X-CSRF-Token'),session.csrf)))fail('SESSION_OR_CSRF_REQUIRED',403);
 if(!(chatRoute.test(url.pathname)||snapshotRoute.test(url.pathname)||accountRoute.test(url.pathname))||!['GET','POST'].includes(request.method))fail('NOT_FOUND',404);
 const body=request.method==='POST'?await bodyOf(request):undefined,owner=sha(session.id);
 const response=await env.CHAT_SESSIONS.get(env.CHAT_SESSIONS.idFromName(owner)).fetch(new Request('https://session'+url.pathname,{method:request.method,headers:{'Content-Type':'application/json','X-Verified-Owner':owner,'X-Verified-IP':ip_hash},...(body===undefined?{}:{body:JSON.stringify(body)})}));
 const result=new Response(response.body,response);for(const[k,v]of Object.entries(headers))result.headers.set(k,v);return result;
 }catch(error){return errorResponse(error);}}};
const cloudErrorMessages={CLOUDFLARE_NEURONS_EXHAUSTED:'Cloudflare Workers AI 的每日 Neurons 额度已触发。输入已保留，请管理员核对平台用量。',MODEL_UPSTREAM_CAPACITY:'Cloudflare 模型当前容量不足。输入已保留，可稍后主动重试。',CLOUDFLARE_PLAN_REQUIRED:'当前 Cloudflare 账户方案不支持此模型，请管理员核对账户设置。'};
const gatewayErrorMessages={MODEL_QUOTA_EXHAUSTED:'模型服务商的余额或配额不足。输入已保留，请联系管理员核对账单。',MODEL_RATE_LIMITED:'模型服务商暂时限流。输入已保留，可稍后主动重试。',MODEL_AUTH_FAILED:'模型服务认证失败。输入已保留，请管理员检查 Secret。',MODEL_NETWORK_FAILED:'模型服务网络连接失败。输入已保留，可稍后主动重试。',MODEL_UPSTREAM_FAILED:'模型服务暂时不可用。输入已保留，可稍后主动重试。',MODEL_PROVIDERS_UNAVAILABLE:'主备模型当前均不可用。输入和已完成计算已保留，请稍后主动重试。',MODEL_DAILY_LIMIT:'所选模型的独立日限额已用尽。输入已保留，请管理员核对额度。',GATEWAY_POLICY_INVALID:'模型费用或能力配置未通过校验，已暂停付费调用。',MODEL_PARTIAL_RESPONSE:'模型回复中途断开，未拼接其他模型的内容。输入和已完成计算已保留。',MODEL_TOOL_CALL_UNSUPPORTED:'备用模型返回了未核实的工具调用格式，已停止本轮；金融工具和风控没有被跳过。',MODEL_INCOMPLETE_RESPONSE:'模型未完整结束回复，输入和已完成计算已保留。',MODEL_ABORTED:'模型调用已停止。已完成计算仍保留。'};
const errorMessages={RISK_TIMEOUT:'风控校验超时，本次数据未提交。请稍后重试；不会绕过校验或自动重试。',BASELINE_CONFIRMATION_REQUIRED:'尚未保存：请先核对当前日期和金额，再明确确认将当前持仓保留为比较基准；更正或新日期请先单独录入。',MODEL_OUTPUT_TRUNCATED:'模型回复达到输出上限，未作为完整答案。请缩小问题后重试。',STORAGE_UNAVAILABLE:'云端保存暂时失败，未写入的新数据不会作为当前持仓。请刷新核对后重试。',MODEL_UNSUPPORTED_METRIC:'现有数据不足以支持模型给出的收益或历史风险数字，已隐藏说明；金额计算保留，可重试。',MODEL_UNSUPPORTED_ATTRIBUTION:'金额差额不能直接归因于收益或买卖，已隐藏缺乏依据的解释，可重试。',SNAPSHOT_DEMO_MISMATCH:'演示数据和真实录入记录不能混合比较。',SNAPSHOT_DATE_ORDER_INVALID:'比较的后一个日期不能早于基准日期，请调整记录顺序。',REVIEW_STALE:'持仓已经更新，请重新读取当前数据后再提交。',SNAPSHOT_REVISION_CONFLICT:'保存记录已被更正，请刷新记录后重新确认。',SNAPSHOT_DATE_REQUIRED:'保存前请确认这些当前市值截至哪一天。',SNAPSHOT_CONFIRMATION_REQUIRED:'保存记录需要明确确认当前金额和日期。',SNAPSHOT_NOT_FOUND:'这条记录不存在或不属于当前访客。',SNAPSHOT_LIMIT:'最多保存20条记录，请先删除不再需要的记录。',REVIEW_CURRENCY_UNSUPPORTED:'当前只支持人民币当前市值，请先明确人民币金额。',REVIEW_BASIS_UNSUPPORTED:'需要当前市值，不能把成本、份额或数量当作当前金额。',REVIEW_DATE_INVALID:'请提供有效日期，不会自动使用今天。',REVIEW_DUPLICATE_NAME:'存在重复名称，请合并或修改后再核对。',TURN_TIMEOUT:'本轮处理超过时限，已停止继续调用。已保存内容仍在，可主动重试。',STREAM_LIMIT:'当前浏览器打开的回复连接较多，请关闭多余页面后重试。',GLOBAL_RATE_LIMIT:'当前访问较多，请稍后再试。',RATE_LIMIT:'发送过于频繁，请稍后重试。',CONCURRENCY_LIMIT:'当前使用人数较多，请稍后重试。',OWNER_BUSY:'当前访客已有回复正在生成，请等待或停止后重试。',MODEL_TIMEOUT:'模型响应超时。已保存输入和计算，可主动重试；系统不会自动重复调用。',USER_RATE_LIMIT:'发送过于频繁，请稍后重试。',IP_RATE_LIMIT:'当前网络请求较多，请稍后重试。',GLOBAL_CONCURRENCY_LIMIT:'当前使用人数较多，请稍后重试。',MODEL_BUDGET_EXHAUSTED:'演示预算已用尽，已保存历史仍可查看。',DAILY_BUDGET_EXHAUSTED:'本站今日模型费用上限已触发；历史仍可查看，请在北京时间次日再试。',DEMO_BUDGET_EXHAUSTED:'演示期模型预算已用尽，历史仍可查看。',DEMO_ENDED:'本次演示期已结束，历史仍可查看。',CHAT_PROVIDER_NOT_CONFIGURED:'模型服务当前暂停，已保存内容仍可查看。',MODEL_UNGROUNDED_NUMBER:'模型说明与工具金额或占比不一致，已隐藏说明。计算结果保留，可重试生成解释。',MODEL_STATE_CLAIM_INVALID:'模型的原始持仓或模拟状态说明未通过校验，已隐藏；可重试。',MODEL_PLAN_INVALID:'模型未返回可靠计划，原始持仓未改变。请重试或补充说明。',RISK_BLOCKED:'本次要求未通过风控。不能进行真实交易，原始持仓和已保存方案未改变。',SCENARIO_REQUIRED:'当前对话没有可确认的方案，请先说明希望如何模拟调整。',TRANSFER_INVALID:'未能确定有效的转出、转入或金额，请核对名称和金额。',HOLDING_NOT_FOUND:'未能明确要更正的持仓，请写明名称。',CHAT_CONTEXT_TOO_LONG:'对话已超过模型上下文限制，历史已保留。请新建对话并提供必要的信息。'};
export class ChatSession{
 constructor(ctx,env){this.ctx=ctx;this.storage=ctx.storage;this.env=env;this.owner=null;this.index=[];this.snapshotIndex=[];this.cache=new Map();this.live=new Map();this.listeners=new Map();this.queue=Promise.resolve();this.ready=ctx.blockConcurrencyWhile(async()=>{this.owner=await this.storage.get('owner');this.index=await this.storage.get('index')||[];this.snapshotIndex=await this.storage.get('snapshot-index')||[];});}
 publicComparison(value,c){if(!value)return null;const output=clone(value),changed=(value.snapshot_refs||[]).some(ref=>this.snapshotIndex.find(s=>s.id===ref.id)?.revision!==ref.revision),currentChanged=value.current_version!==undefined&&c&&value.current_version!==c.state.version;return {...output,stale:changed||Boolean(currentChanged),stale_reason:changed?'SAVED_RECORD_CHANGED_OR_DELETED':currentChanged?'CURRENT_DATA_CHANGED':null};}
 publicTurn(t,c){const {lease,trace,captured_requests,...rest}=t;const out=clone(rest);if(out.review){out.review.stale=out.review.version!==c?.state.version;out.review_stale=out.review.stale;}if(out.comparison)out.comparison=this.publicComparison(out.comparison,c);return out;}
 publicConversation(c){const out={...clone(c),turns:c.turns.map(t=>this.publicTurn(t,c))};if(out.state.review)out.state.review.stale=false;if(out.state.scenario)out.state.scenario.stale=out.state.scenario.base_version!==out.state.version;out.state.comparison=this.publicComparison(out.state.comparison,c);return out;}
 entries(c,t){const {turns,...metadata}=c,entry={id:c.id,title:c.title,created_at:c.created_at,updated_at:c.updated_at},index=clone(this.index),old=index.findIndex(x=>x.id===c.id);if(old<0)index.unshift(entry);else index[old]=entry;const data={index,['chat:'+c.id]:{...metadata,turn_ids:turns.map(t=>t.id)}};if(t)data['turn:'+t.id]=clone(t);if(Object.values(data).some(v=>Buffer.byteLength(JSON.stringify(v))>120000))fail('STORAGE_RECORD_LIMIT',413);return {data,index};}
 async save(c,t){if(t)ensureTrace(t,c,this.env);const {data,index}=this.entries(c,t);try{await this.storage.put(data);}catch{fail('STORAGE_UNAVAILABLE',503);}this.index=index;}
 metadata(c,plan={}){const initial={as_of:null,currency:'CNY',basis:'current_value',source:'USER_TEXT',demo:false},old={...initial,...c.state.metadata},next=plan.operation==='set_holdings'?initial:old,changesData=['set_holdings','correct_holdings'].includes(plan.operation),explicit=changesData&&plan.metadata&&typeof plan.metadata==='object'?plan.metadata:{};return {...next,...Object.fromEntries(Object.entries(explicit).filter(([key,value])=>['currency','basis','as_of','demo'].includes(key)&&value!==null)),source:changesData?'USER_TEXT':next.source};}
 async readSnapshot(id){const index=this.snapshotIndex.find(s=>s.id===id);if(!index)fail('SNAPSHOT_NOT_FOUND',404);const snapshot=await this.storage.get('snapshot:'+id);if(!snapshot||snapshot.revision!==index.revision)fail('STORAGE_UNAVAILABLE',503);return snapshot;}
 async savedReview(c,review){for(const entry of this.snapshotIndex){if(entry.content_hash!==undefined&&entry.source_conversation_id!==undefined){if(entry.content_hash===review.content_hash&&entry.source_conversation_id===c.id)return this.readSnapshot(entry.id);}else{const snapshot=await this.readSnapshot(entry.id);if(snapshot.content_hash===review.content_hash&&snapshot.source_conversation_id===c.id)return snapshot;}}return null;}
 snapshotMeta(s){return {id:s.id,name:s.name,revision:s.revision,created_at:s.created_at,updated_at:s.updated_at,metadata:s.metadata,total_cents:s.total_cents,rows_count:s.rows.length,content_hash:s.content_hash,source_conversation_id:s.source_conversation_id};}
 reviewState(c){if(c.state.actual.length&&!c.state.review){c.state.metadata=this.metadata(c);c.state.review=buildReview(c.state.actual,c.state.metadata,c.state.version);c.state.review_hash=c.state.review.content_hash;}return c.state.review;}
 async currentComparison(c){if(!c.state.baseline_snapshot_id||!this.reviewState(c))return null;const baseline=await this.readSnapshot(c.state.baseline_snapshot_id);return {...compareCurrentReview(baseline,c.state.review),snapshot_refs:[{id:baseline.id,revision:baseline.revision}],current_version:c.state.version};}
 async refreshComparison(c,t){let call;const tracing=!!(t&&c.state.baseline_snapshot_id&&c.state.review);if(tracing){const trace=ensureTrace(t,c,this.env);call={call_id:'tool-'+randomUUID(),name:'review-tools.compareCurrentReview',status:'STARTED',parameters:{baseline_id:c.state.baseline_snapshot_id,current_version:c.state.version,current_hash:c.state.review_hash},used:false};trace.tools.push(call);mark(trace,'tools','REQUIRED_NOT_CALLED');}try{c.state.comparison=await this.currentComparison(c);c.state.comparison_unavailable=null;if(call){call.status='SUCCEEDED';call.result_ref=sha(c.state.comparison);mark(t.trace,'tools','SUCCEEDED',{used:false});}}catch(error){if(call){call.status='FAILED';call.error=error.code||'COMPARISON_FAILED';mark(t.trace,'tools','FAILED',{used:false});}if(!['SNAPSHOT_NOT_FOUND','SNAPSHOT_DATE_ORDER_INVALID','SNAPSHOT_DEMO_MISMATCH'].includes(error.code))throw error;c.state.comparison=null;c.state.comparison_unavailable={code:error.code,message:error.code==='SNAPSHOT_NOT_FOUND'?'基准记录已删除，请重新选择。':error.code==='SNAPSHOT_DEMO_MISMATCH'?'演示数据不能与真实录入记录混合比较。':'当前日期早于基准，请选择日期顺序一致的记录。'};}}
 serverTurn(user,assistant){return {id:'turn-'+randomUUID(),user,assistant,status:'COMPLETE',phase:'',events:[],receipts:[],created_at:new Date().toISOString(),source:'SERVER_DATA_REVIEW'};}
 async load(cid){if(this.cache.has(cid))return this.cache.get(cid);if(!this.index.some(c=>c.id===cid))fail('CONVERSATION_NOT_FOUND',404);const stored=await this.storage.get('chat:'+cid);if(!stored)fail('STORAGE_UNAVAILABLE',503);const {turn_ids,...c}=stored;c.turns=[];for(const id of turn_ids){const t=await this.storage.get('turn:'+id);if(!t)fail('STORAGE_UNAVAILABLE',503);if(t.status==='RUNNING'){t.status='INTERRUPTED';t.phase='';t.error={code:'SERVER_RESTARTED',message:'服务重启中断了生成，已保存内容仍在。可主动重试，不会自动重复调用。'};await this.storage.put('turn:'+id,t);if(t.lease)await gate(this.env,'release',{lease:t.lease,status:'UNKNOWN'}).catch(()=>{});}c.turns.push(t);}this.reviewState(c);this.cache.set(cid,c);return c;}
 async publish(c,t){await this.save(c,t);this.emit(t.id,{type:'turn',conversation_id:c.id,turn:this.publicTurn(t,c)});}
 emit(tid,event){for(const send of this.listeners.get(tid)||[]){try{send(event);}catch{}}}
 async stage(c,t,phase){t.phase=phase;t.events.push({type:'status',message:phase,at:new Date().toISOString()});await this.publish(c,t);}
 async calculate(c,t,rows,metadata){
 const trace=ensureTrace(t,c,this.env),call={call_id:'tool-'+randomUUID(),name:'holdings-readonly.calculate',status:'STARTED',parameters:{row_count:rows.length,input_hash:sha(rows),as_of:metadata?.as_of||null},started_at:new Date().toISOString(),used:false};trace.tools.push(call);mark(trace,'tools','REQUIRED_NOT_CALLED');mark(trace,'core','SUCCEEDED',{used:true});
 const b={task_id:'task-'+c.id,session_id:'session-'+this.owner,input_version:c.state.version+1};
 try{const input=holdings.handle({...b,operation:'intake',input:{rows,text:''}}).input;if(metadata){input.source=metadata.source;input.as_of=metadata.as_of;}const tool=holdings.handle({...b,operation:'calculate',input}).tool;
 Object.assign(call,{status:'SUCCEEDED',result_ref:sha(tool),duration_ms:Date.now()-Date.parse(call.started_at)});mark(trace,'tools','SUCCEEDED');mark(trace,'risk','REQUIRED_NOT_CALLED');
 const risk=await checkRisk(this.env,{operation:'AMOUNT_HEALTH_CHECK',...b,run_id:t.id,input_hash:sha(input),tool_hash:sha(tool),tool,question:t.user});
 mark(trace,'risk','SUCCEEDED',{used:true,policy_version:risk.result.policy_version,decision:risk.result.decision,rules:risk.result.reasons});
 if(risk.result.decision==='BLOCK')fail('RISK_BLOCKED');if(risk.result.decision==='ERROR')fail('RISK_UNAVAILABLE');return {tool,risk,input};
 }catch(error){if(call.status!=='SUCCEEDED'){call.status='FAILED';call.error=safeCode(error.code||error.message);mark(trace,'tools','FAILED');}else if(trace.modules.risk.status!=='SUCCEEDED')mark(trace,'risk','FAILED',{error:safeCode(error.code||error.message)});throw error;}
 }

 async run(c,t,control){
  const signal=control.signal,model=createModelGateway(this.env,t.lease),trace=ensureTrace(t,c,this.env);let accountView;
  const audit={onEvent:event=>modelEvent(t.trace,event),onCapture:request=>{if(this.env.QUALITY_CAPTURE_CONVERSATION_ID===c.id)(t.captured_requests??=[]).push({request_id:request.request_id,messages_hash:request.messages_hash,binding:request.binding,parameters:request.parameters,message_count:request.messages.length});}};
  try{
   accountView=accountHub.publicHub(await this.loadAccountHub());
   signal.throwIfAborted();
   if(!t.plan){
    t.trace.model_steps.plan={status:'REQUIRED_NOT_CALLED',used:false};mark(t.trace,'model','REQUIRED_NOT_CALLED');await this.stage(c,t,'正在理解你的问题');
    const history=boundedHistory(c.turns,t.id);remember(t.trace,c.state,history);t.history=history;
    const planned=await model.plan({message:t.user,state:{actual:c.state.actual,version:c.state.version,scenario:c.state.scenario?{transfer:c.state.scenario.transfer,base_version:c.state.scenario.base_version}:null,previous_actual:c.state.previous_actual,metadata:c.state.metadata,baseline_snapshot_id:c.state.baseline_snapshot_id,comparison:c.state.comparison?{before:c.state.comparison.before,after:c.state.comparison.after,stale:this.publicComparison(c.state.comparison,c).stale}:null,account_hub:accountView},history},{...audit,signal,binding:{trace_id:t.trace_id,conversation_id:c.id,turn_id:t.id,phase:'plan',input_hash:sha(c.state)}});
    signal.throwIfAborted();t.plan=preflightReviewPlan(t.user,planned.value,c.state);t.receipts.push(planned.receipt);const planCall=t.trace.model_calls.find(x=>x.request_id===planned.receipt.request_id);if(planCall)planCall.used=true;t.trace.model_steps.plan.used=true;await this.publish(c,t);
   }
   if(!t.prepared){
    t.plan=preflightReviewPlan(t.user,t.plan,c.state);t.trace.task=t.plan.operation;t.trace.path='APPLICATION_ORCHESTRATED';t.trace.decision_summary='Validated planner operation: '+t.plan.operation;mark(t.trace,'core','SUCCEEDED',{used:true});const p=applyPlan(c.state,t.plan);
    const context={history:t.history||boundedHistory(c.turns,t.id),operation:t.plan.operation,focus:t.plan.focus||'actual',question:t.user,actual:c.state.actual,previous_actual:c.state.previous_actual,previous_tool:c.state.previous_tool?.output||null,actual_tool:c.state.actual_tool?.output||null,scenario:c.state.scenario,clarifying_question:t.plan.question,review:c.state.review||null,comparison:this.publicComparison(c.state.comparison,c),account_hub:accountView,execution_allowed:false};
    let calculation;
    if(p.rows){
     await this.stage(c,t,p.simulation?'正在计算模拟方案':'正在计算持仓比例');
     const metadata=this.metadata(c,t.plan),review=buildReview(p.rows,metadata,p.next.version);
     calculation={...await this.calculate(c,t,review.rows,metadata),metadata,review};
     signal.throwIfAborted();await this.stage(c,t,'正在核对计算与操作范围');signal.throwIfAborted();
    }
    // Keep both state and the prepared turn private until the durable commit.
    // A rejected write leaves the visible/current original data and retry basis intact.
    const candidate=clone(c),prepared=clone(t);prepared.context=context;
    if(calculation){
     const {tool,risk,input,metadata,review}=calculation;
     Object.assign(prepared,{tool,risk,input_hash:sha(input),simulation:p.simulation,review:{...review,tool}});
     if(p.simulation){p.next.scenario.tool=tool;p.next.scenario.risk=risk;p.next.scenario.review=prepared.review;}
     else{p.next.actual_tool=tool;p.next.metadata=metadata;p.next.review=prepared.review;p.next.review_hash=review.content_hash;}
     candidate.state=p.next;
     if(!p.simulation){await this.refreshComparison(candidate,prepared);prepared.comparison=candidate.state.comparison;}
     prepared.context={...context,actual:candidate.state.actual,actual_tool:candidate.state.actual_tool?.output||null,previous_actual:candidate.state.previous_actual,previous_tool:candidate.state.previous_tool?.output||null,scenario:candidate.state.scenario,tool:tool.output,risk:risk.result,previous_scenario_stale:p.stale,simulation:p.simulation,review:prepared.review,comparison:this.publicComparison(candidate.state.comparison,candidate)};
     prepared.committed_version=candidate.state.version;
    }
    if(t.plan.operation==='compare_snapshots'){
     await this.refreshComparison(candidate,prepared);prepared.comparison=candidate.state.comparison;prepared.context.comparison=candidate.state.comparison;
     if(!candidate.state.comparison)prepared.context.clarifying_question=candidate.state.comparison_unavailable?.message||'请先确认保存或选择一条基准记录，再与当前金额比较。';
    }
    if(t.plan.operation==='confirm_baseline'){
     validateBaselineConfirmation(t.user,c.state);const review=this.reviewState(c),prior=await this.savedReview(c,review);if(!prior&&this.snapshotIndex.length>=20)fail('SNAPSHOT_LIMIT',429);
     const now=new Date().toISOString(),snapshot=prior||{...createSnapshot({review,confirmed:true,created_at:now,id:'snapshot-'+randomUUID()}),name:review.metadata.as_of+' 已确认基准',revision:1,updated_at:now,source_conversation_id:c.id,review:clone(review)};
     candidate.state.baseline_snapshot_id=snapshot.id;candidate.state.comparison=null;candidate.state.comparison_unavailable=null;prepared.snapshot_id=snapshot.id;prepared.context.confirmed_baseline={id:snapshot.id,as_of:snapshot.metadata.as_of,revision:snapshot.revision,status:'CONFIRMED',created_at:snapshot.created_at,updated_at:snapshot.updated_at,content_hash:snapshot.content_hash};prepared.baseline_to_commit=snapshot;
    }
    prepared.prepared=true;candidate.turns=candidate.turns.map(turn=>turn.id===t.id?prepared:turn);signal.throwIfAborted();
    if(prepared.baseline_to_commit){const snapshot=prepared.baseline_to_commit;delete prepared.baseline_to_commit;await this.commitSnapshot(snapshot,candidate,prepared);}else await this.save(candidate,prepared);
    c.state=candidate.state;Object.assign(t,prepared);this.cache.set(c.id,c);this.emit(t.id,{type:'turn',conversation_id:c.id,turn:this.publicTurn(t,c)});
   }
   signal.throwIfAborted();
   for(const ref of t.context?.comparison?.snapshot_refs||[]){const snapshot=await this.readSnapshot(ref.id);t.trace.memory.push({kind:'CONFIRMED_SNAPSHOT',id:snapshot.id,revision:snapshot.revision,as_of:snapshot.metadata.as_of,status:snapshot.status,content_hash:snapshot.content_hash});mark(t.trace,'confirmed_memory','SUCCEEDED',{used:true});}
   if(t.context.confirmed_baseline){t.trace.memory.push({kind:'CONFIRMED_BASELINE_WRITE',...t.context.confirmed_baseline});mark(t.trace,'confirmed_memory','SUCCEEDED',{used:true});}
   t.trace.answer.facts_ref=sha(t.context);t.trace.answer.tool_results_in_request=!!(t.context.tool||t.context.actual_tool||t.context.comparison);
   t.trace.model_steps.answer={status:'REQUIRED_NOT_CALLED',used:false};mark(t.trace,'model','REQUIRED_NOT_CALLED');await this.stage(c,t,'正在生成回复');t.assistant='';
   const result=await model.answer(t.context,{...audit,signal,binding:{trace_id:t.trace_id,conversation_id:c.id,turn_id:t.id,phase:'answer',input_hash:sha(t.context)},onDelta:delta=>{if(signal.aborted)return;t.assistant+=delta;this.emit(t.id,{type:'delta',conversation_id:c.id,turn_id:t.id,text:delta});}});
   signal.throwIfAborted();t.receipts.push(result.receipt);const relevant=relevantAnswer(result.text,t.context);
   try{validateAnswer(relevant,t.context);}catch(error){t.trace.answer.validation='REJECTED';t.assistant='';throw error;}
   const answerCall=t.trace.model_calls.find(x=>x.request_id===result.receipt.request_id);if(answerCall)answerCall.used=true;t.trace.model_steps.answer.used=true;mark(t.trace,'model','SUCCEEDED',{used:true});const numericReference=/\d[\d,.]*\s*(元|万|%|％|百分点)/.test(relevant);t.trace.answer.validated_numeric_reference_observed=numericReference;t.trace.answer.semantic_use='NOT_INFERRED_FROM_PROVIDER_SUCCESS';if(t.trace.tools.length){mark(t.trace,'tools',t.trace.tools.some(call=>call.status==='FAILED')?'FAILED':'SUCCEEDED',{used:numericReference});for(const call of t.trace.tools)call.used=call.status==='SUCCEEDED'&&numericReference;}t.source='LIVE_MODEL';
   t.assistant=relevant;t.status='COMPLETE';t.phase='';t.completed_at=new Date().toISOString();
  }catch(error){
   const timedOut=signal.aborted&&signal.reason?.code==='TURN_TIMEOUT',userStopped=signal.aborted&&!timedOut;t.status=userStopped?'STOPPED':'ERROR';t.phase='';
   const code=timedOut?'TURN_TIMEOUT':userStopped?'USER_STOPPED':safeCode(error.code||error.message);
   for(const step of Object.values(t.trace.model_steps||{}))if(step.status==='REQUIRED_NOT_CALLED')step.blocked_reason=code;
   t.error={code,...(error.code==='MODEL_UNGROUNDED_NUMBER'&&error.numeric_diagnostic?{numeric_diagnostic:error.numeric_diagnostic}:{}),message:userStopped?'已停止生成。已完成计算保留，没有执行交易。':errorMessages[code]||gatewayErrorMessages[code]||cloudErrorMessages[code]||'模型或工具暂时不可用。输入和已完成计算已保存，可主动重试；系统不会自动重复调用。'};
  }finally{
   clearTimeout(control.turnDeadline);this.live.delete(c.id);finishTrace(t);
   try{await this.publish(c,t);}catch(error){t.status='ERROR';t.phase='';t.error={code:'STORAGE_UNAVAILABLE',message:'云端保存暂时失败，本次结果未确认保存。请保留输入，刷新后核对历史再重试。'};this.emit(t.id,{type:'turn',conversation_id:c.id,turn:this.publicTurn(t,c)});}
   finally{await gate(this.env,'release',{lease:t.lease,status:t.status==='STOPPED'?'ABORTED':t.status}).catch(()=>{});}
  }
 }
 async start(c,request,ip_hash){if(!request||Object.keys(request).some(k=>!['request_id','text','retry_turn_id'].includes(k))||!/^[\w-]{8,100}$/.test(request.request_id||''))fail('INVALID_CHAT_REQUEST');const hash=sha(request),old=c.turns.find(t=>t.request_id===request.request_id);if(old){if(old.request_hash!==hash)fail('IDEMPOTENCY_CONFLICT',409);return this.publicTurn(old,c);}if(this.live.size||c.turns.some(t=>t.status==='RUNNING'))fail('TURN_IN_PROGRESS',409);if(c.turns.length>=40)fail('TURN_LIMIT',429);
 let previous;if(request.retry_turn_id){previous=c.turns.at(-1);if(previous?.id!==request.retry_turn_id||!['ERROR','STOPPED','INTERRUPTED'].includes(previous.status))fail('RETRY_NOT_ALLOWED',409);}const text=previous?.user||request.text;if(typeof text!=='string'||!text.trim()||text.length>2000)fail('CHAT_TEXT_REQUIRED');
 const t={id:'turn-'+randomUUID(),request_id:request.request_id,request_hash:hash,user:text.trim(),assistant:'',status:'RUNNING',phase:'请求已接收',events:[],receipts:[],created_at:new Date().toISOString(),...(previous?.prepared?{prepared:true,plan:clone(previous.plan),context:clone(previous.context),tool:clone(previous.tool),risk:clone(previous.risk),review:clone(previous.review),comparison:clone(previous.comparison),simulation:previous.simulation,committed_version:previous.committed_version}:previous?.plan?{plan:clone(previous.plan)}:{})};if(previous)t.retry_of=previous.id;ensureTrace(t,c,this.env);if(previous?.prepared)t.trace.answer.reused_prepared_turn=previous.id;
 const admission=await gate(this.env,'begin',{owner:this.owner,ip_hash,turn_id:t.id,request_id:t.request_id});t.lease=admission.lease;
 const controller=new AbortController();controller.turnDeadline=setTimeout(()=>controller.abort(Object.assign(Error('TURN_TIMEOUT'),{code:'TURN_TIMEOUT'})),165000);
 c.turns.push(t);if(c.title==='新对话')c.title=t.user.slice(0,28);c.updated_at=new Date().toISOString();try{await this.save(c,t);}catch(error){clearTimeout(controller.turnDeadline);c.turns.pop();await gate(this.env,'release',{lease:t.lease,status:'UNKNOWN'}).catch(()=>{});throw error;}
 this.live.set(c.id,{turn_id:t.id,controller});this.ctx.waitUntil(this.run(c,t,controller));return this.publicTurn(t,c);
 }
 stream(c,t){if([...this.listeners.values()].reduce((n,set)=>n+set.size,0)>=2)fail('STREAM_LIMIT',429);const encoder=new TextEncoder();let cleanup;return new Response(new ReadableStream({start:controller=>{let closed=false;const send=event=>{if(closed)return;try{controller.enqueue(encoder.encode('data: '+JSON.stringify(event)+'\n\n'));if(event.type==='turn'&&event.turn.status!=='RUNNING'){closed=true;cleanup?.();controller.close();}}catch{closed=true;cleanup?.();}};const set=this.listeners.get(t.id)||new Set();this.listeners.set(t.id,set);set.add(send);const timer=setInterval(()=>{if(!closed){try{controller.enqueue(encoder.encode(': heartbeat\n\n'));}catch{closed=true;cleanup?.();}}},15000);const expiry=setTimeout(()=>{if(!closed){closed=true;cleanup?.();try{controller.close();}catch{}}},180000);cleanup=()=>{clearInterval(timer);clearTimeout(expiry);set.delete(send);if(!set.size)this.listeners.delete(t.id);};send({type:'turn',conversation_id:c.id,turn:this.publicTurn(t,c)});},cancel:()=>cleanup?.()}),{headers:{...headers,'Content-Type':'text/event-stream','X-Accel-Buffering':'no'}});}
 fields(request,allowed){if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(key=>!allowed.includes(key)))fail('INVALID_REVIEW_REQUEST');}
 idle(c){if(this.live.size||c?.turns.some(t=>t.status==='RUNNING'))fail('TURN_IN_PROGRESS',409);if(c?.turns.length>=40)fail('TURN_LIMIT',429);}
 version(c,version){if(!Number.isSafeInteger(version)||version!==c.state.version)fail('REVIEW_STALE',409);}
 revision(snapshot,revision){if(!Number.isSafeInteger(revision)||revision!==snapshot.revision)fail('SNAPSHOT_REVISION_CONFLICT',409);}
 checkedMetadata(rows,metadata){return normalizeReview({rows,metadata});}
 async preparedReview(c,request,options={}){
  this.idle(c);this.version(c,request.base_version);if(!['correct','new'].includes(request.mode))fail('INVALID_REVIEW_REQUEST');
  const normalized=this.checkedMetadata(request.rows,request.metadata),next=clone(c),t=this.serverTurn(options.user||(request.mode==='correct'?'更正当前持仓表格':'录入一份当前持仓表格'),options.assistant||(request.mode==='correct'?'已更正当前数据并重新计算。已保存记录不会自动改写；这不是买卖或资金变动记录。':'已核对这份当前市值并重新计算。当前数据尚未保存为新记录，没有执行交易。'));
  const {tool,risk,input}=await this.calculate(c,t,normalized.rows,normalized.metadata),review={...buildReview(normalized.rows,normalized.metadata,c.state.version+1),tool};
  next.state={...next.state,previous_actual:clone(c.state.actual),previous_tool:c.state.actual_tool,actual:review.rows,actual_tool:tool,metadata:review.metadata,version:review.version,review,review_hash:review.content_hash};
  if(options.baseline)next.state.baseline_snapshot_id=options.baseline.id;
  await this.refreshComparison(next);Object.assign(t,{tool,risk,input_hash:sha(input),review,comparison:next.state.comparison,committed_version:review.version,simulation:false,context:{operation:request.mode==='correct'?'correct_holdings':'set_holdings',actual:next.state.actual,review,comparison:next.state.comparison,execution_allowed:false}});
  next.turns.push(t);next.updated_at=new Date().toISOString();if(next.title==='新对话')next.title=review.metadata.as_of?review.metadata.as_of+' 持仓核对':'持仓核对';return {next,t,review};
 }
 async editReview(c,request){this.fields(request,['base_version','rows','metadata','mode']);const prepared=await this.preparedReview(c,request);await this.save(prepared.next,prepared.t);this.cache.set(c.id,prepared.next);return {conversation:this.publicConversation(prepared.next),review:prepared.review,execution_allowed:false};}
 async commitSnapshot(snapshot,c,t){const nextIndex=this.snapshotIndex.filter(s=>s.id!==snapshot.id);nextIndex.unshift(this.snapshotMeta(snapshot));const prepared=c?this.entries(c,t):null,data={...(prepared?.data||{}),'snapshot-index':nextIndex,['snapshot:'+snapshot.id]:snapshot};if(Object.values(data).some(v=>Buffer.byteLength(JSON.stringify(v))>120000))fail('STORAGE_RECORD_LIMIT',413);await this.storage.put(data);this.snapshotIndex=nextIndex;if(prepared){this.index=prepared.index;this.cache.set(c.id,c);}}
 async handleSnapshots(request,match){const[,id,action]=match;
  if(request.method==='GET'){if(action)fail('METHOD_NOT_ALLOWED',405);return json(id?{snapshot:await this.readSnapshot(id),execution_allowed:false}:{snapshots:clone(this.snapshotIndex),execution_allowed:false});}
  if(request.method!=='POST')fail('METHOD_NOT_ALLOWED',405);const body=await request.json();
  if(!id){this.fields(body,['conversation_id','base_version','base_hash','confirmed','name']);const c=await this.load(body.conversation_id);this.idle(c);this.version(c,body.base_version);const review=this.reviewState(c);if(!review)fail('ACTUAL_HOLDINGS_REQUIRED');if(body.base_hash!==review.content_hash)fail('REVIEW_STALE',409);
   const now=new Date().toISOString(),snapshot=createSnapshot({review,confirmed:body.confirmed,created_at:now,id:'snapshot-'+randomUUID()});if(body.name!==undefined&&(typeof body.name!=='string'||!body.name.trim()||body.name.length>80))fail('SNAPSHOT_NAME_INVALID');
   const prior=await this.savedReview(c,review);if(prior)return json({snapshot:prior,conversation:this.publicConversation(c),replayed:true,execution_allowed:false});
   if(this.snapshotIndex.length>=20)fail('SNAPSHOT_LIMIT',429);const next=clone(c),t=this.serverTurn('确认保存当前持仓记录','已保存这份已确认的当前市值和日期，后续修改当前表格不会覆盖此记录。没有执行交易。'),checked=await this.calculate(c,t,review.rows,review.metadata);
   Object.assign(snapshot,{name:body.name?.trim()||(review.metadata.as_of+' 持仓记录'),revision:1,updated_at:now,source_conversation_id:c.id,review:{...review,tool:checked.tool},risk:checked.risk});next.state.baseline_snapshot_id=snapshot.id;next.state.comparison=null;next.state.comparison_unavailable=null;t.review=next.state.review;t.tool=checked.tool;t.risk=checked.risk;t.snapshot_id=snapshot.id;next.turns.push(t);next.updated_at=now;await this.commitSnapshot(snapshot,next,t);return json({snapshot,conversation:this.publicConversation(next),execution_allowed:false},201);
  }
  const snapshot=await this.readSnapshot(id);this.idle();this.revision(snapshot,body.revision);
  if(action==='restore'){this.fields(body,['conversation_id','base_version','revision']);const c=await this.load(body.conversation_id),prepared=await this.preparedReview(c,{base_version:body.base_version,mode:'new',rows:snapshot.rows,metadata:snapshot.metadata},{baseline:snapshot,user:'从保存记录恢复当前持仓',assistant:'已将选定记录恢复到当前对话，并重新计算校验。原保存记录保持不变；这不是一笔交易。'});prepared.t.snapshot_id=id;prepared.t.snapshot_revision=snapshot.revision;await this.save(prepared.next,prepared.t);this.cache.set(c.id,prepared.next);return json({snapshot,conversation:this.publicConversation(prepared.next),execution_allowed:false});}
  if(action==='update'){this.fields(body,['revision','rows','metadata','confirmed']);const normalized=this.checkedMetadata(body.rows,body.metadata),review=buildReview(normalized.rows,normalized.metadata,snapshot.version+1),updated=createSnapshot({review,confirmed:body.confirmed,created_at:snapshot.created_at,id}),t=this.serverTurn('更正已保存持仓记录','');const checked=await this.calculate({id:'saved-'+id,state:{version:snapshot.version}},t,review.rows,review.metadata);Object.assign(updated,{name:snapshot.name,revision:snapshot.revision+1,updated_at:new Date().toISOString(),source_conversation_id:snapshot.source_conversation_id,review:{...review,tool:checked.tool},risk:checked.risk});await this.commitSnapshot(updated);return json({snapshot:updated,notice:'记录已更正；之前引用旧版本的比较已失效，重新比较后才使用新金额。当前对话金额未被自动改写。',execution_allowed:false});}
  if(action==='delete'){this.fields(body,['revision']);const nextIndex=this.snapshotIndex.filter(s=>s.id!==id);await this.storage.transaction(async tx=>{await tx.delete('snapshot:'+id);await tx.put('snapshot-index',nextIndex);});this.snapshotIndex=nextIndex;return json({deleted:true,snapshot_id:id,notice:'已删除保存记录；已有对话历史中的副本仍保留。',execution_allowed:false});}
  if(action==='compare'){this.fields(body,['revision','conversation_id','base_version','other_id','other_revision']);let c,comparison;
   if(body.conversation_id){c=await this.load(body.conversation_id);this.idle(c);if(body.base_version!==undefined||!body.other_id)this.version(c,body.base_version);}
   if(body.other_id){const other=await this.readSnapshot(body.other_id);this.revision(other,body.other_revision);comparison={...compareSnapshots(snapshot,other),snapshot_refs:[{id,revision:snapshot.revision},{id:other.id,revision:other.revision}]};}
   else{if(!c||!this.reviewState(c))fail('ACTUAL_HOLDINGS_REQUIRED');comparison={...compareCurrentReview(snapshot,c.state.review),snapshot_refs:[{id,revision:snapshot.revision}],current_version:c.state.version};}
   if(c){const next=clone(c),t=this.serverTurn(body.other_id?'比较两份保存记录':'比较基准记录与当前持仓','已按记录中的金额和占比计算变化。差额不等于收益或交易，当前资料无法确定变化原因。');next.state.comparison=comparison;next.state.comparison_unavailable=null;if(!body.other_id)next.state.baseline_snapshot_id=id;t.comparison=comparison;next.turns.push(t);next.updated_at=new Date().toISOString();await this.save(next,t);this.cache.set(c.id,next);return json({comparison:this.publicComparison(comparison,next),conversation:this.publicConversation(next),execution_allowed:false});}
   return json({comparison:this.publicComparison(comparison),execution_allowed:false});
  }
  fail('METHOD_NOT_ALLOWED',405);
 }
 async handleAccounts(request,match){
  const action=match[1]||null;
  if(request.method==='GET'){
   if(action)fail('METHOD_NOT_ALLOWED',405);
   return json(accountHub.publicHub(await this.loadAccountHub()));
  }
  if(request.method!=='POST')fail('METHOD_NOT_ALLOWED',405);
  const body=await request.json();
  if(action==='plan'){
   const hub=await this.loadAccountHub();
   return json({plan:accountHub.routeScenario(body?.question,hub),hub:accountHub.publicHub(hub)});
  }
  let result,status=200;
  if(action==='demo'){
   result=accountHub.seedDemo(await this.loadAccountHub(),{idempotencyKey:body?.idempotency_key||'account-hub-demo-v1',requestId:body?.request_id||'demo-seed-v1'});
   status=result.replayed?200:201;
  }else{
   const input={...(body?.account&&typeof body.account==='object'?body.account:body)};
   if(action)input.account_id=action;
   result=accountHub.upsert(await this.loadAccountHub(),input,{requestId:body?.request_id||null,idempotencyKey:body?.idempotency_key,now:new Date().toISOString()});
   status=result.replayed?200:201;
  }
  await this.saveAccountHub(result.hub);
  return json({account:result.account||null,notice:result.notice||null,replayed:result.replayed,hub:accountHub.publicHub(result.hub)},status);
 }
 async loadAccountHub(){return accountHub.ensureHub(await this.storage.get('account-hub'));}
 async saveAccountHub(hub){try{await this.storage.put('account-hub',hub);}catch{fail('STORAGE_UNAVAILABLE',503);}}
 async confirm(c,request){
  if(this.live.size)fail('TURN_IN_PROGRESS',409);
  const next=clone(c),s=next.state.scenario;
  if(!s||request.plan_id!==s.id||request.base_hash!==sha(c.state.actual)||s.base_version!==c.state.version||request.base_hash!==s.base_hash)fail('STALE_PLAN',409);
  if(s.confirmed)return {conversation:this.publicConversation(c),execution_allowed:false,replayed:true};
  const t={id:'turn-'+randomUUID(),user:'确认保存此模拟方案',assistant:'',status:'RUNNING',events:[],receipts:[],created_at:new Date().toISOString(),simulation:true};
  const {tool,risk}=await this.calculate(c,t,s.rows,c.state.metadata);
  if(c.state.scenario?.id!==s.id||sha(c.state.actual)!==request.base_hash||c.state.version!==s.base_version)fail('STALE_PLAN',409);
  s.confirmed=true;s.requires_confirmation=false;s.risk=risk;
  t.review={...buildReview(s.rows,c.state.metadata||this.metadata(c),c.state.version),tool};t.tool=tool;t.risk=risk;t.status='COMPLETE';t.assistant='模拟方案已确认保存，原始持仓保持不变。当前产品不连接交易账户，未执行买卖或资金转移。';t.source='SERVER_CONFIRMATION';
  next.turns.push(t);await this.save(next,t);this.cache.set(c.id,next);
  return {conversation:this.publicConversation(next),execution_allowed:false};
 }
 async handle(request){await this.ready;const owner=request.headers.get('X-Verified-Owner');if(!/^[a-f0-9]{64}$/.test(owner||''))fail('IDENTITY_REQUIRED',403);if(this.owner&&this.owner!==owner)fail('OWNER_MISMATCH',403);if(!this.owner){this.owner=owner;await this.storage.put('owner',owner);}const path=new URL(request.url).pathname,accountMatch=accountRoute.exec(path);if(accountMatch)return this.handleAccounts(request,accountMatch);const snapshotMatch=snapshotRoute.exec(path);if(snapshotMatch)return this.handleSnapshots(request,snapshotMatch);const match=chatRoute.exec(path);if(!match)fail('NOT_FOUND',404);const[,cid,action,tid,verb]=match;
 if(!cid){if(request.method==='GET')return json({scope:'THIS_BROWSER_RECORDS',conversations:this.index.map(c=>({...c,active:this.live.has(c.id)})),execution_allowed:false});if(request.method!=='POST')fail('METHOD_NOT_ALLOWED',405);if(this.index.length>=40)fail('CONVERSATION_LIMIT',429);const c={id:'chat-'+randomUUID(),title:'新对话',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),state:{actual:[],previous_actual:[],actual_tool:null,previous_tool:null,version:0,scenario:null},turns:[]};this.cache.set(c.id,c);await this.save(c);return json(this.publicConversation(c),201);}
 const c=await this.load(cid);if(!action&&request.method==='GET')return json(this.publicConversation(c));if(action==='turns'&&!tid&&request.method==='POST')return json(await this.start(c,await request.json(),request.headers.get('X-Verified-IP')),202);if(action==='review'&&request.method==='POST')return json(await this.editReview(c,await request.json()));if(action==='confirm'&&request.method==='POST')return json(await this.confirm(c,await request.json()));const t=c.turns.find(t=>t.id===tid);if(!t)fail('TURN_NOT_FOUND',404);
 if(verb==='trace'&&request.method==='GET')return json({trace:t.trace||null,captured_requests:t.captured_requests||[],note:t.trace?'SERVER_GENERATED_OBSERVATIONS':'LEGACY_TURN_WITHOUT_TRACE',execution_allowed:false});if(verb==='events'&&request.method==='GET')return this.stream(c,t);if(verb==='stop'&&request.method==='POST'){const active=this.live.get(c.id);if(active?.turn_id===tid){active.controller.abort();t.status='STOPPED';t.phase='';t.error={code:'USER_STOPPED',message:'已停止生成。已完成计算保留，没有执行交易。'};await this.publish(c,t);}return json(this.publicTurn(t,c));}fail('METHOD_NOT_ALLOWED',405);
 }
 fetch(request){const result=this.queue.then(()=>this.handle(request));this.queue=result.catch(()=>{});return result.catch(errorResponse);}
}
