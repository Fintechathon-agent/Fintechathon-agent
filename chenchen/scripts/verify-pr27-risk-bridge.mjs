import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import worker, { ReviewService } from "../deployment/worker.js";

// Load the reviewed Risk snapshot without merging or rewriting its Owner's code.
const snapshot = process.argv[2];
if (!snapshot) throw new Error("Provide the directory containing PR27 modules/safety-risk-eval/interface-adapters.");
const require = createRequire(import.meta.url);
const adapters = path.resolve(snapshot, "modules/safety-risk-eval/interface-adapters");
const { ConversationStore } = require(path.join(adapters, "conversation-store.cjs"));
const { createConversationReviewer } = require(path.join(adapters, "conversation-review.cjs"));
const at = "2026-10-21T04:00:00.000Z";
const rows = [];

for (const scenario of [
  { name: "BLOCK", amount: "8000.00", fees: "0", status: "REJECTED", callback: "RECORDED", gap: "2000.00" },
  { name: "ALLOW", amount: "2000.00", fees: "0", status: "PENDING_APPROVAL", callback: "RECORDED" },
  { name: "REVIEW", amount: "2000.00", fees: null, status: "PENDING_RISK", callback: "RECORDED" },
  { name: "WRONG_HMAC", amount: "8000.00", fees: "0", status: "PENDING_RISK", callback: "UNKNOWN", wrongSecret: true },
  { name: "MODEL_FAILURE", amount: "8000.00", fees: "0", failModel: true }
]) {
  const data = new Map(); let modelCalls = 0;
  const config = { baseUrl: "https://core.synthetic.invalid", apiKey: "synthetic-pr27-machine-key",
    hmacSecret: "synthetic-pr27-signature-key", reviewer: "synthetic-pr27-risk-owner", timeoutMs: 2000 };
  const env = { MODEL_PROVIDER: "workers_ai", MODEL_MAX_ATTEMPTS: "1", RATE_LIMIT_PER_MINUTE: "0",
    REQUIRE_TRUSTED_ACTORS: "true", REQUIRE_RISK_REVIEWER: "true", CORE_AGENT_API_KEY: config.apiKey,
    RISK_SERVICE_HMAC_SECRET: config.hmacSecret, RISK_REVIEWER_ID: config.reviewer,
    AI: { run: async () => { modelCalls++; if (scenario.failModel) throw new Error("SYNTHETIC_MODEL_FAILURE"); return {
      id: "synthetic-pr27-response", response: { summary: "SYNTHETIC TEST DOUBLE, NOT LIVE", proposed_action: "HOLD_FOR_REVIEW",
        risk_level: "medium", action_reason: "Protect the confirmed rent", evidence: [], missing_information: [] }
    }; } }
  };
  const storage = { get: async key => structuredClone(data.get(key)), put: async entries => {
    for (const [key, value] of Object.entries(entries)) data.set(key, structuredClone(value));
  } };
  const service = new ReviewService({ storage }, env);
  env.REVIEW_SERVICE = { idFromName: name => name, get: () => service };
  const journal = new ConversationStore(mkdtempSync(path.join(tmpdir(), "core-pr27-bridge-")));
  const reviewer = createConversationReviewer({ store: journal, config: {
    ...config, ...(scenario.wrongSecret ? { hmacSecret: "synthetic-deliberately-wrong-key" } : {})
  }, now: () => at, fetchImpl: (url, options) => {
    assert.equal(new URL(url).origin, config.baseUrl);
    return worker.fetch(new Request(url, options), env);
  } });
  const payload = { question: "虚构测试：准备投资，下月必须保留4000元房租。", idempotency_key: "core-pr27-" + scenario.name,
    daily_finance_yuan: { cash_yuan: "10000.00", amount_yuan: scenario.amount, fees_yuan: scenario.fees,
      holds_yuan: "0", floor_yuan: "0", purpose_yuan: "4000.00", due_yuan: "4000.00",
      due_date: "2026-11-01", purpose_label: "房租", facts_confirmed: true, purpose_confirmed: true } };
  try {
    if (scenario.failModel) {
      await assert.rejects(reviewer.review(payload), error => error.code === "CORE_REQUEST_FAILED" && error.partial?.risk_callback.status === "NOT_SENT");
      assert.equal(modelCalls, 1);
      const record = [...data.values()].find(row => row?.workflow_version);
      assert.equal(record.status, "MODEL_FAILED");
      assert.equal(record.execution.execution_allowed, false);
      rows.push({ scenario: scenario.name, status: "PASS", callback: "NOT_SENT", model_calls: modelCalls, model: "TEST_DOUBLE", execution_allowed: false });
      continue;
    }
    const result = await reviewer.review(payload);
    assert.equal(result.risk_callback.status, scenario.callback);
    assert.equal(result.executed, false);
    assert.equal(result.execution_allowed, false);
    if (scenario.gap) assert.equal(result.risk_advice.metrics.shortfall_yuan, scenario.gap);
    const stored = data.get("run:" + result.run_id);
    assert.equal(stored.status, scenario.status);
    if (scenario.wrongSecret) {
      assert.equal(result.risk_callback.requires_reconciliation, true);
      assert.equal(stored.risk_decision, null);
    } else {
      assert.equal(result.risk_advice.decision, scenario.name);
      assert.equal(stored.risk_decision.auth.verified, true);
      assert.equal(stored.risk_decision.auth.actor, config.reviewer);
      assert.equal((await reviewer.review(payload)).replayed, true);
    }
    assert.equal(modelCalls, 1);
    rows.push({ scenario: scenario.name, status: "PASS", workflow_status: stored.status, callback: result.risk_callback.status,
      task_id: stored.task_id, run_id: stored.run_id, audit_id: stored.audit.audit_id, proposal_sha256: stored.proposed_action.proposal_sha256,
      model_calls: modelCalls, model: "TEST_DOUBLE", execution_allowed: false,
      model_evidence: { label: "TEST_DOUBLE_NOT_LIVE", raw_text: stored.model.model_response.raw_text, provider_response_id: stored.model.model_response.provider_response_id },
      audit_events: stored.audit.events });
    for (const secret of [config.apiKey, config.hmacSecret]) assert.equal(JSON.stringify(rows.at(-1)).includes(secret), false);
  } finally { journal.close(); }
}
const report = { verification: "PR27_RISK_WITH_CORE_WORKER_HANDLER", transport: "IN_PROCESS_FETCH_NOT_PUBLIC_HTTP",
  core_security: "MACHINE_KEY_AND_HMAC_AND_FIXED_REVIEWER", passed: rows.length, failed: 0,
  real_model_calls: 0, joint_acceptance: false, cases: rows };
if (process.argv[3]) writeFileSync(path.resolve(process.argv[3]), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
