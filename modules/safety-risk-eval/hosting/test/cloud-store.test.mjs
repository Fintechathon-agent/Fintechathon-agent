import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { CloudStore, getSession } from "../cloud-store.mjs";
import { SQLiteD1 } from "./sqlite-d1.mjs";
const require = createRequire(import.meta.url);
const h = require("../../test/helpers.cjs");
const { ActionGateway } = require("../../gateway.cjs");
const adapter = require("../../core-adapter.cjs");

async function fixture(t) {
  const db = new SQLiteD1(); t.after(() => db.close());
  const session = await getSession(db, new Request("https://demo.example/api/safety/session"));
  return { db, session };
}
test("D1: sessions are isolated and the secure cookie restores the same visitor", async (t) => {
  const { db, session } = await fixture(t);
  const restored = await getSession(db, new Request("https://demo.example/api", { headers: { cookie: `risk_session=${session.session_id}` } }));
  assert.equal(restored.user_id, session.user_id); assert.equal(restored.fresh, false);
  const other = await getSession(db, new Request("https://demo.example/api")); assert.notEqual(other.user_id, session.user_id);
});
test("D1: simultaneous requests cannot hold the same session lease", async (t) => {
  const { db, session } = await fixture(t); const store = await CloudStore.open(db, session);
  await assert.rejects(() => CloudStore.open(db, session), /SESSION_BUSY/);
  await store.close(); const next = await CloudStore.open(db, session); await next.close();
});
test("D1: audit tampering is rejected and its lease is released", async (t) => {
  const { db, session } = await fixture(t); const store = await CloudStore.open(db, session);
  store.append({ event_type: "TEST", occurred_at: h.now }); await store.flush(); await store.close();
  const row = await db.prepare("SELECT payload FROM risk_demo_sessions WHERE session_id=?1").bind(session.session_id).first();
  const payload = JSON.parse(row.payload); payload.events[0].event_type = "CHANGED";
  await db.prepare("UPDATE risk_demo_sessions SET payload=?1 WHERE session_id=?2").bind(JSON.stringify(payload), session.session_id).run();
  await assert.rejects(() => CloudStore.open(db, session), /AUDIT_CHAIN_INVALID/);
  assert.equal((await db.prepare("SELECT lease_until FROM risk_demo_sessions WHERE session_id=?1").bind(session.session_id).first()).lease_until, 0);
});
test("D1: abandoned RUNNING becomes UNKNOWN and never replays the tool", async (t) => {
  const { db, session } = await fixture(t); let store = await CloudStore.open(db, session);
  const i = h.input(); const key = `${i.binding.user_id}:cloud-key-001`;
  store.transaction(data => {
    data.tasks[i.binding.task_id] = { input: i };
    data.executions[key] = { status: "RUNNING", content_hash: h.hash(i.binding), user_id: i.binding.user_id, task_id: i.binding.task_id };
  }); await store.flush(); await store.close();
  store = await CloudStore.open(db, session); let calls = 0;
  const gateway = new ActionGateway({ store, projectPlan: adapter.projectPlan, executePlan: () => calls++ });
  const result = await gateway.execute(i.binding.task_id, i.binding.user_id, "cloud-key-001");
  assert.equal(result.status, "UNKNOWN"); assert.equal(result.replay, true); assert.equal(calls, 0); await store.close();
});
test("D1: execution claim and audit are durable before the tool is called", async (t) => {
  const { db, session } = await fixture(t); const store = await CloudStore.open(db, session);
  const i = h.input(); let calls = 0;
  const gateway = new ActionGateway({ store, projectPlan: adapter.projectPlan, now: () => h.now, beforeExecute: () => store.flush(), executePlan: async (...args) => {
    const row = await db.prepare("SELECT payload FROM risk_demo_sessions WHERE session_id=?1").bind(session.session_id).first();
    const payload = JSON.parse(row.payload);
    assert.equal(Object.values(payload.data.executions)[0].status, "RUNNING");
    assert.ok(payload.events.some(e => e.event_type === "EXECUTION_STARTED")); calls++; return adapter.executePlan(...args);
  } });
  const review = gateway.register(i); h.confirm(gateway, i, review);
  assert.equal((await gateway.execute(i.binding.task_id, i.binding.user_id, "cloud-key-001")).status, "SUCCEEDED");
  await store.flush(); await store.close();
  const reopened = await CloudStore.open(db, session);
  const again = new ActionGateway({ store: reopened, projectPlan: adapter.projectPlan, executePlan: () => calls++ });
  assert.equal((await again.execute(i.binding.task_id, i.binding.user_id, "cloud-key-001")).status, "SUCCEEDED");
  assert.equal(calls, 1); await reopened.close();
});
test("D1: a failed pre-execution flush prevents any tool call", async (t) => {
  const { db, session } = await fixture(t); const store = await CloudStore.open(db, session); const i = h.input(); let calls = 0;
  const gateway = new ActionGateway({ store, projectPlan: adapter.projectPlan, now: () => h.now, beforeExecute: async () => { throw new Error("D1 unavailable"); }, executePlan: () => calls++ });
  const review = gateway.register(i); h.confirm(gateway, i, review);
  const result = await gateway.execute(i.binding.task_id, i.binding.user_id, "cloud-key-001");
  assert.equal(result.status, "NOT_STARTED"); assert.equal(result.decision, "ERROR"); assert.equal(calls, 0); await store.close();
});
