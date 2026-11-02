"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");
async function main() {
  const base = process.env.RISK_BASE_URL || "http://127.0.0.1:8781";
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(base + "/risk");
    await page.locator("#check-core").click();
    await page.waitForFunction(() => document.querySelector("#remote-core-status").textContent === "远程 Core 已连接", { timeout: 35000 });
    await page.locator("#run-core").click();
    await page.waitForFunction(() => document.querySelector("#remote-core-status").textContent === "已接收远程 Core 结果", { timeout: 35000 });
    const evidence = JSON.parse(await page.locator("#remote-core-evidence").textContent());
    assert.equal(evidence.service_receipt.verification, "SERVER_FETCH_PINNED_HTTPS");
    assert.equal(evidence.service_receipt.endpoint, "https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/api/risk-workbench/handoff");
    assert.notEqual(evidence.local_task_id, evidence.source.task_id);
    assert.ok(await page.locator("#approve").isDisabled()); assert.ok(await page.locator("#execute").isDisabled());
    assert.match(await page.locator("#policy-evidence").textContent(), /POLICY_CORE_READ_ONLY/);
    assert.match(await page.locator("#audit").textContent(), /REMOTE_CORE_RECEIVED/);
    await page.locator("#repeat-core").click();
    await page.waitForFunction(() => document.querySelector("#remote-core-note").textContent.includes("没有再次调用"));
    assert.equal(JSON.parse(await page.locator("#remote-core-evidence").textContent()).local_task_id, evidence.local_task_id);
    const boundary = await page.evaluate(async taskId => {
      const session = await fetch("/api/safety/session").then(r => r.json());
      const post = (url, data, csrf = session.csrf) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Risk-Csrf": csrf }, body: JSON.stringify(data) });
      const forged = await post("/api/safety/core-handoff", { request_key: "browser-forged-url", endpoint: "https://attacker.invalid" });
      const noCsrf = await post("/api/safety/core-handoff", { request_key: "browser-csrf-invalid" }, "wrong");
      const execution = await post("/api/paper-trade/execute", { task_id: taskId, idempotency_key: "browser-readonly-test" }).then(r => r.json());
      return { forged: forged.status, noCsrf: noCsrf.status, execution_status: execution.status, reasons: execution.policy.reasons.map(r => r.code) };
    }, evidence.local_task_id);
    assert.equal(boundary.forged, 400); assert.equal(boundary.noCsrf, 403); assert.equal(boundary.execution_status, "NOT_STARTED"); assert.ok(boundary.reasons.includes("POLICY_CORE_READ_ONLY"));
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    assert.deepEqual(errors, []);
    const report = { checked_at: new Date().toISOString(), base, scope: "Live remote Core handoff, deterministic workflow; not an LLM run", evidence, boundary, checks: ["health-online", "live-handoff-import", "risk-and-audit", "idempotent-replay", "readonly-enforcement", "client-field-and-csrf-rejection", "desktop-mobile-no-overflow"], page_errors: errors };
    if (process.env.RISK_REMOTE_REPORT) fs.writeFileSync(process.env.RISK_REMOTE_REPORT, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
