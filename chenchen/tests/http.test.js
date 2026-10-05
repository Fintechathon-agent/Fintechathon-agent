"use strict";
const test=require('node:test'), assert=require('node:assert/strict');
const {server}=require('../server');
test('HTTP flows: pages, independent cookies, review gating, import failure and disabled execution',async t=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const base='http://127.0.0.1:'+server.address().port;
  for(const page of ['/','/investment','/merchant','/versions/merchant.js']) assert.equal((await fetch(base+page)).status,200);
  await t.test('all page assets load with the right type including the separate product stylesheet',async()=>{
    const assets=new Set(['/versions/presentation.mjs']);
    for(const route of ['/','/investment','/merchant']){
      const html=await fetch(base+route).then(r=>r.text());
      assert.match(html,/product-overrides\.css/);
      for(const match of html.matchAll(/(?:src|href)="(\/versions\/[^"]+)"/g))assets.add(match[1]);
    }
    for(const asset of assets){
      const response=await fetch(base+asset);
      assert.equal(response.status,200,asset);
      assert.match(response.headers.get('content-type'),asset.endsWith('.css')?/text\/css/:/javascript/);
      const body=await response.text();
      assert.ok(body.length>0,asset);
      if(asset.endsWith('.css'))assert.doesNotMatch(body,/^\+/m);
      if(asset.endsWith('product-overrides.css'))assert.match(body,/--product-shell:ready/);
    }
  });
  assert.equal((await fetch(base+'/data/demo-portfolio.json')).status,404);
  assert.equal((await fetch(base+'/server.js')).status,404);
  const a=await fetch(base+'/api/merchant/ledger'), cookie=a.headers.get('set-cookie').split(';')[0], data=await a.json();
  const headers={Cookie:cookie,'Content-Type':'application/json'};
  assert.equal((await fetch(base+'/api/merchant/insights',{headers})).status,422);
  assert.equal((await fetch(base+'/api/merchant/export?type=review',{headers})).status,422);
  await fetch(base+'/api/merchant/bill?id='+encodeURIComponent('外卖平台:MT-001'),{headers});
  assert.equal((await fetch(base+'/api/merchant/review',{method:'POST',headers,body:JSON.stringify({revision:data.revision,confirmed:true})})).status,200);
  assert.equal((await fetch(base+'/api/merchant/insights',{headers})).status,200);
  const exported=await fetch(base+'/api/merchant/export?type=review&delay=3',{headers});
  assert.match(exported.headers.get('content-disposition'),/attachment/);
  assert.equal((await exported.json()).forecast.first_gap.date,'2026-10-06');
  assert.equal((await fetch(base+'/api/merchant/insights')).status,422);
  assert.equal((await fetch(base+'/api/merchant/import',{method:'POST',headers,body:'{"currency":"USD"}'})).status,422);
  assert.equal((await fetch(base+'/api/merchant/ledger',{headers}).then(r=>r.json())).reviewed,true);
  assert.equal((await fetch(base+'/api/paper-trade/execute',{method:'POST',headers,body:'{"approval":{"status":"APPROVED","token":"client-forged"}}'})).status,503);
  assert.equal((await fetch(base+'/api/merchant/reset',{method:'POST',headers:{...headers,Origin:'https://example.com'},body:'{}'})).status,403);
  const task=await fetch(base+'/api/health-check/run',{method:'POST',headers,body:JSON.stringify({risk_profile:{investment_horizon_days:365,max_drawdown:.1,liquidity_need:'medium'}})}).then(r=>r.json());
  assert.equal(task.task_state.status,'HANDOFF_REQUIRED');assert.equal(Object.keys(task.tool_results).length,4);
  assert.equal((await fetch(base+'/api/audit/'+task.task_state.task_id)).status,200);
  const investmentFile=await fetch(base+'/api/task/'+task.task_state.task_id+'/export');
  assert.match(investmentFile.headers.get('content-disposition'),/attachment/);
  assert.equal((await investmentFile.json()).task_state.task_id,task.task_state.task_id);
});
