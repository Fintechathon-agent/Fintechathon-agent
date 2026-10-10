"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");
async function main() {
  const base = process.env.RISK_BASE_URL || "http://127.0.0.1:8781";
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage();
  const errors = [], cases = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base + "/risk");
    await page.waitForFunction(() => document.querySelector("#policy-runtime").textContent === "确定性策略已接入");
    const manifest = JSON.parse(await page.locator("#policy-manifest").textContent());
    assert.equal(manifest.version, "financial-policy-v1");
    assert.equal(manifest.opa_runtime_connected, false);
    cases.push("deployed-policy-manifest");
    await page.locator("#profile-confirmed").check(); await page.locator("#create").click();
    await page.waitForFunction(() => document.querySelector("#decision").textContent.includes("ALLOW"));
    await page.locator("#whole-plan").check(); await page.locator("#approve").click();
    await page.waitForFunction(() => !document.querySelector("#execute").disabled);
    const receipt = JSON.parse(await page.locator("#policy-evidence").textContent());
    assert.equal(receipt.approval_binding.policy_digest, manifest.digest);
    await page.locator("#execute").click();
    await page.waitForFunction(() => document.querySelector("#execution-state").textContent === "模拟成功");
    assert.match(await page.locator("#audit").textContent(), /POLICY_DECIDED/);
    cases.push("bound-confirmation-and-server-execution");
    await page.locator("#run-attack").click();
    await page.waitForFunction(() => document.querySelector("#attack-verdict").textContent === "越权操作已阻止");
    assert.match(await page.locator("#attack-tool-count").textContent(), /0 次/);
    assert.match(await page.locator("#attack-audit").textContent(), /POLICY_UNTRUSTED_AUTHORITY/);
    cases.push("untrusted-authority-zero-tool-calls");
    assert.deepEqual(errors, []);
    const result = { base_url: base, scope: "Deployed synthetic policy enforcement; not OPA or live trading", policy_digest: manifest.digest, cases, page_errors: errors };
    if (process.env.RISK_POLICY_REPORT) fs.writeFileSync(process.env.RISK_POLICY_REPORT, JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
