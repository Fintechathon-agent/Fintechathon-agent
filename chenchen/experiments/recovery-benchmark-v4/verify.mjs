import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sha = value => createHash("sha256").update(value).digest("hex");
const parseLines = value => value.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
function inspect(folder) {
  const location = path.join(root, "docs", folder), read = name => fs.readFileSync(path.join(location, name));
  const report = JSON.parse(read("report.json")), dataset = read("cases.jsonl").toString("utf8").replaceAll("\r\n", "\n");
  const cases = parseLines(dataset), results = parseLines(read("results.jsonl").toString("utf8"));
  assert.equal(sha(dataset), report.dataset_sha256);
  assert.equal(cases.length, 5000); assert.equal(results.length, 5000);
  assert.equal(new Set(cases.map(c => c.case_id)).size, 5000);
  assert.deepEqual(cases.map(c => c.case_id), results.map(r => r.case_id));
  assert.equal(report.passed, results.filter(r => r.passed).length);
  assert.equal(report.failed, results.filter(r => !r.passed).length);
  assert.equal(report.total, 5000); assert.equal(report.skipped, 0);
  assert.equal(report.external_network_attempts, 0); assert.equal(report.external_model_calls, 0); assert.equal(report.paid_model_calls, 0);
  assert.equal(report.parameterized_templates, new Set(cases.map(c => c.group + ":" + c.template)).size);
  for (const group of report.groups) {
    const subset = results.filter(r => r.group === group.group);
    assert.equal(group.cases, subset.length); assert.equal(group.passed, subset.filter(r => r.passed).length);
    assert.equal(group.failed, subset.filter(r => !r.passed).length);
  }
  const packed = read(report.evidence_artifact.file), unpacked = gunzipSync(packed);
  assert.equal(packed.length, report.evidence_artifact.bytes);
  assert.equal(sha(packed), report.evidence_artifact.sha256);
  assert.equal(sha(unpacked), report.evidence_artifact.uncompressed_sha256);
  const traces = parseLines(unpacked.toString("utf8")), passedIds = new Set(results.filter(r => r.passed).map(r => r.case_id));
  assert.equal(traces.length, report.evidence_artifact.records);
  assert.equal(new Set(traces.map(t => t.case_id)).size, traces.length);
  assert.ok(traces.every(t => passedIds.has(t.case_id)));
  const uniqueInputs = new Set(cases.map(c => JSON.stringify({ group: c.group, template: c.template, input: c.input }))).size;
  // Scan the actual decompressed evidence, not just its container name.
  assert.equal(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?<![A-Za-z0-9_-])(?:ghp_|github_pat_|sk-)[A-Za-z0-9_-]{20,}/.test(unpacked.toString("utf8")), false);
  return { folder, report, results, cases, unique_inputs: uniqueInputs,
    evidence_verified: true, evidence_records: traces.length, uncompressed_bytes: unpacked.length };
}

const before = inspect("benchmark-5000-recovery-first-2026-10-19"), after = inspect("benchmark-5000-recovery-after-2026-10-19");
assert.deepEqual(before.cases, after.cases);
assert.equal(before.report.passed, 4800); assert.equal(after.report.passed, 5000);
const changed = Object.keys(after.report.source_sha256).filter(key => before.report.source_sha256[key] !== after.report.source_sha256[key]);
assert.deepEqual(changed, ["integrations/review-workflow.js"]);
const failures = before.results.filter(r => !r.passed), failureGroups = {};
for (const row of failures) {
  assert.equal(row.error.code, "IDEMPOTENCY_CONFLICT");
  failureGroups[row.template] = (failureGroups[row.template] || 0) + 1;
}
assert.deepEqual(failureGroups, { "same-key": 100, "model-failure": 100 });

// Path redaction is presentation-only; preserve every test result and stack line.
const workspacePath = root.replace(/[\\/]$/, "");
const logNames = ["benchmark-5000-recovery-replay-before-2026-10-19.txt", "benchmark-5000-recovery-regression-2026-10-19.txt"];
for (const file of logNames) {
  const location = path.join(root, "docs", file), raw = fs.readFileSync(location, "utf8");
  const clean = raw.replaceAll(workspacePath.replaceAll("\\", "\\\\"), "repo:")
    .replaceAll(workspacePath, "repo:").replaceAll(workspacePath.replaceAll("\\", "/"), "repo:");
  if (clean !== raw) fs.writeFileSync(location, clean);
}
const regression = fs.readFileSync(path.join(root, "docs", logNames[1]), "utf8");
assert.match(regression, /^# tests 274$/m); assert.match(regression, /^# pass 274$/m); assert.match(regression, /^# fail 0$/m);
const result = { verification_version: "investment-recovery-evidence.v1", verified_at: new Date().toISOString(),
  total: 5000, before_passed: 4800, after_passed: 5000, unchanged_input_and_expectations: true, changed_sources: changed,
  templates: after.report.parameterized_templates, unique_inputs: after.unique_inputs, seed: after.report.seed,
  dataset_sha256: after.report.dataset_sha256, original_failures: failureGroups, regression_tests: 274,
  source_head_is_prechange_base: true, external_network_attempts: 0, paid_model_calls: 0, joint_acceptance: false,
  fault_test_mode: "IN_MEMORY_STORAGE_AND_SAME_PROCESS_SERVICE_RECONSTRUCTION",
  concurrency_test_mode: "CONTROLLED_ASYNC_INTERLEAVING_NOT_PUBLIC_LOAD",
  runs: [before, after].map(r => ({ folder: r.folder, passed: r.report.passed, failed: r.report.failed, groups: r.report.groups,
    evidence_verified: r.evidence_verified, evidence_records: r.evidence_records, compressed_bytes: r.report.evidence_artifact.bytes,
    uncompressed_bytes: r.uncompressed_bytes, evidence_sha256: r.report.evidence_artifact.sha256 })) };
console.log(JSON.stringify(result, null, 2));
const index = process.argv.indexOf("--output");
if (index >= 0) {
  if (!process.argv[index + 1]) throw new Error("--output requires a new file path");
  fs.writeFileSync(path.resolve(process.argv[index + 1]), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
}
