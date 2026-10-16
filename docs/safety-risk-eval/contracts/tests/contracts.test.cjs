"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const c = require("../validate.cjs");
const pair = (name = "allow") => ({ input: c.read(`examples/${name}.input.json`), output: c.read(`examples/${name}.output.json`) });
const has = (issues, code) => assert.ok(issues.some((issue) => issue.code === code), JSON.stringify(issues));

test("four authored examples and ten rule definitions validate offline", () => c.verifyExamples());
test("main handoff stays unchanged and cannot be replaced with a Risk result", () => {
  const { input } = pair();
  assert.equal(input.upstream.risk_handoff.decision, "REQUIRED");
  input.upstream.risk_handoff.decision = "ALLOW";
  has(c.shape("input", input), "SCHEMA_INVALID");
});
test("empty upstream artifacts do not count as a complete Risk input", () => {
  const { input } = pair(); input.upstream.artifacts = {};
  has(c.inputIssues(input), "EVIDENCE_MISMATCH");
});
test("cross-task or cross-session binding is rejected", () => {
  const { input } = pair(); input.binding.task_id = "another-task";
  has(c.inputIssues(input), "BINDING_MISMATCH");
});
test("missing tool provenance cannot masquerade as complete evidence", () => {
  const { input } = pair(); input.upstream.tool_results = {};
  has(c.inputIssues(input), "EVIDENCE_MISMATCH");
});
test("shape-valid evidence mismatch is an explicit ERROR fixture", () => {
  const { input, output } = pair("error");
  assert.deepEqual(c.shape("input", input), []);
  has(c.inputIssues(input), "EVIDENCE_MISMATCH");
  assert.deepEqual(c.outputIssues(output, input), []);
});
test("incomplete checks cannot be reported as ALLOW", () => {
  const { input } = pair("error"); const { output } = pair();
  output.risk_request_id = input.risk_request_id;
  has(c.outputIssues(output, input), "FAIL_CLOSED");
});
test("signed historical drawdown cannot be replaced by positive percentage points", () => {
  const { input } = pair();
  input.upstream.artifacts.simulation.comparisons[1].metrics.max_drawdown = 2.78;
  has(c.inputIssues(input), "METRIC_UNIT_MISMATCH");
});
test("profile tolerance is a ratio, not a percent number", () => {
  const { input } = pair(); input.profile.max_historical_drawdown = 20;
  has(c.shape("input", input), "SCHEMA_INVALID");
});
test("nonfinite numbers and numeric strings are rejected", () => {
  for (const value of [NaN, Infinity, "5000"]) {
    const { input } = pair(); input.profile.reserve_cash = value;
    has(c.shape("input", input), "SCHEMA_INVALID");
  }
});
test("unknown profile values stay null without becoming invented zeroes", () => {
  const { input, output } = pair(); input.profile.reserve_cash = null; input.profile.unknown_fields = ["reserve_cash"];
  assert.deepEqual(c.shape("input", input), []);
  has(c.outputIssues(output, input), "MISSING_CONFIRMED_CONSTRAINTS");
});
test("ETF classification keeps unknown mass and rejects incomplete sums", () => {
  const { input } = pair(); const item = input.data_context.classification[1];
  item.sector_weights.Technology = 0.6; item.unknown_weight = 0.4;
  assert.deepEqual(c.inputIssues(input), []);
  item.unknown_weight = 0;
  has(c.inputIssues(input), "INVALID_CLASSIFICATION");
});
test("changing a plan invalidates the recorded plan hash", () => {
  const { input } = pair(); input.plan.steps[0].cash_after = 9000;
  has(c.inputIssues(input), "PLAN_HASH_MISMATCH");
});
test("data version drift is detectable", () => {
  const { input } = pair(); input.data_context.version = "v-next";
  has(c.inputIssues(input), "VERSION_MISMATCH");
});
test("latest data mode requires an explicit freshness policy deadline", () => {
  const { input } = pair(); input.plan.data_mode = "LATEST_AVAILABLE";
  input.binding.plan_hash = c.hash(input.plan);
  has(c.inputIssues(input), "INVALID_DATA_CONTEXT");
});
test("every rule occurs once and missing rules cannot silently pass", () => {
  const { input, output } = pair(); output.checks[1].rule_id = "R01";
  has(c.outputIssues(output, input), "RULE_COVERAGE");
});
test("a hard BLOCK cannot be made acceptable by a checkbox", () => {
  const { output } = pair("block"); output.reasons[0].acceptance_allowed = true;
  has(c.shape("output", output), "SCHEMA_INVALID");
});
test("repair-type reasons cannot be accepted as financial risk", () => {
  const { input, output } = pair("review");
  output.reasons[0].rule_id = "R02"; output.reasons[0].code = "DATA_MISSING";
  has(c.outputIssues(output, input), "INVALID_ACCEPTANCE");
});
test("stable reasons must belong to the specified rule", () => {
  const { input, output } = pair("review"); output.reasons[0].code = "MADE_UP_REASON";
  has(c.outputIssues(output, input), "UNKNOWN_REASON_CODE");
});
test("broken reason evidence pointers are rejected", () => {
  const { input, output } = pair("review"); output.reasons[0].evidence_refs = ["/not-present"];
  has(c.outputIssues(output, input), "BROKEN_REASON_EVIDENCE");
});
test("Risk output cannot claim execution authorization", () => {
  const { output } = pair(); output.execution_allowed = true;
  has(c.shape("output", output), "SCHEMA_INVALID");
});
test("confirmed approval requires person, time, expiry, check ID and full binding", () => {
  const { input } = pair(); input.approval.status = "CONFIRMED";
  has(c.shape("input", input), "SCHEMA_INVALID");
});
test("Risk cannot fabricate a changed confirmation state", () => {
  const { input, output } = pair(); output.approval.status = "REJECTED";
  has(c.outputIssues(output, input), "STATE_MISMATCH");
});
test("execution preflight cannot skip approval, idempotency or durable audit", () => {
  const { input, output } = pair(); input.stage = output.stage = "EXECUTION_PREFLIGHT";
  output.checks.forEach((check) => { check.status = "PASS"; });
  const errors = c.outputIssues(output, input);
  has(errors, "INVALID_APPROVAL"); has(errors, "AUDIT_NOT_RECORDED"); has(errors, "INVALID_EXECUTION_CONTEXT");
});
test("audits retain decision and version bindings", () => {
  const { input, output } = pair(); output.audit_event.binding.plan_version = "changed";
  has(c.outputIssues(output, input), "AUDIT_MISMATCH");
});
test("audits cannot omit required fields", () => {
  const { output } = pair(); delete output.audit_event.input_sha256;
  has(c.shape("output", output), "SCHEMA_INVALID");
});
test("review reasons remain attached to the audit", () => {
  const { input, output } = pair("review"); output.audit_event.reason_details = [];
  has(c.outputIssues(output, input), "AUDIT_MISMATCH");
});
test("ERROR preserves a known BLOCK while keeping incomplete-check semantics", () => {
  const { input, output } = pair("error");
  const blocked = pair("block").output.reasons[0]; output.reasons.push(blocked);
  output.checks[2].status = "BLOCK"; output.checks[2].reason_ids = [blocked.reason_id];
  output.audit_event.checks = structuredClone(output.checks);
  output.audit_event.reason_details = structuredClone(output.reasons);
  output.audit_event.reason_ids = output.reasons.map((reason) => reason.reason_id);
  output.audit_event.metrics_and_thresholds = output.checks.flatMap((check) => check.measurements);
  assert.equal(c.outputIssues(output, input).some((x) => x.code === "DECISION_MISMATCH"), false);
  output.decision = "BLOCK"; output.check_complete = true;
  has(c.outputIssues(output, input), "DECISION_MISMATCH");
});
test("demo thresholds use both denominators and keep strict versus inclusive comparisons", () => {
  assert.deepEqual(c.rules[3].conditions.map((x) => [x.operator, x.threshold, x.basis]), [
    ["GT", .35, "TOTAL_ASSETS"], ["GT", .75, "TOTAL_ASSETS"],
    ["GT", .5, "INVESTED_ASSETS"], ["GT", .9, "INVESTED_ASSETS"]
  ]);
  assert.deepEqual(c.rules[6].conditions.map((x) => [x.operator, x.threshold, x.group]), [["GTE", .8, "PAIR_AND"], ["GT", .4, "PAIR_AND"]]);
});


test("latest shared trace and audit evidence stay correlated to this task", () => {
  for (const field of ["request_id", "task_id", "session_id"]) {
    const { input } = pair(); input.upstream.trace[field] = "foreign-" + field;
    has(c.inputIssues(input), "BINDING_MISMATCH");
    const second = pair().input; second.upstream.audit_evidence[field] = "foreign-" + field;
    has(c.inputIssues(second), "BINDING_MISMATCH");
  }
});
test("latest shared audit events and handoff audit reference cannot come from another task", () => {
  const { input } = pair(); input.upstream.audit_evidence.events[0].task_id = "foreign-task";
  has(c.inputIssues(input), "EVIDENCE_MISMATCH");
  const second = pair().input; second.upstream.risk_handoff.evidence.audit_id = "foreign-audit";
  has(c.inputIssues(second), "EVIDENCE_MISMATCH");
});
