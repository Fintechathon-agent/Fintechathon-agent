"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { extract, IntakeSessions } = require("../experiments/life-planning-v1/intake");
const { compareQuotes, subscriptionSchedule, planPurchases, iso } = require("../experiments/life-planning-v1/planning");
const { buildReport } = require("../experiments/life-planning-v1/report");
const { AS_OF, clock, example, binding, runFixture } = require("../experiments/life-planning-v1/fixture");
const { createServer } = require("../experiments/life-planning-v1/server");
const { normalizeReviewInput } = require("../integrations/model-review");
const input = text => ({ text, data_mode: "FIXTURE" });
const quotes = () => { const f = example(); return { ...f.comparison, data_mode: f.data_mode, as_of: f.as_of }; };
const bills = () => { const f = example(); return { ...f.subscriptions, data_mode: f.data_mode, as_of: f.as_of }; };
const errorCode = code => error => error.code === code;

test("long life request separates plans, completed bills, hypotheses, negations and cancellation", () => {
  const text = "我计划投资8000元，但下月要交房租4500元；学费6000元已经交了。如果工资到账，再买基金500元。没有买基金；取消了会员。申请取消另一项订阅。我没有取消会员；不打算取消自动续费。";
  const draft = extract(input(text), clock);
  assert.deepEqual(draft.candidates.map(c => c.classification.status),
    ["PLANNED", "PLANNED", "COMPLETED", "CONDITIONAL", "CONDITIONAL", "NEGATED", "CANCELLED", "CANCELLATION_REQUESTED", "NEGATED", "NEGATED"]);
  assert.equal(draft.risk_decision, null);
  assert.equal(draft.execution_allowed, false);
  assert.equal(draft.memory_write_performed, false);
});

test("emoji offsets, clause continuation and corrections retain exact source evidence", () => {
  const text = "💬我下月要交房租，4500元，改成4800元。朋友想买基金，3000元；我买手机2000元。";
  const draft = extract(input(text), clock);
  const [rent, amount, correction, friend, friendAmount, self] = draft.candidates;
  assert.equal(amount.related_candidate_id, rent.candidate_id);
  assert.equal(amount.inherited_categories[0].code, "LIVING_COST");
  assert.equal(correction.classification.status, "CORRECTION");
  assert.equal(correction.related_candidate_id, amount.candidate_id);
  assert.equal(correction.inherited_categories[0].code, "LIVING_COST");
  assert.equal(friendAmount.classification.subject, "THIRD_PARTY");
  assert.equal(self.classification.subject, "SELF_REPORTED");
  for (const c of draft.candidates) for (const span of [c, ...c.amount_mentions])
    assert.equal(text.slice(span.source_span.start, span.source_span.end), span.text);
  assert.equal(friend.classification.subject, "THIRD_PARTY");
});

test("ambiguous mixed past and future is not collapsed into one confirmed payment", () => {
  const draft = extract(input("已付房租后下月还要交学费6000元。"), clock);
  assert.equal(draft.candidates[0].classification.status, "AMBIGUOUS");
  assert.equal(draft.candidates[0].status, "UNCONFIRMED");
});

test("speech interim results stop; final transcripts require user review and support correction", () => {
  const store = new IntakeSessions(clock);
  assert.throws(() => store.create({ ...input("房租八千元"), channel: "speech_transcript", is_final: false }), errorCode("TRANSCRIPT_NOT_FINAL"));
  const draft = store.create({ ...input("房租八千元"), channel: "speech_transcript", is_final: true });
  assert.equal(draft.speech_recognition_performed, false);
  assert.throws(() => store.reviewRequest(binding(draft)), errorCode("INTAKE_UNCONFIRMED"));
  const revised = store.revise({ ...binding(draft), text: "房租两千元" });
  assert.equal(revised.revision, 2);
  assert.equal(revised.corrected_from_channel, "speech_transcript");
  assert.throws(() => store.confirm({ ...binding(draft), confirmed: true, reviewed_candidate_ids: ["candidate-1"] }), errorCode("INTAKE_CHANGED"));
  const confirmed = store.confirm({ ...binding(revised), confirmed: true, reviewed_candidate_ids: ["candidate-1"] });
  const result = store.reviewRequest(binding(confirmed));
  assert.equal(result.request.text, "房租两千元");
  assert.equal(result.request.scenario, "FUNDING_CONFLICT");
  assert.equal(result.request.memory_consent, false);
  assert.deepEqual(result.request.action_parameters, {});
  assert.equal(result.submitted, false);
  assert.equal(result.request.context.confirmation.risk_approved, false);
});

test("partial confirmation, duplicates and caller-injected permission fields cannot pass", () => {
  const store = new IntakeSessions(clock);
  const draft = store.create({ ...input("买基金100元；房租200元。"), risk_approved: true, memory_consent: true });
  for (const ids of [[], ["candidate-1"], ["candidate-1", "candidate-1"], ["candidate-1", "candidate-2", "injected"]]) {
    assert.throws(() => store.confirm({ ...binding(draft), confirmed: true, reviewed_candidate_ids: ids }), errorCode("INTAKE_INCOMPLETE"));
  }
  const request = { ...binding(draft), confirmed: true, reviewed_candidate_ids: ["candidate-2", "candidate-1"] };
  const confirmed = store.confirm(request);
  assert.deepEqual(store.confirm(request), confirmed);
  assert.equal(confirmed.execution_allowed, false);
  confirmed.confirmation.risk_approved = true;
  assert.equal(store.reviewRequest(binding(confirmed)).request.context.confirmation.risk_approved, false);
});

test("editing after confirmation invalidates the receipt and changes idempotency evidence", () => {
  const store = new IntakeSessions(clock);
  const draft = store.create(input("会员25元"));
  const confirmed = store.confirm({ ...binding(draft), confirmed: true, reviewed_candidate_ids: ["candidate-1"] });
  const before = store.reviewRequest(binding(confirmed));
  const revised = store.revise({ ...binding(confirmed), text: "会员35元" });
  assert.equal(revised.confirmation, null);
  assert.throws(() => store.reviewRequest(binding(confirmed)), errorCode("INTAKE_CHANGED"));
  assert.throws(() => store.reviewRequest(binding(revised)), errorCode("INTAKE_UNCONFIRMED"));
  const next = store.confirm({ ...binding(revised), confirmed: true, reviewed_candidate_ids: ["candidate-1"] });
  assert.notEqual(store.reviewRequest(binding(next)).request.idempotency_key, before.request.idempotency_key);
  assert.equal(normalizeReviewInput(before.request).scenario, "SUBSCRIPTION_REVIEW");
});

test("draft retention is bounded and expired drafts cannot be confirmed", () => {
  let now = new Date(AS_OF);
  const store = new IntakeSessions({ now: () => now, ttlMs: 1000, capacity: 1 });
  const draft = store.create(input("房租"));
  assert.throws(() => store.create(input("学费")), errorCode("INTAKE_CAPACITY"));
  now = new Date(now.getTime() + 1000);
  assert.throws(() => store.confirm(binding(draft)), errorCode("INTAKE_NOT_FOUND"));
  assert.ok(store.create(input("学费")).draft_id);
});

test("quote and bill evidence must be reviewed with text; edits revoke the combined confirmation", () => {
  const store = new IntakeSessions(clock);
  const draft = store.create(input("我买手机，但还有会员续费"));
  const withPlan = store.attachPlan({ ...binding(draft), plan_input: example() });
  const confirmation = { ...binding(withPlan), confirmed: true, reviewed_candidate_ids: withPlan.candidates.map(c => c.candidate_id) };
  assert.throws(() => store.confirm(confirmation), errorCode("PLAN_UNCONFIRMED"));
  const confirmed = store.confirm({ ...confirmation, reviewed_plan_sha256: withPlan.attached_plan.plan_sha256 });
  const request = store.reviewRequest(binding(confirmed)).request;
  assert.equal(request.context.plan.known_purchase_and_bills_minor, 279500);
  assert.equal(request.context.plan.money_unit, "CNY_MINOR");
  assert.equal(request.context.plan.bills.length, 2);
  assert.equal(request.memory_consent, false);
  assert.deepEqual(store.attachPlan({ ...binding(confirmed), plan_input: example() }), confirmed);
  const changed = example(); changed.comparison.quotes[0].unit_price_minor += 100;
  const newDraft = store.attachPlan({ ...binding(confirmed), plan_input: changed });
  assert.equal(newDraft.confirmation, null);
  assert.throws(() => store.reviewRequest(binding(confirmed)), errorCode("INTAKE_CHANGED"));
  assert.throws(() => store.reviewRequest(binding(newDraft)), errorCode("INTAKE_UNCONFIRMED"));
  assert.throws(() => store.attachPlan({ ...binding(newDraft), plan_input: { ...example(), data_mode: "LIVE" } }), errorCode("DATA_MODE_MISMATCH"));
});

test("oversize text and model context fail explicitly, preserving the original draft", () => {
  assert.throws(() => extract(input("字".repeat(20001)), clock));
  const store = new IntakeSessions(clock);
  const draft = store.create(input("我下月想买基金100元；".repeat(80)));
  const confirmed = store.confirm({ ...binding(draft), confirmed: true, reviewed_candidate_ids: draft.candidates.map(c => c.candidate_id) });
  assert.throws(() => store.reviewRequest(binding(confirmed)), errorCode("CONTEXT_TOO_LARGE"));
  assert.equal(confirmed.candidates.length, 80);
});

test("comparison includes shipping and explicit single coupon, with a visible calculation", () => {
  const result = compareQuotes(quotes());
  assert.deepEqual(result.ranked_quote_ids, ["shop-b", "shop-a"]);
  assert.equal(result.quotes[0].total_minor, 280000);
  assert.equal(result.quotes[1].total_minor, 276000);
  assert.equal(result.lowest_known_total_minor, 276000);
  assert.equal(result.status, "COMPARABLE_INPUTS");
  assert.equal(result.platform_data_fetched, false);
});

test("same-price alternatives are retained instead of implying an arbitrary winner", () => {
  const q = quotes();
  q.quotes[1].unit_price_minor = 279000;
  const result = compareQuotes(q);
  assert.deepEqual(result.lowest_known_quote_ids, ["shop-a", "shop-b"]);
});

test("unknown coupon eligibility is not treated as a discount or a complete comparison", () => {
  const q = quotes(); q.quotes[0].coupons[0].eligible = null;
  const result = compareQuotes(q);
  assert.equal(result.quotes[0].total_minor, 300000);
  assert.equal(result.quotes[0].coupon_checks[0].status, "NEEDS_ELIGIBILITY");
  assert.equal(result.status, "PARTIAL_COMPARISON");
});

test("future, expired, threshold and ineligible coupons never discount current prices", () => {
  const patches = [
    [{ starts_at: "2026-10-17T13:00:00+08:00" }, "OUTSIDE_WINDOW"],
    [{ ends_at: AS_OF }, "OUTSIDE_WINDOW"],
    [{ threshold_minor: 400000 }, "BELOW_THRESHOLD"],
    [{ eligible: false }, "INELIGIBLE"],
    [{ discount_minor: 400000 }, "INVALID_DISCOUNT"]
  ];
  for (const [patch, expected] of patches) {
    const q = quotes(); Object.assign(q.quotes[0].coupons[0], patch);
    const row = compareQuotes(q).quotes[0];
    assert.equal(row.total_minor, 300000);
    assert.equal(row.coupon_checks[0].status, expected);
  }
});

test("coupons are not stacked without a verified stacking policy", () => {
  const q = quotes();
  q.quotes[0].coupons.push({ ...q.quotes[0].coupons[0], coupon_id: "another", discount_minor: 30000 });
  const row = compareQuotes(q).quotes[0];
  assert.equal(row.total_minor, 270000);
  assert.equal(row.selected_coupon_id, "another");
});

test("missing shipping, unmatched product, stale quotes and mismatched units are excluded", () => {
  for (const patch of [{ shipping_minor: null }, { match_confirmed: false }, { comparison_key: "different" },
    { valid_until: AS_OF }, { quoted_at: "2026-10-18T00:00:00+08:00" }, { quantity: 2 }, { currency: "USD" }]) {
    const q = quotes(); Object.assign(q.quotes[0], patch);
    const result = compareQuotes(q);
    assert.equal(result.quotes[0].total_minor, null);
    assert.equal(result.status, "PARTIAL_COMPARISON");
    assert.deepEqual(result.ranked_quote_ids, ["shop-b"]);
  }
});

test("money accepts integer cents only, duplicate IDs and unbounded inputs are rejected", () => {
  for (const value of [-1, 0.01, NaN, Infinity, "100", 1e13]) {
    const q = quotes(); q.quotes[0].unit_price_minor = value;
    assert.throws(() => compareQuotes(q), errorCode("INVALID_INPUT"));
  }
  const q = quotes(); q.quotes[1].quote_id = q.quotes[0].quote_id;
  assert.throws(() => compareQuotes(q), errorCode("INVALID_INPUT"));
  assert.throws(() => compareQuotes({ ...quotes(), quotes: Array(31).fill({}) }), errorCode("INVALID_INPUT"));
  assert.throws(() => compareQuotes({ ...quotes(), data_mode: "" }), errorCode("INVALID_INPUT"));
});

test("empty comparisons do not fabricate a free purchase", () => {
  const result = compareQuotes({ ...quotes(), quotes: [] });
  assert.equal(result.status, "NEEDS_QUOTES");
  assert.equal(result.lowest_known_total_minor, null);
});

test("cancellation requests remain payable; paid and reported cancelled bills are separated", () => {
  const b = bills();
  b.bills.push({ ...b.bills[0], bill_id: "paid", status: "PAID" }, { ...b.bills[0], bill_id: "cancelled", status: "CANCELLED" });
  const result = subscriptionSchedule(b);
  assert.equal(result.upcoming_known_total_minor, 3500);
  assert.match(result.bills.find(x => x.bill_id === "video-next").reminder, /仍保留/);
  assert.equal(result.cancellation_performed, false);
  assert.equal(result.reminder_delivery, "NOT_CONNECTED");
});

test("unknown amounts and dates, overdue bills and unknown status remain unresolved", () => {
  for (const patch of [{ amount_minor: null }, { due_at: null }, { status: "UNKNOWN" }, { due_at: "2026-10-16T00:00:00+08:00" }]) {
    const b = bills(); Object.assign(b.bills[0], patch);
    const result = subscriptionSchedule(b);
    assert.equal(result.incomplete, true);
    assert.deepEqual(result.unresolved_bill_ids, ["video-next"]);
    assert.equal(result.upcoming_known_total_minor, 1000);
  }
});

test("timezones, inclusive window boundaries and invalid calendar dates are explicit", () => {
  const b = bills(); b.bills[0].due_at = "2026-10-17T04:00:00Z";
  b.bills[1].due_at = b.through;
  assert.equal(subscriptionSchedule(b).upcoming_known_total_minor, 3500);
  for (const date of ["2026-10-17", "2026-02-30T12:00:00Z", "2026-10-17T12:00:00", "nonsense"]) assert.throws(() => iso(date, "date"));
  assert.throws(() => subscriptionSchedule({ ...b, through: "2025-10-17T12:00:00Z" }), errorCode("INVALID_INPUT"));
});

test("combined plan lists shopping plus upcoming bills without claiming affordability", () => {
  const source = example(); const saved = structuredClone(source);
  const plan = planPurchases(source);
  assert.equal(plan.known_purchase_and_bills_minor, 279500);
  assert.equal(plan.affordability, "NOT_ASSESSED");
  assert.equal(plan.risk_decision, null);
  assert.equal(plan.execution_allowed, false);
  assert.deepEqual(source, saved);
  const changed = example(); changed.comparison.quotes[0].unit_price_minor++;
  assert.notEqual(planPurchases(changed).plan_sha256, plan.plan_sha256);
});

test("report keeps source, units and demo markings and does not advertise absent renderers", () => {
  const report = buildReport(planPurchases(example()));
  assert.equal(report.meta.mode, "demo");
  assert.match(report.meta.disclaimer, /虚构/);
  assert.deepEqual(report.export_formats, []);
  assert.equal(report.sections[0].blocks[1].metrics[0].value, 2795);
  assert.equal(report.provenance[0].source, "demo");
  const source = example(); source.data_mode = "LIVE";
  const live = buildReport(planPurchases(source));
  assert.equal(live.provenance[0].source, "user_import");
  assert.match(live.meta.disclaimer, /尚未核实/);
});

test("synthetic transcript-to-review-to-Risk-to-approval-to-simulation retains a single trace", async () => {
  const result = await runFixture();
  assert.equal(result.network_calls, 0);
  assert.equal(result.paid_model_calls, 0);
  assert.equal(result.joint_acceptance, false);
  assert.deepEqual(result.checkpoints, ["PENDING_RISK", "BLOCKED_BEFORE_RISK", "PENDING_APPROVAL", "BLOCKED_BEFORE_APPROVAL", "READY_FOR_SIMULATION", "SIMULATED"]);
  const { workflow, handoff } = result;
  assert.equal(workflow.task_id, handoff.task_id);
  assert.equal(workflow.run_id, handoff.run_id);
  assert.equal(workflow.audit.audit_id, handoff.audit_id);
  assert.equal(workflow.execution.receipt.side_effects, false);
  assert.equal(workflow.execution.execution_allowed, false);
  assert.equal(workflow.reviewed_input.context.confirmation.risk_approved, false);
  for (const event of workflow.audit.events) assert.equal(event.task_id, workflow.task_id);
  assert.equal(result.transport_log[0].request.model, "synthetic-model");
  assert.match(result.transport_log[0].request.messages[1].content, /UNVERIFIED_FACTS/);
  assert.equal(handoff.reviewed_input.context.plan.plan_sha256, result.plan.plan_sha256);
  assert.equal(result.report.meta.run_id, workflow.run_id);
  assert.deepEqual(result.report.meta.audit_refs, [workflow.audit.audit_id]);
});

test("rejected and needs-information synthetic callbacks cannot reach simulation", async () => {
  for (const decision of ["REJECT", "REQUEST_MORE_INFO"]) {
    const result = await runFixture({ riskDecision: decision });
    assert.equal(result.workflow.execution.status, "BLOCKED");
    assert.equal(result.workflow.execution.receipt, null);
    assert.ok(!result.checkpoints.includes("SIMULATED"));
  }
});

test("provider failure yields auditable MODEL_FAILED rather than offline success", async () => {
  const result = await runFixture({ failModel: true });
  assert.equal(result.workflow.status, "MODEL_FAILED");
  assert.equal(result.handoff, null);
  assert.equal(result.workflow.execution.status, "BLOCKED");
  assert.ok(result.workflow.audit.events.some(e => e.event_type === "model.failed"));
});

async function serverFor(t) {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (path, body) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { base, post };
}

test("local HTTP intake and plan work; no network model route is exposed", async t => {
  const { base, post } = await serverFor(t);
  const health = await (await fetch(base + "/health")).json();
  assert.equal(health.network_model_enabled, false);
  const draft = await (await post("/api/life/v1/intake", input("房租2000元，下月想买基金100元"))).json();
  const before = await post("/api/life/v1/review-draft", binding(draft));
  assert.equal(before.status, 422);
  const confirmed = await (await post("/api/life/v1/confirm", { ...binding(draft), confirmed: true, reviewed_candidate_ids: draft.candidates.map(c => c.candidate_id) })).json();
  const review = await (await post("/api/life/v1/review-draft", binding(confirmed))).json();
  assert.equal(review.submitted, false);
  const result = await (await post("/api/life/v1/plan", example())).json();
  assert.equal(result.plan.known_purchase_and_bills_minor, 279500);
  assert.equal((await post("/api/review", {})).status, 404);
  const fixture = await (await fetch(base + "/fixture")).json();
  assert.equal(fixture.evidence_mode, "SYNTHETIC_LOCAL_TEST");
});

test("HTTP rejects cross-site access, bad JSON and oversize body", async t => {
  const { base } = await serverFor(t);
  assert.equal((await fetch(base + "/health", { headers: { Origin: "https://untrusted.invalid" } })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    http.get(base + "/health", { headers: { Host: "untrusted.invalid" } }, response => {
      response.resume(); response.on("end", () => resolve(response.statusCode));
    }).on("error", reject);
  });
  assert.equal(hostStatus, 403);
  const send = (body, type = "application/json") => fetch(base + "/api/life/v1/intake", { method: "POST", headers: { "Content-Type": type }, body });
  assert.equal((await send("{}", "text/plain")).status, 415);
  assert.equal((await send("{")).status, 400);
  assert.equal((await send("[]")).status, 422);
  assert.equal((await send(JSON.stringify(input("字".repeat(25000))))).status, 413);
});
