"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
(async () => {
  const base = process.env.RISK_BASE_URL || "http://127.0.0.1:8781";
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1365, height: 960 } });
  const errors = [], cases = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    const first = await page.goto(base + "/risk"); assert.equal(first.status(), 200);
    await page.getByRole("link", { name: "投资组合页面", exact: true }).click();
    await page.waitForURL(base + "/investment");
    await page.waitForFunction(() => !document.querySelector("#run").disabled);
    const links = await page.locator("header a").evaluateAll(elements => elements.map(el => ({ text: el.textContent.trim(), href: el.getAttribute("href") })));
    assert.ok(links.every(link => ["/investment", "/risk"].includes(link.href)));
    assert.equal(await page.locator('a[href="/merchant"]').count(), 0);
    cases.push({ name: "risk-to-investment-and-data-loaded", passed: true, header_links: links });
    await page.getByRole("link", { name: "风控工作台", exact: true }).click();
    await page.waitForURL(base + "/risk");
    await page.waitForFunction(() => !document.querySelector("#create").disabled);
    cases.push({ name: "investment-navigation-returns-to-risk", passed: true });
    for (const route of ["/merchant", "/merchant/"]) {
      const response = await page.goto(base + route);
      assert.equal(response.status(), 200); assert.equal(page.url(), base + "/investment");
      await page.waitForFunction(() => !document.querySelector("#run").disabled);
      cases.push({ name: "legacy-route-recovered", route, destination: "/investment", status: response.status(), passed: true });
    }
    assert.deepEqual(errors, []);
    const output = { scope: "Navigation repair in the risk-only deployment", base_url: base, cases, page_errors: errors };
    const reportDir = process.env.RISK_BROWSER_ARTIFACTS || path.resolve(__dirname, "../../../..", "output/navigation-check");
    fs.mkdirSync(reportDir, { recursive: true }); fs.writeFileSync(path.join(reportDir, "navigation-results.json"), JSON.stringify(output, null, 2) + "\n");
    await page.locator("header").screenshot({ path: path.join(reportDir, "investment-navigation.png") });
    console.log(JSON.stringify(output));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
