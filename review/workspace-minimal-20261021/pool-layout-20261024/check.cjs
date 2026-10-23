'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const online = process.argv.includes('--online');
const source = process.env.PREVIEW_ROOT;
const evidence = path.join(__dirname, 'evidence');
const mode = online ? 'online' : 'local';
const report = { mode, measurements: [], navigation: [], errors: [] };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let server;
(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  let base = 'https://lixjanus526-art.github.io/finance-lab-ui-preview';
  if (!online) {
    assert.ok(source, 'Set PREVIEW_ROOT to the preview checkout');
    server = http.createServer((req, res) => {
      const file = path.join(source, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
      const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
      fs.readFile(file, (err, bytes) => {
        res.writeHead(err ? 404 : 200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
        res.end(err ? '' : bytes);
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    ...(!online ? { args: ['--no-proxy-server'] } : process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}) });
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    for (const width of [320, 375, 430, 700, 701, 720, 840, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      const response = await page.goto(`${base}/landing.html?v=20261024-pool-layout`, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200);
      await page.locator('.feature-grid').scrollIntoViewIfNeeded();
      const cards = await page.locator('.feature-card').evaluateAll(elements => elements.map(card => {
        const rect = selector => {
          const r = card.querySelector(selector).getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        };
        const water = card.querySelector('.liquid-water');
        const pixels = water.getContext('2d').getImageData(0, 0, water.width, water.height).data;
        return { number: rect('.archive-diagram>span:not(.liquid-vessel)'), pool: rect('.liquid-vessel'),
          diagram: rect('.archive-diagram'), title: rect('h3'), link: rect('.feature-link'),
          paintedWater: pixels.some((value, index) => index % 4 === 3 && value > 0) };
      }));
      assert.equal(cards.length, 2);
      for (const card of cards) {
        assert.ok(card.pool.x - card.number.right >= 4, `${width}: number and pool need a visible gap`);
        assert.ok(card.pool.right <= card.diagram.right + 1, `${width}: pool must stay in card`);
        assert.ok(card.pool.width > 20 && card.pool.height > 20, `${width}: pool must remain visible`);
        assert.ok(card.paintedWater, `${width}: water canvas must render`);
      }
      for (const key of ['title', 'link']) assert.ok(Math.abs(cards[0][key].y - cards[1][key].y) <= 1, `${width}: card alignment`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: page overflow`);
      report.measurements.push({ width, cards });
      if ([375, 840, 1440].includes(width)) await page.locator('.feature-grid').screenshot({ path: path.join(evidence, `${mode}-${width}.png`) });
    }
    for (const [index, panel] of [[0, 'banking'], [1, 'tasks']]) {
      await page.goto(`${base}/landing.html`, { waitUntil: 'networkidle' });
      const title = page.locator('.feature-card h3').nth(index);
      await title.scrollIntoViewIfNeeded();
      const rect = await title.boundingBox();
      await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.waitForURL(`**/workspace.html#${panel}`);
      await page.locator(`[data-panel="${panel}"]`).waitFor({ state: 'visible' });
      report.navigation.push(panel);
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`${base}/landing.html`, { waitUntil: 'networkidle' });
    await page.locator('.feature-grid').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => Number(document.querySelector('.feature-grid').dataset.tossImpacts) > 0, null, { timeout: 45000 });
    report.animation = await page.locator('.feature-grid').evaluate(el => ({ phase: el.dataset.tossPhase, impacts: el.dataset.tossImpacts }));
    if (online) {
      const files = JSON.parse(fs.readFileSync(path.join(__dirname, 'release-files.json'))).files;
      for (const entry of files) {
        const response = await context.request.get(`${base}/${entry.file}?v=20261024-pool-layout`);
        assert.equal(response.status(), 200);
        assert.equal(sha(await response.body()), entry.sha256, `Published bytes: ${entry.file}`);
      }
      report.publishedHashesMatch = true;
    }
    assert.deepEqual(report.errors, []);
    report.result = 'PASSED';
  } catch (error) {
    report.result = 'FAILED'; report.error = error.message; throw error;
  } finally {
    fs.writeFileSync(path.join(evidence, `${mode}.json`), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
    console.log(JSON.stringify({ result: report.result, mode, widths: report.measurements.length, error: report.error }));
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server?.close());
