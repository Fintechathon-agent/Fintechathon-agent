import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const target = process.argv[2], reportFile = process.argv[3];
if (!target) throw Error('Usage: node scripts/smoke.mjs https://YOUR-SUBMISSION-HOST [report.json]');
const origin = new URL(target).origin, checks = [], started = new Date().toISOString();
async function run(name, fn) {try {await fn(); checks.push({name, passed: true});} catch (error) {checks.push({name, passed: false, error: /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'ASSERTION_OR_NETWORK_FAILED'}); throw error;}}
let cookie, csrf;
const request = (route, body, extra = {}) => fetch(origin + route, {method: body === undefined ? 'GET' : 'POST', headers: {Cookie: cookie || '', Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '', ...extra}, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(15000), redirect: 'error'});
try {
  await run('homepage_and_mode_label', async () => {const r = await request('/'); assert.equal(r.status, 200); assert.match(await r.text(), /submission-mode/); assert.equal(r.headers.get('X-Submission-Module'), 'submission-parallel-v1');});
  await run('health', async () => {const r = await request('/health'); assert.equal(r.status, 200); assert.equal((await r.json()).execution_allowed, false);});
  await run('signed_session', async () => {const r = await request('/api/session'); assert.equal(r.status, 200); cookie = r.headers.get('set-cookie').split(';')[0]; csrf = (await r.json()).csrf; assert.ok(csrf);});
  const body = {request_id: 'smoke-' + crypto.randomUUID(), idempotency_key: 'smoke-' + crypto.randomUUID()};
  await run('synthetic_accounts', async () => {const r = await request('/api/local/accounts/demo', body); assert.equal(r.status, 201); const b = await r.json(); assert.equal(b.hub.summary.total_assets_cents, 13300000); assert.equal(b.hub.execution_allowed, false);});
  await run('idempotent_replay', async () => {const r = await request('/api/local/accounts/demo', body); assert.equal(r.status, 200); assert.equal((await r.json()).replayed, true);});
  await run('csrf_rejected', async () => {const r = await request('/api/local/accounts/demo', body, {'X-CSRF-Token': 'forged'}); assert.equal(r.status, 403);});
  await run('scenario_routing_only', async () => {const r = await request('/api/local/accounts/plan', {question: '想投8000元基金，下个月还要交房租'}); assert.equal(r.status, 200); const b = await r.json(); assert.equal(b.plan.scenario, 'FUNDING_CONFLICT'); assert.equal(b.plan.execution_allowed, false);});
  await run('no_external_asset_dependency', async () => {const r = await request('/health.js'); assert.equal(r.status, 200); const script = await r.text(); assert.ok(!/https?:\/\/[^'"\s]+\.workers\.dev/.test(script));});
} catch {process.exitCode = 1;} finally {
  const report = {started_at: started, ended_at: new Date().toISOString(), origin, checks, passed: checks.length === 8 && checks.every(x => x.passed), provider_calls: 0, model_inference_verified: false, mainland_reachability_verified: false, note: 'Run on actual mainland networks with proxy disabled; record operator and network separately. This script does not infer visitor location.'};
  if (reportFile) writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
