'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const previewRoot = path.resolve(process.argv[2]);
const online = process.argv.includes('--online');
const previewBase = online ? 'https://lixjanus526-art.github.io/finance-lab-ui-preview' : 'http://127.0.0.1:4187';
const cloudBase = online ? 'https://xinlan-qwen38-share.lixjanus526.workers.dev' : 'http://127.0.0.1:4188';
const report = { timestamp: new Date().toISOString(), mode: online ? 'ONLINE' : 'LOCAL', checks: [], modelRequests: 0, pageErrors: [] };
const evidence = path.join(__dirname, 'evidence');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    ...(online ? { proxy: { server: process.env.HTTPS_PROXY } } : { args: ['--no-proxy-server'] }) });
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/review')) report.modelRequests++; });
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const home = await page.goto(previewBase + '/landing.html?v=20261021-focus', { waitUntil: 'networkidle', timeout: 40000 });
      assert.equal(home.status(), 200);
      assert.equal(await page.locator('.feature-card ul,.feature-card li').count(), 0);
      assert.equal(await page.locator('.story-action').getAttribute('href'), 'workspace.html#workspace');
      await page.locator('.feature-grid').screenshot({ path: path.join(evidence, `${report.mode.toLowerCase()}-home-cards-${width}.png`) });
      await page.locator('.story-action').click();
      await page.waitForURL('**/workspace.html#workspace');
      await page.locator('[data-panel=workspace]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-panel]:visible').count(), 1);
      report.checks.push({ width, heroDirectNavigation: true, decorativeLabelsRemoved: 6 });
      for (const [label, base] of [['preview', previewBase], ['share', cloudBase]]) {
        const response = await page.goto(base + '/investment-only/investment.html?v=20261021-focus', { waitUntil: 'networkidle', timeout: 40000 });
        assert.equal(response.status(), 200);
        await page.locator('#run:not([disabled])').waitFor();
        assert.equal(await page.locator('.hero-cta').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 145, 74)');
        assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(11, 10, 9)');
        assert.match(await page.locator('#allocation-donut').evaluate(el => getComputedStyle(el).backgroundImage), /rgb\(255, 145, 74\)/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const brand = await page.locator('.lab-brand').evaluate(el => el.outerHTML);
        const original = cp.execFileSync('git', ['show', 'c529294:investment-only/investment.html'], { cwd: previewRoot, encoding: 'utf8' });
        // DOM normalization keeps SVG syntax comparable without changing the logo.
        const source = await context.newPage();
        await source.route('**/*', route => route.abort());
        await source.setContent(original.replace(/<script\b[\s\S]*?<\/script>/g, ''));
        assert.equal(brand, await source.locator('.lab-brand').evaluate(el => el.outerHTML));
        await source.close();
        await page.screenshot({ path: path.join(evidence, `${report.mode.toLowerCase()}-${label}-${width}.png`), fullPage: false });
        await page.locator('#demo-profile').click();
        await page.locator('#run').click();
        await page.locator('#results').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#comparison .plan-card').count(), 3);
        report.checks.push({ label, width, orangeControls: true, orangeAllocation: true, noOverflow: true, logoUnchanged: true, staticPlans: 3 });
      }
    }
    if (online) {
      const response = await context.request.get(cloudBase + '/health');
      const health = await response.json();
      assert.equal(response.status(), 200);
      assert.equal(health.configured, true);
      assert.equal(health.paidEnabled, true);
      report.health = health;
      const asset = await context.request.get(cloudBase + '/investment-only/versions/investment-theme.css?v=20261021-focus');
      report.cloudThemeSha256 = sha(await asset.body());
      assert.equal(report.cloudThemeSha256, sha(fs.readFileSync(path.join(previewRoot, 'investment-only/versions/investment-theme.css'))));
    }
    assert.equal(report.modelRequests, 0);
    assert.deepEqual(report.pageErrors, []);
    report.result = 'PASSED';
  } catch (error) { report.result = 'FAILED'; report.error = error.message; throw error; }
  finally {
    fs.writeFileSync(path.join(evidence, online ? 'online.json' : 'local.json'), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
    console.log(JSON.stringify({ result: report.result, mode: report.mode, checks: report.checks.length, error: report.error }));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
