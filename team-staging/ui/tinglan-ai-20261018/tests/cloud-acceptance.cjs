'use strict';
// Manual cloud acceptance. Persist attempts before sending; never retry paid calls.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
(async () => {
  const browserOnly=process.argv.includes('--browser-only');
  const live = process.argv.includes(browserOnly?'--authorized-cloud-calls=1':'--authorized-cloud-calls=2');
  if(browserOnly&&!live)throw new Error('Explicit one-call browser authorization required.');
  const root = path.resolve(__dirname, '..'), base = 'https://xinlan-qwen38-share.lixjanus526.workers.dev';
  const privateFile = path.join(require('node:os').homedir(), '.codex/secrets/finance-lab-share/server-auth.json');
  const secrets = JSON.parse(fs.readFileSync(privateFile, 'utf8'));
  const fixed=process.argv.includes('--after-transport-fix');
  const sessionFixed=process.argv.includes('--after-session-fix');
  const file = path.join(root, 'evidence', browserOnly?(sessionFixed?'cloud-browser-final-20261020.json':'cloud-browser-20261020.json'):live ? (fixed?'cloud-live-fixed-20261020.json':'cloud-live-20261020.json') : 'cloud-preflight-20261020.json');
  assert(!fs.existsSync(file), 'Evidence exists; refusing an accidental rerun.');
  const report = { timestamp:new Date().toISOString(), base, model:'qwen3.8-flash', scope:live?'REAL_CLOUDFLARE_CHAIN':'NO_PROVIDER_PREFLIGHT', attempts:0, steps:[], mainlandNetworkVerified:false };
  const save = () => { const text=JSON.stringify(report,null,2);for(const value of Object.values(secrets))assert(!text.includes(value),'Credential detected');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text+'\n'); };
  const request = async (route, options={}) => { const started=performance.now();const r=await fetch(base+route,{...options,signal:AbortSignal.timeout(40000)});const data=await r.json();return {r,data,durationMs:Math.round(performance.now()-started)}; };
  let browser;
  try {
    const health=await request('/health'); assert.equal(health.r.status,200);assert.equal(health.data.configured,true);assert.equal(health.data.paidEnabled,live);report.health=health.data;
    const anonymous=await request('/api/review',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Core-Agent-Key':'forged'},body:'{}'});assert.equal(anonymous.r.status,401);
    const cross=await request('/api/session',{method:'POST',headers:{Origin:'https://invalid.example','Content-Type':'application/json'},body:'{}'});assert.equal(cross.r.status,403);
    if(!browserOnly){
    const login=await request('/api/session',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({code:secrets.SHARE_ACCESS_CODE})});assert.equal(login.r.status,200);
    const cookie=login.r.headers.get('set-cookie');assert(cookie.includes('HttpOnly')&&cookie.includes('Secure')&&cookie.includes('SameSite=Strict'));
    report.security={anonymous:401,forgedMachineBypassBlocked:true,crossOrigin:403,login:200,httpOnly:true,secure:true,sameSiteStrict:true};save();
    if(live){
      const {buildInput,readResult}=await import(pathToFileURL(path.join(root,'frontend/client.mjs')));
      const body=buildInput({amount:'1000',horizon:'365',risk:'low',drawdown:'',goal:'学习储蓄原则',inputMode:'sample',liquidity:'high',text:'虚构示例，仅分析低风险偏好和备用金研究思路，不提供交易指令。',consent:true},require('node:crypto').randomUUID());
      report.attempts++;save();
      const direct=await request('/api/review',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie.split(';')[0]},body:JSON.stringify(body)});
      report.steps.push({phase:'authenticated-cloud-server-to-bailian',http:direct.r.status,durationMs:direct.durationMs,body:direct.data});save();
      assert.equal(direct.r.status,200);readResult(direct.data,'qwen3.8-flash');
    }
    }
    const proxyUrl=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;
    const proxy=proxyUrl?new URL(proxyUrl):null;
    browser=await require('playwright').chromium.launch({channel:'chrome',...(proxy?{proxy:{server:proxy.origin,...(proxy.username?{username:decodeURIComponent(proxy.username),password:decodeURIComponent(proxy.password)}:{})}}:{})});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];page.on('pageerror',e=>errors.push(e.name));
    report.stage='page-load';save();
    await page.goto(base+'/investment-only/investment.html#ai-assistant',{waitUntil:'domcontentloaded',timeout:45000});
    await page.locator('#share-login').waitFor({state:'visible'});
    report.stage='browser-login';save();await page.locator('#share-login [name=code]').fill(secrets.SHARE_ACCESS_CODE);
    await page.locator('#share-login button').click();await page.locator('#tinglan-form').waitFor({state:'visible'});
    assert.equal(await page.locator('#share-login [name=code]').inputValue(),'');report.browserLogin=true;report.pageErrors=errors;
    if(live){
      for(const [name,value] of Object.entries({amount:'10000',horizon:'1095',goal:'制定未来三年的投资计划',text:'我是一名中国大学生，目前有10000元闲置资金，风险承受能力中低，希望制定未来三年的投资计划，请分析我的投资偏好、资金配置思路和风险。'}))await page.locator('#tinglan-form [name='+name+']').fill(value);
      await page.locator('[name=risk]').selectOption('medium_low');await page.locator('[name=liquidity]').selectOption('medium');await page.locator('[name=inputMode]').selectOption('self_reported');await page.locator('[name=consent]').check();
      report.stage='browser-model-request';report.attempts++;save();const started=performance.now();
      const [response]=await Promise.all([page.waitForResponse(r=>r.url()===base+'/api/review'&&r.request().method()==='POST',{timeout:40000}),page.locator('#tinglan-form button').click()]);const data=await response.json();
      report.steps.push({phase:'browser-worker-bailian',http:response.status(),durationMs:Math.round(performance.now()-started),body:data});save();assert.equal(response.status(),200);
      await page.locator('#tinglan-result').waitFor({state:'visible',timeout:5000});
      assert.equal(await page.locator('[data-result=summary]').innerText(),data.model.model_response.proposal.summary);
      const raw=JSON.parse(data.model.model_response.raw_text);assert.equal(await page.locator('[data-result=reason]').innerText(),raw.action_reason);
      assert.equal(data.model.source,'model');assert.equal(data.model.model_response.call_succeeded,true);assert.equal(data.model.model_response.model,'qwen3.8-flash');
      report.browser={visible:true,matchesModelRaw:true,meta:await page.locator('[data-result=meta]').innerText(),status:await page.locator('#tinglan-status').innerText()};
      await page.locator('#ai-assistant').screenshot({path:path.join(root,'evidence/cloud-live-20261020.png')});
    }
    await page.locator('#share-logout').click();await page.locator('#share-login').waitFor({state:'visible'});report.logout=true;assert.equal(errors.length,0);
    report.result=live?'REAL_CLOUD_BROWSER_CHAIN_PASSED':'CLOUD_PREFLIGHT_PASSED';save();console.log(JSON.stringify({result:report.result,attempts:report.attempts,evidence:file}));
  }catch(e){report.result='FAILED';report.error={name:e.name,code:e.code||null};save();console.error(JSON.stringify({result:report.result,attempts:report.attempts,evidence:file,error:report.error}));process.exitCode=1;}
  finally{await browser?.close();}
})();
