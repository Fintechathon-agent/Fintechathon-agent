'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

(async () => {
  const live = process.argv.includes('--one-live-call');
  const evidence = process.argv.find(x => x.startsWith('--evidence='))?.slice(11);
  assert.ok(evidence, 'An explicit evidence directory is required.');
  fs.mkdirSync(evidence, { recursive: true });
  const file = path.join(evidence, live ? 'live.json' : 'online.json');
  if (fs.existsSync(file)) assert.equal(JSON.parse(fs.readFileSync(file)).attempts, 0, 'A paid attempt is already recorded; never repeat automatically.');
  const report = { timestamp: new Date().toISOString(), mode: live ? 'ONE_REAL_MODEL_CALL' : 'ONLINE_NO_MODEL_CALLS', attempts: 0, passwordPosts: 0, checks: [], pageErrors: [] };
  const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  const base = 'https://xinlan-qwen38-share.lixjanus526.workers.dev';
  const browser = await chromium.launch({ channel: 'chrome', headless: true, proxy: { server: process.env.HTTPS_PROXY } });
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/session')) report.passwordPosts++; });
    const health = await context.request.get(base + '/health');
    assert.equal(health.status(), 200); report.health = await health.json();
    assert.equal(report.health.accessMode, 'PUBLIC');
    assert.equal(report.health.configured, true); assert.equal(report.health.paidEnabled, true);
    for (const width of [375, 840, 1440]) {
      await page.setViewportSize({ width, height: 1100 });
      assert.equal((await page.goto(`${base}/investment-only/investment?v=20261022-public-chat-${width}#ai-assistant`, { waitUntil: 'networkidle', timeout: 40000 })).status(), 200);
      await page.locator('#tinglan-form button:not([disabled])').waitFor();
      assert.equal(await page.locator('#tinglan-form textarea').isVisible(), true);
      assert.equal(await page.locator('#share-login').isVisible(), false);
      assert.equal(await page.locator('#share-logout').isVisible(), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const session = await context.request.get(base + '/api/session');
      assert.equal(session.status(), 200); assert.equal((await session.json()).authenticated, true);
      report.checks.push({ width, automaticSession: true, chatVisible: true, noPassword: true, noOverflow: true });
      await page.locator('#ai-assistant').screenshot({ path: path.join(evidence, `online-${width}.png`) });
    }
    const usageBefore = await context.request.get(base + '/api/tinglan/status');
    assert.equal(usageBefore.status(), 200); const usage = await usageBefore.json();
    report.reservedCentsBefore = usage.budget?.reserved_cents ?? 0;
    report.attemptsBefore = usage.budget?.attempts ?? 0;
    if (live) {
      // Stay within the original CNY 0.20 total reservation; never raise the limit.
      assert.ok(Number.isSafeInteger(report.reservedCentsBefore) && report.reservedCentsBefore < 20, 'Original budget has no remaining reservation.');
      for (const [name, value] of Object.entries({ amount: '1000', horizon: '365', goal: '学习备用金与资金安排原则', text: '虚构验收示例：请解释备用金、流动性与分散风险的学习思路，不提供交易指令。' })) await page.locator(`#tinglan-form [name=${name}]`).fill(value);
      await page.locator('#tinglan-form [name=risk]').selectOption('low');
      await page.locator('#tinglan-form [name=liquidity]').selectOption('high');
      await page.locator('#tinglan-form [name=inputMode]').selectOption('sample');
      await page.locator('#tinglan-form [name=consent]').check();
      report.attempts = 1; save();
      const started = performance.now();
      const [response] = await Promise.all([
        page.waitForResponse(r => r.url() === base + '/api/review' && r.request().method() === 'POST', { timeout: 45000 }),
        page.locator('#tinglan-form button').click()
      ]);
      report.http = response.status(); report.durationMs = Math.round(performance.now() - started); save();
      const data = await response.json();
      if (!response.ok()) report.errorCode = data.error?.code;
      assert.equal(response.status(), 200);
      const model = data.model?.model_response;
      assert.equal(data.model?.source, 'model'); assert.equal(model.call_succeeded, true);
      assert.equal(model.model, 'qwen3.8-flash'); assert.equal(data.execution?.execution_allowed, false);
      await page.locator('#tinglan-result').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-result=summary]').innerText(), model.proposal.summary);
      assert.equal(await page.locator('[data-result=reason]').innerText(), JSON.parse(model.raw_text).action_reason);
      report.model = model.model; report.tokens = model.usage?.total_tokens ?? null;
      report.runId = data.run_id; report.auditId = data.audit?.audit_id;
      report.resultMatchesProvider = true; report.executionAllowed = false;
      await page.locator('#ai-assistant').screenshot({ path: path.join(evidence, 'live-reply.png') });
      const after = await (await context.request.get(base + '/api/tinglan/status')).json();
      report.reservedCentsAfter = after.budget?.reserved_cents;
      assert.ok(report.reservedCentsAfter <= 20);
    }
    report.assets = [];
    for (const asset of ['investment.html', 'versions/tinglan-widget.mjs', 'versions/tinglan.css', 'release-manifest.json']) {
      const response = await context.request.get(`${base}/investment-only/${asset}?v=20261022-public-chat`);
      assert.equal(response.status(), 200);
      const bytes = await response.body();
      assert.deepEqual(bytes, fs.readFileSync(path.resolve(__dirname, '../public/investment-only', asset)));
      report.assets.push({ file: asset, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
    }
    assert.equal(report.passwordPosts, 0); assert.deepEqual(report.pageErrors, []);
    report.result = 'PASSED';
  } catch (error) { report.result = 'FAILED'; report.error = error.message; throw error; }
  finally { save(); await browser.close(); console.log(JSON.stringify({ result: report.result, attempts: report.attempts, http: report.http, passwordPosts: report.passwordPosts, reservedCentsBefore: report.reservedCentsBefore, error: report.error })); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
