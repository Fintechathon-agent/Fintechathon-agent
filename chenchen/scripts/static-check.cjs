'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {chromium}=require('playwright'),{build,sha256}=require('./build-static.cjs');
const tools=require('../tools/financial-tools'),{MerchantSession}=require('../merchant/ledger');
async function main(){
  const dist=build(),report=[],networkApi=[];
  for(const input of ['', 'abc','中文金融 💰','a'.repeat(55),'a'.repeat(56),'b'.repeat(64),'c'.repeat(100000)])assert.equal(sha256(input),crypto.createHash('sha256').update(input).digest('hex'));
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/'))networkApi.push(url.pathname);
    let name=decodeURIComponent(url.pathname.replace(/^\/demo\//,''));if(!name||name==='/')name='index.html';
    const file=path.resolve(dist,name),relative=path.relative(dist,file);
    if(relative.startsWith('..')||path.isAbsolute(relative)){res.writeHead(404).end();return;}
    fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(data);});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({channel:'chrome',args:['--disable-gpu']});
  const base='http://127.0.0.1:'+server.address().port+'/demo/';
  try{for(const width of [1440,1024,375]){
    const context=await browser.newContext({viewport:{width,height:width===375?844:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(base);await page.waitForURL('**/landing.html');assert(await page.locator('#story-title').isVisible());
    const call=async(url,body)=>page.evaluate(async({url,body})=>{const r=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};},{url,body});
    assert.deepEqual((await call('/api/demo/portfolio')).data,tools.validatePortfolio(tools.getDemoPortfolio()),'browser SHA-256 and portfolio envelope match Node');
    assert.deepEqual((await call('/api/simulation/run',{})).data.output,tools.runSimulation().output,'simulation is identical to Node');
    assert.deepEqual((await call('/api/merchant/ledger')).data,new MerchantSession().summary(0),'ledger and forecast match Node');
    assert.equal((await call('/api/unknown')).status,404);assert.equal((await call('/api/task/missing')).status,404);assert.equal((await call('/api/paper-trade/execute',{})).status,503);assert.equal((await call('/api/session/init',[])).status,400);
    const invalid=await page.evaluate(async()=>{const r=await fetch('/api/session/init',{method:'POST',body:'{'});return {status:r.status,data:await r.json()};});assert.equal(invalid.status,400);assert.equal(invalid.data.error.code,'INVALID_JSON');
    const oversize=await page.evaluate(async()=>{const r=await fetch('/api/session/init',{method:'POST',body:'x'.repeat(1024*1024+1)});return r.status;});assert.equal(oversize,413);
    await page.getByRole('link',{name:'探索投资工作台'}).click();await page.locator('#run:not([disabled])').waitFor();
    assert.match(await page.locator('#portfolio-total').innerText(),/31,080\.00/);await page.locator('#demo-profile').click();await page.locator('#run').click();await page.locator('#results:not([hidden])').waitFor();
    assert.equal(await page.locator('.plan-card').count(),3);await page.locator('.plan-card summary').first().click();assert(await page.locator('.weight-list').first().isVisible());
    await page.getByText('任务状态与工具证据',{exact:true}).click();const downloaded=page.waitForEvent('download');await page.locator('#export').click();const download=await downloaded;assert.equal(download.suggestedFilename(),'portfolio-analysis.json');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.locator('.workspace-switch a').filter({hasText:'店主财务助手'}).click();await page.locator('#quick-bills .evidence').first().waitFor();
    assert.match(await page.locator('#merchant-status').innerText(),/6,200\.00/);await page.locator('#quick-bills .evidence').first().click();await page.locator('#bill-dialog[open]').waitFor();await page.locator('#close-dialog').click();await page.locator('#confirm').check();await page.locator('#review').click();await page.locator('#insights .insight').first().waitFor();
    const exported=await call('/api/merchant/export?type=review');assert.equal(exported.status,200);assert(exported.data.review.notices.length>0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.reload();await page.locator('#quick-bills .evidence').first().waitFor();assert(await page.locator('#review').isDisabled(),'refresh resets demo session');
    await page.goto(base+'catalog.html');assert.equal(await page.locator('a[href="investment.html"]').count()>0,true);
    await page.goto(base+'not-found.html');assert.equal(await page.locator('a[href="merchant.html"]').count()>0,true);
    assert.deepEqual(errors,[]);report.push({width,status:'passed',apiNetworkRequests:0,cryptoParity:true,simulationParity:true,flows:2,export:true});console.log('PASS static '+width);await context.close();
  }
  assert.deepEqual(networkApi,[],'all API requests run in the browser');
  }finally{await browser.close();await new Promise(r=>server.close(r));}
  fs.mkdirSync(path.resolve(__dirname,'../artifacts/static'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../artifacts/static/report.json'),JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
