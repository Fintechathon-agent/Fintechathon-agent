"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { DailyGateway } = require("../daily-gateway.cjs"), { LongTextBridge } = require("../long-text.cjs");
const { binding } = require("../../../team-staging/risk/long-text/service.cjs");
const model = require("../daily-model.cjs"), h = require("./helpers.cjs"), f = require("./daily-fixture.cjs");
function setup(t) {
  const { store } = h.fixture(t), clock = { value: new Date("2026-10-18T08:00:00Z") };
  const gateway = new DailyGateway({ store, now: () => clock.value.toISOString() });
  const bridge = () => new LongTextBridge({ store, gateway, now: () => clock.value });
  const actor = "long-text-user", call = (op, input) => bridge().handle(op, actor, input);
  return { store, gateway, clock, actor, call };
}
function intake(amount = 20000) { return { data_mode: "SYNTHETIC_REPLAY", as_of: "2026-10-18", horizon_days: 60,
  text: `我目前现金5万元，保底1万元。每月5号交房租3500元，下个月20号交学费2万元。我每月10号工资8000元，想拿${amount}元买基金。` }; }
function facts(call, draft) { return call("correct", { ...binding(draft), items: [], profile: { existing_holds_minor: 0, fees_minor: 0 } }); }
function confirm(call, draft) { return call("confirm", { ...binding(draft), reviewed_item_ids: draft.items.map(x => x.id), confirmed: true, nonoverlap_confirmed: true }); }
function ready(call, amount) { return confirm(call, facts(call, call("intake", intake(amount)))); }
test("long text preserves all expanded events and blocks investment against protected cash", t => {
  const { call, gateway, actor, store } = setup(t), draft = ready(call), task = call("handoff", binding(draft)), id = task.input.binding.task_id;
  assert.equal(draft.result.decision, "BLOCK"); assert.equal(task.review.decision, "BLOCK");
  assert.equal(task.review.metrics.shortfall_minor, draft.result.metrics.shortfall_minor);
  assert.equal(task.input.snapshot.purposes.length, 3); assert.equal(task.input.snapshot.income_events.length, 2);
  assert.equal(task.long_text_source.source_text, draft.source_text); assert.equal(task.source_stale, false);
  assert.equal(task.approval.status, "UNCONFIRMED"); assert.throws(() => gateway.confirm(id, actor, f.confirm(task)), { code: "RISK_NOT_ACCEPTABLE" });
  assert.equal(call("handoff", binding(draft)).input.binding.task_id, id);
  assert.equal(Object.keys(store.data.tasks).length, 1); assert.equal(Object.keys(store.data.daily_ledgers).length, 1);
});
test("safe long text reaches shared confirm, paper execution, replay and audit", async t => {
  const { call, gateway, actor, store } = setup(t), draft = ready(call, 10000), task = call("handoff", binding(draft)), id = task.input.binding.task_id;
  assert.equal(task.review.decision, "ALLOW");
  await assert.rejects(gateway.execute(id, actor, "long-before-approval"));
  gateway.confirm(id, actor, f.confirm(task));
  const receipt = await gateway.execute(id, actor, "long-safe-execution");
  assert.equal(receipt.status, "SUCCEEDED"); assert.equal(receipt.receipt.side_effects, false);
  assert.equal((await gateway.execute(id, actor, "long-safe-execution")).execution_id, receipt.execution_id);
  assert.equal(gateway.inspect(id, actor).current_ledger.holds.length, 1);
  for (const type of ["LONG_TEXT_HANDOFF_RECEIVED", "DAILY_PLAN_CONFIRMED", "DAILY_EXECUTION_SUCCEEDED", "DAILY_DUPLICATE_REQUEST"]) assert.ok(store.events.some(e => e.event_type === type && e.task_id === id));
});
test("editing facts invalidates approval and model; handoff revises the same task", async t => {
  const { call, gateway, actor } = setup(t); let draft = ready(call, 10000), task = call("handoff", binding(draft)); const id = task.input.binding.task_id;
  await model.review({ gateway, actor, payload: { task_id: id }, fetchImpl: async (_url, init) => Response.json(f.modelResponse(JSON.parse(init.body))) });
  gateway.confirm(id, actor, f.confirm(task));
  draft = call("correct", { ...binding(draft), items: [{ id: draft.items.find(x => x.type === "INVESTMENT").id, amount_minor: 2000000 }] });
  task = gateway.inspect(id, actor); assert.equal(task.source_stale, true); assert.equal(task.approval.status, "INVALIDATED"); assert.equal(task.model_review, undefined); assert.equal(task.model_review_history.length, 1);
  assert.throws(() => gateway.confirm(id, actor, f.confirm(task)), { code: "LONG_TEXT_SOURCE_STALE" });
  await assert.rejects(gateway.execute(id, actor, "long-stale-execution"), { code: "LONG_TEXT_SOURCE_STALE" });
  await assert.rejects(model.review({ gateway, actor, payload: { task_id: id }, fetchImpl: () => { throw Error("must not call"); } }), { code: "LONG_TEXT_SOURCE_STALE" });
  draft = confirm(call, draft); task = call("handoff", binding(draft));
  assert.equal(task.input.binding.task_id, id); assert.equal(task.source_stale, false); assert.equal(task.review.decision, "BLOCK"); assert.equal(task.input.action.amount_minor, 2000000);
});
test("source revisions remain authoritative and ordinary form cannot overwrite imported facts", t => {
  const { call, gateway, actor } = setup(t); let draft = ready(call, 10000), task = call("handoff", binding(draft)); const id = task.input.binding.task_id;
  assert.throws(() => gateway.revise(id, actor, { ...f.payload(), task_id: id, ledger_id: task.ledger_id, expected_ledger_revision: task.ledger_revision }), { code: "LONG_TEXT_REVISION_REQUIRED" });
  draft = call("revise", { ...binding(draft), text: intake(20000).text, as_of: draft.as_of, horizon_days: 60 });
  assert.equal(gateway.inspect(id, actor).source_stale, true);
  draft = confirm(call, facts(call, draft)); task = call("handoff", binding(draft)); assert.equal(task.input.binding.task_id, id); assert.equal(task.long_text_source.source_text, intake().text);
});
test("model response arriving after source edit is discarded with failure audit", async t => {
  const { call, gateway, actor, store } = setup(t), draft = ready(call, 10000), task = call("handoff", binding(draft)), id = task.input.binding.task_id;
  await assert.rejects(model.review({ gateway, actor, payload: { task_id: id }, fetchImpl: async (_url, init) => {
    const request = JSON.parse(init.body); assert.ok(JSON.stringify(request).includes(draft.source_text));
    call("correct", { ...binding(draft), items: [], profile: { fees_minor: 100 } });
    return Response.json(f.modelResponse(request));
  } }), { code: "MODEL_RESPONSE_STALE" });
  assert.equal(gateway.inspect(id, actor).model_review, undefined);
  assert.ok(store.events.some(e => e.event_type === "DAILY_MODEL_REVIEW_FAILED" && e.code === "MODEL_RESPONSE_STALE"));
  assert.ok(!store.events.some(e => e.event_type === "DAILY_MODEL_REVIEW_RECEIVED"));
});
test("reported holds protect cash without invented executions or duplicate cashflow", t => {
  const { call } = setup(t); let draft = ready(call, 10000);
  draft = call("correct", { ...binding(draft), items: [], profile: { existing_holds_minor: 200000 } }); draft = confirm(call, draft);
  const task = call("handoff", binding(draft));
  assert.equal(task.review.metrics.projected_free_after_minor, draft.result.metrics.projected_free_after_minor);
  assert.equal(task.current_ledger.holds.length, 1); assert.equal(task.current_ledger.holds[0].source, "USER_REPORTED_SYNTHETIC"); assert.equal(task.current_ledger.holds[0].settlement_link, "UNVERIFIED");
  assert.equal(task.execution.status, "NOT_STARTED");
  assert.equal(task.review.metrics.cashflow.at(-1).balance_minor, draft.result.metrics.cashflow.at(-1).balance_minor);
});
test("oversized expanded plan fails explicitly before registering a partial task", t => {
  const { call, store } = setup(t); let draft = call("intake", { ...intake(1000), text: "我目前现金5万元，保底1万元。每天生活费100元，我想投资1000元。" });
  const expense = draft.items.find(x => x.type === "EXPENSE");
  draft = call("correct", { ...binding(draft), items: [{ id: expense.id, due_date: "2026-10-18", recurrence: "DAILY" }], profile: { existing_holds_minor: 0, fees_minor: 0 } });
  draft = confirm(call, draft); assert.throws(() => call("handoff", binding(draft)), { code: "WORKBENCH_EVENT_LIMIT" }); assert.equal(Object.keys(store.data.tasks).length, 0);
});
test("restore enforces session ownership and expires old approvals", async t => {
  const { call, gateway, store, actor, clock } = setup(t), draft = ready(call, 10000), task = call("handoff", binding(draft)), id = task.input.binding.task_id;
  assert.equal(call("restore", { draft_id: draft.draft_id }).workbench_link.task_id, id);
  assert.throws(() => new LongTextBridge({ store, gateway, now: () => clock.value }).handle("restore", "someone-else", { draft_id: draft.draft_id }), { code: "NOT_FOUND" });
  gateway.confirm(id, actor, f.confirm(task)); clock.value = new Date(clock.value.getTime() + 31 * 60000);
  assert.equal(gateway.inspect(id, actor).source_stale, true); assert.throws(() => call("restore", { draft_id: draft.draft_id }), { code: "NOT_FOUND" });
  await assert.rejects(gateway.execute(id, actor, "long-expired-execution"), { code: "LONG_TEXT_SOURCE_STALE" });
});
test("Beijing date-only action can execute after local midnight before UTC midnight", async t => {
  const { call, gateway, actor, clock } = setup(t); clock.value = new Date("2026-10-17T17:00:00Z");
  const draft = ready(call, 10000), task = call("handoff", binding(draft)), id = task.input.binding.task_id;
  assert.equal(task.input.action.at, "2026-10-18"); gateway.confirm(id, actor, f.confirm(task));
  assert.equal((await gateway.execute(id, actor, "beijing-midnight-safe")).status, "SUCCEEDED");
});
