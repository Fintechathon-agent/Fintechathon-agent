'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const base = 'https://lixjanus526-art.github.io/finance-lab-ui-preview';
const report = { timestamp: new Date().toISOString(), base, previewCommit: 'c529294bf0fe78c205d9ef372ef75d6b5ead152e',
  pagesBuild: { runId: 39548507452, conclusion: 'success' }, modelCalls: 0, routes: [], assets: [], pageErrors: [] };
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-proxy-server'] });
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    const response = await page.goto(base + '/landing.html?v=20261021-minimal', { waitUntil: 'domcontentloaded', timeout: 40000 });
    assert.equal(response.status(), 200);
    assert.equal(await page.locator('link[href*=workspace-refinement]').count(), 1);
    await page.locator('.investment-feature').scrollIntoViewIfNeeded();
    await page.locator('.investment-feature').click({ position: { x: 12, y: 12 } });
    await page.waitForURL('**/workspace.html#banking');
    await page.locator('[data-panel=banking]').waitFor({ state: 'visible' });
    report.cardBackgroundClick = true;
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const route of ['workspace', 'banking', 'tasks', 'safety']) {
        let r = await page.goto(base + '/workspace.html?v=20261021-minimal#' + route, { waitUntil: 'domcontentloaded', timeout: 40000 });
        if (!r) r = await page.reload({ waitUntil: 'domcontentloaded', timeout: 40000 });
        assert.equal(r.status(), 200);
        await page.locator(`[data-view=${route}][aria-current=page]`).waitFor();
        assert.equal(await page.locator('[data-panel]:visible').count(), 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        report.routes.push({ route, width, http: r.status(), visible: true, noOverflow: true });
      }
    }
    const release = JSON.parse(fs.readFileSync(path.join(__dirname, 'release-files.json')));
    for (const file of ['versions/workspace-refinement.css', 'versions/workspace.js', 'workspace.html']) {
      const response = await context.request.get(base + '/' + file + '?v=20261021-minimal', { timeout: 30000 });
      assert.equal(response.status(), 200);
      const sha256 = crypto.createHash('sha256').update(await response.body()).digest('hex');
      assert.equal(sha256, release.files.find(item => item.file === file).sha256);
      report.assets.push({ file, http: response.status(), matchesReviewedSha256: true });
    }
    await page.goto(base + '/workspace.html?v=20261021-minimal#workspace');
    await page.screenshot({ path: path.join(__dirname, 'evidence/online-workspace-1440.png'), fullPage: true });
    assert.deepEqual(report.pageErrors, []);
    report.result = 'PUBLISHED_UI_VERIFIED';
  } catch (error) { report.result = 'FAILED'; report.error = error.message; throw error; }
  finally {
    fs.writeFileSync(path.join(__dirname, 'evidence/online-verification.json'), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
    console.log(JSON.stringify({ result: report.result, routes: report.routes.length, assets: report.assets.length, error: report.error }));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
