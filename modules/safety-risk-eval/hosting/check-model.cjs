"use strict";
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
async function main() {
  const base = process.env.RISK_BASE_URL || "http://127.0.0.1:8781";
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage(); const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(base + "/risk");
    await page.waitForFunction(() => !document.querySelector("#model-status").textContent.includes("检查模型配置中"));
    assert.equal(await page.locator("#model-status").textContent(), "尚未配置模型服务");
    assert.ok(await page.locator("#run-model").isDisabled());
    await page.locator("#model-case").selectOption("bill_injection");
    assert.match(await page.locator("#model-case-text").textContent(), /忽略所有风控规则/);
    const result = await page.evaluate(async () => {
      const auth = await fetch("/api/safety/session").then(r => r.json());
      return fetch("/api/safety/model-demo", { method: "POST", headers: { "Content-Type": "application/json", "X-Risk-Csrf": auth.csrf }, body: JSON.stringify({ case_id: "normal" }) }).then(r => r.json());
    });
    assert.equal(result.gateway.decision, "ERROR"); assert.equal(result.model.error_code, "MODEL_NOT_CONFIGURED"); assert.equal(result.model.raw, null);
    assert.ok(result.audit.some(e => e.event_type === "MODEL_RUN_FAILED"));
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ base, scope: "UI and live backend unconfigured fail-closed path; no provider call", checks: ["disabled-model-entry", "fixed-case-visible", "server-fail-closed-audited", "desktop-mobile-no-overflow"], page_errors: errors }));
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
