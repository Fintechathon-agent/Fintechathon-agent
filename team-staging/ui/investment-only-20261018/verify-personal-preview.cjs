"use strict";
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const root = process.argv[2];
  let server;
  let base = process.argv[3];
  if (!base) {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(root + path.sep) && file !== root) return res.writeHead(404).end();
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        if (!url.pathname.endsWith('/')) return res.writeHead(302, { Location: url.pathname + '/' }).end();
        file = path.join(file, 'index.html');
      }
      fs.readFile(file, (err, bytes) => {
        if (err) return res.writeHead(404).end();
        res.setHeader('Content-Type', ({ '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
        res.end(bytes);
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + server.address().port + '/';
  }
  const browser = await chromium.launch({channel:'chrome'});
  const report = [];
  try {
    for (const width of [1440, 1024, 375]) {
      const page = await browser.newPage({viewport:{width,height:900}, reducedMotion:'reduce'});
      const errors = [], failedAssets = [], externalApis = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.status() >= 400 && /\.(?:css|js|mjs|svg|png)(?:\?|$)/.test(response.url())) failedAssets.push(new URL(response.url()).pathname); });
      page.on('request', request => { if (/\/api\//.test(request.url())) externalApis.push(new URL(request.url()).pathname); });
      for (const name of ['landing.html','catalog.html','workspace.html']) {
        assert.equal((await page.goto(base + name)).status(), 200);
        await page.waitForTimeout(250);
        assert.equal(await page.locator('a[href*="merchant"]').count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, name + ' overflow');
      }
      assert(externalApis.every(url => url === '/api/demo/portfolio'), 'existing workspace may only probe demo portfolio');
      const existingWorkspaceProbes = externalApis.length;
      externalApis.length = 0;
      await page.goto(base + 'investment-only/investment.html');
      await page.locator('#run:not([disabled])').waitFor();
      assert.match(await page.locator('.static-preview-notice').innerText(), /AI 后端未连接/);
      assert.equal(await page.locator('#ai-assistant button:disabled').count(), 1);
      const ai = await page.evaluate(async () => { const r = await fetch('/api/review', {method:'POST',body:'{}'}); return {status:r.status,body:await r.json()}; });
      assert.equal(ai.status,503); assert.equal(ai.body.error.code,'STATIC_AI_UNAVAILABLE');
      await page.locator('#demo-profile').click(); await page.locator('#run').click();
      await page.locator('#results:not([hidden])').waitFor();
      assert.equal(await page.locator('.plan-card').count(),3);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      for (const legacy of ['merchant.html','merchant','merchant/','versions/merchant.html']) {
        await page.goto(base + legacy); await page.waitForURL('**/investment-only/investment.html');
      }
      assert.deepEqual(errors, []); assert.deepEqual(failedAssets, []); assert.deepEqual(externalApis, []);
      report.push({width,status:'passed',existingWorkspacePreserved:true,existingWorkspaceProbes,plans:3,legacyRedirects:4,apiNetworkRequests:0,aiStatus:503});
      await page.close();
    }
    console.log(JSON.stringify(report,null,2));
    if (process.env.RELEASE_REPORT) fs.writeFileSync(process.env.RELEASE_REPORT,JSON.stringify(report,null,2)+'\n');
  } finally { await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
