"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { parseEnv } = require("node:util");
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;
let stage = "launch";

async function main() {
  const root = path.resolve(__dirname, "..");
  const base = process.env.LOCAL_REVIEW_URL || "http://127.0.0.1:4175";
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const report = { browser: "Chrome", mocked_failure_cases: [], live: null };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(base + "/investment", { waitUntil: "networkidle" });
    await page.locator("#ai-assistant").scrollIntoViewIfNeeded();
    for (const [code, status, expected] of [
      ["MODEL_AUTH_FAILED", 502, "鉴权失败"], ["MODEL_TIMEOUT", 504, "响应超时"],
      ["MODEL_RATE_LIMITED", 503, "请求过于频繁"], ["LOCAL_RATE_LIMITED", 429, "请求过于频繁"],
      ["MODEL_INVALID_RESPONSE", 502, "格式不正确"]
    ]) {
      stage = "mock-" + code;
      await page.route("**/api/review", route => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: { code, message: "INTERNAL_SENSITIVE_MESSAGE_MUST_NOT_RENDER" } }) }));
      await page.locator("#ai-review-text").fill("合成新闻：企业尚未披露公告原文，请核实来源。");
      await page.locator("#ai-review-submit").click();
      await page.waitForFunction(() => !document.querySelector("#ai-review-submit").disabled);
      assert.match(await page.locator("#ai-review-status").innerText(), new RegExp(expected));
      assert.equal(await page.locator("#ai-review-result").isVisible(), false);
      assert.ok(!(await page.locator("body").innerText()).includes("INTERNAL_SENSITIVE_MESSAGE_MUST_NOT_RENDER"));
      report.mocked_failure_cases.push(code);
      await page.unroute("**/api/review");
    }
    await page.route("**/api/review", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ source: "rule_fallback", status: "DEGRADED_RULE_FALLBACK", model_response: { call_succeeded: false } }) }));
    stage = "mock-rule-fallback";
    await page.locator("#ai-review-submit").click();
    await page.waitForFunction(() => !document.querySelector("#ai-review-submit").disabled);
    assert.match(await page.locator("#ai-review-status").innerText(), /格式不正确/);
    report.mocked_failure_cases.push("RULE_FALLBACK_REJECTED");
    await page.unroute("**/api/review");
    stage = "accessibility";
    const accessibility = await new AxeBuilder({ page }).include("#ai-assistant").analyze();
    report.axe_violations = accessibility.violations.map(item => ({ id: item.id, impact: item.impact }));
    assert.equal(accessibility.violations.length, 0);

    if (process.argv.includes("--live")) {
      stage = "live-config";
      const env = parseEnv(fs.readFileSync(path.join(root, ".env.local"), "utf8"));
      assert.ok(env.MODEL_API_KEY);
      let browserRequestSafe = false;
      page.on("request", request => {
        if (request.url().endsWith("/api/review")) {
          const exposed = JSON.stringify({ url: request.url(), headers: request.headers(), body: request.postData() });
          browserRequestSafe = !exposed.includes(env.MODEL_API_KEY) && !request.headers().authorization;
        }
      });
      const synthetic = "【合成金融文本，仅供联调】虚构企业星澜科技公告称拟调整业务布局，但未披露投资金额、实施日期及审议结果。请解读已知事实、证据缺口和需要核实的信息，不荐股、不预测收益、不执行交易。";
      await page.locator("#ai-review-text").fill(synthetic);
      const responsePromise = page.waitForResponse(response => response.url() === base + "/api/review", { timeout: 40000 });
      const started = Date.now();
      await page.locator("#ai-review-submit").click();
      const response = await responsePromise;
      const data = await response.json();
      stage = "live-http-" + response.status() + "-" + (data.error?.code || "response");
      await page.waitForFunction(() => !document.querySelector("#ai-review-submit").disabled, { timeout: 40000 });
      assert.equal(response.status(), 200);
      assert.equal(data.source, "model");
      assert.equal(data.model_response.call_succeeded, true);
      assert.equal(data.model_response.model, "qwen3.8-flash");
      assert.equal(data.gateway.execution_allowed, false);
      stage = "live-ui-display";
      assert.equal(await page.locator("#ai-review-summary").innerText(), data.model_response.proposal.summary);
      assert.equal(await page.locator("#ai-review-raw").textContent(), data.model_response.raw_text);
      assert.equal(await page.locator("#ai-review-result").isVisible(), true);
      stage = "live-security";
      assert.ok(browserRequestSafe);
      assert.ok(!JSON.stringify(data).includes(env.MODEL_API_KEY));
      assert.ok(!(await page.content()).includes(env.MODEL_API_KEY));
      assert.ok(!JSON.stringify(data).includes(env.MODEL_API_URL));
      report.live = { http_status: response.status(), roundtrip_ms: Date.now() - started, provider_duration_ms: data.model_response.duration_ms,
        model: data.model_response.model, source: data.source, call_succeeded: true, frontend_matches_response: true,
        browser_credentials_absent: true, execution_allowed: false, usage: data.model_response.usage,
        run_id: data.run_id, audit_id: data.audit.audit_id, summary: data.model_response.proposal.summary };
      const out = path.resolve(root, "..", "screenshots", "bailian-local");
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
      await page.locator("#ai-assistant").screenshot({ path: path.join(out, "desktop.png") });
      stage = "mobile-layout";
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator("#ai-assistant").scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator("#ai-assistant").screenshot({ path: path.join(out, "mobile.png") });
      // Input changes invalidate the old model result without another paid request.
      await page.locator("#ai-review-text").fill("另一段合成文本。");
      stage = "invalidate-result";
      assert.equal(await page.locator("#ai-review-result").isVisible(), false);
      fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
}

main().catch(error => {
  console.error("Browser check failed at " + stage + ": " + (error.code || error.name || "UNKNOWN"));
  process.exitCode = 1;
});
