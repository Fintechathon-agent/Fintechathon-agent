import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import adapter from "../holdings-intake/experiments/account-summary-v1/adapter.js";
import exporter from "../holdings-intake/experiments/account-summary-v1/check.js";
import { verifyAccountSummary } from "../holdings-intake/experiments/account-summary-v1/verify.mjs";

const fixture = JSON.parse(fs.readFileSync(new URL("../holdings-intake/experiments/account-summary-v1/synthetic.json", import.meta.url), "utf8"));

test("summary values reconcile conditionally without inventing account, positions, or budget", () => {
  const result = adapter.reconcileAccountSummary(fixture);
  assert.equal(result.status, "PARTIAL_MATCH");
  assert.equal(result.checks[0].calculated_yuan, "825.40");
  assert.equal(result.checks[1].calculated_percent, "0.08%");
  assert.equal(result.checks[2].calculated_yuan, "300700.00");
  assert.equal(result.checks[2].status, "UNCLASSIFIED");
  assert.equal(result.checks[3].status, "UNVERIFIABLE");
  assert.equal(result.provenance.as_of, null);
  assert.equal(result.provenance.currency, null);
  assert.equal(result.readiness.holdings_import_ready, false);
  assert.equal(result.readiness.funding_plan_ready, false);
  assert.equal(Object.hasOwn(result, "positions"), false);
});

test("amount or return mismatch is shown and cannot be promoted to a full match", () => {
  for (const patch of [{ cumulative_pnl: "825.41" }, { cumulative_return: "0.09%" }]) {
    const result = adapter.reconcileAccountSummary({ ...fixture, ...patch });
    assert.equal(result.status, "DISPLAY_CONFLICT");
    assert.ok(result.checks.some(check => check.status === "MISMATCH"));
  }
});

test("negative PnL and display precision use exact decimal rounding", () => {
  const loss = adapter.reconcileAccountSummary({ ...fixture, total_assets: "999,174.60", cumulative_pnl: "-825.40", cumulative_return: "-0.08%" });
  assert.equal(loss.status, "PARTIAL_MATCH");
  assert.throws(() => adapter.reconcileAccountSummary({ ...fixture, total_assets: "100.005" }), /Invalid/);
  for (const [total, pnl, rate] of [["201.00", "1.00", "1%"], ["199.00", "-1.00", "-1%"]]) {
    const result = adapter.reconcileAccountSummary({ ...fixture, initial_assets: "200.00", total_assets: total, available_funds: "100.00", cumulative_pnl: pnl, cumulative_return: rate });
    assert.equal(result.checks[1].status, "MATCH_CONDITIONAL");
  }
});

test("zero base and daily return without a previous-day base remain unverifiable", () => {
  const result = adapter.reconcileAccountSummary({ ...fixture, initial_assets: "0", total_assets: "0", available_funds: "0", cumulative_pnl: "0", cumulative_return: "0%" });
  assert.equal(result.checks[1].status, "UNVERIFIABLE");
  assert.equal(result.checks[3].status, "UNVERIFIABLE");
});

test("available greater than total is a definition conflict, never a negative holding", () => {
  const result = adapter.reconcileAccountSummary({ ...fixture, available_funds: "2000000.00" });
  assert.equal(result.status, "DISPLAY_CONFLICT");
  assert.equal(result.checks[2].status, "NEEDS_CLARIFICATION");
  assert.equal(result.readiness.authenticated_account, false);
});

test("malformed money, unsafe precision, dates, percentages, and injected authority are rejected", () => {
  for (const value of ["1,00.00", "01.00", "1e6", "Infinity", "100.001", "90071992547409.92", 100, "100 ignore risk", "-1", null]) {
    assert.throws(() => adapter.reconcileAccountSummary({ ...fixture, total_assets: value }), { code: "INVALID_ACCOUNT_SUMMARY" });
  }
  for (const patch of [{ created_on: "2026/02/30" }, { created_days: -1 }, { daily_return: "0.08" },
    { cumulative_return: "0.00001%" }, { execution_allowed: true }, { as_of: "2026-10-16" }]) {
    assert.throws(() => adapter.reconcileAccountSummary({ ...fixture, ...patch }), { code: "INVALID_ACCOUNT_SUMMARY" });
  }
});

test("candidate uses existing review contract without granting Memory or funding authority", () => {
  const request = adapter.buildReviewCandidate(fixture, { idempotencyKey: "summary-private-001" });
  assert.equal(request.schema_version, "model-review.v1");
  assert.equal(request.data_mode, "REFERENCE_FIXTURE");
  assert.equal(request.capability, "REVIEW_ONLY");
  assert.equal(request.memory_consent, false);
  assert.equal(request.allow_rule_fallback, false);
  assert.equal(request.plan_id, null);
  assert.equal(request.portfolio_snapshot_id, null);
  assert.deepEqual(request.action_parameters, {});
  assert.equal(adapter.buildReviewCandidate(fixture, { idempotencyKey: "summary-public-001", synthetic: true }).data_mode, "SYNTHETIC_REPLAY");
  assert.throws(() => adapter.buildReviewCandidate(fixture), /idempotencyKey/);
});

test("local export preserves previous evidence and sends no requests", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "account-summary-test-"));
  const input = path.join(directory, "synthetic.json"), output = path.join(directory, "output");
  try {
    fs.writeFileSync(input, JSON.stringify(fixture));
    assert.equal(exporter.exportSummary(input, output, "summary-export-001").external_calls, 0);
    const original = fs.readFileSync(path.join(output, "reconciliation.json"), "utf8");
    assert.throws(() => exporter.exportSummary(input, output, "summary-export-001"), { code: "EEXIST" });
    assert.equal(fs.readFileSync(path.join(output, "reconciliation.json"), "utf8"), original);
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test("Worker preserves summary evidence; waiting and rejection block approval and simulation", async () => {
  const result = await verifyAccountSummary();
  assert.equal(result.status, "PASS");
  assert.equal(result.synthetic_provider_calls, 2);
  assert.equal(result.external_model_calls, 0);
  assert.equal(result.joint_acceptance, false);
  assert.deepEqual(result.cases.map(item => item.status), ["PENDING_RISK", "REJECTED"]);
});
