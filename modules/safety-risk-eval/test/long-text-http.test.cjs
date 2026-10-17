"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createApplication } = require("../server.cjs"), h = require("./helpers.cjs"), f = require("./daily-fixture.cjs");
const { binding } = require("../../../team-staging/risk/long-text/service.cjs");
async function start(t, options = {}) {
  const app = createApplication({ store: h.fixture(t).store, ...options });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => app.server.close(resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`, response = await fetch(base + "/api/safety/session"), session = await response.json(), cookie = response.headers.get("set-cookie").split(";")[0];
  async function post(route, payload, headers = {}) { const r = await fetch(base + route, { method: "POST", headers: { cookie, "content-type": "application/json", "x-risk-csrf": session.csrf, ...headers }, body: JSON.stringify(payload) }); return { status: r.status, data: await r.json() }; }
  const call = async (op, payload) => { const r = await post("/api/safety/long-text/" + op, payload); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  async function ready() {
    let d = await call("intake", { text: "我目前现金8万元，保底1万元。下个月5号交房租3500元，下个月20号交学费2万元。我想投资2万元。", data_mode: "SYNTHETIC_REPLAY", as_of: new Date().toISOString().slice(0, 10), horizon_days: 90 });
    d = await call("correct", { ...binding(d), items: [], profile: { existing_holds_minor: 0, fees_minor: 0 } });
    return call("confirm", { ...binding(d), reviewed_item_ids: d.items.map(x => x.id), confirmed: true, nonoverlap_confirmed: true });
  }
  return { base, cookie, post, call, ready };
}
test("integrated HTTP shares session and completes model, risk, confirmation, replay, audit", async t => {
  const { base, cookie, post, call, ready } = await start(t, { coreFetch: async (_u, init) => Response.json(f.modelResponse(JSON.parse(init.body))) });
  const page = await fetch(base + "/risk/long-text"); assert.equal(page.status, 200); assert.match(await page.text(), /src="\/risk\/long-text\/app.js"/);
  const draft = await ready(), task = await call("handoff", binding(draft)), id = task.input.binding.task_id;
  assert.equal(task.review.decision, "ALLOW"); assert.equal((await call("restore", { draft_id: draft.draft_id })).workbench_link.task_id, id);
  assert.equal((await post("/api/safety/daily/model-review", { task_id: id })).data.run_id, "run-daily-test");
  assert.equal((await post("/api/paper-trade/execute", { task_id: id, idempotency_key: "http-before-confirm" })).status, 409);
  assert.equal((await post("/api/safety/confirm", f.confirm(task))).data.status, "CONFIRMED");
  const first = await post("/api/paper-trade/execute", { task_id: id, idempotency_key: "http-long-text-safe" }); assert.equal(first.data.status, "SUCCEEDED");
  assert.equal((await post("/api/paper-trade/execute", { task_id: id, idempotency_key: "http-long-text-safe" })).data.execution_id, first.data.execution_id);
  const audit = await (await fetch(base + "/api/safety/audit?task_id=" + id, { headers: { cookie } })).json();
  for (const event of ["LONG_TEXT_HANDOFF_RECEIVED", "DAILY_MODEL_REVIEW_RECEIVED", "DAILY_PLAN_CONFIRMED", "DAILY_EXECUTION_SUCCEEDED"]) assert.ok(audit.some(e => e.event_type === event));
});
test("integrated routes reject missing CSRF, cross origin, authority injection and other sessions", async t => {
  const { base, post, ready } = await start(t), draft = await ready(), payload = binding(draft);
  assert.equal((await post("/api/safety/long-text/handoff", payload, { "x-risk-csrf": "wrong" })).status, 403);
  assert.equal((await post("/api/safety/long-text/handoff", payload, { origin: "https://evil.invalid" })).status, 403);
  assert.equal((await post("/api/safety/long-text/handoff", { ...payload, execution_allowed: true })).status, 422);
  const other = await fetch(base + "/api/safety/session"), auth = await other.json(), cookie = other.headers.get("set-cookie").split(";")[0];
  assert.equal((await post("/api/safety/long-text/restore", { draft_id: draft.draft_id }, { cookie, "x-risk-csrf": auth.csrf })).status, 404);
});
test("model outage leaves same workbench task available for explicit retry", async t => {
  let fail = true;
  const { post, call, ready } = await start(t, { coreFetch: async (_u, init) => fail ? Response.json({ error: "unavailable" }, { status: 503 }) : Response.json(f.modelResponse(JSON.parse(init.body))) });
  const draft = await ready(), task = await call("handoff", binding(draft)), id = task.input.binding.task_id;
  assert.equal((await post("/api/safety/daily/model-review", { task_id: id })).status, 503);
  const retry = await call("handoff", binding(draft)); assert.equal(retry.input.binding.task_id, id); assert.equal(retry.model_review, undefined); assert.equal(retry.approval.status, "UNCONFIRMED");
  fail = false; assert.equal((await post("/api/safety/daily/model-review", { task_id: id })).status, 200);
});
