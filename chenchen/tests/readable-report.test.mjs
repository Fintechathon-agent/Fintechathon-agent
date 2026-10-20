import test from "node:test";
import assert from "node:assert/strict";
import { buildInvestmentReport, investmentReportText, investmentReportHtml } from "../versions/investment-report.mjs";
import { readableBenchmarkReport } from "../experiments/report-benchmark-v6/report.mjs";
import harnessModule from "../core/harness.js";
import { server } from "../server.js";

function example() { return new harnessModule.Harness().runHealthCheck({ risk_profile: {
  investment_horizon_days: 365, max_drawdown: .01, liquidity_need: "medium" } }); }

test("report consumes Harness facts without recalculation or task changes", () => {
  const result = example(), before = structuredClone(result);
  const report = buildInvestmentReport(result, { observedOn: "2026-10-20" });
  assert.equal(report.available, true);
  assert.equal(report.metrics[0].value, "-2.79%");
  assert.equal(report.metrics[1].value, "2.79%");
  assert.match(report.priorities[2].title, /超过/);
  assert.match(investmentReportText(report), /当前停在风控复核/);
  assert.deepEqual(result, before);
});

test("incomplete results never manufacture zero, approval or a successful report", () => {
  for (const mutate of [x => { x.artifacts.simulation.comparisons[0].metrics.cumulative_return = null; },
    x => { x.artifacts.simulation.comparisons[1] = null; }, x => { x.task_state.status = "FAILED"; },
    x => { x.artifacts.simulation.snapshot_id = "different"; }, x => { x.artifacts.portfolio_snapshot.as_of = "2099-01-01"; }]) {
    const result = example(); mutate(result);
    const report = buildInvestmentReport(result, { observedOn: "2026-10-20" });
    assert.equal(report.available, false);
    assert.deepEqual(report.metrics, []);
    assert.equal(report.comparison, null);
  }
});

test("presentation does not claim improvement when every alternative falls more", () => {
  const result = example();
  result.artifacts.simulation.comparisons.slice(1).forEach(c => { c.metrics.max_drawdown = -.08; });
  const report = buildInvestmentReport(result, { observedOn: "2026-10-20" });
  assert.equal(report.comparison.code, "MORE_DROP");
  assert.match(report.comparison.title, /没有比当前组合少跌/);
});

test("HTML escapes labels, all explanations start collapsed, plain text retains detail", () => {
  const report = buildInvestmentReport(example(), { observedOn: "2026-10-20" });
  report.headline = '<img src=x onerror="alert(1)">';
  const html = investmentReportHtml(report);
  assert.doesNotMatch(html, /<img|<details[^>]*\bopen\b/);
  assert.match(html, /&lt;img/);
  assert.match(investmentReportText(report), /六、查找原始记录/);
});

test("team report counts failures accurately and rejects contradictory totals", () => {
  const report = { total: 2, passed: 1, failed: 1, skipped: 0, groups: [{ group: "readable_report", cases: 2, passed: 1, failed: 1 }],
    templates: 2, unique_inputs: 2, seed: 1, recorded_at: "2026-10-20", dataset_sha256: "a".repeat(64) };
  const failures = [{ case_id: "failed-1", group: "readable_report", template: "null-plan", error: { message: "<script>alert(1)</script>" } }];
  const output = readableBenchmarkReport(report, failures);
  assert.match(output.text, /发现 1 例未通过/);
  assert.match(output.text, /报告是否说清楚：1\/2/);
  assert.doesNotMatch(output.html, /<script>/);
  assert.throws(() => readableBenchmarkReport({ ...report, passed: 2 }, failures));
  assert.throws(() => readableBenchmarkReport(report, []));
});

test("investment page serves the real report module and exports readable text", async t => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = "http://127.0.0.1:" + server.address().port;
  const module = await fetch(base + "/versions/investment-report.mjs");
  assert.equal(module.status, 200); assert.match(module.headers.get("content-type"), /javascript/);
  const page = await fetch(base + "/investment").then(r => r.text());
  assert.match(page, /下载易读报告 TXT/);
  assert.match(page, /<details class="panel" id="plans-panel">/);
  assert.match(page, /id="dashboard-overview"/);
  assert.match(page, /href="#concentration-panel"/);
  assert.match(page, /id="focus-risk-value"/);
});
