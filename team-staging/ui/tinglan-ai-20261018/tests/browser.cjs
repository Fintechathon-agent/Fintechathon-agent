'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');const {chromium}=require('playwright');
(async()=>{
 const moduleRoot=path.resolve(__dirname,'..'),root=path.join(moduleRoot,'public');
 const {createGateway}=await import(pathToFileURL(path.join(moduleRoot,'gateway.mjs')));
 const core=(await import(pathToFileURL(path.resolve(moduleRoot,'../../../chenchen/deployment/worker.js')))).default;
 const {ReviewService}=await import(pathToFileURL(path.join(moduleRoot,'worker-entry.mjs')));
 let mode='success',app,networkRequests=0,providerCalls=0;
 const originalFetch=global.fetch;
 global.fetch=async(_url,options)=>{providerCalls++;await new Promise(resolve=>setTimeout(resolve,200));
  if(mode==='timeout')throw new DOMException('synthetic timeout','AbortError');
  if(mode==='invalid')return new Response('{');
  if(mode==='provider-auth')return new Response('{}',{status:401});
  if(mode==='network')throw new TypeError('synthetic network failure');
  const sent=JSON.parse(options.body);assert.match(options.body,/investment_horizon_days/);
  return Response.json({model:sent.model,id:'MOCK-BROWSER',usage:{prompt_tokens:80,completion_tokens:40,total_tokens:120},choices:[{message:{content:JSON.stringify({summary:'MOCK：你这 1 万元三年不用，建议七成中短债、两成宽基、一成货币基金，先保住本金。',risk_level:'medium',proposed_action:'HOLD_FOR_REVIEW',action_reason:'MOCK：你这 1 万元三年内不用，可以这样放：7000 元放中短债基金，2000 元定投宽基指数，1000 元留货币基金当备用金。\n这么放是因为你自述中低风险，1 万元按最差跌 5% 算最多亏 500 元。\n代价是一年收益大概 3% 到 6%，想靠它赚大钱不现实。\n你要是三年里随时要用钱，那 2000 元的定投就先停掉。',missing_information:['这笔钱三年内会不会动用'],evidence:['投资金额：10000 元','自述风险偏好：中低']})}}]});
 };
 function reset(){const data=new Map();const storage={get:async key=>structuredClone(data.get(key)),put:async(key,value)=>{for(const [k,v]of Object.entries(typeof key==='string'?{[key]:value}:key))data.set(k,structuredClone(v));}};
  const env={MODEL_PROVIDER:'aliyun_bailian',MODEL_NAME:'qwen3.8-flash',MODEL_MAX_ATTEMPTS:'1',MODEL_TIMEOUT_MS:'30000',DASHSCOPE_API_KEY:'synthetic-browser-key',CORE_AGENT_API_KEY:'synthetic-machine-key',BAILIAN_WORKSPACE_ID:'synthetic-workspace',BAILIAN_ALLOW_PAID_CALLS:'true',BAILIAN_TEST_BUDGET_CNY:'0.05',BAILIAN_MAX_OUTPUT_TOKENS:'800'};
  const service=new ReviewService({storage},env);env.REVIEW_SERVICE={idFromName:x=>x,get:()=>service};app={env,gateway:createGateway(core,async()=>{if(mode==='auth')throw new Error('AUTHENTICATION_REQUIRED');return 'b'.repeat(64);})};
 }
 const server=http.createServer(async(req,res)=>{
  const base='http://127.0.0.1:'+server.address().port,url=new URL(req.url,base);
  if(url.pathname==='/investment-only/tinglan-config.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(mode==='unconfigured'?{endpoint:null}:{endpoint:'/api/review',model:'qwen3.8-flash',mode:'CLOUDFLARE_ACCESS'}));}
  if(url.pathname==='/api/review'){
   networkRequests++;if(mode==='rate'){res.writeHead(429,{'Content-Type':'application/json'});return res.end('{}');}
   const chunks=[];for await(const c of req)chunks.push(c);const response=await app.gateway.fetch(new Request(url,{method:req.method,headers:req.headers,body:Buffer.concat(chunks)}),app.env);
   res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(await response.text());
  }
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}
  fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'chrome'}),report=[];
 try{for(const width of [1440,1024,375]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const open=async()=>{reset();await page.goto(base+'/investment-only/investment.html');await page.locator('#tinglan-form button:not([disabled])').waitFor();
   await page.locator('[name=amount]').fill('10000');await page.locator('[name=risk]').selectOption('medium_low');await page.locator('[name=goal]').fill('三年学习生活备用金');await page.locator('[name=inputMode]').selectOption('sample');
   await page.locator('[name=horizon]').fill('365');await page.locator('[name=drawdown]').fill('10');await page.locator('[name=liquidity]').selectOption('medium');await page.locator('[name=text]').fill('虚构示例：请分析备用金需求。');await page.locator('[name=consent]').check();};
  mode='success';await open();const before=networkRequests;await page.locator('#tinglan-form button').click();assert.equal(await page.locator('#tinglan-form').getAttribute('aria-busy'),'true');await page.locator('#tinglan-result:not([hidden])').waitFor();
  assert.equal(networkRequests,before+1);assert.match(await page.locator('[data-result=summary]').innerText(),/MOCK/);assert.match(await page.locator('[data-result=meta]').innerText(),/qwen3.8-flash/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.locator('#demo-profile').click();await page.locator('#run').click();await page.locator('#results:not([hidden])').waitFor();assert.equal(await page.locator('.plan-card').count(),3);
  for(const [scenario,message] of [['auth','登录'],['rate','上限'],['timeout','超时'],['invalid','格式'],['network','不可用'],['provider-auth','鉴权'],['unconfigured','待团队管理员配置']]){
   mode=scenario;await open();const count=providerCalls;await page.locator('#tinglan-form button').click();await page.locator('#tinglan-status[role=alert]').waitFor();assert.match(await page.locator('#tinglan-status').innerText(),new RegExp(message));assert.equal(await page.locator('#tinglan-result').isVisible(),false);if(['auth','rate','unconfigured'].includes(scenario))assert.equal(providerCalls,count);
  }
  assert.deepEqual(errors,[]);report.push({width,status:'passed',mode:'MOCK_ONLY',realPaidCalls:0,normalResponse:true,deterministicPlans:3,failures:7});await page.close();
 }
 fs.mkdirSync(path.join(moduleRoot,'evidence'),{recursive:true});fs.writeFileSync(path.join(moduleRoot,'evidence/browser-mock.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{global.fetch=originalFetch;await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
