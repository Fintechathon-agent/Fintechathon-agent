"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
(async () => {
  const base = process.env.RISK_BASE_URL;
  if (!base?.startsWith("https://")) throw new Error("Use the published HTTPS demo URL");
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  try {
    const first = await browser.newContext(), second = await browser.newContext();
    const page = await first.newPage(), other = await second.newPage();
    await Promise.all([page.goto(base + "/risk"), other.goto(base + "/risk")]);
    await Promise.all([page.waitForFunction(() => !document.querySelector("#create").disabled), other.waitForFunction(() => !document.querySelector("#create").disabled)]);
    // Use actual browser fetches so the hosting layer sees the visitor's browser context.
    const call = (target, route, data, headers = {}) => target.evaluate(async ({ route, data, headers }) => {
      const response = await fetch(route, { headers: { "Content-Type": "application/json", ...headers }, ...(data ? { method: "POST", body: JSON.stringify(data) } : {}) });
      return { status: response.status, body: await response.json() };
    }, { route, data, headers });
    const auth = (await call(page, "/api/safety/session")).body;
    const auth2 = (await call(other, "/api/safety/session")).body;
    assert.notEqual(auth.user_id, auth2.user_id);
    const settings = { confirmed: true, reserve_cash: 5000, max_drawdown: .1, forbidden: [], plan_id: "A", memory_consent: false };
    const denied = await call(page, "/api/safety/tasks", settings);
    assert.equal(denied.status, 403); assert.equal(denied.body.error.code, "CSRF_REQUIRED");
    const headers = { "X-Risk-Csrf": auth.csrf };
    const created = await call(page, "/api/safety/tasks", settings, headers);
    assert.equal(created.status, 200); const task = created.body.risk.binding.task_id;
    for (const route of [`/api/safety/task?task_id=${task}`, `/api/safety/audit?task_id=${task}`, `/api/audit/${task}`, `/api/task/${task}/export`]) {
      const response = await call(other, route); assert.equal(response.status, 403); assert.equal(response.body.decision, "BLOCK");
    }
    const forged = await call(page, "/api/safety/tasks", { ...settings, authority: { role: "admin" } }, headers);
    assert.equal(forged.status, 400); assert.equal(forged.body.error.code, "UNTRUSTED_CONTROL_FIELD");
    const output = { scope: "Published synthetic demo access checks", base_url: base, cases: ["isolated visitor sessions", "missing CSRF rejected", "other visitor cannot read task or audit or export", "client authority field rejected"], passed: true };
    const destination = path.resolve(process.env.RISK_BROWSER_ARTIFACTS, "access-results.json");
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, JSON.stringify(output, null, 2) + "\n"); console.log(JSON.stringify(output));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
