import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import worker, { ReviewService } from "../../deployment/worker.js";

const script = fileURLToPath(import.meta.url);

async function phase(directory, name) {
  const db = new DatabaseSync(path.join(directory, "recovery.sqlite"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const read = key => { const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key); return row ? JSON.parse(row.value) : undefined; };
  const write = (key, value) => db.prepare("INSERT OR REPLACE INTO kv(key,value) VALUES (?,?)").run(key, JSON.stringify(value));
  const storage = { get: async key => read(key), put: async entries => {
    const final = Object.keys(entries).some(key => key.startsWith("run:"));
    if (final && name === "crash-before-final-commit") process.exit(86);
    db.exec("BEGIN IMMEDIATE");
    try { for (const [key, value] of Object.entries(entries)) write(key, value); db.exec("COMMIT"); }
    catch (error) { db.exec("ROLLBACK"); throw error; }
    if (final && name === "crash-after-final-commit") process.exit(87);
  } };
  const env = { MODEL_PROVIDER: "workers_ai", MODEL_MAX_ATTEMPTS: "1", RATE_LIMIT_PER_MINUTE: "0", MODEL_DISABLE_RULE_FALLBACK: "true",
    AI: { run: async () => {
      const count = (read("test-vendor-calls") || 0) + 1; write("test-vendor-calls", count);
      return { id: "synthetic-disk-test-" + count, response: { summary: "虚构磁盘恢复案例", risk_level: "unknown",
        proposed_action: "HOLD_FOR_REVIEW", action_reason: "等待 Risk", missing_information: [], evidence: [] } };
    } } };
  const service = new ReviewService({ storage }, env);
  env.REVIEW_SERVICE = { idFromName: x => x, get: () => service };
  const input = { text: "虚构房租与投资安排，不涉及真实资料", data_mode: "SYNTHETIC_REPLAY",
    idempotency_key: name.includes("before") || name === "retry-unresolved" ? "synthetic-unresolved-key" : "synthetic-completed-key" };
  const before = read("test-vendor-calls") || 0;
  const response = await worker.fetch(new Request("https://synthetic.test/api/review", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  }), env);
  const body = await response.json();
  const after = read("test-vendor-calls") || 0;
  const reservations = db.prepare("SELECT value FROM kv WHERE key LIKE 'review-reservation:task:%'").all().map(r => JSON.parse(r.value));
  const taskId = body.task_id || body.trace?.task_id;
  const queried = await worker.fetch(new Request("https://synthetic.test/api/review/task/" + taskId), env);
  const result = { phase: name, http_status: response.status, response: body, query_status: queried.status,
    query_response: await queried.json(), model_calls_before: before, model_calls_after: after, reservations };
  db.close(); return result;
}

function verify() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "core-durable-recovery-"));
  const run = name => spawnSync(process.execPath, [script, "--phase", name, "--directory", directory], { encoding: "utf8", timeout: 30000 });
  const crashed = run("crash-before-final-commit"); assert.equal(crashed.status, 86, crashed.stderr);
  const retry = run("retry-unresolved"); assert.equal(retry.status, 0, retry.stderr); const unresolved = JSON.parse(retry.stdout);
  assert.equal(unresolved.http_status, 503); assert.equal(unresolved.query_status, 503);
  assert.equal(unresolved.model_calls_before, 1); assert.equal(unresolved.model_calls_after, 1);
  assert.equal(unresolved.response.error.retryable, false); assert.ok(unresolved.response.trace.task_id);
  assert.equal(unresolved.reservations.length, 1); assert.equal(unresolved.reservations[0].state, "RESERVED");
  const lost = run("crash-after-final-commit"); assert.equal(lost.status, 87, lost.stderr);
  const replay = run("retry-completed"); assert.equal(replay.status, 0, replay.stderr); const completed = JSON.parse(replay.stdout);
  assert.equal(completed.http_status, 200); assert.equal(completed.query_status, 200);
  assert.equal(completed.model_calls_before, 2); assert.equal(completed.model_calls_after, 2);
  assert.equal(completed.response.status, "PENDING_RISK"); assert.equal(completed.response.execution.execution_allowed, false);
  assert.equal(completed.response.run_id, completed.query_response.run_id);
  assert.equal(completed.response.audit.audit_id, completed.query_response.audit.audit_id);
  assert.ok(completed.reservations.some(r => r.state === "COMPLETED" && r.run_id === completed.response.run_id));
  return { evidence_version: "core-durable-recovery.v1", recorded_at: new Date().toISOString(),
    mode: "LOCAL_SQLITE_PROCESS_RESTART", status: "PASS", process_count: 4,
    forced_exits: [{ phase: "before final commit", exit_code: crashed.status }, { phase: "after final commit before response", exit_code: lost.status }],
    synthetic_model_calls: 2, real_model_calls: 0, paid_calls: 0, public_cloud_fault_injection: false,
    database: "Temporary SQLite file with explicit transactions and synchronous FULL; not a Cloudflare runtime emulator",
    cases: [unresolved, completed], joint_acceptance: false };
}

const phaseIndex = process.argv.indexOf("--phase");
if (phaseIndex >= 0) {
  const directoryIndex = process.argv.indexOf("--directory");
  process.stdout.write(JSON.stringify(await phase(process.argv[directoryIndex + 1], process.argv[phaseIndex + 1])));
} else {
  const result = verify();
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0) {
    fs.writeFileSync(path.resolve(process.argv[outputIndex + 1]), JSON.stringify(result, null, 2) + "\n");
    process.stdout.write(JSON.stringify({ status: result.status, process_count: result.process_count,
      synthetic_model_calls: result.synthetic_model_calls, real_model_calls: 0 }) + "\n");
  } else process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
