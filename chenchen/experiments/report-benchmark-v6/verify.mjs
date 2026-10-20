import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readableBenchmarkReport } from "./report.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sha = value => createHash("sha256").update(value).digest("hex");
const lines = text => text.trim().split("\n").filter(Boolean).map(JSON.parse);
function inspect(folder) {
  const location = path.join(root, "docs", folder), report = JSON.parse(fs.readFileSync(path.join(location, "report.json")));
  const datasets = [], results = [], evidenceSummary = []; let tracesCount = 0;
  for (const batch of report.batches) {
    const read = name => fs.readFileSync(path.join(location, batch.folder, name));
    const detail = JSON.parse(read("report.json")), dataset = read("cases.jsonl").toString("utf8").replaceAll("\r\n", "\n");
    const cases = lines(dataset), outcomes = lines(read("results.jsonl").toString("utf8"));
    assert.equal(sha(dataset), batch.dataset_sha256); assert.equal(detail.dataset_sha256, batch.dataset_sha256);
    assert.equal(cases.length, 1000); assert.equal(outcomes.length, 1000);
    assert.deepEqual(cases.map(c => c.case_id), outcomes.map(c => c.case_id));
    assert.equal(outcomes.filter(r => r.passed).length, batch.passed); assert.equal(detail.passed, batch.passed);
    assert.equal(outcomes.filter(r => !r.passed).length, batch.failed); assert.equal(detail.failed, batch.failed);
    assert.deepEqual(detail.source_sha256, report.source_sha256); assert.equal(detail.external_network_attempts, 0);
    assert.equal(detail.external_model_calls, 0); assert.equal(detail.paid_model_calls, 0); assert.equal(detail.skipped, 0);
    const packed = read(batch.evidence_artifact.file), unpacked = gunzipSync(packed), text = unpacked.toString("utf8");
    assert.deepEqual(detail.evidence_artifact, batch.evidence_artifact);
    assert.equal(packed.length, batch.evidence_artifact.bytes); assert.equal(sha(packed), batch.evidence_artifact.sha256);
    assert.equal(sha(unpacked), batch.evidence_artifact.uncompressed_sha256);
    const traces = lines(text), ids = new Set(outcomes.filter(r => r.passed).map(r => r.case_id));
    assert.equal(traces.length, batch.evidence_artifact.records); assert.ok(traces.every(t => ids.has(t.case_id)));
    assert.equal(new Set(traces.map(t => t.case_id)).size, traces.length);
    assert.equal(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?<![A-Za-z0-9_-])(?:ghp_|github_pat_|sk-)[A-Za-z0-9_-]{20,}/.test(text), false);
    datasets.push(dataset); results.push(...outcomes); tracesCount += traces.length;
    evidenceSummary.push({ folder: batch.folder, records: traces.length, compressed_bytes: packed.length, uncompressed_bytes: unpacked.length,
      sha256: batch.evidence_artifact.sha256 });
  }
  const dataset = datasets.join(""), cases = lines(dataset);
  assert.equal(sha(dataset), report.dataset_sha256); assert.equal(report.total, 10000);
  assert.equal(cases.length, 10000); assert.equal(results.length, 10000);
  assert.equal(new Set(cases.map(c => c.case_id)).size, 10000);
  assert.equal(new Set(cases.map(c => JSON.stringify({ group: c.group, template: c.template, input: c.input }))).size, report.unique_inputs);
  assert.equal(new Set(cases.map(c => c.group + ":" + c.template)).size, report.templates);
  assert.equal(results.filter(r => r.passed).length, report.passed);
  const failures = results.filter(r => !r.passed);
  assert.equal(failures.length, report.failed);
  assert.deepEqual(failures, lines(fs.readFileSync(path.join(location, "failures.jsonl"), "utf8")));
  assert.equal(report.skipped, 0); assert.equal(report.external_network_attempts, 0); assert.equal(report.external_model_calls, 0); assert.equal(report.paid_model_calls, 0);
  for (const group of report.groups) {
    const subset = results.filter(r => r.group === group.group);
    assert.equal(subset.length, group.cases); assert.equal(subset.filter(r => r.passed).length, group.passed);
    assert.equal(subset.filter(r => !r.passed).length, group.failed);
  }
  return { folder, report, dataset, failures, tracesCount, evidenceSummary };
}


const before = inspect("benchmark-10000-readable-first-2026-10-20"), after = inspect("benchmark-10000-readable-after-2026-10-20");
assert.equal(before.dataset, after.dataset); assert.equal(before.report.passed, 9900); assert.equal(after.report.passed, 10000);
assert.ok(before.failures.every(r => r.template === "null-plan" && r.error.message.includes("plan_id")));
const changed = Object.keys(after.report.source_sha256).filter(key => before.report.source_sha256[key] !== after.report.source_sha256[key]);
assert.deepEqual(changed, ["versions/presentation.mjs"]);
const summaries = [];
for (const run of [before, after]) {
  const generated = readableBenchmarkReport(run.report, run.failures);
  const text = fs.readFileSync(path.join(root, "docs", run.folder, "测试报告.txt"), "utf8");
  const html = fs.readFileSync(path.join(root, "docs", run.folder, "report.html"), "utf8");
  assert.equal(text.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n"), generated.text);
  assert.equal(html.replaceAll("\r\n", "\n"), generated.html);
  summaries.push({ folder: run.folder, text_sha256: sha(text), html_sha256: sha(html) });
}
const logs = ["readable-report-focused-first-2026-10-20.txt", "readable-report-regression-2026-10-20.txt"];
const localRoot = root.replace(/[\\/]$/, "");
for (const file of logs) {
  const location = path.join(root, "docs", file), raw = fs.readFileSync(location, "utf8");
  const redacted = raw.replaceAll(localRoot.replaceAll("\\", "\\\\"), "repo:")
    .replaceAll(localRoot, "repo:").replaceAll(localRoot.replaceAll("\\", "/"), "repo:")
    .replace(/[ \t]+$/gm, "");
  if (raw !== redacted) fs.writeFileSync(location, redacted);
}
const regression = fs.readFileSync(path.join(root, "docs", logs[1]), "utf8");
assert.match(regression, /^# tests 284$/m); assert.match(regression, /^# pass 284$/m); assert.match(regression, /^# fail 0$/m);
const focused = fs.readFileSync(path.join(root, "docs", logs[0]), "utf8");
assert.match(focused, /^# fail 1$/m);
const result = { verification_version: "readable-report-evidence.v6", verified_at: new Date().toISOString(),
  before_passed: 9900, after_passed: 10000, total: 10000, skipped: 0, templates: after.report.templates,
  unique_inputs: after.report.unique_inputs, seed: after.report.seed, dataset_sha256: after.report.dataset_sha256,
  unchanged_input_and_expectations: true, changed_sources: changed, original_failures: { "null-plan": 100 },
  regression_tests: 284, external_network_attempts: 0, paid_model_calls: 0, joint_acceptance: false,
  source_head_is_prechange_base: true, readable_summaries: summaries,
  final_visual_styles_sha256: sha(fs.readFileSync(path.join(root, "versions/product-overrides.css"))),
  visual_styles_note: "Style-only contrast fix verified by browser; styles are not executed by the 10000-case runner.",
  runs: [before, after].map(r => ({ folder: r.folder, passed: r.report.passed, failed: r.report.failed,
    groups: r.report.groups, evidence_records: r.tracesCount, evidence_verified: true, artifacts: r.evidenceSummary })) };
console.log(JSON.stringify({total:10000,before:9900,after:10000,templates:result.templates,
  unique_inputs:result.unique_inputs,changed_sources:changed,evidence_records:result.runs.map(r=>r.evidence_records),regression_tests:284}));
const index = process.argv.indexOf("--output");
if (index >= 0) {
  if (!process.argv[index + 1]) throw new Error("--output needs a new path");
  fs.writeFileSync(path.resolve(process.argv[index + 1]), JSON.stringify(result,null,2)+"\n", {flag:"wx"});
}
