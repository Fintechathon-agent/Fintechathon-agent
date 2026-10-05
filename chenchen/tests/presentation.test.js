"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const models = import("../versions/presentation.mjs");
const { MerchantSession, demo } = require("../merchant/ledger");
const candidate = (plan_id, drawdown, turnover = 0) =>
  ({plan_id, metrics:{max_drawdown:drawdown,cumulative_return:-0.02},turnover});

test("data date labels describe age, not automatic real-time freshness", async () => {
  const {dateStatus} = await models;
  assert.equal(dateStatus("2026-09-23T16:00:00Z", "2026-10-05").ageDays, 12);
  assert.equal(dateStatus("2026-10-04", "2026-10-05").label, "距今日 1 天 · 非实时");
  assert.equal(dateStatus("2026-10-05", "2026-10-05").kind, "same-day");
  assert.equal(dateStatus("2026-10-06", "2026-10-05").kind, "future");
  assert.equal(dateStatus("2026-02-30", "2026-10-05").kind, "unknown");
  assert.equal(dateStatus(null, "2026-10-05").kind, "unknown");
  assert.equal(dateStatus("2024-02-28", "2024-03-01").ageDays, 2);
});

test("negative drawdown compares closer to zero; CURRENT is never a candidate", async () => {
  const {planComparison} = await models;
  const result = planComparison([candidate("CURRENT",-.028),candidate("A",-.028),candidate("B",-.025,.04),candidate("C",-.020,.12)]);
  assert.equal(result.best.plan_id, "C");
  assert.deepEqual(result.plans.map(plan=>plan.plan_id),["A","B","C"]);
  assert.ok(Math.abs(result.improvementPoints - .8) < 1e-10);
  assert.equal(planComparison([candidate("A",0),candidate("C",-.01)]).best.plan_id,"A");
});

test("ties prefer lower turnover; invalid and empty plans have no invented winner", async () => {
  const {planComparison} = await models;
  assert.equal(planComparison([candidate("A",-.01,.1),candidate("B",-.01,.02)]).best.plan_id,"B");
  assert.equal(planComparison([]).best,null);
  assert.equal(planComparison([candidate("C",NaN),candidate("B",.01)]).best,null);
  assert.equal(planComparison([candidate("A",-.02)]).improvementPoints,null);
});

test("gap changes with delay and opening negative cash is reported as already negative", async () => {
  const {merchantOverview} = await models, session = new MerchantSession();
  assert.equal(merchantOverview(session.summary()).gap.date,"2026-10-10");
  assert.equal(merchantOverview(session.summary(3)).gap.date,"2026-10-06");
  assert.equal(merchantOverview(session.summary(3)).scenario,"到账延迟 3 天");
  const input = demo(); input.balance_cents=-100;
  const negative = merchantOverview(new MerchantSession(input).summary());
  assert.equal(negative.gap.date,input.as_of);
  assert.equal(negative.gap.opening,true);
});

test("due-today unsettled receipts agree with forecast exclusions", async () => {
  const {merchantOverview} = await models, input = demo();
  input.bills.find(b=>b.id==="GROUP-01").due_on=input.as_of;
  const state = new MerchantSession(input).summary(), overview = merchantOverview(state);
  assert.deepEqual(overview.unconfirmed.map(b=>b.channel+":"+b.id),state.forecast.excluded_overdue_receipts);
  assert.equal(overview.nextPayment.id,"BEAN-C");
});

test("bill priority surfaces pending dates without changing the ledger", async () => {
  const {priorityBills} = await models, bills = new MerchantSession().summary().ledger.bills, before=structuredClone(bills);
  const ordered = priorityBills(bills);
  assert.equal(ordered[0].id,"GROUP-01");
  assert.ok(ordered.slice(0,3).every(b=>b.status==="pending"));
  assert.deepEqual(bills,before);
});

test("empty merchant overview does not fabricate bills or gaps", async () => {
  const {merchantOverview} = await models, input = demo(); input.bills=[];
  const overview = merchantOverview(new MerchantSession(input).summary());
  assert.equal(overview.nextPayment,null);
  assert.equal(overview.gap,null);
  assert.equal(overview.pendingCount,0);
  assert.equal(overview.unconfirmed.length,0);
});
