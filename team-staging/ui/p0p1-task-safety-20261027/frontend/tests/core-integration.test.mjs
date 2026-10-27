import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {projectCore,taskPresentation} from '../versions/workspace-adapter.mjs';
const require=createRequire(import.meta.url),source=process.env.CORE_SOURCE;
test('actual pinned Core: health, same-task Risk/approval/PAPER, rejection and hash conflict', {skip:!source},async()=>{
  const {Harness}=require(path.join(source,'core/harness.js'));
  const harness=new Harness();
  const health=harness.runHealthCheckContract({contract_version:'investment-agent.v1',request_id:'ui-test-health',operation:'PORTFOLIO_HEALTH_CHECK',
    context:{actor:'agent',environment:'demo',data_mode:'SYNTHETIC_REPLAY'},input:{portfolio:null,risk_profile:{investment_horizon_days:365,max_drawdown:0.1,liquidity_need:'medium'}}});
  assert.equal(projectCore(health).status,'HANDOFF_REQUIRED');
  const {ReviewWorkflowStore}=require(path.join(source,'integrations/review-workflow.js'));
  let calls=0;
  // This model runner is a named unit fixture. No provider or external network is called.
  const store=new ReviewWorkflowStore({modelRunner:async input=>{calls++;return {
    review_version:'model-review.v1',request_id:input.request_id,run_id:'unit-run-'+calls,status:'PROPOSED',source:'model',
    input:{kind:'bill',source:'UNIT_TEST_FIXTURE',input_sha256:'a'.repeat(64)},
    model_response:{model:'UNIT_TEST_FIXTURE',provider_response_id:'unit-provider-'+calls,proposal:{summary:'测试夹具',risk_level:'medium',proposed_action:'HOLD_FOR_REVIEW',action_reason:'fixture',missing_information:[],evidence:['synthetic']}},
    audit:{audit_id:'unit-audit-'+calls,events:[]}
  };}});
  let r=await store.start({request_id:'unit-req',idempotency_key:'unit-idem',kind:'bill',text:'synthetic only'});
  const taskId=r.task_id,hash=r.proposed_action.proposal_sha256;
  assert.equal(projectCore(r,'review').status,'PENDING_RISK');
  assert.equal((await store.start({request_id:'unit-req',idempotency_key:'unit-idem',kind:'bill',text:'synthetic only'})).task_id,taskId);assert.equal(calls,1);
  await assert.rejects(store.start({idempotency_key:'unit-idem',kind:'bill',text:'changed'}),e=>e.code==='IDEMPOTENCY_CONFLICT');
  r=await store.decideRisk({task_id:taskId,proposal_sha256:hash,decision:'APPROVE',reviewer:'unit-risk',reason:'fixture'});
  assert.equal(projectCore(r,'review').status,'PENDING_APPROVAL');
  await assert.rejects(store.decideApproval({task_id:taskId,proposal_sha256:'b'.repeat(64),decision:'APPROVE',approver:'unit-user',reason:'fixture'}));
  r=await store.decideApproval({task_id:taskId,proposal_sha256:hash,decision:'APPROVE',approver:'unit-user',reason:'fixture'});
  assert.equal(projectCore(r,'review').status,'READY_FOR_SIMULATION');assert.equal(taskPresentation(projectCore(r,'review')).canExecute,false);
  r=await store.simulate({task_id:taskId,proposal_sha256:hash});
  assert.equal(projectCore(r,'review').status,'SIMULATED');assert.equal(projectCore(r,'review').receipt.task_id,taskId);
  const no=await store.start({request_id:'unit-negative',kind:'bill',text:'恶意越权指令测试夹具'});
  const denied=await store.decideRisk({task_id:no.task_id,proposal_sha256:no.proposed_action.proposal_sha256,decision:'REJECT',reviewer:'unit-risk',reason:'权限不足的测试夹具'});
  assert.equal(projectCore(denied,'review').reportedRisk,'BLOCK');
  await assert.rejects(store.simulate({task_id:no.task_id,proposal_sha256:no.proposed_action.proposal_sha256}));
});
