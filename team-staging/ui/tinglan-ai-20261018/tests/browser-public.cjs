'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '../public');
  const evidence = process.argv.find(x => x.startsWith('--evidence='))?.slice(11);
  const report = { mode: 'MOCK_UI_ONLY', checks: [], modelRequests: 0, passwordPosts: 0, pageErrors: [] };
  const server = http.createServer((request, response) => {
    const file = path.resolve(root, '.' + new URL(request.url, 'http://local').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-proxy-server'] });
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    let sessionAvailable = true, status = 200, navigation = 0;
    page.on('pageerror', error => report.pageErrors.push(error.message));
    await page.route('**/tinglan-config.json', route => route.fulfill({ json: { endpoint: '/api/review', model: 'qwen3.8-flash', mode: 'SESSION', accessMode: 'PUBLIC' } }));
    await page.route('**/api/session', route => {
      if (route.request().method() !== 'GET') report.passwordPosts++;
      return route.fulfill({ status: sessionAvailable ? 200 : 503, json: { authenticated: sessionAvailable } });
    });
    await page.route('**/api/review', async route => {
      report.modelRequests++;
      const body = route.request().postDataJSON();
      assert.equal(body.context.risk_profile.investment_horizon_days, 365);
      assert.equal(body.context.synthetic, true);
      assert.equal(body.execution_mode, 'PAPER');
      assert.equal(body.allow_rule_fallback, false);
      const proposal = { summary: 'MOCK：已读取本次输入。', action_reason: '资金配置思路：核实备用金。\n投资期限与流动性建议：按用途研究。\n适合进一步研究的资产类别：仅作学习。\n主要风险及注意事项：没有实时行情。', evidence: ['MOCK输入'], missing_information: ['MOCK待核实资料'] };
      await route.fulfill({ status, json: status === 200 ? { status: 'PENDING_RISK', run_id: 'MOCK-PUBLIC', audit: { audit_id: 'MOCK-AUDIT' }, execution: { execution_allowed: false }, model: { source: 'model', model_response: { call_succeeded: true, model: 'qwen3.8-flash', proposal, raw_text: JSON.stringify(proposal), usage: { total_tokens: 120 } } } } : { error: { code: status === 429 ? 'RATE_LIMITED' : 'AUTHENTICATION_REQUIRED' } } });
    });
    const open = async width => {
      await page.setViewportSize({ width, height: 1100 });
      await page.goto(`http://127.0.0.1:${server.address().port}/investment-only/investment.html?case=${++navigation}#ai-assistant`, { waitUntil: 'networkidle' });
      await page.locator('#tinglan-form button:not([disabled])').waitFor();
    };
    const fill = async () => {
      for (const [name, value] of Object.entries({ amount: '1000', horizon: '365', goal: '了解备用金安排', text: '虚构验收示例：学习资金安排原则。' })) await page.locator(`#tinglan-form [name=${name}]`).fill(value);
      await page.locator('#tinglan-form [name=risk]').selectOption('low');
      await page.locator('#tinglan-form [name=liquidity]').selectOption('high');
      await page.locator('#tinglan-form [name=inputMode]').selectOption('sample');
      await page.locator('#tinglan-form [name=consent]').check();
    };
    for (const width of [375, 840, 1440]) {
      await open(width);
      assert.equal(await page.locator('#share-login').isVisible(), false);
      assert.equal(await page.locator('#share-logout').isVisible(), false);
      assert.equal(await page.locator('#tinglan-form textarea').isVisible(), true);
      const before = report.modelRequests;
      await page.locator('#tinglan-form textarea').fill('还未填写投资信息');
      await page.locator('#tinglan-form button').click();
      assert.equal(report.modelRequests, before);
      await fill();
      await page.locator('#tinglan-form button').click();
      await page.locator('#tinglan-result').waitFor({ state: 'visible' });
      assert.match(await page.locator('[data-result=summary]').innerText(), /MOCK/);
      assert.equal(report.modelRequests, before + 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      report.checks.push({ width, noCodeNeeded: true, requiredInputsPreserved: true, singleSend: true, replyVisible: true, noOverflow: true });
      if (evidence) { fs.mkdirSync(evidence, { recursive: true }); await page.locator('#ai-assistant').screenshot({ path: path.join(evidence, `mock-${width}.png`) }); }
    }
    for (const code of [401, 429]) {
      status = code; await open(840); await fill();
      const before = report.modelRequests;
      await page.locator('#tinglan-form button').click();
      await page.locator('#tinglan-status[role=alert]').waitFor();
      assert.equal(report.modelRequests, before + 1);
      assert.equal(await page.locator('#tinglan-result').isVisible(), false);
      assert.equal(await page.locator('#share-login').isVisible(), false);
    }
    status = 200; sessionAvailable = false;
    await open(840); await fill();
    const before = report.modelRequests;
    await page.locator('#tinglan-form button').click();
    await page.locator('#tinglan-status[role=alert]').waitFor();
    assert.equal(report.modelRequests, before);
    sessionAvailable = true;
    await page.locator('#tinglan-form button').click();
    await page.locator('#tinglan-result').waitFor({ state: 'visible' });
    assert.equal(report.modelRequests, before + 1);
    assert.equal(report.passwordPosts, 0);
    assert.deepEqual(report.pageErrors, []);
    report.result = 'PASSED'; report.realPaidCalls = 0;
    if (evidence) fs.writeFileSync(path.join(evidence, 'browser-mock.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ result: report.result, widths: report.checks.length, passwordPosts: 0, realPaidCalls: 0 }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
