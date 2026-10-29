"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { authorizeCapability } = require("../permission.cjs");

const now = "2026-10-29T12:00:00+08:00";
function fixture(capability = "financial_data.read") {
  const request = { capability, resource_id: "synthetic-account-1", purpose: "CURRENT_ANALYSIS", audience: "workbench-risk-service", environment: "TEAM_SYNTHETIC" };
  const confirmation = { "financial_data.read": "DATA_ACCESS_GRANT", "analysis.run": "EXISTING_ANALYSIS_SCOPE", "memory.read": "MEMORY_READ_GRANT", "model_context.send": "MODEL_DATA_SEND_CONSENT", "execution.reconcile": "OWNER_EXECUTION_READ_GRANT" }[capability] || "COMPLETE_PAPER_PLAN_APPROVAL";
  const context = { session_verified: true, subject_id: "synthetic-user-1", actor_id: "workbench-server", actor_type: "AUTHENTICATED_SCOPED_SERVICE_ACTOR", service_verified: true, actor_capabilities: [capability], resource_id: request.resource_id, resource_owner: "synthetic-user-1", environment: request.environment, versions: { resource_version: "v1", authorization_version: "v1" }, now, validation_status: "READY", grants: [] };
  context.grants.push({ grant_id: "synthetic-grant-1", subject_id: context.subject_id, actor_id: context.actor_id, ...request, issued_at: "2026-10-29T11:55:00+08:00", expires_at: "2026-10-29T12:05:00+08:00", revoked: false, versions: { ...context.versions }, confirmation_type: confirmation, confirmation_verified: true });
  return { context, request };
}
function checkDenied(value, code) {
  assert.equal(value.decision, "DENY");
  if (code) assert.equal(value.code, code);
  assert.equal(value.execution_allowed, false);
  assert.equal(value.starts_new_risk_check, false);
  assert.equal(value.preserve_prior_risk_records, true);
  assert.equal(Object.hasOwn(value, "risk_engine_ran"), false);
}

test("private read permits only its exact server-verified resource grant", () => {
  const { context, request } = fixture();
  const before = structuredClone(context);
  const result = authorizeCapability(context, request);
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.execution_allowed, false);
  assert.deepEqual(context, before);
  assert.equal(Object.isFrozen(result), true);
});

test("a registered public resource is readable without private identity", () => {
  const request = { capability: "public.read", resource_id: "policy-help", purpose: "HELP", audience: "public-help", environment: "TEAM_SYNTHETIC" };
  const context = { environment: request.environment, now, public_resources: [{ resource_id: request.resource_id, purpose: request.purpose, audience: request.audience, environment: request.environment }] };
  assert.equal(authorizeCapability(context, request).decision, "ALLOW");
  checkDenied(authorizeCapability(context, { ...request, resource_id: "private-report" }), "PUBLIC_RESOURCE_NOT_REGISTERED");
});

test("public registry absence is an error rather than inferred public access", () => {
  const { context, request } = fixture("public.read");
  const result = authorizeCapability(context, request);
  assert.equal(result.decision, "ERROR");
  assert.equal(result.code, "PUBLIC_RESOURCE_REGISTRY_UNAVAILABLE");
});

test("client-supplied role, identity, approval or grants cannot upgrade a request", () => {
  for (const control of [{ role: "admin" }, { subject_id: "synthetic-user-1" }, { approved: true }, { grants: ["*"] }, { risk_decision: "ALLOW" }]) {
    const { context, request } = fixture();
    checkDenied(authorizeCapability(context, { ...request, ...control }), "UNTRUSTED_CONTROL_FIELD");
  }
});

test("unknown capabilities and an L3 label never inherit read permission", () => {
  const { context, request } = fixture();
  checkDenied(authorizeCapability(context, { ...request, capability: "L3" }), "ACTION_SCOPE_DENIED");
  checkDenied(authorizeCapability(context, { ...request, capability: "financial_data.*" }), "ACTION_SCOPE_DENIED");
});

test("cross-user or guessed resource IDs are rejected before returning data", () => {
  const { context, request } = fixture();
  checkDenied(authorizeCapability({ ...context, resource_owner: "synthetic-user-2" }, request), "SUBJECT_OR_RESOURCE_MISMATCH");
  checkDenied(authorizeCapability(context, { ...request, resource_id: "synthetic-account-2" }), "SUBJECT_OR_RESOURCE_MISMATCH");
});

test("service identity is not an end-user session or vice versa", () => {
  const { context, request } = fixture();
  checkDenied(authorizeCapability({ ...context, session_verified: false }, request), "SUBJECT_AUTHENTICATION_REQUIRED");
  checkDenied(authorizeCapability({ ...context, service_verified: false }, request), "SERVICE_AUTH_REQUIRED");
});

test("an actor scope and a user grant must both cover the exact action", () => {
  const { context, request } = fixture();
  checkDenied(authorizeCapability({ ...context, actor_capabilities: ["analysis.run"] }, request), "ACTOR_SCOPE_DENIED");
  checkDenied(authorizeCapability({ ...context, grants: [] }, request), "ACTION_SCOPE_DENIED");
});

test("purpose, audience and environment do not widen automatically", () => {
  const { context, request } = fixture();
  for (const changed of [{ purpose: "EXPORT_ALL" }, { audience: "another-model" }]) checkDenied(authorizeCapability(context, { ...request, ...changed }), "ACTION_SCOPE_DENIED");
  checkDenied(authorizeCapability(context, { ...request, environment: "PRODUCTION" }), "ENVIRONMENT_SCOPE_MISMATCH");
});

test("expired, revoked and future grants remain denied at the exact boundary", () => {
  for (const patch of [{ expires_at: now }, { revoked: true }, { issued_at: "2026-10-29T12:00:01+08:00" }]) {
    const { context, request } = fixture();
    Object.assign(context.grants[0], patch);
    checkDenied(authorizeCapability(context, request), "GRANT_NOT_VALID");
  }
});

test("changed or removed version dependencies invalidate prior consent", () => {
  for (const versions of [{ resource_version: "v2", authorization_version: "v1" }, { resource_version: "v1" }]) {
    const { context, request } = fixture();
    context.versions = versions;
    checkDenied(authorizeCapability(context, request), "CONTEXT_VERSION_CHANGED");
  }
});

test("separate partial grants cannot be unioned into an authorization", () => {
  const { context, request } = fixture();
  context.grants[0].purpose = "OTHER_PURPOSE";
  context.grants.push({ ...context.grants[0], grant_id: "grant-2", purpose: request.purpose, audience: "other-audience" });
  checkDenied(authorizeCapability(context, request), "ACTION_SCOPE_DENIED");
});

test("model sending needs independent confirmed consent and field scope", () => {
  const { context, request } = fixture("model_context.send");
  request.fields = ["cash", "purposes"];
  context.grants[0].fields = ["cash", "purposes"];
  assert.equal(authorizeCapability(context, request).decision, "ALLOW");
  checkDenied(authorizeCapability(context, { ...request, fields: ["cash", "income"] }), "DATA_FIELDS_SCOPE_DENIED");
  const omitted = { ...request }; delete omitted.fields;
  checkDenied(authorizeCapability(context, omitted), "DATA_FIELDS_SCOPE_DENIED");
  context.grants[0].confirmation_type = "DATA_ACCESS_GRANT";
  checkDenied(authorizeCapability(context, request), "CONFIRMATION_SCOPE_REQUIRED");
});

test("an unconfirmed or mismatched confirmation cannot be accepted", () => {
  const { context, request } = fixture("analysis.run");
  context.grants[0].confirmation_verified = false;
  checkDenied(authorizeCapability(context, request), "CONFIRMATION_SCOPE_REQUIRED");
});

test("unimplemented independent writes and exports remain closed", () => {
  for (const capability of ["memory.confirm_write", "memory.revoke", "constraints.confirm_update", "profile.confirm_write", "data.export", "data.delete", "audit.export", "policy.publish", "deployment.manage"]) {
    const { context, request } = fixture(capability);
    checkDenied(authorizeCapability(context, request), "CAPABILITY_NOT_AVAILABLE");
  }
});

test("full declared grants cannot enable L3 or real financial operations", () => {
  for (const capability of ["paper.reserve", "paper.commit"]) {
    const { context, request } = fixture(capability);
    checkDenied(authorizeCapability(context, request), "PAPER_GATEWAY_NOT_CONNECTED");
  }
  for (const capability of ["real_trade.buy", "real_trade.transfer", "real_trade.*"]) {
    const { context, request } = fixture(capability);
    checkDenied(authorizeCapability(context, request), "REAL_EXECUTION_DISABLED");
  }
});

test("trusted read-only reconciliation is limited to the original execution", () => {
  const { context, request } = fixture("execution.reconcile");
  context.actor_type = "AUTHENTICATED_FINANCE_RECOVERY_ACTOR";
  context.session_verified = false;
  context.recovery = { verified: true, original_subject_id: context.subject_id, original_resource_id: request.resource_id, original_task_id: "original-task", original_execution_id: "original-execution", original_proposal_sha256: "a".repeat(64), read_only: true };
  context.grants[0].confirmation_type = "TRUSTED_RECOVERY_AUTHORITY";
  const result = authorizeCapability(context, request);
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.read_only, true);
  assert.equal(result.execution_allowed, false);
  context.recovery.original_subject_id = "another-user";
  checkDenied(authorizeCapability(context, request), "RECOVERY_SCOPE_DENIED");
});

test("ordinary owner reconciliation still requires the current owner session", () => {
  const { context, request } = fixture("execution.reconcile");
  assert.equal(authorizeCapability(context, request).decision, "ALLOW");
  checkDenied(authorizeCapability({ ...context, session_verified: false }, request), "SUBJECT_AUTHENTICATION_REQUIRED");
});

test("recovery actor cannot convert cleanup authority into investment or data access", () => {
  const { context, request } = fixture();
  context.actor_type = "AUTHENTICATED_FINANCE_RECOVERY_ACTOR";
  checkDenied(authorizeCapability(context, request), "RECOVERY_SCOPE_DENIED");
  const release = fixture("paper.release");
  checkDenied(authorizeCapability(release.context, release.request), "PAPER_RECOVERY_BACKEND_NOT_CONNECTED");
});

test("missing grant validity, conflicting grant IDs and validation failures fail closed", () => {
  for (const mutate of [
    context => { delete context.grants[0].revoked; },
    context => { context.grants.push({ ...context.grants[0] }); },
    context => { context.versions = {}; },
    context => { context.validation_status = "UNAVAILABLE"; },
    context => { context.now = "2026-02-31T12:00:00Z"; }
  ]) {
    const { context, request } = fixture(); mutate(context);
    const result = authorizeCapability(context, request);
    assert.equal(result.decision, "ERROR");
    assert.equal(result.execution_allowed, false);
  }
});

test("accessors and hostile prototypes cannot be treated as authorization data", () => {
  let reads = 0;
  const { context, request } = fixture();
  const malicious = { ...request };
  Object.defineProperty(malicious, "role", { get() { reads += 1; return "admin"; } });
  checkDenied(authorizeCapability(context, malicious), "UNTRUSTED_CONTROL_FIELD");
  assert.equal(reads, 0);
  const inherited = Object.create({ session_verified: true });
  assert.equal(authorizeCapability(inherited, request).decision, "ERROR");
});

test("permission results do not expose private IDs, grants or change historical risk", () => {
  const { context, request } = fixture();
  const original = { risk_decision: "ALLOW", audit_id: "original-private-audit" };
  const result = authorizeCapability(context, { ...request, resource_id: "other-account" });
  checkDenied(result);
  for (const text of [context.subject_id, request.resource_id, context.grants[0].grant_id, original.audit_id]) assert.equal(JSON.stringify(result).includes(text), false);
  assert.deepEqual(original, { risk_decision: "ALLOW", audit_id: "original-private-audit" });
});
