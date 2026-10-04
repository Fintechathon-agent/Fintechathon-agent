"use strict";
const test=require('node:test'), assert=require('node:assert/strict');
const tools=require('../tools/financial-tools');
const {Harness}=require('../core/harness');
const profile={investment_horizon_days:365,max_drawdown:.1,liquidity_need:'medium'};
test('numeric strings, mismatched replay dates and missing snapshot amounts are rejected',()=>{
  for(const change of [p=>p.cash='10000',p=>p.as_of='2025-01-01',p=>p.positions[0].price=999]){
    const p=tools.getDemoPortfolio();change(p);assert.equal(tools.validatePortfolio(p).output.valid,false);
  }
  const p=tools.validatePortfolio(tools.getDemoPortfolio()).output.snapshot;
  delete p.positions[0].market_value;assert.throws(()=>tools.diagnosePortfolio(p),{code:'INVALID_PORTFOLIO'});
});
test('negative correlation is not labelled as same-direction concentration; cash is separate',()=>{
  const r=tools.diagnosePortfolio().output;
  assert.ok(Object.values(r.correlation_matrix).some(row=>Object.values(row).some(v=>v<-.8)));
  assert.ok(r.hidden_clusters.every(c=>c.correlation>=.8));
  assert.notEqual(r.concentration.largest_instrument,'CASH');
});
test('net return equals curve endpoint and holding A matches baseline scenarios exactly',()=>{
  const s=tools.runSimulation().output;
  for(const c of s.comparisons) assert.ok(Math.abs(c.metrics.cumulative_return-(c.curve.at(-1).value-1))<1e-7);
  assert.equal(s.comparisons[1].turnover,0);assert.equal(s.comparisons[1].transaction_cost,0);
  assert.deepEqual(s.scenarios[0].distribution,s.scenarios[1].distribution);
});
test('C includes the price path of a new bond holding even when the original portfolio lacks it',()=>{
  const p=tools.getDemoPortfolio();p.cash+=p.positions.find(p=>p.instrument_id==='ETF_BOND').quantity*40.5;
  p.positions=p.positions.filter(p=>p.instrument_id!=='ETF_BOND');delete p.total_value;
  const candidates=tools.generateCandidates(p).output.candidates;
  assert.ok(candidates[2].target_weights.ETF_BOND>0);
  const curve=tools.runSimulation(p,candidates).output.comparisons[3].curve;
  assert.equal(curve[0].value,1);assert.ok(curve.every(p=>Number.isFinite(p.value)));
});
test('stale or fabricated health reports do not influence strategy generation',()=>{
  const p=tools.validatePortfolio().output.snapshot,r=tools.diagnosePortfolio(p).output;
  r.hidden_clusters=[];assert.throws(()=>tools.generateCandidates(p,r),{code:'INVALID_REPORT'});
});
test('changing inputs invalidates cached artifacts; identical completed requests reuse the result',()=>{
  const h=new Harness(),p=tools.getDemoPortfolio();
  const first=h.runHealthCheck({risk_profile:profile,portfolio:p});
  assert.deepEqual(h.runHealthCheck({task_id:first.task_state.task_id}),first);
  p.cash+=1000;delete p.total_value;
  const second=h.runHealthCheck({task_id:first.task_state.task_id,portfolio:p});
  assert.equal(second.artifacts.portfolio_snapshot.cash,11000);
  assert.notEqual(second.artifacts.portfolio_snapshot.snapshot_id,first.artifacts.portfolio_snapshot.snapshot_id);
  assert.equal(Object.keys(second.tool_results).length,4);
  assert.ok(h.getAudit(first.task_state.task_id).events.some(e=>e.event_type==='checkpoint.invalidated'));
});
test('clearing risk preferences requests clarification and unknown tasks are not recreated',()=>{
  const h=new Harness(),s=h.runHealthCheck({risk_profile:profile});
  assert.equal(h.runHealthCheck({task_id:s.task_state.task_id,risk_profile:null}).task_state.status,'WAITING_INPUT');
  assert.throws(()=>h.runHealthCheck({task_id:'missing'}),/task not found/);
  assert.throws(()=>h.createSession({risk_profile:{...profile,max_drawdown:'0.1'}}),/max_drawdown/);
});
test('the circuit breaker stops repeated tool failure instead of running forever',()=>{
  let calls=0;const h=new Harness({toolset:{...tools,diagnosePortfolio:()=>{calls++;throw new Error('offline');}}});
  const s=h.createSession({risk_profile:profile}),id=s.task_state.task_id;
  assert.throws(()=>h.runHealthCheck({task_id:id}),/offline/);
  assert.throws(()=>h.runHealthCheck({task_id:id}),/offline/);
  assert.equal(h.getTask(id).task_state.status,'CIRCUIT_OPEN');
  assert.throws(()=>h.runHealthCheck({task_id:id}),/circuit is open/);assert.equal(calls,4);
});
