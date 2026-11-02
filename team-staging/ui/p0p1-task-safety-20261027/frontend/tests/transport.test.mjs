import test from 'node:test';
import assert from 'node:assert/strict';
import {createTransport} from '../versions/workspace-api.mjs';
for(const code of [401,403,409,423,404,429])test('HTTP '+code+' stays stopped and does not expose upstream text',async()=>{
  let calls=0;const api=createTransport(async()=>{calls++;return Response.json({error:{code:'DENIED',message:'private diagnostic must not render'}},{status:code});});
  await assert.rejects(api('/api/task/a'),e=>e.status===code&&!e.message.includes('private'));
  assert.equal(calls,1);
});
test('concurrent duplicate submissions share one request without automatic retry',async()=>{
  let calls=0,release;const api=createTransport(async()=>{calls++;await new Promise(r=>release=r);return Response.json({task_id:'existing'});});
  const a=api('/api/assistant/workspace/analysis',{body:{requestId:'same'}}),b=api('/api/assistant/workspace/analysis',{body:{requestId:'same'}});
  assert.equal(a,b);release();assert.deepEqual(await a,{task_id:'existing'});await b;assert.equal(calls,1);
});
test('timeout and lost network acknowledgement remain UNKNOWN and do not retry',async()=>{
  let calls=0;const api=createTransport(async()=>{calls++;return new Promise(()=>{});},15);
  await assert.rejects(api('/api/assistant/workspace/analysis',{body:{requestId:'original'}}),e=>e.unknown&&e.code==='TIMEOUT');
  assert.equal(calls,1);
  const offline=createTransport(async()=>{throw new TypeError('offline');});
  await assert.rejects(offline('/api/assistant/workspace/task',{body:{analysisId:'original'}}),e=>e.unknown);
});
test('HTML or invalid JSON cannot become a success result',async()=>{
  const api=createTransport(async()=>new Response('<html>static fallback</html>',{headers:{'content-type':'text/html'}}));
  await assert.rejects(api('/api/task/a'),e=>e.code==='INVALID_RESPONSE');
});
test('transport rejects cross-origin, undeclared base paths and traversal',()=>{
  const api=createTransport();for(const path of ['https://other/api/task/a','//other/api/task/a','/api/../secret','/other'])assert.throws(()=>api(path));
});
