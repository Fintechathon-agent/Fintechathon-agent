import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { CloudStore, getSession } from "../cloud-store.mjs";
import { SQLiteD1 } from "./sqlite-d1.mjs";
const require = createRequire(import.meta.url), { DailyGateway } = require("../../daily-gateway.cjs"), { LongTextBridge } = require("../../long-text.cjs");
const { binding } = require("../../../../team-staging/risk/long-text/service.cjs"), f = require("../../test/daily-fixture.cjs"), model = require("../../daily-model.cjs");
test("D1 persists long text, confirmed source, real-shaped model evidence, execution and audit across requests", async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const session = await getSession(db, new Request("https://test.example/api/safety/session"));
  async function request(fn) {
    const store = await CloudStore.open(db, session), gateway = new DailyGateway({ store, beforeExecute: () => store.flush() }), bridge = new LongTextBridge({ store, gateway });
    try { const result = await fn({ store, gateway, call: (op, p) => bridge.handle(op, session.user_id, p) }); await store.flush(); return result; } finally { await store.close(); }
  }
  let draft = await request(({ call }) => call("intake", { text: "我目前现金8万元，保底1万元。下个月5号交房租3500元。我想投资2万元。", data_mode: "SYNTHETIC_REPLAY", as_of: new Date().toISOString().slice(0, 10), horizon_days: 60 }));
  draft = await request(({ call }) => call("correct", { ...binding(draft), items: [], profile: { existing_holds_minor: 100000, fees_minor: 0 } }));
  draft = await request(({ call }) => call("confirm", { ...binding(draft), reviewed_item_ids: draft.items.map(x => x.id), confirmed: true, nonoverlap_confirmed: true }));
  const task = await request(({ call }) => call("handoff", binding(draft))), id = task.input.binding.task_id;
  await request(({ store, gateway }) => model.review({ gateway, actor: session.user_id, payload: { task_id: id }, persist: () => store.flush(), fetchImpl: async (_u, init) => Response.json(f.modelResponse(JSON.parse(init.body))) }));
  await request(({ call, gateway }) => { assert.equal(call("restore", { draft_id: draft.draft_id }).workbench_link.task_id, id); const current = gateway.inspect(id, session.user_id); assert.equal(current.source_stale, false); assert.equal(current.model_review.run_id, "run-daily-test"); return gateway.confirm(id, session.user_id, f.confirm(current)); });
  const result = await request(({ gateway }) => gateway.execute(id, session.user_id, "cloud-long-text-safe")); assert.equal(result.status, "SUCCEEDED");
  await request(async ({ store, gateway }) => { assert.equal((await gateway.execute(id, session.user_id, "cloud-long-text-safe")).execution_id, result.execution_id); assert.equal(gateway.inspect(id, session.user_id).current_ledger.holds.length, 2); assert.ok(store.events.some(e => e.event_type === "DAILY_EXECUTION_SUCCEEDED")); });
});
