import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const events=new EventTarget();
globalThis.addEventListener=events.addEventListener.bind(events);globalThis.dispatchEvent=events.dispatchEvent.bind(events);
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),clear:()=>map.clear()};};
globalThis.localStorage=storage();globalThis.sessionStorage=storage();globalThis.location={hostname:'github.io'};
globalThis.fetch=async()=>Response.json({error:{code:'NOT_CONNECTED'}},{status:403});
const key='finance-workspace-drafts.v1:'+new URL('../',new URL('../versions/workspace-store.mjs',import.meta.url)).pathname;
test('tampered local storage cannot restore service results, identity, Risk or receipts',async()=>{
  localStorage.setItem(key,JSON.stringify({version:1,user:{role:'ADMIN',verified:true},drafts:{question:'keep draft'},goals:{},
    analyses:[{id:'server-analysis',mode:'REAL_MODEL'}],tasks:[{id:'server-task',mode:'CORE_SERVICE',risk:'ALLOW'},
      {id:'draft-task-test',mode:'CORE_SERVICE',risk:'ALLOW',execution_allowed:true,receipt:{status:'success'}}],events:[{id:'server-event',mode:'CORE_SERVICE'}]}));
  const store=await import('../versions/workspace-store.mjs?test=untrusted');const state=store.getState();
  assert.equal(state.user.verified,false);assert.equal(state.user.role,'UNKNOWN');assert.equal(state.analyses.length,0);assert.equal(state.events.length,0);
  assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].mode,'BROWSER_DRAFT');assert.equal(state.tasks[0].execution_allowed,false);assert.equal(state.tasks[0].receipt,null);
  assert.equal(state.drafts.question,'keep draft');
});
test('only service references survive refresh; read projections are not stored',async()=>{
  localStorage.clear();sessionStorage.clear();const store=await import('../versions/workspace-store.mjs?test=refs');
  const data=JSON.parse(fs.readFileSync(new URL('./fixtures/health.json',import.meta.url),'utf8'));
  store.rememberServiceRecord(data);assert.equal(store.getState().tasks[0].id,data.task_state.task_id);
  assert.equal(localStorage.getItem(key),null);const restored=await import('../versions/workspace-store.mjs?test=refresh');
  assert.equal(restored.getState().tasks.length,0);assert.ok(sessionStorage.getItem(key+':service-refs').includes('task-demo-001'));
  store.invalidateContext();store.rememberServiceRecord(data);
  assert.equal(store.getState().tasks[0].inputStale,true);
  assert.equal(JSON.parse(sessionStorage.getItem(key+':service-refs'))[0].stale,true);
  const replay=await import('../versions/workspace-store.mjs?test=stale-replay');replay.rememberServiceRecord(data);
  assert.equal(replay.getState().tasks[0].inputStale,true);
});
test('failed source reads clear old provider success and never render local task as formal',async()=>{
  localStorage.clear();sessionStorage.clear();globalThis.location.hostname='127.0.0.1';
  globalThis.fetch=async()=>Response.json({error:{code:'NOT_CONNECTED'}},{status:403});
  const store=await import('../versions/workspace-store.mjs?test=failure');
  store.sourceState.workspace={analyses:[{id:'old-result',mode:'REAL_MODEL'}],tasks:[],events:[]};store.sourceState.connections.analysis='READY';
  await store.readSources();
  assert.equal(store.sourceState.workspace,null);assert.equal(store.sourceState.connections.analysis,'NOT_CONNECTED');
  assert.equal(store.sourceState.errors.analysis.status,403);assert.equal(store.getState().tasks.length,0);
});
