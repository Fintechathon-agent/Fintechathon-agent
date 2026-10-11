"use strict";
// Set PLAYWRIGHT_MODULE to an existing installation when the repository has no local dependency.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createPreviewServer } = require("./xinlan-preview.cjs");
(async () => {
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  const errors = [], cases = [], screenshots = [];
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    const base = "http://127.0.0.1:" + server.address().port + "/xinlan/index.html";
    await page.goto(base);
    await page.getByRole("heading", { name: "看清风险，再做决定。" }).waitFor();
    const out = process.env.XINLAN_SCREENSHOTS;
    async function shot(name) {
      if (!out) return;
      await page.locator("#toast").waitFor({ state: "hidden" });
      await page.locator("h1").click();
      await page.evaluate(() => window.scrollTo(0, 0));
      fs.mkdirSync(out, { recursive: true });
      await page.screenshot({ path: path.join(out, name + ".png"), fullPage: true });
      screenshots.push(name);
    }
    await shot("personal-desktop");
    assert.equal(await page.locator("main").innerText().then(text => /\b(ALLOW|REVIEW|BLOCK)\b/.test(text)), false);
    cases.push("personal dashboard uses public status labels");
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "dashboard overflow at " + width);
      if (width === 375) await shot("personal-mobile");
    }
    await page.getByRole("link", { name: "AI 金融助理", exact: true }).click();
    await page.getByRole("button", { name: "为什么没有健康分数？" }).click();
    assert.match(await page.locator("#assistant-answer").innerText(), /没有经过验证/);
    await page.evaluate(() => { location.hash = "#console/queue"; });
    await page.getByRole("heading", { name: "此页面不属于当前预览身份" }).waitFor();
    cases.push("direct console route is marked as outside personal preview, not server RBAC");
    await page.locator("#role").selectOption("analyst");
    await page.getByRole("link", { name: "Case Queue", exact: true }).click();
    await page.locator("#case-search").fill("nothing-matches");
    await page.getByRole("heading", { name: "没有匹配的案件" }).waitFor();
    await page.locator("#case-search").fill("");
    await page.locator("#decision-filter").selectOption("BLOCK");
    assert.equal(await page.locator("tbody tr").count(), 1);
    await page.getByRole("link", { name: "复核 DEMO-002" }).click();
    await page.locator("#review-note").fill('<script>alert("x")</script> 已核对原记录');
    await page.getByRole("button", { name: "提交模拟复核意见" }).click();
    assert.equal(await page.locator(".split-status").innerText().then(text => text.includes("复核中") && text.includes("BLOCK")), true);
    assert.equal(await page.locator(".audit-item script").count(), 0);
    await page.locator("#role").selectOption("supervisor");
    await page.getByRole("link", { name: "Case Queue", exact: true }).click();
    await shot("console-desktop");
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "queue overflow at " + width);
      if (width === 375) await shot("console-mobile");
    }
    await page.getByRole("link", { name: "复核 DEMO-002" }).click();
    await page.locator("#review-note").fill("记录模拟复核结论，仍保持原有拦截决策");
    await page.getByRole("button", { name: "记录模拟复核结论" }).click();
    assert.match(await page.locator(".split-status").innerText(), /BLOCK/);
    assert.match(await page.locator(".split-status").innerText(), /复核已记录/);
    assert.equal(await page.locator("#review-form").count(), 0);
    await shot("case-review-desktop");
    cases.push("analyst and supervisor demo workflow preserves BLOCK and prevents duplicate resolution");
    await page.locator("#role").selectOption("personal");
    await page.getByRole("link", { name: "重复操作已在演示中阻止" }).click();
    assert.match(await page.locator(".split-status").innerText(), /操作已拦截/);
    assert.match(await page.locator(".split-status").innerText(), /复核已记录/);
    assert.equal(/\bBLOCK\b/.test(await page.locator("main").innerText()), false);
    assert.equal((await page.locator("main").innerText()).includes('<script>alert("x")</script>'), false);
    await page.getByRole("button", { name: "我已阅读提醒" }).click();
    assert.equal(await page.getByRole("button", { name: "通知已读" }).isDisabled(), true);
    cases.push("same-page workspaces share demo progress and acknowledged notification");
    await page.evaluate(() => { location.hash = "#personal/event/DEMO-004"; });
    await page.getByRole("heading", { name: "风险检查暂时无法完成" }).waitFor();
    assert.match(await page.locator(".split-status").innerText(), /风险检查暂不可用/);
    await page.evaluate(() => { location.hash = "#personal/event/unknown"; });
    await page.getByRole("heading", { name: "未找到风险事件" }).waitFor();
    await page.locator("#role").selectOption("admin");
    await page.getByRole("heading", { name: "系统管理与业务审批分离" }).waitFor();
    assert.equal(await page.locator("#review-form").count(), 0);
    cases.push("ERROR, missing event, and administrator no-review states");
    await page.locator("#reset").click();
    await page.locator("#role").selectOption("analyst");
    await page.getByRole("link", { name: "Audit Logs", exact: true }).click();
    assert.match(await page.locator("main").innerText(), /尚无本次演示操作/);
    await page.reload();
    assert.equal(await page.locator("#role").inputValue(), "personal");
    await page.getByRole("heading", { name: "此页面不属于当前预览身份" }).waitFor();
    cases.push("reset clears local logs and reload does not retain a privileged preview identity");
    assert.deepEqual(errors, []);
    if (process.env.AXE_MODULE) {
      const AxeBuilder = require(process.env.AXE_MODULE).default;
      // Axe injects styles and fetches CSS. Bypass CSP only in its separate audit context.
      const auditContext = await browser.newContext({ bypassCSP: true, viewport: { width: 1440, height: 1000 } });
      const auditPage = await auditContext.newPage();
      await auditPage.goto(base);
      for (const [identity, hash] of [["personal", "#personal/dashboard"], ["analyst", "#console/queue"]]) {
        await auditPage.locator("#role").selectOption(identity);
        await auditPage.evaluate(hash => { location.hash = hash; }, hash);
        await auditPage.waitForTimeout(150);
        const audit = await new AxeBuilder({ page: auditPage }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        assert.deepEqual(audit.violations.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.map(node => node.target) })), []);
      }
      await auditContext.close();
      cases.push("automated WCAG A/AA checks on dashboard and queue");
    }
    assert.deepEqual(errors, []);
    const report = { passed: true, cases, viewports: [375, 768, 1440], screenshots, browserErrors: errors, boundary: "UI demonstration only; no server RBAC or API integration tested" };
    if (out) fs.writeFileSync(path.join(out, "ui-report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
