'use strict';
// Browser acceptance exercises navigation and preserved inputs without a model call.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { chromium } = require('playwright');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4187';
const root = path.resolve(process.argv[2]);
const out = path.resolve(process.env.EVIDENCE_DIR || path.join(__dirname, 'evidence'));
const report = { timestamp: new Date().toISOString(), base, modelCalls: 0, widths: [], routes: [], checks: [], pageErrors: [] };
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const originalLogo = cp.execFileSync('git', ['show', '57e0a6b:versions/team-logo-transparent.png'], { cwd: root });
assert.equal(digest(originalLogo), digest(fs.readFileSync(path.join(root, 'versions/team-logo-transparent.png'))));
report.logoSha256 = digest(originalLogo);
for (const [file, className] of [['workspace.html', 'workspace-brand'], ['landing.html', 'landing-brand']]) {
  const original = cp.execFileSync('git', ['show', '57e0a6b:' + file], { cwd: root, encoding: 'utf8' });
  const pattern = new RegExp('<a class="' + className + '"[\\s\\S]*?</a>');
  assert.equal(fs.readFileSync(path.join(root, file), 'utf8').match(pattern)?.[0], original.match(pattern)?.[0]);
}
const live = 'https://xinlan-qwen38-share.lixjanus526.workers.dev/investment-only/investment.html#ai-assistant';

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-proxy-server'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/review')) report.modelCalls++; });
    for (const width of [320, 375, 390, 430, 850, 1024, 1440]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      await page.goto(base + '/landing.html');
      assert.equal(await page.locator('.landing-nav nav a').count(), 5);
      assert.equal(await page.locator('.nav-enter').getAttribute('href'), live);
      const homeColor = await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor);
      for (const route of ['workspace', 'banking', 'tasks', 'safety']) {
        await page.goto(base + '/workspace.html#' + route);
        await page.locator(`[data-view=${route}][aria-current=page]`).waitFor();
        assert.equal(await page.locator('[data-panel]:visible').count(), 1);
        assert.equal(await page.locator(`[data-panel=${route}]`).isVisible(), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${route} at ${width}`);
        assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), homeColor);
        const label = page.locator('[data-view=safety]');
        assert.equal(await label.evaluate(el => el.getBoundingClientRect().height >= 44), true);
        const plain = await page.locator('.panel:visible').evaluateAll(els => els.every(el => {
          const s = getComputedStyle(el); return s.borderTopWidth === '0px' && s.boxShadow === 'none' && s.backgroundColor === 'rgba(0, 0, 0, 0)';
        }));
        assert.equal(plain, true);
        if ([375, 1440].includes(width)) await page.screenshot({ path: path.join(out, `${route}-${width}.png`), fullPage: true });
      }
      report.widths.push({ width, routes: 4, noOverflow: true, landingPalette: homeColor, navigationTouchTarget: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Test the card background, rather than only the existing text link.
    for (const [selector, route] of [['.investment-feature', 'banking'], ['.merchant-feature', 'tasks']]) {
      await page.goto(base + '/landing.html');
      await page.locator(selector).scrollIntoViewIfNeeded();
      await page.locator(selector).click({ position: { x: 12, y: 12 } });
      await page.waitForURL('**/workspace.html#' + route);
      await page.locator(`[data-panel=${route}]`).waitFor({ state: 'visible' });
      report.routes.push({ card: selector, route, backgroundClick: true });
    }
    await page.goto(base + '/landing.html');
    await page.locator('.investment-feature .feature-link').focus();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/workspace.html#banking');
    report.checks.push('Keyboard card activation');
    await page.goto(base + '/workspace.html');
    const draft = '合成测试：检查组合集中度与备用金。';
    await page.locator('#task-intent').fill(draft);
    await page.locator('#open-portfolio').click();
    assert.equal(await page.locator('#intent-preview').innerText(), '你的目标（仅本页草稿，未发送模型）：' + draft);
    await page.locator('[data-view=tasks]').click();
    await page.goBack();
    await page.locator('[data-panel=banking]').waitFor({ state: 'visible' });
    await page.goBack();
    await page.locator('[data-panel=workspace]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#task-intent').inputValue(), draft);
    await page.goForward();
    await page.locator('[data-panel=banking]').waitFor({ state: 'visible' });
    await page.reload();
    await page.locator('[data-panel=banking]').waitFor({ state: 'visible' });
    report.checks.push('Draft preserved across windows', 'Back and forward', 'Deep-link reload');
    await page.goto(base + '/workspace.html#not-a-window');
    await page.locator('[data-panel=workspace]').waitFor({ state: 'visible' });
    await page.locator('[data-view=tasks]').click();
    await page.locator('#restore-form button').click();
    assert.match(await page.locator('#restore-message').innerText(), /请填写原任务编号/);
    await page.locator('#restore-id').fill('synthetic-missing-task');
    await page.locator('#restore-form button').click();
    await page.waitForFunction(() => document.querySelector('#restore-message').textContent.includes('ERROR'));
    assert.equal(await page.locator('#task-detail').isVisible(), false);
    report.checks.push('Invalid route fallback', 'Task validation', 'Service failure does not show success');
    for (const file of ['investment.html', 'catalog.html', 'risk-workbench.html', 'investment-only/investment.html']) {
      await page.goto(base + '/' + file);
      assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(11, 10, 9)');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      report.routes.push({ file, palette: true });
    }
    await page.goto(base + '/investment-only/investment.html');
    await page.locator('#demo-profile').click();
    await page.locator('#run:not([disabled])').waitFor();
    await page.locator('#run').click();
    await page.locator('#results').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#comparison .plan-card').count(), 3);
    assert.match(await page.locator('body').innerText(), /虚构|模拟/);
    report.checks.push('Existing explicitly labelled static portfolio simulation retains all three plans');
    const noScript = await browser.newContext({ javaScriptEnabled: false });
    const fallback = await noScript.newPage();
    await fallback.goto(base + '/workspace.html#safety');
    assert.equal(await fallback.locator('[data-panel=safety]').isVisible(), true);
    await noScript.close();
    report.checks.push('No-script safety content accessible', 'Logo asset byte-identical');
    assert.equal(report.modelCalls, 0);
    assert.deepEqual(report.pageErrors, []);
    report.result = 'PASSED';
  } catch (error) { report.result = 'FAILED'; report.error = error.message; throw error; }
  finally {
    fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
    console.log(JSON.stringify({ result: report.result, widths: report.widths.length, checks: report.checks.length, evidence: out, error: report.error }));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
