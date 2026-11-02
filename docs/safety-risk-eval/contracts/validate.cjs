"use strict";

// Offline contract checks only: this module never makes a Risk decision or executes a trade.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const Ajv = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const root = __dirname;
const repo = path.resolve(root, "../../..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const upstream = JSON.parse(fs.readFileSync(path.join(repo, "chenchen/contracts/investment-agent.v1.schema.json"), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false, strictNumbers: true, validateFormats: true });
addFormats(ajv);
ajv.addSchema(upstream);
ajv.addSchema(read("common.schema.json"));
const validators = Object.fromEntries(["input", "output", "rule"].map((name) => [name, ajv.compile(read(`risk-${name}.schema.json`))]));
const ruleIds = Array.from({ length: 10 }, (_, i) => `R${String(i + 1).padStart(2, "0")}`);
const rules = ruleIds.map((id) => read(`rules/${id}.json`));
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const pointer = (value, ref) => {
  if (!ref.startsWith("/")) return undefined;
  return ref.slice(1).split("/").map((key) => key.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((node, key) => node && Object.hasOwn(node, key) ? node[key] : undefined, value);
};

function shape(kind, value) {
  const validate = validators[kind];
  return validate(value) ? [] : validate.errors.map((error) => ({ code: "SCHEMA_INVALID", path: error.instancePath, message: error.message }));
}

function inputIssues(input) {
  const issues = shape("input", input);
  if (issues.length) return issues;
  const add = (code, message) => issues.push({ code, message });
  const { upstream: u, binding: b } = input;
  const h = u.risk_handoff;
  if (!h || u.task_state.status !== "HANDOFF_REQUIRED" || u.task_state.stage !== "RISK_CHECK") {
    add("INVALID_HANDOFF", "A pending Risk handoff is required.");
    return issues;
  }
  for (const [key, expected] of Object.entries({ request_id: u.request_id, handoff_id: h.handoff_id, task_id: u.task_state.task_id, session_id: u.task_state.session_id })) {
    if (b[key] !== expected) add("BINDING_MISMATCH", key);
  }
  if (h.task_id !== b.task_id || h.session_id !== b.session_id) add("BINDING_MISMATCH", "handoff task/session");
  const a = u.artifacts;
  if (!Object.keys(u.tool_results).length) add("EVIDENCE_MISMATCH", "Missing tool provenance");
  for (const [traceId, result] of Object.entries(u.tool_results)) {
    if (result.trace_id !== traceId || !result.version || !result.inputs_hash || !result.data_as_of) add("EVIDENCE_MISMATCH", "Tool provenance metadata");
  }
  for (const [key, expected] of Object.entries({ portfolio_snapshot_id: a.portfolio_snapshot?.snapshot_id, health_report_id: a.health_report?.report_id, simulation_id: a.simulation?.simulation_id })) {
    if (!expected || h.evidence[key] !== expected) add("EVIDENCE_MISMATCH", key);
  }
  if (a.health_report?.snapshot_id !== a.portfolio_snapshot?.snapshot_id || a.simulation?.snapshot_id !== a.portfolio_snapshot?.snapshot_id) add("EVIDENCE_MISMATCH", "snapshot lineage");
  if (u.task_state.portfolio_snapshot_id !== a.portfolio_snapshot?.snapshot_id) add("EVIDENCE_MISMATCH", "task snapshot");
  if (h.evidence.market_context_id && h.evidence.market_context_id !== a.market_context?.context_id) add("EVIDENCE_MISMATCH", "market context");
  const candidate = a.candidates?.find((x) => x.proposal_id === b.proposal_id);
  if (!candidate || !h.evidence.proposal_ids.includes(b.proposal_id) || candidate.proposal_hash !== b.proposal_hash) add("EVIDENCE_MISMATCH", "selected proposal");
  const comparison = a.simulation?.comparisons?.find((x) => x.proposal_id === b.proposal_id);
  if (!comparison || comparison.plan_id !== candidate?.plan_id) add("EVIDENCE_MISMATCH", "selected simulation");
  if (typeof comparison?.metrics?.max_drawdown !== "number" || comparison.metrics.max_drawdown > 0 || comparison.metrics.max_drawdown < -1) add("METRIC_UNIT_MISMATCH", "Main historical drawdown must be a signed ratio in [-1, 0].");
  if (candidate && Math.abs(Object.values(candidate.target_weights).reduce((sum, x) => sum + x, 0) - 1) > 1e-6) add("INVALID_WEIGHTS", "Target weights must sum to one within rounding tolerance.");
  for (const item of input.data_context.classification) {
    if (Math.abs(Object.values(item.sector_weights).reduce((sum, x) => sum + x, item.unknown_weight) - 1) > 1e-6) add("INVALID_CLASSIFICATION", item.instrument_id);
  }
  if (hash(input.plan) !== b.plan_hash) add("PLAN_HASH_MISMATCH", "Plan content changed.");
  if (b.data_version !== input.data_context.version || b.trading_rules_version !== (input.data_context.trading_rules?.version ?? null)) add("VERSION_MISMATCH", "Data/trading rules version");
  if (b.rules_version !== rules[0].version) add("VERSION_MISMATCH", "Unsupported rule set");
  if (input.plan.data_mode === "LATEST_AVAILABLE" && (input.data_context.usage !== "CURRENT_ADVICE" || input.data_context.valid_until === null)) add("INVALID_DATA_CONTEXT", "Latest advice needs a freshness deadline.");
  if (input.plan.data_mode !== "LATEST_AVAILABLE" && input.data_context.usage !== "HISTORICAL_REPLAY") add("INVALID_DATA_CONTEXT", "Replay must remain labelled historical.");
  if (input.profile.confirmed_by_user && (!input.profile.confirmed_at || input.profile.confirmed_by !== b.user_id)) add("INVALID_PROFILE_CONFIRMATION", "Confirmed profile requires attributable user and timestamp.");
  return issues;
}

function outputIssues(output, input) {
  const issues = shape("output", output);
  if (issues.length) return issues;
  const add = (code, message) => issues.push({ code, message });
  if (output.risk_request_id !== input.risk_request_id || output.stage !== input.stage || !isDeepStrictEqual(output.binding, input.binding)) add("BINDING_MISMATCH", "Output must bind to the reviewed input.");
  if (!isDeepStrictEqual(output.approval, input.approval) || !isDeepStrictEqual(output.execution, input.execution)) add("STATE_MISMATCH", "Risk result must not fabricate approval or execution state.");
  if (new Set(output.checks.map((x) => x.rule_id)).size !== 10) add("RULE_COVERAGE", "Every rule must occur exactly once.");
  const reasonIds = output.reasons.map((x) => x.reason_id);
  if (new Set(reasonIds).size !== reasonIds.length) add("DUPLICATE_REASON", "Reason IDs must be unique.");
  const statuses = output.checks.map((x) => x.status);
  const expected = statuses.includes("ERROR") ? "ERROR" : statuses.includes("BLOCK") ? "BLOCK" : statuses.includes("REVIEW") ? "REVIEW" : "ALLOW";
  if (output.decision !== expected) add("DECISION_MISMATCH", "Aggregate decision must preserve incomplete checks before known violations.");
  for (const check of output.checks) {
    const reasons = output.reasons.filter((x) => x.rule_id === check.rule_id);
    const strongest = ["ERROR", "BLOCK", "REVIEW"].find((status) => reasons.some((reason) => reason.decision === status));
    if (strongest && check.status !== strongest) add("DECISION_MISMATCH", check.rule_id);
    if (!isDeepStrictEqual([...check.reason_ids].sort(), reasons.map((x) => x.reason_id).sort())) add("REASON_LINK_MISMATCH", check.rule_id);
    if (["REVIEW", "BLOCK", "ERROR"].includes(check.status) && !reasons.some((x) => x.decision === check.status)) add("MISSING_REASON", check.rule_id);
    if (["PASS", "NOT_APPLICABLE", "NOT_EVALUATED"].includes(check.status) && reasons.length) add("REASON_LINK_MISMATCH", check.rule_id);
    if (check.status === "NOT_EVALUATED" && output.decision !== "ERROR") add("INCOMPLETE_CHECK", check.rule_id);
    if (check.status === "NOT_APPLICABLE" && (input.stage === "EXECUTION_PREFLIGHT" || !["R08", "R09", "R10"].includes(check.rule_id))) add("RULE_COVERAGE", check.rule_id);
  }
  for (const reason of output.reasons) {
    const rule = rules.find((r) => r.rule_id === reason.rule_id);
    if (!rule.reason_codes.includes(reason.code) || !rule.failure_decisions.includes(reason.decision)) add("UNKNOWN_REASON_CODE", reason.code);
    if (reason.evidence_refs.some((r) => pointer(input, r) === undefined)) add("BROKEN_REASON_EVIDENCE", reason.reason_id);
    const acceptable = ["MAX_DRAWDOWN_EXCEEDED", "HIGH_CORRELATION_CONCENTRATION", "SECTOR_INFORMATION_INCOMPLETE", "GRADUAL_IMPROVEMENT_ACCEPTANCE"];
    if (reason.acceptance_allowed && !acceptable.includes(reason.code)) add("INVALID_ACCEPTANCE", reason.code);
  }
  if (inputIssues(input).length && output.decision !== "ERROR") add("FAIL_CLOSED", "Invalid evidence must not yield a completed decision.");
  if (output.decision === "ALLOW" && (!input.profile.confirmed_by_user || ["reserve_cash", "max_historical_drawdown", "forbidden_instruments", "allowed_instruments"].some((key) => input.profile[key] === null))) add("MISSING_CONFIRMED_CONSTRAINTS", "Missing or unconfirmed constraints cannot silently yield ALLOW.");
  if (input.stage === "EXECUTION_PREFLIGHT" && output.decision === "ALLOW") {
    const approval = input.approval;
    if (approval.status !== "CONFIRMED" || approval.confirmed_by !== input.binding.user_id || !isDeepStrictEqual(approval.binding, input.binding) || Date.parse(approval.expires_at) <= Date.parse(output.checked_at)) add("INVALID_APPROVAL", "Confirmed, current, version-bound approval is required.");
    if (input.audit_context.pre_execution_record_status !== "RECORDED" || !input.audit_context.pre_execution_record_id) add("AUDIT_NOT_RECORDED", "Pre-execution audit must be durable.");
    if (!input.execution.idempotency_key || !input.execution.content_hash || input.execution.status !== "NOT_STARTED") add("INVALID_EXECUTION_CONTEXT", "Only a new idempotent execution can become eligible.");
    if (input.plan.steps.some((step) => step.orders.length) && !input.data_context.trading_rules) add("MISSING_TRADING_RULES", "Trade steps need instrument rules.");
  }
  const a = output.audit_event;
  for (const key of ["binding", "risk_check_id", "stage", "decision", "approval", "execution", "checks"]) {
    if (!isDeepStrictEqual(a[key], output[key])) add("AUDIT_MISMATCH", key);
  }
  if (a.input_sha256 !== hash(input) || a.correlation_id !== input.audit_context.correlation_id || !isDeepStrictEqual(a.reason_details, output.reasons) || !isDeepStrictEqual(a.reason_ids, reasonIds)) add("AUDIT_MISMATCH", "input/reasons/correlation");
  if (!isDeepStrictEqual(a.rule_ids, ruleIds) || !isDeepStrictEqual(a.metrics_and_thresholds, output.checks.flatMap((r) => r.measurements))) add("AUDIT_MISMATCH", "rules/check measurements");
  if (a.evidence_refs.some((r) => pointer(input, r) === undefined)) add("AUDIT_MISMATCH", "evidence pointer");
  return issues;
}

function verifyExamples() {
  for (const rule of rules) {
    const errors = shape("rule", rule);
    if (errors.length) throw new Error(JSON.stringify({ rule: rule.rule_id, errors }));
  }
  for (const item of read("examples/manifest.json").cases) {
    const input = read(`examples/${item.name}.input.json`);
    const output = read(`examples/${item.name}.output.json`);
    const inputErrors = inputIssues(input).map((x) => x.code);
    const errors = [...shape("input", input), ...outputIssues(output, input)];
    if (!isDeepStrictEqual(inputErrors, item.expected_input_semantic_errors) || output.decision !== item.expected_decision || errors.length) throw new Error(JSON.stringify({ case: item.name, inputErrors, errors }, null, 2));
    console.log(`${item.name}: schema and linkage verified; authored decision=${output.decision}`);
  }
}
if (require.main === module) verifyExamples();
module.exports = { read, rules, ruleIds, hash, pointer, shape, inputIssues, outputIssues, verifyExamples };
