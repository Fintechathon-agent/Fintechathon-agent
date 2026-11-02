"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { server } = require("../server");

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const report = [];
  try {
    for (const width of [1440, 1024, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      const retiredRequests = [];
      const modelRequests = [];
      page.on("request", request => {
        const url = new URL(request.url());
        if (url.pathname.startsWith("/api/merchant/") || url.pathname === "/versions/merchant.js") retiredRequests.push(url.pathname);
        if (url.pathname === "/api/review") modelRequests.push(url.pathname);
      });
      for (const route of ["/", "/catalog", "/investment"]) {
        await page.goto(base + route);
        assert.equal(await page.locator('a[href*="merchant"]').count(), 0);
        assert.doesNotMatch(await page.locator("body").innerText(), /店主财务助手/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      }
      await page.locator("#run:not([disabled])").waitFor();
      await page.locator("#demo-profile").click();
      const healthResponse = page.waitForResponse(response => response.url() === base + "/api/health-check/run");
      await page.locator("#run").click();
      const health = await (await healthResponse).json();
      assert.equal(health.task_state.status, "HANDOFF_REQUIRED");
      await page.locator("#results:not([hidden])").waitFor();
      assert.equal(await page.locator(".plan-card").count(), 3);
      assert.match(await page.locator("#task-status").textContent(), /等待团队风控接入/);
      assert.equal(await page.locator("#ai-assistant").count(), 1);
      for (const legacy of ["/merchant", "/merchant/", "/merchant.html", "/versions/merchant.html"]) {
        await page.goto(base + legacy);
        assert.equal(new URL(page.url()).pathname, "/investment");
        await page.locator("#run:not([disabled])").waitFor();
      }
      assert.deepEqual(retiredRequests, []);
      assert.deepEqual(modelRequests, []);
      report.push({ width, status: "passed", legacy_routes_redirect: true, plans: 3, merchant_requests: 0, paid_model_requests: 0 });
      await context.close();
    }
    const output = path.resolve(__dirname, "../artifacts/single-product");
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  const location = String(error.stack || "").split("\n").find(line => /single-product-check\.cjs:\d/.test(line));
  console.error("Single-product browser check failed: " + error.name + (location ? " " + location.trim() : ""));
  process.exitCode = 1;
});
