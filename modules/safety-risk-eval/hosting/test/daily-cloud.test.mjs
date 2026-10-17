import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { CloudStore, getSession } from "../cloud-store.mjs";
import { SQLiteD1 } from "./sqlite-d1.mjs";
const require = createRequire(import.meta.url), { DailyGateway } = require("../../daily-gateway.cjs"), f = require("../../test/daily-fixture.cjs");
test("D1 daily holds and audit survive reopening, replay never writes twice", async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const session = await getSession(db, new Request("https://test.example/api/safety/session"));
  let store = await CloudStore.open(db, session), gateway = new DailyGateway({ store, beforeExecute: () => store.flush() });
  const record = gateway.create(session.user_id, f.payload()), id = record.input.binding.task_id; gateway.confirm(id, session.user_id, f.confirm(record));
  const result = await gateway.execute(id, session.user_id, "cloud-daily-001"); assert.equal(result.status, "SUCCEEDED"); await store.flush(); await store.close();
  store = await CloudStore.open(db, session); gateway = new DailyGateway({ store, beforeExecute: () => store.flush() });
  const current = gateway.inspect(id, session.user_id); assert.equal(current.current_ledger.holds.length, 1); assert.equal(current.ledger_revision, 2);
  assert.equal((await gateway.execute(id, session.user_id, "cloud-daily-001")).replay, true); assert.equal(gateway.inspect(id, session.user_id).current_ledger.holds.length, 1); await store.close();
});
test("D1 daily preflight persistence failure cannot allocate cash", async t => {
  const db = new SQLiteD1(); t.after(() => db.close()); const session = await getSession(db, new Request("https://test.example/api/safety/session")), store = await CloudStore.open(db, session);
  const gateway = new DailyGateway({ store, beforeExecute: async () => { throw new Error("D1 unavailable"); } }), record = gateway.create(session.user_id, f.payload()), id = record.input.binding.task_id;
  gateway.confirm(id, session.user_id, f.confirm(record)); assert.equal((await gateway.execute(id, session.user_id, "cloud-daily-fail")).status, "ABORTED"); assert.equal(gateway.inspect(id, session.user_id).current_ledger.holds.length, 0); await store.close();
});
