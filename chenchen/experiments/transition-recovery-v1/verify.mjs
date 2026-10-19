import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import worker, { ReviewService } from "../../deployment/worker.js";

const script = fileURLToPath(import.meta.url);
async function phase(directory, scenario, restart) {
  const db = new DatabaseSync(path.join(directory, "transitions.sqlite"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
  const read = key => { const row = db.prepare("SELECT value FROM kv WHERE key=?").get(key); return row ? JSON.parse(row.value) : undefined; };
  const write = (key, value) => db.prepare("INSERT OR REPLACE INTO kv(key,value) VALUES(?,?)").run(key, JSON.stringify(value));
  let armed = false;
  const storage = { get: async key => read(key), put: async entries => {
    const final = armed && Object.values(entries).some(v => v?.transition_version && v.state === "COMPLETED");
    if (final && scenario.endsWith("before")) process.exit(86);
    db.exec("BEGIN IMMEDIATE");
    try { for (const [key, value] of Object.entries(entries)) write(key, value); db.exec("COMMIT"); }
    catch (error) { db.exec("ROLLBACK"); throw error; }
    if (final && scenario.endsWith("after")) process.exit(87);
  } };
  const env = { MODEL_PROVIDER: "workers_ai", MODEL_MAX_ATTEMPTS: "1", MODEL_REQUESTS_PER_MINUTE: "100", RATE_LIMIT_PER_MINUTE: "0",
    AI: { run: async () => { const calls = (read("test:model-calls") || 0) + 1; write("test:model-calls", calls);
      return { id: "synthetic-disk-transition-" + calls, response: { summary: "虚构状态变更恢复", risk_level: "unknown",
        proposed_action: "HOLD_FOR_REVIEW", action_reason: "等风控审批", missing_information: [], evidence: [] } }; } } };
  const service = new ReviewService({ storage }, env);
  env.REVIEW_SERVICE = { idFromName: x => x, get: () => service };
  async function call(endpoint, body) {
    const response = await worker.fetch(new Request("https://synthetic.test" + endpoint, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }), env);
    return { endpoint, http_status: response.status, body: await response.json() };
  }
  const binding = r => ({ task_id: r.task_id, proposal_sha256: r.proposed_action.proposal_sha256 });
  if (!restart) {
    const plan = (await call("/api/funding-demo/plan", { synthetic: true, confirmed: true, currency: "CNY", cash_minor: 1000000,
      protected_purposes: [{ purpose_id: "rent", label: "虚构房租", amount_minor: 400000 }] })).body;
    const records = [];
    for (const name of ["first", "second"]) {
      const record = (await call("/api/review", { text: "虚构磁盘恢复 " + name, data_mode: "SYNTHETIC_REPLAY", idempotency_key: "disk-transition-" + name,
        action_parameters: { synthetic: true, currency: "CNY", amount: 4000, funding_plan_id: plan.plan_id, funding_plan_revision: plan.revision } })).body;
      assert.equal(record.status, "PENDING_RISK");
      assert.equal((await call("/api/review/risk-decision", { ...binding(record), decision: "APPROVE", reviewer: "synthetic-risk", reason: "Fixture decision" })).http_status, 200);
      assert.equal((await call("/api/review/approval", { ...binding(record), decision: "APPROVE", approver: "synthetic-user", reason: "Fixture approval" })).http_status, 200);
      records.push(record);
    }
    write("test:metadata", { plan_id: plan.plan_id, task_ids: records.map(r => r.task_id) });
    armed = true;
    if (scenario === "cancel-before") await call("/api/review/cancel", { ...binding(records[0]), canceler: "synthetic-user", reason: "Keep rent" });
    else await call("/api/review/simulate", binding(records[0]));
    throw new Error("Expected forced exit was not reached");
  }
  const metadata = read("test:metadata"), callsBefore = read("test:model-calls");
  const first = read("run:" + read("task:" + metadata.task_ids[0]));
  const second = read("run:" + read("task:" + metadata.task_ids[1]));
  const originalReceipt = structuredClone(first.execution.receipt);
  const responses = [await call("/api/review/task/" + first.task_id), await call("/api/review/simulate", binding(first))];
  if (scenario === "simulate-before") {
    responses.push(await call("/api/review/simulate", binding(second)));
    responses.push(await call("/api/funding-demo/plan/" + metadata.plan_id));
  }
  if (scenario.endsWith("before")) {
    for (const result of responses) {
      assert.equal(result.http_status, 503); assert.equal(result.body.error.retryable, false);
      assert.equal(result.body.error.code, "REVIEW_SERVICE_UNAVAILABLE"); assert.equal(result.body.workflow, null);
    }
    assert.equal(read("funding:" + metadata.plan_id).allocations.length, 0);
  } else {
    assert.ok(responses.every(r => r.http_status === 200));
    assert.deepEqual(responses[1].body.execution.receipt, originalReceipt);
    assert.equal(read("funding:" + metadata.plan_id).allocations.length, 1);
    assert.equal(responses[1].body.audit.events.filter(e => e.event_type === "execution.simulated").length, 1);
  }
  assert.equal(read("test:model-calls"), callsBefore);
  const marks = db.prepare("SELECT value FROM kv WHERE key LIKE 'review-transition:%'").all().map(r => JSON.parse(r.value));
  const result = { scenario, status: "PASS", responses, model_calls_before: callsBefore, model_calls_after: read("test:model-calls"),
    persisted_workflow_status: read("run:" + first.run_id).status,
    allocated_minor: read("funding:" + metadata.plan_id).allocations.reduce((sum, item) => sum + item.amount_minor, 0), markers: marks,
    caveat: "Raw database state may be older than a pending transition; it is not a usable API response." };
  db.close(); return result;
}

const get = key => { const i = process.argv.indexOf(key); return i < 0 ? null : process.argv[i + 1]; };
if (get("--phase")) {
  process.stdout.write(JSON.stringify(await phase(get("--directory"), get("--scenario"), get("--phase") === "restart")));
} else {
  if (!get("--output")) throw new Error("--output <new report.json> required");
  const cases = [];
  for (const scenario of ["cancel-before", "simulate-before", "simulate-after"]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "core-transition-recovery-"));
    const run = name => spawnSync(process.execPath, [script, "--phase", name, "--scenario", scenario, "--directory", directory],
      { encoding: "utf8", timeout: 30000, windowsHide: true });
    const crash = run("crash"); assert.equal(crash.status, scenario.endsWith("before") ? 86 : 87, crash.stderr);
    const restart = run("restart"); assert.equal(restart.status, 0, restart.stderr);
    cases.push({ forced_exit: crash.status, ...JSON.parse(restart.stdout) });
  }
  const report = { evidence_version: "core-transition-recovery.v1", recorded_at: new Date().toISOString(), status: "PASS",
    mode: "LOCAL_SQLITE_FORCED_PROCESS_EXIT", process_count: 6, forced_exit_count: 3, synthetic_model_calls: 6,
    real_model_calls: 0, paid_model_calls: 0, actual_risk_owner_used: false, joint_acceptance: false, public_cloud_fault_injection: false,
    database: "Temporary SQLite with transactions, WAL and synchronous FULL; not a Cloudflare emulator", cases };
  fs.writeFileSync(path.resolve(get("--output")), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, cases: cases.length, process_count: 6, forced_exits: 3, real_model_calls: 0 }));
}
