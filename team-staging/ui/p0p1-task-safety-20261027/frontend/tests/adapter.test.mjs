import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {projectCore,projectCandidate,taskPresentation,traceOf,scopeFingerprint,modelEvidence} from '../versions/workspace-adapter.mjs';
import {executionView} from '../versions/workspace-model.mjs';
const fixture=name=>JSON.parse(fs.readFileSync(new URL('./fixtures/'+name+'.json',import.meta.url),'utf8'));
test('frozen team health contract retains only actual trace fields',()=>{
  const task=projectCore(fixture('health'));
  assert.equal(task.id,'task-demo-001');assert.equal(task.status,'HANDOFF_REQUIRED');
  assert.equal(task.trace.run_id,null);assert.equal(task.trace.handoff_id,'handoff-task-demo-001');
  assert.equal(task.risk,'UNVERIFIED');assert.equal(task.canExecute,false);
});
for(const state of ['PENDING_RISK','PENDING_APPROVAL','READY_FOR_SIMULATION','SIMULATED','REJECTED','EXPIRED','MODEL_FAILED','FUNDING_BLOCKED','CANCELLED']){
  test('task phase remains independent: '+state,()=>{
    const data=fixture('review');data.status=state;
    const task=projectCore(data,'review');
    assert.equal(task.status,state==='SIMULATED'?'UNKNOWN':state);
    assert.equal(taskPresentation(task).canExecute,false);assert.equal(task.risk,'UNVERIFIED');
  });
}
test('all six trace identifiers reject mismatches without inventing aliases',()=>{
  for(const key of ['request_id','task_id','session_id','run_id','audit_id','handoff_id']){
    const d=fixture('review');const existing=traceOf(d)[key];d.trace={[key]:'wrong'};
    assert.ok(existing);assert.throws(()=>projectCore(d,'review'),/追踪/);
  }
});
test('audit events from another task are rejected; historical request provenance is retained',()=>{
  const d=fixture('review');d.audit.events[0].task_id='other';assert.throws(()=>projectCore(d,'review'),/审计/);
  const good=fixture('review');good.audit.events[0].payload.request_id='original-request';
  assert.equal(projectCore(good,'review').events[0].trace.request_id,'original-request');
});
for(const [raw,expected] of [['APPROVE','ALLOW'],['REQUEST_MORE_INFO','REVIEW'],['REJECT','BLOCK']]){
  test('business Risk mapping retains Owner authentication boundary: '+raw,()=>{
    const d=fixture('review');d.risk_decision={task_id:d.task_id,proposal_sha256:d.plan_hash,decision:raw,reason:'test',auth:{verified:false,mode:'DEMO_UNVERIFIED'}};
    let p=projectCore(d,'review');assert.equal(p.reportedRisk,expected);assert.equal(p.risk,'UNVERIFIED');
    d.risk_decision.auth.verified=true;p=projectCore(d,'review');assert.equal(p.risk,expected);
    assert.equal(taskPresentation(p,{stale:true}).risk,'UNVERIFIED');assert.equal(p.canExecute,false);
  });
}
test('receipt must bind task, execution, plan hash, mode and side effects',()=>{
  const d=fixture('review');d.status='SIMULATED';d.execution={task_id:d.task_id,execution_id:'test-exec',status:'SIMULATED',execution_allowed:false,
    receipt:{task_id:d.task_id,execution_id:'test-exec',proposal_sha256:d.plan_hash,mode:'SIMULATED',side_effects:false}};
  assert.equal(projectCore(d,'review').receipt.execution_id,'test-exec');
  for(const [key,value] of [['task_id','other'],['execution_id','other'],['proposal_sha256','other'],['mode','LIVE'],['side_effects',true]]){
    const wrong=structuredClone(d);wrong.execution.receipt[key]=value;assert.throws(()=>projectCore(wrong,'review'),/回执/);
  }
});
test('expiry, source changes and service errors independently stop the next step',()=>{
  const task={status:'READY_FOR_SIMULATION',risk:'ALLOW',expiresAt:'2026-01-01T00:00:00Z'};
  assert.equal(taskPresentation(task,{now:Date.parse('2026-10-27')}).expired,true);
  assert.equal(taskPresentation(task,{unavailable:true}).risk,'UNVERIFIED');
  assert.equal(taskPresentation({...task,status:'EXPIRED'}).label,'审批已过期');
});
test('candidate task is never formal Risk, approval or execution',()=>{
  const p=projectCandidate({id:'local-task-1',mode:'LOCAL_CANDIDATE',status:'WAITING_OWNER_RISK',risk:'ALLOW',execution_allowed:true});
  assert.equal(p.risk,'UNVERIFIED');assert.equal(p.execution_allowed,false);assert.equal(p.trace.audit_id,null);
});
test('consent binds question, scope, snapshot revision and goal',()=>{
  const base=scopeFingerprint('问题',{portfolio:{id:'p',revision:'1'}},{name:'备用金'});
  for(const changed of [scopeFingerprint('问题2',{portfolio:{id:'p',revision:'1'}},{name:'备用金'}),
    scopeFingerprint('问题',{}, {name:'备用金'}),scopeFingerprint('问题',{portfolio:{id:'p',revision:'2'}},{name:'备用金'}),
    scopeFingerprint('问题',{portfolio:{id:'p',revision:'1'}},{name:'其他目标'})])assert.notEqual(base,changed);
});
test('configured status and HTTP 200 alone do not prove a real provider response',()=>{
  assert.equal(modelEvidence({mode:'REAL_MODEL',model:'qwen3.8-flash',provider:{http_status:200}}).real,false);
  assert.equal(modelEvidence({mode:'DEMO',provider:{http_status:200,provider_response_id:'test'}}).real,false);
  assert.equal(modelEvidence({mode:'REAL_MODEL',model:'UNIT_TEST_FIXTURE',provider:{http_status:200,provider_response_id:'unit-only',duration_ms:25}}).real,true);
});
test('legacy projection also refuses live, unbound or side-effectful success receipts',()=>{
  assert.equal(executionView({status:'SUCCEEDED',receipt:{task_id:'t',execution_id:'e',side_effects:true}},'t').state,'UNKNOWN');
  assert.equal(executionView({status:'SIMULATED',receipt:{task_id:'other',execution_id:'e',mode:'SIMULATED',side_effects:false}},'t').state,'UNKNOWN');
  assert.equal(executionView({status:'SIMULATED',receipt:{task_id:'t',execution_id:'e',mode:'SIMULATED',side_effects:false}},'t').state,'SUCCEEDED');
});
test('live mode, mismatched plans and execution authority are refused at the adapter boundary',()=>{
  for(const mutate of [d=>d.execution_mode='LIVE',d=>d.execution.execution_allowed=true,d=>d.risk_handoff.execution_allowed=true,
    d=>d.plan_hash='other',d=>d.execution.task_id='other',d=>d.risk_handoff.evidence.proposal_sha256='other']){
    const d=fixture('review');mutate(d);assert.throws(()=>projectCore(d,'review'));
  }
});
