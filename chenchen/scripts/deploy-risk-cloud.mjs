import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ownerBridge from "../integrations/owner-bridge.js";

// Explicit operator command. Secrets travel through stdin, not args or logs.
// Windows DPAPI encrypts the recovery copy for this Windows user, outside Git.
const [wranglerArg, buildArg, action = "deploy"] = process.argv.slice(2);
if (!wranglerArg || !buildArg || !["deploy", "verify"].includes(action)) throw new Error("Usage: deploy-risk-cloud.mjs WRANGLER_JS BUILD_DIRECTORY [deploy|verify]");
const wrangler = path.resolve(wranglerArg), build = path.resolve(buildArg);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vault = path.join(process.env.LOCALAPPDATA, "FinanceLabDeploy", "risk-validation-secrets.dpapi");
mkdirSync(path.dirname(vault), { recursive: true });
function ps(code, input) {
  const shellEnv = { ...process.env, FINANCE_DEPLOY_VAULT: vault, FINANCE_DEPLOY_SECRET_JSON: input || "" };
  // A PS7 parent's module path prevents Windows PowerShell loading its DPAPI module.
  delete shellEnv.PSModulePath;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", '$ErrorActionPreference="Stop"; ' + code], { encoding: "utf8", windowsHide: true, env: shellEnv, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error("Windows credential vault operation failed; secret content is not logged.");
  return result.stdout.trim();
}
let secrets;
if (existsSync(vault) && statSync(vault).size > 0) {
  secrets = JSON.parse(ps('$secure = ConvertTo-SecureString ([IO.File]::ReadAllText($env:FINANCE_DEPLOY_VAULT)); $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }'));
} else {
  if (action !== "deploy") throw new Error("No local encrypted deployment credentials exist.");
  secrets = Object.fromEntries(["CORE_AGENT_API_KEY", "RISK_SERVICE_HMAC_SECRET", "RISK_CONVERSATION_API_KEY"].map(name => [name, randomBytes(32).toString("hex")]));
  ps('$text = $env:FINANCE_DEPLOY_SECRET_JSON; if (!$text) { throw "Missing credential input" }; $encrypted = ConvertFrom-SecureString (ConvertTo-SecureString $text -AsPlainText -Force); if (!$encrypted) { throw "Encryption failed" }; [IO.File]::WriteAllText($env:FINANCE_DEPLOY_VAULT, $encrypted)', JSON.stringify(secrets));
}
function cli(args, cwd, input) {
  const result = spawnSync(process.execPath, [wrangler, ...args], { cwd, input, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  // Wrangler ordinarily logs only secret names; redact defensively nonetheless.
  let output = (result.stdout || "") + (result.stderr || "");
  for (const value of Object.values(secrets)) output = output.replaceAll(value, "[REDACTED]");
  process.stdout.write(output);
  if (result.status !== 0) throw new Error(`Deployment command failed (${result.status}); no automatic deletion or rollback.`);
}
if (action === "deploy") {
  cli(["deploy", "--config", "wrangler.core-risk-validation.toml", "--keep-vars", "--message", "Isolated zero-budget Core Risk integration; no AI binding"], root);
  cli(["secret", "bulk", "--config", "wrangler.core-risk-validation.toml"], root, JSON.stringify({ CORE_AGENT_API_KEY: secrets.CORE_AGENT_API_KEY, RISK_SERVICE_HMAC_SECRET: secrets.RISK_SERVICE_HMAC_SECRET }));
  cli(["deploy", "--keep-vars", "--message", "Risk PR27 cloud adapter; model calls disabled; SQLite audit"], build);
  cli(["secret", "bulk"], build, JSON.stringify(secrets));
}
const base = "https://finance-lab-risk-bridge.realchenchenluo.workers.dev", core = "https://finance-lab-core-risk-validation.realchenchenluo.workers.dev";
const rows = [];
async function check(name, url, options = {}, expected = 200) {
  const start = Date.now(), response = await fetch(url, { ...options, redirect: "manual", signal: AbortSignal.timeout(30000) });
  const content = await response.json();
  if (response.status !== expected) throw new Error(`${name}: HTTP ${response.status}, expected ${expected}; code=${content.error?.code || "unknown"}`);
  const summary = content.risk_result ? { risk_check_id: content.risk_result.risk_check_id, decision: content.risk_result.decision,
    shortfall_yuan: content.risk_advice?.metrics?.shortfall_yuan, protected_yuan: content.risk_advice?.metrics?.protected_before_yuan,
    replayed: content.replayed, model_status: content.model_status, formal_risk_callback: content.formal_risk_callback,
    audit_event_id: content.audit_event_id, execution_allowed: content.execution_allowed }
    : content.record ? { record_status: content.record.status, audit_count: content.audit_events.length,
      audit_event_ids: content.audit_events.map(row => row.event_id), event_hashes: content.audit_events.map(row => row.event_hash), execution_allowed: content.execution_allowed } : content;
  const row = { name, status: response.status, elapsed_ms: Date.now() - start, response_sha256: createHash("sha256").update(JSON.stringify(content)).digest("hex"), summary };
  const serialized = JSON.stringify(content); if (Object.values(secrets).some(value => serialized.includes(value))) throw new Error("Secret detected in response; evidence not printed.");
  rows.push(row); return content;
}
const headers = { "X-Risk-Conversation-Key": secrets.RISK_CONVERSATION_API_KEY };
await check("risk_health", base + "/health");
await check("core_health", core + "/health");
await check("risk_unauthenticated_denied", base + "/api/status", {}, 401);
await check("core_unauthenticated_denied", core + "/api/review/capabilities", {}, 401);
const status = await check("risk_to_core_authenticated_connection", base + "/api/status", { headers });
if (status.core_connection_verified !== true || status.core_callback_configured !== true || status.model_configured !== false || status.model_calls_enabled !== false) throw new Error("Unexpected configuration; do not call model.");
const payload = { question: "云端虚构验收：可用资金10000元，需保护房租4000元，拟投资8000元。", idempotency_key: "cloud-acceptance-20261021-v1",
  daily_finance_yuan: { cash_yuan: "10000", amount_yuan: "8000", fees_yuan: "0", holds_yuan: "0", floor_yuan: "0", purpose_yuan: "4000", due_yuan: "4000", due_date: "2026-11-01", purpose_label: "房租", facts_confirmed: true, purpose_confirmed: true } };
const options = { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(payload) };
const assessment = await check("cloud_program_shortfall", base + "/api/assess", options);
if (assessment.risk_result?.decision !== "BLOCK" || assessment.risk_advice?.metrics?.shortfall_yuan !== "2000.00" || assessment.execution_allowed !== false) throw new Error("Cloud assessment mismatch.");
const replay = await check("cloud_replay", base + "/api/assess", options);
if (replay.replayed !== true || replay.audit_event_id !== assessment.audit_event_id) throw new Error("Cloud replay mismatch.");
await check("cloud_content_conflict", base + "/api/assess", { ...options, body: JSON.stringify({ ...payload, question: "changed" }) }, 409);
const records = await check("cloud_persisted_record", base + "/api/records/" + payload.idempotency_key, { headers });
if (records.audit_events?.length !== 1 || records.record?.status !== "COMPLETE") throw new Error("Cloud audit mismatch.");
await check("cloud_model_budget_guard", base + "/api/review", options, 423);
await check("browser_machine_key_rejected", base + "/api/status", { headers: { ...headers, Origin: "https://untrusted.invalid" } }, 403);
// No task is created by these probes. Passing HMAC reaches the missing-task gate;
// it does NOT mean a real business callback was accepted or recorded.
const callback = { callback_version: "risk-callback.v1", handoff_id: "handoff-cloud-probe-no-task", task_id: "task-cloud-probe-no-task",
  request_id: "request-cloud-probe-no-task", run_id: "run-cloud-probe-no-task", audit_id: "audit-cloud-probe-no-task",
  proposal_sha256: "0".repeat(64), decision: "REJECT", reviewer: "risk-conversation-cloudflare-v1", reason: "Synthetic authentication probe only; no existing business task." };
async function signatureProbe(name, body, secret, expected) {
  return check(name, core + "/api/review/risk-callback", { method: "POST", headers: { "Content-Type": "application/json", "X-Core-Agent-Key": secrets.CORE_AGENT_API_KEY,
    "X-Risk-Signature": await ownerBridge.signatureFor(body, secret) }, body: JSON.stringify(body) }, expected);
}
await signatureProbe("wrong_callback_signature_rejected", callback, "deliberately-invalid-synthetic-key", 401);
await signatureProbe("correct_signature_wrong_reviewer_rejected", { ...callback, reviewer: "synthetic-wrong-reviewer" }, secrets.RISK_SERVICE_HMAC_SECRET, 403);
await signatureProbe("valid_signature_missing_task_rejected", callback, secrets.RISK_SERVICE_HMAC_SECRET, 404);
console.log(JSON.stringify({ report: "core-risk-cloud-deployment.v1", recorded_for_date: "2026-10-21", checked_at: new Date().toISOString(), core, risk: base, checks: rows, real_model_calls: 0, signature_authentication_probed: true, formal_risk_callback_tested: false, human_approval_tested: false, execution_gateway_connected: false, joint_acceptance: false, encrypted_credentials_outside_git: true }, null, 2));
