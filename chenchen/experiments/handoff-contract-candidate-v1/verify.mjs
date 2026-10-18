import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error("Missing " + name);
  return path.resolve(process.argv[index + 1]);
}
const directory = path.dirname(fileURLToPath(import.meta.url));
const core = path.resolve(directory, "../..");
const runtime = path.join(core, "integrations/risk-handoff.js");
const patchFile = path.join(directory, "remove-undeclared-alias.patch");
const require = createRequire(runtime);
const baseline = require(runtime);
const source = fs.readFileSync(runtime, "utf8");
const patch = fs.readFileSync(patchFile, "utf8");
const aliasLine = "    source_task_id: record.source_task_id || null,";
// Only this reviewed one-line deletion can be tested by this verifier.
assert.deepEqual(patch.split(/\r?\n/).filter(line => /^[+-]/.test(line) && !/^---|^\+\+\+/.test(line)), ["-" + aliasLine]);
assert.equal(source.split(aliasLine).length, 2);
execFileSync("git", ["apply", "--check", patchFile], { cwd: path.dirname(core), stdio: "pipe", windowsHide: true });
const candidateSource = source.replace(aliasLine + (source.includes("\r\n") ? "\r\n" : "\n"), "");
// Execute a patched copy in memory. No production file or route is changed.
const candidateModule = { exports: {} };
compileFunction(candidateSource, ["require", "module", "exports"], { filename: runtime })(require, candidateModule, candidateModule.exports);
const candidate = candidateModule.exports;

const snapshot = argument("--snapshot");
const deps = createRequire(path.join(snapshot, "source/docs/safety-risk-eval/contracts/package.json"));
const Ajv2020 = deps("ajv/dist/2020");
const ajv = new Ajv2020({ strict: false, allErrors: true });
deps("ajv-formats")(ajv);
const schemaDirectory = path.join(core, "contracts");
const schemaHashes = {};
const digest = text => createHash("sha256").update(text).digest("hex");
for (const file of fs.readdirSync(schemaDirectory).filter(file => file.endsWith(".schema.json"))) {
  const bytes = fs.readFileSync(path.join(schemaDirectory, file));
  schemaHashes[file] = digest(bytes);
  ajv.addSchema(JSON.parse(bytes));
}
const validate = ajv.getSchema("https://fintechathon-agent.github.io/contracts/risk-handoff.v1.schema.json#/$defs/HandoffPackage");
assert.equal(typeof validate, "function");
const evidenceFile = argument("--evidence");
const evidenceBytes = fs.readFileSync(evidenceFile);
const evidence = JSON.parse(evidenceBytes);
const records = evidence.transport.filter(entry => entry.response?.workflow_version && entry.response?.proposed_action).map(entry => entry.response);
assert.ok(records.length > 0);
const results = [];
for (const record of records) {
  const originalRecord = structuredClone(record);
  const live = baseline.buildRiskHandoffPackage(record);
  const baselineValid = validate(live);
  const baselineErrors = structuredClone(validate.errors);
  assert.equal(baselineValid, false);
  assert.ok(baselineErrors.some(error => error.keyword === "additionalProperties" && error.params.additionalProperty === "source_task_id"));
  const proposed = candidate.buildRiskHandoffPackage(record);
  assert.equal(validate(proposed), true, JSON.stringify(validate.errors));
  const expected = structuredClone(live); delete expected.source_task_id;
  assert.deepEqual(proposed, expected);
  assert.equal(proposed.reviewed_input.source_task_id, record.source_task_id);
  assert.equal(proposed.execution_allowed, false);
  assert.deepEqual(record, originalRecord);
  const callback = { callback_version: "risk-callback.v1", handoff_id: proposed.handoff_id, task_id: proposed.task_id,
    request_id: proposed.request_id, run_id: proposed.run_id, audit_id: proposed.audit_id,
    proposal_sha256: proposed.proposal.proposal_sha256, decision: "REJECT", reviewer: "synthetic-risk", reason: "Contract verification only" };
  assert.deepEqual(candidate.validateRiskCallback(callback, record), callback);
  for (const field of ["task_id", "request_id", "run_id", "audit_id", "handoff_id", "proposal_sha256"]) {
    assert.throws(() => candidate.validateRiskCallback({ ...callback, [field]: "tampered" }, record), e => e.code === "RISK_HANDOFF_MISMATCH");
  }
  assert.equal(validate({ ...proposed, undocumented_field: true }), false);
  assert.equal(validate({ ...proposed, execution_allowed: true }), false);
  results.push({ task_id: record.task_id, source_task_id: record.source_task_id, baseline_valid: false,
    baseline_errors: baselineErrors, candidate_valid: true, callback_bindings_checked: 6,
    source_record_unchanged: true, only_removed_field: "source_task_id", candidate_handoff: proposed });
}
const legacy = structuredClone(records[0]); legacy.reviewed_input = null;
const legacyPackage = candidate.buildRiskHandoffPackage(legacy);
assert.equal(validate(legacyPackage), true, JSON.stringify(validate.errors));
assert.equal(legacyPackage.reviewed_input, null);
assert.equal(legacy.source_task_id, records[0].source_task_id);
assert.ok(!Object.hasOwn(legacyPackage, "source_task_id"));
assert.equal(fs.readFileSync(runtime, "utf8"), source);
for (const [file, hash] of Object.entries(schemaHashes)) assert.equal(digest(fs.readFileSync(path.join(schemaDirectory, file))), hash);
const report = { report_version: "handoff-candidate-check.v1", checked_at: new Date().toISOString(),
  status: "CANDIDATE_VALIDATED_NOT_APPLIED", live_contract_status: "BLOCKED_SOURCE_TASK_ID_UNDECLARED",
  runtime_changed: false, schemas_changed: false, routes_changed: false, owner_confirmation: false,
  validator: "ajv " + deps("ajv/package.json").version, patch_sha256: digest(patch), runtime_sha256: digest(source),
  source_evidence_file: path.basename(evidenceFile), source_evidence_sha256: digest(evidenceBytes), schema_sha256: schemaHashes,
  records_checked: records.length, checks: results,
  legacy: { reviewed_input: null, source_record_retained: true, source_in_package: false,
    required_owner_decision: "Legacy consumers needing source_task_id must read the workflow record or choose a versioned contract alternative. No source is fabricated." },
  boundaries: { external_model_calls: 0, paid_model_calls: 0, actual_risk_service_called: false, joint_acceptance: false,
    provider_response_id_gap_resolved: false, formal_callback_connected: false } };
const output = argument("--output");
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
process.stdout.write(JSON.stringify({ status: report.status, records_checked: records.length,
  live_contract_status: report.live_contract_status, output: path.basename(output) }) + "\n");
