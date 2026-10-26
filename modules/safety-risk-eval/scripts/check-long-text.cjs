"use strict";
// Explicit live synthetic smoke check; never part of offline unit tests.
const assert = require("node:assert/strict"), fs = require("node:fs"), { randomUUID } = require("node:crypto");
const { binding } = require("../../../team-staging/risk/long-text/service.cjs");
async function main() {
  if (!process.argv.includes("--live")) throw Error("Pass --live to make two real team-model calls with synthetic data.");
  const base = process.argv.find(x => /^https?:\/\//.test(x)); if (!base) throw Error("Provide the workbench origin.");
  const response = await fetch(base + "/api/safety/session"), auth = await response.json(), cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie); assert.ok(auth.csrf);
  async function request(route, payload, status = 200) {
    const r = await fetch(base + route, { method: payload ? "POST" : "GET", headers: { cookie, "content-type": "application/json", "x-risk-csrf": auth.csrf }, ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(75000) });
    const data = await r.json(); assert.equal(r.status, status, JSON.stringify(data)); return data;
  }
  const call = (op, p) => request("/api/safety/long-text/" + op, p);
  const asOf = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), checks = [], models = [];
  let draft = await call("intake", { text: "我目前现金5万元，保底1万元。每月5号交房租3500元，下个月20号交学费2万元。我每月10号工资8000元，想拿2万元买基金。", data_mode: "SYNTHETIC_REPLAY", as_of: asOf, horizon_days: 60 });
  draft = await call("correct", { ...binding(draft), items: [], profile: { existing_holds_minor: 0, fees_minor: 0 } });
  const confirm = d => call("confirm", { ...binding(d), reviewed_item_ids: d.items.map(x => x.id), confirmed: true, nonoverlap_confirmed: true });
  draft = await confirm(draft);
  let task = await call("handoff", binding(draft)); const id = task.input.binding.task_id;
  assert.equal(task.review.decision, "BLOCK"); assert.equal(task.review.metrics.shortfall_minor, draft.result.metrics.shortfall_minor);
  checks.push({ name: "protected-cash-conflict", decision: task.review.decision, shortfall_minor: task.review.metrics.shortfall_minor });
  assert.equal((await call("handoff", binding(draft))).input.binding.task_id, id); checks.push({ name: "handoff-idempotent", passed: true });
  const approval = t => ({ task_id: id, risk_check_id: t.review.risk_check_id, binding: t.input.binding, accepted_reason_ids: t.review.reasons.filter(r => r.acceptance_allowed).map(r => r.reason_id), confirmed: true });
  await request("/api/safety/confirm", approval(task), 409); checks.push({ name: "hard-conflict-cannot-confirm", passed: true });
  async function online() {
    const result = await request("/api/safety/daily/model-review", { task_id: id });
    assert.equal(result.mode, "LIVE_TEAM_CORE_MODEL_READ_ONLY"); assert.ok(result.run_id); assert.ok(result.provider_response_id); assert.equal(result.execution_allowed, false);
    assert.equal(result.task_id, id); assert.ok(result.raw_text); assert.ok(!/test-model|run-daily-test/.test(JSON.stringify(result)));
    models.push({ model: result.model, run_id: result.run_id, provider_response_id: result.provider_response_id, input_sha256: result.input_sha256, proposal_sha256: result.proposal_sha256, core_audit_id: result.core_audit_id, summary: result.proposal.summary, risk_decision: result.risk_decision });
    console.log("Live model verified:", result.run_id, result.risk_decision);
  }
  await online();
  draft = await call("correct", { ...binding(draft), items: [{ id: draft.items.find(x => x.type === "INVESTMENT").id, amount_minor: 1000000 }] });
  let stale = await request("/api/safety/task?task_id=" + id); assert.equal(stale.source_stale, true); assert.equal(stale.model_review, undefined);
  await request("/api/safety/daily/model-review", { task_id: id }, 409); checks.push({ name: "source-change-invalidates-old-model-and-approval", passed: true });
  draft = await confirm(draft); task = await call("handoff", binding(draft)); assert.equal(task.input.binding.task_id, id); assert.equal(task.review.decision, "ALLOW");
  checks.push({ name: "revise-same-task", decision: "ALLOW", projected_free_after_minor: task.review.metrics.projected_free_after_minor });
  await online(); await request("/api/paper-trade/execute", { task_id: id, idempotency_key: "pre-confirm-" + randomUUID() }, 409);
  await request("/api/safety/confirm", approval(task)); const key = randomUUID(), receipt = await request("/api/paper-trade/execute", { task_id: id, idempotency_key: key });
  assert.equal(receipt.status, "SUCCEEDED"); assert.equal(receipt.side_effects, false);
  const replay = await request("/api/paper-trade/execute", { task_id: id, idempotency_key: key }); assert.equal(replay.execution_id, receipt.execution_id); assert.equal(replay.replay, true);
  const current = await request("/api/safety/task?task_id=" + id); assert.equal(current.current_ledger.holds.length, 1);
  const audit = await request("/api/safety/audit?task_id=" + id);
  for (const event of ["LONG_TEXT_HANDOFF_RECEIVED", "DAILY_MODEL_REVIEW_RECEIVED", "DAILY_PLAN_CONFIRMED", "DAILY_EXECUTION_SUCCEEDED", "DAILY_DUPLICATE_REQUEST"]) assert.ok(audit.some(e => e.event_type === event));
  checks.push({ name: "confirmed-paper-execution-and-replay", passed: true, execution_id: receipt.execution_id, holds: 1, audit_events: audit.length });
  const report = { verified_at: new Date().toISOString(), as_of: asOf, origin: base, mode: "LIVE_MODEL_WITH_SYNTHETIC_PAPER_ONLY", task_id: id, draft_id: draft.draft_id, source_text: draft.source_text, final_items: draft.items, checks, models, real_account_connected: false, real_transactions: false };
  const output = process.argv.find(x => x.startsWith("--report="))?.slice(9); if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
