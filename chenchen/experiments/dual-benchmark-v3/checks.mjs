import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runCase as originalCase } from "../investment-benchmark-v1/run.mjs";
import intake from "../life-planning-v1/intake.js";
import planning from "../life-planning-v1/planning.js";
import fixture from "../life-planning-v1/fixture.js";
import funding from "../../integrations/funding-plan.js";
import workflow from "../../integrations/review-workflow.js";
import evidence from "../../integrations/review-evidence.js";
import merchant from "../../merchant/ledger.js";

async function investmentLifecycle(c) {
  const x = c.input, plans = new funding.FundingPlanStore();
  const definition = { synthetic: true, confirmed: true, currency: "CNY",
    cash_minor: x.available_minor + x.rent_minor + x.tuition_minor,
    protected_purposes: [{ purpose_id: "rent", label: "合成房租", amount_minor: x.rent_minor },
      { purpose_id: "tuition", label: "合成学费", amount_minor: x.tuition_minor }] };
  const plan = plans.create(definition), calls = [];
  const store = new workflow.ReviewWorkflowStore({ fundingPlans: plans, modelRunner: async input => {
    const response = { run_id: "synthetic-run-" + randomUUID(), source: "model", status: "PROPOSED",
      input: { input_sha256: "a".repeat(64) },
      model_response: { provider_response_id: "synthetic-" + c.case_id,
        proposal: { proposed_action: "NO_ACTION", action_reason: "固定替身不能取消审批要求", risk_level: "low" } },
      audit: { audit_id: "synthetic-audit-" + randomUUID(), events: [] } };
    calls.push({ input: structuredClone(input), response });
    return response;
  } });
  const request = { text: x.text, data_mode: "SYNTHETIC_REPLAY", memory_consent: false, allow_rule_fallback: false,
    context: { confirmed: true, demo_funding_snapshot: { protected_minor: 0, cash_minor: 999999999 } },
    action_parameters: { synthetic: true, currency: "CNY", funding_plan_id: plan.plan_id, funding_plan_revision: plan.revision,
      amount: x.mode === "subcent" ? 0.001 : x.requested_minor / 100 } };
  if (x.mode === "subcent") {
    await assert.rejects(store.start(request), { code: c.expected.error_code });
    assert.equal(calls.length, 0);
    assert.equal(plans.summary(plan.plan_id).allocated_minor, 0);
    return { validation_error: c.expected.error_code, synthetic_provider_calls: 0 };
  }
  const created = await store.start(request);
  assert.equal(created.approval.required, true);
  assert.equal(calls[0].input.context.demo_funding_snapshot.cash_minor, definition.cash_minor);
  assert.equal(calls[0].input.context.demo_funding_snapshot.check.protected_minor, x.rent_minor + x.tuition_minor);
  const bind = { task_id: created.task_id, proposal_sha256: created.proposed_action.proposal_sha256 };
  await assert.rejects(store.simulate(bind), { code: "EXECUTION_BLOCKED" });
  if (x.mode === "cancelled") {
    await store.cancel({ ...bind, canceler: "synthetic-user", reason: "合成撤回" });
    await assert.rejects(store.decideRisk({ ...bind, decision: "APPROVE", reviewer: "synthetic-risk", reason: "合成" }),
      { code: "WORKFLOW_TERMINAL" });
    await assert.rejects(store.simulate(bind), { code: "EXECUTION_BLOCKED" });
  } else {
    const decision = x.mode === "risk-reject" ? "REJECT" : x.mode === "risk-more-info" ? "REQUEST_MORE_INFO" : "APPROVE";
    await store.decideRisk({ ...bind, decision, reviewer: "synthetic-risk", reason: "本地替身判定，非正式 Risk" });
    const approval = { ...bind, decision: x.mode === "approval-reject" ? "REJECT" : "APPROVE",
      approver: "synthetic-user", reason: "本地替身审批" };
    if (decision !== "APPROVE") {
      await assert.rejects(store.decideApproval(approval),
        { code: decision === "REJECT" ? "WORKFLOW_TERMINAL" : "APPROVAL_BLOCKED" });
      await assert.rejects(store.simulate(bind), { code: "EXECUTION_BLOCKED" });
    } else if (x.mode === "approval-missing") {
      await assert.rejects(store.simulate(bind), { code: "EXECUTION_BLOCKED" });
    } else {
      await store.decideApproval(approval);
      if (x.mode === "purpose-changed") {
        const changed = structuredClone(definition);
        // Rename a protected purpose without changing available cash.
        changed.protected_purposes[0].label = "合成房租已更正用途";
        plans.revise({ ...changed, plan_id: plan.plan_id, expected_revision: 1 });
        await assert.rejects(store.simulate(bind), { code: "FUNDING_PLAN_CHANGED" });
      } else if (x.mode === "one-cent-short") {
        await assert.rejects(store.simulate(bind), { code: "FUNDING_CONFLICT" });
      } else if (x.mode === "approval-reject") {
        await assert.rejects(store.simulate(bind), { code: "EXECUTION_BLOCKED" });
      } else {
        const [a, b] = await Promise.all([store.simulate(bind), store.simulate(bind)]);
        assert.deepEqual(a.execution.receipt, b.execution.receipt);
        assert.equal(a.execution.receipt.side_effects, false);
        assert.equal(a.execution.receipt.task_id, created.task_id);
      }
    }
  }
  const record = store.getByTaskId(created.task_id), summary = plans.summary(plan.plan_id);
  assert.equal(record.status, c.expected.status);
  assert.equal(record.execution.execution_allowed, false);
  assert.equal(summary.allocated_minor, record.status === "SIMULATED" ? x.requested_minor : 0);
  assert.equal(summary.allocations.length, record.status === "SIMULATED" ? 1 : 0);
  if (record.status !== "SIMULATED") assert.equal(record.execution.receipt, null);
  for (const event of record.audit.events) {
    assert.equal(event.task_id, record.task_id);
    for (const key of ["task_id", "request_id", "run_id", "session_id"]) assert.equal(event.payload.trace[key], record[key]);
    assert.equal(event.payload.trace.audit_id, record.audit.audit_id);
  }
  assert.equal(evidence.buildReviewEvidence(record).manifest.consistency_status, "CONSISTENT_WITH_LIMITS");
  return { status: record.status, allocated_minor: summary.allocated_minor, synthetic_provider_calls: calls.length,
    evidence: { model_calls: calls, record, funding_plan: summary } };
}

function intakeLifecycle(c) {
  let instant = new Date("2026-10-19T12:00:00Z");
  const x = c.input, store = new intake.IntakeSessions({ now: () => instant, ttlMs: 1000, capacity: 1 });
  const input = { text: x.text, data_mode: "SYNTHETIC_REPLAY" };
  if (x.mode === "interim-speech") {
    assert.throws(() => store.create({ ...input, channel: "speech_transcript", is_final: false }), { code: "TRANSCRIPT_NOT_FINAL" });
    return { rejected: "TRANSCRIPT_NOT_FINAL" };
  }
  let draft = store.create(input);
  const bind = d => ({ draft_id: d.draft_id, revision: d.revision, interpretation_sha256: d.interpretation_sha256 });
  const confirm = d => store.confirm({ ...bind(d), confirmed: true, reviewed_candidate_ids: d.candidates.map(c => c.candidate_id),
    ...(d.attached_plan ? { reviewed_plan_sha256: d.attached_plan.plan_sha256 } : {}) });
  if (x.mode === "unconfirmed") {
    assert.throws(() => store.reviewRequest(bind(draft)), { code: "INTAKE_UNCONFIRMED" });
  } else if (x.mode === "partial-confirm") {
    assert.throws(() => store.confirm({ ...bind(draft), confirmed: true, reviewed_candidate_ids: ["candidate-1"] }), { code: "INTAKE_INCOMPLETE" });
  } else if (x.mode === "expired") {
    instant = new Date(instant.getTime() + 1000);
    assert.throws(() => confirm(draft), { code: "INTAKE_NOT_FOUND" });
  } else if (x.mode === "capacity") {
    assert.throws(() => store.create(input), { code: "INTAKE_CAPACITY" });
  } else if (x.mode === "plan-edited") {
    const p = { ...fixture.example(), data_mode: "SYNTHETIC_REPLAY" };
    draft = store.attachPlan({ ...bind(draft), plan_input: p });
    draft = confirm(draft);
    p.comparison.quotes[0].unit_price_minor++;
    const changed = store.attachPlan({ ...bind(draft), plan_input: p });
    assert.equal(changed.confirmation, null);
    assert.throws(() => store.reviewRequest(bind(draft)), { code: "INTAKE_CHANGED" });
    assert.throws(() => store.reviewRequest(bind(changed)), { code: "INTAKE_UNCONFIRMED" });
    draft = changed;
  } else {
    draft = confirm(draft);
    assert.deepEqual(confirm(draft), draft);
    const prepared = store.reviewRequest(bind(draft));
    assert.equal(prepared.submitted, false);
    assert.equal(prepared.request.memory_consent, false);
    assert.deepEqual(prepared.request.action_parameters, {});
    if (x.mode === "edited") {
      const revised = store.revise({ ...bind(draft), text: x.replacement });
      assert.throws(() => store.reviewRequest(bind(draft)), { code: "INTAKE_CHANGED" });
      assert.throws(() => store.reviewRequest(bind(revised)), { code: "INTAKE_UNCONFIRMED" });
      assert.equal(revised.confirmation, null);
      draft = revised;
    }
  }
  assert.equal(draft.execution_allowed, false);
  assert.equal(draft.memory_write_performed, false);
  return { draft };
}

function merchantLedger(c) {
  const x = c.input;
  const bill = (id, kind, amount, extras = {}) => ({ id, channel: "合成渠道", kind, category: "合成分类",
    booked_on: "2026-10-19", due_on: "2026-10-20", amount_cents: amount, fee_cents: 0, refund_cents: 0,
    status: "pending", source: "synthetic-source-" + id, description: "虚构账单", ...extras });
  const input = { shop: "合成店铺", currency: "CNY", as_of: "2026-10-19", balance_cents: x.opening_minor,
    bills: [bill("in", "income", x.income_minor, { fee_cents: x.fee_minor, refund_cents: x.refund_minor }),
      bill("out", "expense", x.expense_minor)] };
  if (x.mode === 1) input.bills.push(structuredClone(input.bills[0]));
  const store = new merchant.MerchantSession(input), before = store.summary();
  const incoming = x.income_minor - x.fee_minor - x.refund_minor;
  assert.equal(before.totals.receivable_cents, incoming);
  assert.equal(before.totals.payable_cents, x.expense_minor);
  assert.equal(before.forecast.days.length, c.expected.forecast_days);
  for (const d of before.forecast.days) assert.equal(d.expected_cents, x.opening_minor + incoming - x.expense_minor);
  assert.throws(() => store.insights(), { code: "REVIEW_REQUIRED" });
  if ([2, 3].includes(x.mode)) {
    const invalid = structuredClone(input);
    if (x.mode === 2) invalid.bills.push({ ...input.bills[0], amount_cents: input.bills[0].amount_cents + 1 });
    else invalid.bills[0].refund_cents = input.bills[0].amount_cents + 1;
    assert.throws(() => store.replace(invalid), { code: x.mode === 2 ? "DUPLICATE_CONFLICT" : "INVALID_MONEY" });
    assert.deepEqual(store.summary(), before);
  } else if (x.mode === 4) {
    store.detail("合成渠道:in");
    store.review(store.revision, true);
    store.insights();
    input.balance_cents++;
    store.replace(input);
    assert.throws(() => store.insights(), { code: "REVIEW_REQUIRED" });
  }
  return { totals: before.totals, projected_closing_minor: before.forecast.days.at(-1).expected_cents, mode: x.mode };
}

export async function runCase(c) {
  if (c.group === "investment_lifecycle") return investmentLifecycle(c);
  if (c.group === "intake_lifecycle") return intakeLifecycle(c);
  if (c.group === "merchant_ledger") return merchantLedger(c);
  if (["quote_edges", "subscription_edges"].includes(c.group)) {
    const fn = c.group === "quote_edges" ? planning.compareQuotes : planning.subscriptionSchedule;
    if (c.expected.error_code) {
      assert.throws(() => fn(c.input), { code: c.expected.error_code });
      return { rejected: c.expected.error_code };
    }
    const result = fn(c.input);
    if (c.group === "quote_edges") {
      assert.equal(result.lowest_known_total_minor, c.expected.total_minor);
      assert.equal(result.status, c.expected.status);
      assert.equal(result.platform_data_fetched, false);
    } else {
      assert.equal(result.upcoming_known_total_minor, c.expected.total_minor);
      assert.equal(result.bills[0].schedule_status, c.expected.schedule_status);
      assert.equal(result.cancellation_performed, false);
      assert.equal(result.reminder_delivery, "NOT_CONNECTED");
    }
    assert.equal(result.execution_allowed, false);
    return result;
  }
  return originalCase(c);
}
