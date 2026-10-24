'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const online = process.argv.includes('--online');
const base = online ? 'https://lixjanus526-art.github.io/finance-lab-ui-preview' : 'http://127.0.0.1:4187';
const mode = online ? 'online' : 'local';
const evidence = path.join(__dirname, 'evidence');
const report = { timestamp: new Date().toISOString(), mode, measurements: [], navigation: [], pageErrors: [] };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    ...(online ? { proxy: { server: process.env.HTTPS_PROXY } } : { args: ['--no-proxy-server'] }) });
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    for (const width of [375, 700, 701, 720, 800, 840, 1024, 1259, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const response = await page.goto(base + '/landing.html?v=20261021-align', { waitUntil: 'networkidle', timeout: 40000 });
      assert.equal(response.status(), 200);
      await page.locator('.feature-grid').scrollIntoViewIfNeeded();
      const cards = await page.locator('.feature-card').evaluateAll(elements => elements.map(card =>
        Object.fromEntries(['h3', 'p', '.feature-link'].map(selector => {
          const element = card.querySelector(selector);
          const rect = element.getBoundingClientRect();
          return [selector, { y: rect.y + scrollY, height: rect.height, unclipped: element.scrollWidth <= element.clientWidth }];
        }))));
      assert.equal(cards.length, 2);
      for (const selector of ['h3', 'p', '.feature-link']) {
        assert.ok(Math.abs(cards[0][selector].y - cards[1][selector].y) <= 1, `${width}: ${selector} top alignment`);
        assert.ok(Math.abs(cards[0][selector].height - cards[1][selector].height) <= 1, `${width}: ${selector} equal height`);
        assert.ok(cards.every(card => card[selector].unclipped), `${width}: ${selector} no clipping`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      report.measurements.push({ width, cards, aligned: true, noOverflow: true });
      if ([375, 840, 1440].includes(width)) {
        await page.locator('.feature-grid').screenshot({ path: path.join(evidence, `${mode}-${width}.png`) });
      }
    }
    // Clicking the title area must still activate the whole-card link.
    for (const [index, panel] of [[0, 'banking'], [1, 'tasks']]) {
      await page.goto(base + '/landing.html?v=20261021-align', { waitUntil: 'networkidle' });
      const title = page.locator('.feature-card h3').nth(index);
      await title.scrollIntoViewIfNeeded();
      const rect = await title.boundingBox();
      await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.waitForURL(`**/workspace.html#${panel}`);
      await page.locator(`[data-panel="${panel}"]`).waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-panel]:visible').count(), 1);
      report.navigation.push({ card: index, panel, passed: true });
    }
    if (online) {
      const files = JSON.parse(fs.readFileSync(path.join(__dirname, 'release-files.json'), 'utf8')).files;
      for (const entry of files) {
        const response = await context.request.get(`${base}/${entry.file}?v=20261021-align`);
        assert.equal(response.status(), 200);
        assert.equal(sha(await response.body()), entry.sha256, `Published bytes: ${entry.file}`);
      }
      report.publishedHashesMatch = true;
    }
    assert.deepEqual(report.pageErrors, []);
    report.result = 'PASSED';
  } catch (error) {
    report.result = 'FAILED';
    report.error = error.message;
    throw error;
  } finally {
    fs.writeFileSync(path.join(evidence, `${mode}.json`), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
    console.log(JSON.stringify({ result: report.result, mode, widths: report.measurements.length, navigation: report.navigation.length, error: report.error }));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
