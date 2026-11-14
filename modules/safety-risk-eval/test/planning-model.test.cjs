"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const h = require("./helpers.cjs"), f = require("./daily-fixture.cjs"), fixture = require("./planning-fixture.cjs");
const { LongTextBridge } = require("../long-text.cjs"), { DailyGateway } = require("../daily-gateway.cjs");
const { binding } = require("../../../team-staging/risk/long-text/service.cjs");
const planner = require("../planning-model.cjs"), remote = require("../remote-model.cjs");
function setup(t) {
  const { store } = h.fixture(t), gateway = new DailyGateway({ store }), actor = "planning-user", clock = { time: new Date() };
  const bridge = () => new LongTextBridge({ store, gateway, now: () => clock.time });
  const call = (op, p) => bridge().handle(op, actor, p);
  const draft = call("intake", { text: fixture.text, data_mode: "FIXTURE", as_of: "2026-10-18", horizon_days: 365 });
  return { store, gateway, actor, clock, bridge, call, draft, options: () => ({ bridge: bridge(), actor, payload: binding(draft), fetchImpl: async (_u, init) => Response.json(fixture.response(JSON.parse(init.body))) }) };
}
test("planning request uses yuan, ranges, arithmetic and targeted questions without inventing missing budgets", t => {
  const { draft } = setup(t), document = planner.buildDocument(draft), facts = document.facts;
  assert.equal(facts.amount_unit, "YUAN"); assert.equal(facts.cash_yuan, 240000);
  assert.deepEqual(facts.known_expense_total_yuan, { min: 145000, max: 165000 });
  assert.deepEqual(facts.remainder_before_other_budgets_yuan, { min: 75000, max: 95000 });
  assert.equal(facts.independent_reserve_yuan, null); assert.equal(facts.fees_yuan, null);
  assert.equal(facts.all_in_stress.shortfall_before_other_budgets_yuan, 20000);
  assert.equal(facts.expenses.find(x => x.purpose === "旅游").amount_range_yuan, null);
  assert.ok(document.requested_action.length < 900);
  const request = remote.buildRequest(document, "test-request");
  assert.equal(request.requested_action, document.requested_action); assert.deepEqual(request.action_parameters, {});
  assert.equal(request.allow_rule_fallback, false); assert.equal(request.context.money_unit, "CNY_YUAN");
});
test("grounding accepts readable headings and rejects generic or wrong-cash answers", t => {
  const { draft } = setup(t), document = planner.buildDocument(draft), response = fixture.response(remote.buildRequest(document, "test-request"));
  const good = response.model.model_response.proposal;
  assert.equal(planner.quality(good, document).passed, true);
  assert.equal(planner.quality({ ...good, action_reason: good.action_reason.replace("【资金安排】", "资金安排方面，").replace("【风险说明】", "风险说明方面，") }, document).passed, true);
  const prose = good.action_reason.replace("【资金安排】", "").replace("【风险说明】", "");
  assert.equal(planner.quality({ ...good, action_reason: prose }, document).passed, true);
  assert.equal(Object.values(planner.sections(prose)).join(""), prose);
  assert.equal(planner.quality({ ...good, summary: "现金1元，信息不足。" }, document).passed, false);
  assert.equal(planner.quality({ ...good, missing_information: ["当前现金具体金额是多少？"] }, document).passed, false);
  assert.equal(planner.quality({ ...good, missing_information: [] }, document).passed, false);
  assert.equal(planner.quality({ ...good, missing_information: ["旅游预算", "独立应急保底"] }, document).passed, false);
  assert.equal(planner.quality({ ...good, summary: "现金999999999999999999999万元" }, document).passed, false);
  assert.equal(planner.quality(f.modelResponse({}).model.model_response.proposal, document).passed, false);
});
test("unconfirmed planning produces only bound advice, persists across restore and never creates a risk task", async t => {
  const s = setup(t); let budgetCalls = 0;
  const result = await planner.review({ ...s.options(), claimBudget: async () => { budgetCalls++; } });
  assert.equal(result.mode, "LIVE_TEAM_CORE_PLANNING_READ_ONLY"); assert.equal(result.quality.passed, true);
  assert.deepEqual(JSON.parse(result.raw_text), result.proposal); assert.equal(result.execution_allowed, false);
  const restored = s.call("restore", { draft_id: s.draft.draft_id });
  assert.equal(restored.planning_review.run_id, result.run_id); assert.equal(restored.confirmation, null); assert.equal(restored.result, null);
  assert.equal(restored.planning_model_calls, 1); assert.equal(budgetCalls, 1); assert.equal(Object.keys(s.store.data.tasks).length, 0);
  assert.throws(() => s.call("handoff", binding(restored)), { code: "CONFIRMATION_REQUIRED" });
});
test("one weak answer triggers one counted retry; two weak answers never become an offline success", async t => {
  const s = setup(t); let calls = 0, budget = 0;
  const result = await planner.review({ ...s.options(), claimBudget: async () => { budget++; }, fetchImpl: async (_u, init) => {
    const request = JSON.parse(init.body); calls++; return Response.json(calls === 1 ? f.modelResponse(request) : fixture.response(request));
  } });
  assert.equal(calls, 2); assert.equal(budget, 2); assert.equal(result.attempts[0].quality.passed, false); assert.equal(result.attempts[1].quality.passed, true);
  await assert.rejects(planner.review({ ...s.options(), fetchImpl: async (_u, init) => Response.json(f.modelResponse(JSON.parse(init.body))) }), { code: "MODEL_REPLY_NOT_GROUNDED" });
  const restored = s.call("restore", { draft_id: s.draft.draft_id });
  assert.equal(restored.planning_review, null); assert.equal(restored.planning_model_calls, 4);
  assert.ok(restored.audit.some(x => x.event === "PLANNING_MODEL_QUALITY_REJECTED"));
});
test("changes invalidate advice and late responses cannot attach to revised source", async t => {
  const s = setup(t);
  await planner.review(s.options());
  const changed = s.call("correct", { ...binding(s.draft), items: [], profile: { cash_minor: 30000000 } });
  assert.equal(changed.planning_review, null);
  await assert.rejects(planner.review(s.options()), { code: "STALE_DRAFT" });
  await assert.rejects(planner.review({ ...s.options(), payload: binding(changed), fetchImpl: async (_u, init) => {
    const request = JSON.parse(init.body); s.call("correct", { ...binding(changed), items: [], profile: { fees_minor: 100 } }); return Response.json(fixture.response(request));
  } }), { code: "STALE_DRAFT" });
  assert.equal(s.call("restore", { draft_id: changed.draft_id }).planning_review, null);
});
test("owner, extra authority fields, expiration, per-draft limit and shared budget are enforced before calling", async t => {
  const s = setup(t), options = { ...s.options(), fetchImpl: () => { throw Error("must not call"); } };
  await assert.rejects(planner.review({ ...options, actor: "other" }), { code: "NOT_FOUND" });
  await assert.rejects(planner.review({ ...options, payload: { ...binding(s.draft), confirmed: true } }), { code: "INVALID_FIELDS" });
  await assert.rejects(planner.review({ ...options, claimBudget: async () => { const e = Error("limit"); e.code = "MODEL_DAILY_LIMIT"; throw e; } }), { code: "MODEL_DAILY_LIMIT" });
  s.store.transaction(data => { data.long_text_drafts[s.draft.draft_id].draft.planning_model_calls = 6; return null; });
  await assert.rejects(planner.review(options), { code: "MODEL_TASK_LIMIT" });
  s.clock.time = new Date(s.clock.time.getTime() + 31 * 60000);
  await assert.rejects(planner.review(options), { code: "NOT_FOUND" });
});
test("provider failures and concurrent requests do not grant advice or leave a stuck pending flag", async t => {
  const s = setup(t); let finish, started;
  const signal = new Promise(resolve => { started = resolve; });
  const pending = planner.review({ ...s.options(), fetchImpl: async () => { started(); return new Promise(resolve => { finish = resolve; }); } });
  await signal;
  await assert.rejects(planner.review(s.options()), { code: "MODEL_BUSY" });
  finish(Response.json({ secret: "provider-secret" }, { status: 503 }));
  await assert.rejects(pending, e => e.code === "MODEL_SERVICE_FAILED" && !e.message.includes("provider-secret"));
  assert.equal(s.call("restore", { draft_id: s.draft.draft_id }).planning_request, null);
});
