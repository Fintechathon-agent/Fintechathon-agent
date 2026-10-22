'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const online = process.argv.includes('--online');
  const root = path.resolve(__dirname, '../../../team-staging/ui/tinglan-ai-20261018/public');
  const report = { mode: online ? 'CLOUD_UI_ONLY' : 'LOCAL_UI_ONLY', checks: [], pageErrors: [], modelRequests: 0 };
  const server = http.createServer((req, res) => {
    let file = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(file) && !path.extname(file)) file += '.html';
    if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = online ? 'https://xinlan-qwen38-share.lixjanus526.workers.dev' : `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true, ...(online ? { proxy: { server: process.env.HTTPS_PROXY } } : { args: ['--no-proxy-server'] }) });
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.route('**/api/review', route => { report.modelRequests++; return route.abort(); });
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    for (const width of [320, 375, 840, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const screen of ['investment', 'catalog']) {
        const response = await page.goto(`${base}/investment-only/${screen}?v=20261022-navigation`, { waitUntil: 'networkidle' });
        assert.equal(response.status(), 200);
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow: ${screen}/${width}`);
        const globalLink = page.locator('.global-nav a');
        const productLink = page.locator('.workspace-switch a');
        await globalLink.waitFor({ state: 'visible' });
        await productLink.waitFor({ state: 'visible' });
        const globalBox = await globalLink.boundingBox(), productBox = await productLink.boundingBox();
        assert.equal(width > 900 ? globalBox.y + globalBox.height <= productBox.y : globalBox.x + globalBox.width <= productBox.x, true, `Global navigation order: ${width}`);
        assert.equal(await page.locator('.lab-brand img').evaluate(img => img.complete && img.naturalWidth > 0), true);
        if (screen === 'investment' && width > 900) {
          assert.deepEqual(await page.locator('.section-nav a').allTextContents(), ['资产概览', '偏好与持仓', '健康检查']);
          await page.locator('#run:not([disabled])').waitFor();
          await page.locator('.section-nav a[href="#overview"]').click();
          await page.waitForURL('**#overview');
          await page.locator('.section-nav a[href="#input-panel"]:not([data-health-link])').click();
          await page.waitForURL('**#input-panel');
          await page.locator('#check-form').waitFor({ state: 'visible' });
          await page.locator('[data-health-link]').click();
          assert.equal(await page.locator('#input-panel').getAttribute('open') !== null, true);
        }
        if (screen === 'catalog') {
          assert.equal(await globalLink.getAttribute('aria-current'), 'page');
          assert.equal(await page.locator('.section-nav').count(), 0);
        }
        await page.screenshot({ path: path.join(__dirname, `${online ? 'online' : 'local'}-${screen}-${width}.png`) });
        await globalLink.click();
        await page.waitForURL(/\/catalog(?:\.html)?(?:[?#]|$)/);
        await page.locator('.workspace-switch a').click();
        await page.waitForURL(/\/investment(?:\.html)?(?:[?#]|$)/);
        report.checks.push({ screen, width, navigationRoundTrip: true, logoLoaded: true, noOverflow: true });
      }
    }
    assert.deepEqual(report.pageErrors, []);
    assert.equal(report.modelRequests, 0);
    fs.writeFileSync(path.join(__dirname, `${online ? 'online' : 'local'}.json`), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
