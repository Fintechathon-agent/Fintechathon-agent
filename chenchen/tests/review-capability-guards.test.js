"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { randomUUID } = require("node:crypto");
const { ReviewWorkflowStore } = require("../integrations/review-workflow");
const { FundingPlanStore } = require("../integrations/funding-plan");
const { signatureFor, verifyOwnerRequest } = require("../integrations/owner-bridge");

async function setup(capability, action = "HOLD_FOR_REVIEW") {
  const plans = new FundingPlanStore();
  const plan = plans.create({ synthetic: true, confirmed: true, currency: "CNY", cash_minor: 1000000,
    protected_purposes: [{ purpose_id: "rent", label: "Synthetic rent", amount_minor: 400000 }] });
  const store = new ReviewWorkflowStore({ fundingPlans: plans, modelRunner: async input => ({
    run_id: "synthetic-capability-" + randomUUID(), source: "model", status: "PROPOSED",
    input: { input_sha256: "a".repeat(64), capability: input.capability },
    model_response: { call_succeeded: true, provider_response_id: "TEST_DOUBLE_NOT_LIVE", proposal: {
      proposed_action: action, action_reason: "Synthetic capability regression", risk_level: "low" } },
    audit: { audit_id: "synthetic-audit-" + randomUUID(), events: [] }
  }) });
  const created = await store.start({ text: "Synthetic investment protecting rent", data_mode: "SYNTHETIC_REPLAY",
    ...(capability === undefined ? {} : { capability }), action_parameters: {
      synthetic: true, currency: "CNY", amount: 2000, funding_plan_id: plan.plan_id, funding_plan_revision: plan.revision
    } });
  const base = { task_id: created.task_id, proposal_sha256: created.proposed_action.proposal_sha256 };
  const risk = { ...base, decision: "APPROVE", reviewer: "synthetic-risk-owner", reason: "Synthetic risk decision" };
  const riskSecret = "synthetic-test-risk-secret";
  const riskAuth = await verifyOwnerRequest({ owner: "risk", body: risk,
    headers: new Headers({ "X-Risk-Signature": await signatureFor(risk, riskSecret) }),
    env: { REQUIRE_TRUSTED_ACTORS: "true", RISK_SERVICE_HMAC_SECRET: riskSecret } });
  await store.decideRisk(risk, riskAuth);
  const approval = { ...base, decision: "APPROVE", approver: "synthetic-confirmed-user", reason: "Synthetic PAPER confirmation" };
  const approvalSecret = "synthetic-test-approval-secret";
  const approvalAuth = await verifyOwnerRequest({ owner: "approval", body: approval,
    headers: new Headers({ "X-Approval-Signature": await signatureFor(approval, approvalSecret) }),
    env: { REQUIRE_TRUSTED_ACTORS: "true", APPROVAL_SERVICE_HMAC_SECRET: approvalSecret } });
  return { store, plans, plan, base, approval, approvalAuth };
}

for (const capability of [undefined, "REVIEW_ONLY"]) {
  test(`signed Risk and approval cannot upgrade ${capability ?? "default"} review capability`, async () => {
    const { store, plans, plan, base, approval, approvalAuth } = await setup(capability);
    await assert.rejects(store.decideApproval(approval, approvalAuth), { code: "SIMULATION_CAPABILITY_REQUIRED" });
    const saved = store.getByTaskId(base.task_id);
    assert.equal(saved.status, "PENDING_APPROVAL");
    assert.equal(saved.approval.status, "PENDING");
    assert.equal(saved.risk_decision.auth.verified, true);
    assert.equal(saved.execution.simulation_allowed, false);
    assert.equal(saved.execution.receipt, null);
    assert.equal(plans.summary(plan.plan_id).allocated_minor, 0);
    assert.ok(saved.audit.events.some(event => event.event_type === "workflow.operation_blocked" &&
      event.payload.code === "SIMULATION_CAPABILITY_REQUIRED" && event.payload.stage === "APPROVAL"));
  });
}

for (const corruption of ["legacy_read_only", "missing", "unknown", "top_level_upgrade", "reviewed_input_downgrade"]) {
  test(`a forged or legacy READY state cannot simulate with ${corruption} capability`, async () => {
    const { store, plans, plan, base } = await setup("SIMULATION_ONLY");
    const saved = store.getByTaskId(base.task_id);
    // Reproduce stored legacy approval without authorizing a fresh transition.
    saved.approval.status = "APPROVED";
    saved.approval.decision = "APPROVE";
    saved.status = "READY_FOR_SIMULATION";
    saved.execution.status = "READY";
    saved.execution.simulation_allowed = true;
    if (corruption === "legacy_read_only") {
      saved.capability = "REVIEW_ONLY";
      saved.reviewed_input.capability = "REVIEW_ONLY";
    } else if (corruption === "missing") delete saved.capability;
    else if (corruption === "unknown") saved.capability = "UNKNOWN";
    else if (corruption === "top_level_upgrade") saved.reviewed_input.capability = "REVIEW_ONLY";
    else saved.capability = "REVIEW_ONLY";
    store.save(saved);
    await assert.rejects(store.simulate(base), { code: "SIMULATION_CAPABILITY_REQUIRED" });
    const result = store.getByTaskId(base.task_id);
    assert.equal(result.execution.simulation_allowed, false);
    assert.equal(result.execution.receipt, null);
    assert.equal(result.approval.status, "APPROVED");
    assert.equal(plans.summary(plan.plan_id).allocated_minor, 0);
    assert.equal(result.audit.events.at(-1).payload.code, "SIMULATION_CAPABILITY_REQUIRED");
  });
}

test("an explicitly reviewed simulation keeps one receipt and preserves completed history", async () => {
  const { store, plans, plan, base, approval, approvalAuth } = await setup("SIMULATION_ONLY");
  await store.decideApproval(approval, approvalAuth);
  const completed = await store.simulate(base);
  const legacy = store.getByTaskId(base.task_id);
  delete legacy.capability;
  store.save(legacy);
  const replayed = await store.simulate(base);
  assert.deepEqual(replayed.execution.receipt, completed.execution.receipt);
  assert.equal(plans.summary(plan.plan_id).allocations.length, 1);
  assert.equal(replayed.audit.events.filter(event => event.event_type === "execution.simulated").length, 1);
});

test("NO_ACTION does not turn a read-only Risk decision into simulation readiness", async () => {
  const store = new ReviewWorkflowStore({ modelRunner: async () => ({
    run_id: "synthetic-no-action-" + randomUUID(), source: "model", status: "PROPOSED",
    input: { input_sha256: "a".repeat(64) },
    model_response: { provider_response_id: null, proposal: { proposed_action: "NO_ACTION", action_reason: "Synthetic read-only answer", risk_level: "low" } },
    audit: { audit_id: "synthetic-no-action-audit-" + randomUUID(), events: [] }
  }) });
  const created = await store.start({ text: "Synthetic read-only question", capability: "REVIEW_ONLY" });
  const base = { task_id: created.task_id, proposal_sha256: created.proposed_action.proposal_sha256 };
  const checked = await store.decideRisk({ ...base, decision: "APPROVE", reviewer: "synthetic-risk", reason: "Synthetic" });
  assert.notEqual(checked.status, "READY_FOR_SIMULATION");
  assert.equal(checked.execution.simulation_allowed, false);
  assert.ok(!checked.audit.events.some(event => event.event_type === "execution.ready_for_simulation"));
  await assert.rejects(store.simulate(base), error => ["EXECUTION_BLOCKED", "SIMULATION_CAPABILITY_REQUIRED"].includes(error.code));
});
