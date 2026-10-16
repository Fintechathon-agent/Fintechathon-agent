"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const contract = require("../../../docs/safety-risk-eval/contracts/validate.cjs");
const { JournalStore } = require("../store.cjs");
const { ActionGateway } = require("../gateway.cjs");
const adapter = require("../core-adapter.cjs");
const { Harness } = require("../../../chenchen/core/harness.js");
const now = "2026-10-10T09:00:00+08:00";
function input(name = "allow") { return contract.read(`examples/${name}.input.json`); }
function authority(i) { return { user_id: i.binding.user_id, allowed_tools: ["portfolio.review", "paper_trade"], expected_binding: i.binding, project_plan: adapter.projectPlan }; }
function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "risk-test-"));
  const store = new JournalStore(dir);
  t.after(() => { store.close(); if (dir.startsWith(path.join(os.tmpdir(), "risk-test-"))) fs.rmSync(dir, { recursive: true, force: true }); });
  let calls = 0;
  const gateway = new ActionGateway({ store, projectPlan: adapter.projectPlan, executePlan: async (...args) => { calls++; return adapter.executePlan(...args); }, now: () => now, ...options });
  return { gateway, store, dir, calls: () => calls };
}
function confirm(gateway, i, result) { return gateway.confirm(i.binding.task_id, i.binding.user_id, { confirmed: true, binding: i.binding, risk_check_id: result.risk_check_id, accepted_reason_ids: result.reasons.filter((r) => r.acceptance_allowed).map((r) => r.reason_id) }); }
function fresh() {
  const harness = new Harness();
  const request = require("../../../chenchen/contracts/examples/health-check.request.json");
  const upstream = harness.runHealthCheckContract(structuredClone(request));
  return { harness, upstream, input: adapter.fromHandoff(upstream, "demo-user-001", { confirmed: true, now }) };
}
module.exports = { input, authority, fixture, confirm, fresh, now, ...contract };
