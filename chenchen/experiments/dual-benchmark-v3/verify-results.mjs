import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const docs = fileURLToPath(new URL("../../docs/", import.meta.url));
const digest = text => createHash("sha256").update(text).digest("hex");
const read = (dir, name) => fs.readFileSync(path.join(dir, name), "utf8").replace(/\r\n/g, "\n");
const sources = ["experiments/investment-benchmark-v1/run.mjs", "experiments/dual-benchmark-v3/cases.mjs",
  "experiments/dual-benchmark-v3/checks.mjs", "experiments/dual-benchmark-v3/run.mjs"];
const results = [], globalIds = [];
for (const suite of ["investment", "other"]) {
  const runs = [];
  for (const phase of ["before", "after"]) {
    const folder = "benchmark-5000-" + suite + "-" + phase + "-2026-10-19", dir = path.join(docs, folder);
    const report = JSON.parse(read(dir, "report.json"));
    const casesText = read(dir, "cases.jsonl");
    const cases = casesText.trim().split("\n").map(JSON.parse);
    const outcomes = read(dir, "results.jsonl").trim().split("\n").map(JSON.parse);
    assert.equal(cases.length, 5000);
    assert.equal(new Set(cases.map(c => c.case_id)).size, 5000);
    assert.deepEqual(cases.map(c => c.case_id), outcomes.map(c => c.case_id));
    assert.equal(digest(casesText), report.dataset_sha256);
    assert.equal(outcomes.filter(r => r.passed).length, report.passed);
    assert.equal(outcomes.filter(r => !r.passed).length, report.failed);
    assert.equal(report.skipped, 0);
    assert.equal(report.external_network_attempts, 0);
    assert.equal(report.paid_model_calls, 0);
    const size = fs.readdirSync(dir).map(name => ({ name, bytes: fs.statSync(path.join(dir, name)).size }));
    assert.ok(size.every(f => f.bytes < 100 * 1024 * 1024), "Individual artifact must stay below GitHub file limit");
    if (phase === "after") {
      assert.equal(report.failed, 0);
      globalIds.push(...cases.map(c => c.case_id));
    }
    runs.push({ phase, folder, total: report.total, passed: report.passed, failed: report.failed,
      templates: report.parameterized_templates, unique_inputs: new Set(cases.map(c => JSON.stringify(c.input))).size,
      dataset_sha256: report.dataset_sha256, groups: report.groups, source_sha256: report.source_sha256, files: size });
  }
  assert.equal(runs[0].dataset_sha256, runs[1].dataset_sha256);
  for (const source of sources) assert.equal(runs[0].source_sha256[source], runs[1].source_sha256[source], source);
  results.push({ suite, input_and_expectations_unchanged: true, runner_unchanged: true,
    changed_sources: Object.keys(runs[0].source_sha256).filter(k => runs[0].source_sha256[k] !== runs[1].source_sha256[k]),
    runs: runs.map(({ source_sha256, ...run }) => run) });
}
assert.equal(new Set(globalIds).size, 10000);
const result = { verification_version: "dual-benchmark-evidence.v1", total_after: 10000, passed_after: 10000,
  skipped: 0, external_network_attempts: 0, paid_model_calls: 0, model_accuracy_measured: false,
  training_performed: false, joint_acceptance: false, results };
const output = process.argv.indexOf("--output");
if (output >= 0) fs.writeFileSync(path.resolve(process.argv[output + 1]), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(result, null, 2));
