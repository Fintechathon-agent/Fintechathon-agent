import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import coreWorker, { ReviewService } from "../deployment/worker.js";
const target = process.argv[2];
if (!target) throw new Error("Provide the generated risk-worker.mjs path.");
const { default: worker, RiskConversationService } = await import(pathToFileURL(path.resolve(target)));
const rows = [];
function storage(filename) {
  const db = new DatabaseSync(filename);
  return { sql: { exec: (query, ...args) => db.prepare(query).all(...args) }, sync: async () => {}, close: () => db.close() };
}
const expectedKey = "synthetic-cloud-machine-access-key-32";
const payload = amount => ({ question: "虚构测试：计划投资，下月还须交4000元房租。", idempotency_key: "cloud-verify-" + amount,
  daily_finance_yuan: { cash_yuan: "10000", amount_yuan: String(amount), fees_yuan: "0", holds_yuan: "0", floor_yuan: "0", purpose_yuan: "4000", due_yuan: "4000", due_date: "2026-11-01", purpose_label: "房租", facts_confirmed: true, purpose_confirmed: true } });
const env = { CORE_AGENT_BASE_URL: "https://core.synthetic.invalid", CORE_AGENT_API_KEY: "synthetic-core-access", RISK_SERVICE_HMAC_SECRET: "synthetic-risk-signature", RISK_REVIEWER_ID: "synthetic-fixed-risk-reviewer", RISK_CONVERSATION_API_KEY: expectedKey, RISK_MODEL_CALLS_ENABLED: "false" };
function request(route, body, headers = {}, method = body === undefined ? "GET" : "POST") {
  return new Request("https://risk.synthetic.invalid" + route, { method, headers: { "X-Risk-Conversation-Key": expectedKey, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const directory = mkdtempSync(path.join(tmpdir(), "risk-cloud-sqlite-")), filename = path.join(directory, "state.sqlite");
let disk = storage(filename), service = new RiskConversationService({ storage: disk }, env);
env.RISK_CONVERSATIONS = { idFromName: value => value, get: () => service };
let network = 0; const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { network++; throw new Error("Unexpected network request"); };
try {
  assert.equal((await worker.fetch(new Request("https://risk.synthetic.invalid/api/status"), env)).status, 401);
  assert.equal((await worker.fetch(request("/api/status", undefined, { Origin: "https://untrusted.invalid" }), env)).status, 403);
  const missingEnv = { ...env }; delete missingEnv.RISK_CONVERSATION_API_KEY;
  assert.equal((await worker.fetch(request("/api/status"), missingEnv)).status, 503);
  rows.push({ scenario: "identity_missing_wrong_and_browser_denied", passed: true });
  let response = await worker.fetch(request("/api/assess", payload(8000)), env), result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.risk_result.decision, "BLOCK"); assert.equal(result.risk_advice.metrics.shortfall_yuan, "2000.00"); assert.equal(result.execution_allowed, false);
  rows.push({ scenario: "program_block_shortfall_2000", passed: true });
  const eventCount = service.store.events.length;
  const replay = await (await worker.fetch(request("/api/assess", payload(8000)), env)).json(); assert.equal(replay.replayed, true); assert.equal(service.store.events.length, eventCount);
  assert.equal((await worker.fetch(request("/api/assess", { ...payload(8000), question: "different" }), env)).status, 409);
  rows.push({ scenario: "durable_replay_and_content_conflict", passed: true });
  const record = await (await worker.fetch(request("/api/records/" + payload(8000).idempotency_key), env)).json(); assert.equal(record.audit_events.length, 1);
  disk.close(); disk = storage(filename); service = new RiskConversationService({ storage: disk }, env);
  assert.equal((await (await worker.fetch(request("/api/assess", payload(8000)), env)).json()).replayed, true);
  rows.push({ scenario: "sqlite_reopen_keeps_record_and_audit", passed: true });
  const unknown = { ...payload(2000), daily_finance_yuan: { ...payload(2000).daily_finance_yuan, fees_yuan: null } };
  assert.equal((await (await worker.fetch(request("/api/assess", unknown), env)).json()).risk_result.decision, "REVIEW");
  rows.push({ scenario: "unknown_fees_not_assumed_zero", passed: true });
  response = await worker.fetch(request("/api/review", payload(8000)), env); assert.equal(response.status, 423); assert.equal((await response.json()).error.code, "MODEL_CALLS_DISABLED"); assert.equal(network, 0);
  rows.push({ scenario: "budget_guard_no_model_or_network_calls", passed: true });
  assert.equal((await worker.fetch(request("/api/assess", { ...payload(1234), decision: "ALLOW" }), env)).status, 422);
  rows.push({ scenario: "user_control_field_rejected", passed: true });
  // Exercise the bundled, precompiled validator and original Owner callback logic.
  for (const [amount, expected] of [[8000, "REJECTED"], [2000, "PENDING_APPROVAL"]]) {
    const values = new Map(); let modelCalls = 0;
    const coreEnv = { ...env, MODEL_PROVIDER: "workers_ai", MODEL_MAX_ATTEMPTS: "1", RATE_LIMIT_PER_MINUTE: "0", REQUIRE_TRUSTED_ACTORS: "true", REQUIRE_RISK_REVIEWER: "true",
      AI: { run: async () => { modelCalls++; return { id: "synthetic-cloud-response", response: { summary: "TEST DOUBLE NOT LIVE", proposed_action: "HOLD_FOR_REVIEW", risk_level: "medium", action_reason: "Protect rent", evidence: [], missing_information: [] } }; } } };
    const coreService = new ReviewService({ storage: { get: async key => structuredClone(values.get(key)), put: async entries => { for (const [key, value] of Object.entries(entries)) values.set(key, structuredClone(value)); } } }, coreEnv);
    coreEnv.REVIEW_SERVICE = { idFromName: value => value, get: () => coreService };
    globalThis.fetch = async (url, options) => { network++; return coreWorker.fetch(new Request(url, options), coreEnv); };
    const memoryDisk = storage(":memory:"), liveEnv = { ...env, RISK_MODEL_CALLS_ENABLED: "true" };
    const bridge = new RiskConversationService({ storage: memoryDisk }, liveEnv); liveEnv.RISK_CONVERSATIONS = { idFromName: value => value, get: () => bridge };
    response = await worker.fetch(request("/api/review", payload(amount)), liveEnv); result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.risk_callback.status, "RECORDED"); assert.equal(result.workflow_status, expected); assert.equal(result.execution_allowed, false); assert.equal(result.risk_decision.auth.verified, true); assert.equal(modelCalls, 1);
    assert.equal((await (await worker.fetch(request("/api/review", payload(amount)), liveEnv)).json()).replayed, true); assert.equal(modelCalls, 1);
    memoryDisk.close(); rows.push({ scenario: "bundled_owner_callback_" + expected, passed: true, model: "TEST_DOUBLE", model_calls: modelCalls });
  }
} finally { disk.close(); globalThis.fetch = originalFetch; }
console.log(JSON.stringify({ passed: rows.length, failed: 0, cases: rows, real_model_calls: 0, local_sqlite_only: true }, null, 2));
