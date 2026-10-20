import assert from "node:assert/strict";
import { runCase as previous } from "../integration-benchmark-v5/checks.mjs";
import { buildInvestmentReport, investmentReportHtml, investmentReportText } from "../../versions/investment-report.mjs";
import harnessModule from "../../core/harness.js";

export async function runCase(c) {
  if (c.group === "portfolio_chain") {
    const original = await previous(c);
    // Also run the exact report adapter against real existing Harness output.
    const result = new harnessModule.Harness().runHealthCheck(c.input);
    const report = buildInvestmentReport(result, { observedOn: "2026-10-20" });
    assert.equal(report.available, c.expected.status === "HANDOFF_REQUIRED");
    if (report.available) {
      assert.equal(report.metrics[0].value, (result.artifacts.simulation.comparisons.find(x => x.plan_id === "CURRENT").metrics.cumulative_return * 100).toFixed(2) + "%");
      assert.equal(report.taskId, result.task_state.task_id);
    }
    return { ...original, report_checks: { available: report.available, headline: report.headline } };
  }
  if (c.group !== "readable_report") return previous(c);
  const before = structuredClone(c.input);
  const report = buildInvestmentReport(c.input.result, { observedOn: c.input.observedOn });
  assert.equal(report.available, c.expected.available);
  assert.deepEqual(c.input, before, "Report must not mutate input or workflow");
  const text = investmentReportText(report), html = investmentReportHtml(report);
  assert.doesNotMatch(text, /NaN|undefined|Infinity/);
  assert.match(text, /没有买卖任何资产/);
  assert.match(text, /一、先看结论[\s\S]*二、关键数字[\s\S]*三、下一步怎么做[\s\S]*四、方案有什么不同[\s\S]*五、数据与边界/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b|<script\b|<img\b/);
  if (!report.available) {
    assert.equal(report.metrics.length, 0); assert.equal(report.comparison, null);
    assert.match(text, /暂不能/);
  } else {
    const e = c.expected;
    assert.equal(report.metrics[1].value, "4.00%");
    assert.equal(report.metrics[2].value, (e.cash * 100).toFixed(2) + "%");
    assert.equal(report.comparison.code, e.comparison_code);
    assert.equal(report.metrics.length, 3); assert.equal(report.priorities.length, 3);
    assert.match(report.headline, e.change < 0 ? /下跌/ : e.change > 0 ? /上涨/ : /持平/);
    if (Math.abs(e.change) > 0 && Math.abs(e.change) < .00005) assert.match(report.metrics[0].value, /不足 0.01%/);
    if (c.template === "worse-drop") assert.match(report.comparison.title, /没有比当前组合少跌/);
    if (c.template === "living-soon") assert.match(report.priorities[0].title, /近期/);
    if (c.template === "low-tolerance") assert.match(report.priorities[2].title, /超过/);
    assert.match(report.metrics[2].help, /不能全当作可投资/);
    const injected = { ...report, headline: '<img src=x onerror="alert(1)">' };
    assert.doesNotMatch(investmentReportHtml(injected), /<img/);
    assert.match(investmentReportHtml(injected), /&lt;img/);
  }
  return { available: report.available, headline: report.headline, report, text, html };
}
