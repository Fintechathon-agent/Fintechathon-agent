import assert from "node:assert/strict";
import worker from "../../../output/risk-build-check/dist/server/index.js";
import { SQLiteD1 } from "./test/sqlite-d1.mjs";
const db = new SQLiteD1(), env = { DB: db }, origin = "https://test.example";
try {
  const first = await worker.fetch(new Request(origin + "/api/safety/session"), env), auth = await first.json(), cookie = first.headers.get("set-cookie").split(";")[0];
  async function call(route, payload) {
    const response = await worker.fetch(new Request(origin + route, { method: payload ? "POST" : "GET", headers: { cookie, "content-type": "application/json", "x-risk-csrf": auth.csrf }, ...(payload ? { body: JSON.stringify(payload) } : {}) }), env);
    assert.equal(response.status, 200); return response.json();
  }
  for (const path of ["/risk", "/risk/long-text", "/risk/long-text/", "/risk/long-text/app.js", "/risk/long-text/style.css"]) assert.equal((await worker.fetch(new Request(origin + path), env)).status, 200);
  assert.equal((await call("/api/safety/long-text/health")).integrated, true);
  const op = (name, p) => call("/api/safety/long-text/" + name, p), binding = d => ({ draft_id: d.draft_id, revision: d.revision, interpretation_sha256: d.interpretation_sha256 });
  let draft = await op("intake", { text: "我目前现金8万元，保底1万元。下个月5号交房租3500元。我想投资2万元。", as_of: new Date().toISOString().slice(0, 10), horizon_days: 60, data_mode: "SYNTHETIC_REPLAY" });
  draft = await op("correct", { ...binding(draft), items: [], profile: { existing_holds_minor: 100000, fees_minor: 0 } });
  draft = await op("confirm", { ...binding(draft), reviewed_item_ids: draft.items.map(x => x.id), confirmed: true, nonoverlap_confirmed: true });
  const task = await op("handoff", binding(draft)), id = task.input.binding.task_id;
  assert.equal(task.review.decision, "ALLOW"); assert.equal(task.source_stale, false);
  await call("/api/safety/confirm", { task_id: id, risk_check_id: task.review.risk_check_id, binding: task.input.binding, accepted_reason_ids: [], confirmed: true });
  const receipt = await call("/api/paper-trade/execute", { task_id: id, idempotency_key: "bundled-long-text" }); assert.equal(receipt.status, "SUCCEEDED"); assert.equal(receipt.side_effects, false);
  assert.equal((await call("/api/paper-trade/execute", { task_id: id, idempotency_key: "bundled-long-text" })).replay, true);
  assert.ok((await call("/api/safety/audit?task_id=" + id)).some(e => e.event_type === "DAILY_EXECUTION_SUCCEEDED"));
  console.log("Bundled Worker: assets, same-session intake/correction/confirmation/handoff, D1 persistence, paper execution/replay and audit passed.");
} finally { db.close(); }
