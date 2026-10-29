import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {createRuntime, configuration} from '../runtime.mjs';
import {createNodeServer} from '../server.mjs';
import {SqliteStore} from '../storage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = path.resolve(here, '..');
function clean(dir) {
  const resolved = path.resolve(dir), parent = path.resolve(os.tmpdir());
  if (path.dirname(resolved).toLowerCase() !== parent.toLowerCase() || !path.basename(resolved).startsWith('submission-')) throw Error('UNSAFE_TEST_CLEANUP_PATH');
  rmSync(resolved, {recursive: true, force: true});
}
execFileSync(process.execPath, [path.join(moduleRoot, 'build.mjs')]);
const base = () => ({PUBLIC_ORIGIN: 'https://finance.test', SESSION_SECRET: 's'.repeat(64), RISK_HMAC_SECRET: 'r'.repeat(64), PROXY_SECRET: 'p'.repeat(64),
  SUBMISSION_MODEL_MODE: 'demo', DEMO_START_AT: '2026-10-29T00:00:00+08:00', DEMO_END_AT: '2026-11-30T00:00:00+08:00', DEMO_BUDGET_CENTS: '100', DAILY_BUDGET_CENTS: '50'});
async function fixture(t, extra = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'submission-parallel-'));
  const env = {...base(), ...extra};
  const runtime = await createRuntime(env, {dbPath: path.join(dir, 'test.sqlite')});
  t.after(async () => {await runtime.close(); clean(dir);});
  return {runtime, env};
}
async function visitor(runtime, existing) {
  let cookie = existing;
  const session = await runtime.fetch(new Request('https://finance.test/api/session', {headers: cookie ? {Cookie: cookie} : {}}));
  cookie = session.headers.get('set-cookie').split(';')[0];
  const csrf = (await session.json()).csrf;
  return {cookie, csrf, call(route, body, extra = {}) {
    return runtime.fetch(new Request('https://finance.test' + route, {method: body === undefined ? 'GET' : 'POST', headers: {Cookie: cookie, Origin: 'https://finance.test', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...extra}, ...(body === undefined ? {} : {body: JSON.stringify(body)})}));
  }};
}
const review = () => ({mode: 'new', base_version: 0, rows: [{name: '基金A', amount_cents: 6000000, kind: 'unresolved'}, {name: '现金', amount_cents: 4000000, kind: 'cash'}], metadata: {as_of: '2026-10-29', currency: 'CNY', basis: 'current_value', source: 'USER_TABLE', demo: true}});

test('configuration fails closed on placeholder secrets, unapproved external model and unsafe origins', () => {
  assert.throws(() => configuration({...base(), SESSION_SECRET: 'REPLACE_WITH_RANDOM_64_HEX_CHARACTERS'}), /SESSION_SECRET_REQUIRED/);
  assert.throws(() => configuration({...base(), SUBMISSION_MODEL_MODE: 'external'}), /EXTERNAL_DEPLOYMENT_NOT_APPROVED/);
  assert.throws(() => configuration({...base(), SUBMISSION_MODEL_MODE: 'demo', LLM_A_API_KEY: 'not-a-real-key'}), /DEMO_MUST_NOT_HAVE_PAID_PROVIDER/);
  assert.throws(() => configuration({...base(), PUBLIC_ORIGIN: 'http://finance.test'}), /PUBLIC_ORIGIN_INVALID/);
  assert.throws(() => configuration({...base(), DAILY_BUDGET_CENTS: '200'}), /BUDGET_CONFIG_INVALID/);
});

test('SQLite transaction rolls back all rows and concurrent increments are serialized', async t => {
  const store = new SqliteStore(':memory:'); t.after(() => store.close());
  const storage = store.namespace('one');
  await storage.put('n', 0);
  await assert.rejects(storage.transaction(async tx => {await tx.put('n', 99); await tx.put('other', 1); throw Error('synthetic');}), /synthetic/);
  assert.equal(await storage.get('n'), 0); assert.equal(await storage.get('other'), undefined);
  await Promise.all(Array.from({length: 30}, () => storage.transaction(async tx => {const n = await tx.get('n'); await Promise.resolve(); await tx.put('n', n + 1);} )));
  assert.equal(await storage.get('n'), 30);
  await storage.put({a: 1, b: 2}); await storage.delete(['a', 'b']); assert.equal(await storage.get('a'), undefined);
});

test('original API contracts persist accounts, replay writes once, enforce CSRF and visitor isolation', async t => {
  const {runtime} = await fixture(t); const a = await visitor(runtime), b = await visitor(runtime);
  const seed = {idempotency_key: 'submission-demo-v1', request_id: 'submission-demo-v1'};
  const response = await a.call('/api/local/accounts/demo', seed); assert.equal(response.status, 201);
  const data = await response.json(); assert.equal(data.hub.summary.total_assets_cents, 13300000);
  assert.equal(data.hub.summary.available_cents, 4400000); assert.equal(data.hub.summary.obligations_cents, 2500000);
  const repeated = await a.call('/api/local/accounts/demo', seed); assert.equal(repeated.status, 200); assert.equal((await repeated.json()).replayed, true);
  assert.equal((await (await b.call('/api/local/accounts')).json()).accounts.length, 0);
  assert.equal((await a.call('/api/local/accounts/demo', seed, {'X-CSRF-Token': 'forged'})).status, 403);
  const plan = await (await a.call('/api/local/accounts/plan', {question: '我想投8000元基金，但是还要交房租'})).json();
  assert.equal(plan.plan.scenario, 'FUNDING_CONFLICT'); assert.equal(plan.plan.execution_allowed, false);
});

test('real SQLite restart retains browser records and the same budget ledger', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'submission-restart-')), dbPath = path.join(dir, 'test.sqlite');
  let runtime = await createRuntime(base(), {dbPath});
  try {
    const a = await visitor(runtime); await a.call('/api/local/accounts/demo', {idempotency_key: 'restart-seed-v1'});
    const c = await (await a.call('/api/local/chats', {})).json();
    await a.call('/api/local/chats/' + c.id + '/turns', {request_id: randomUUID(), text: '解释一下持仓'});
    await runtime.settle();
    const before = await runtime.store.namespace('gate-synthetic:global').get('meta');
    await runtime.close(); runtime = await createRuntime(base(), {dbPath});
    const resumed = await visitor(runtime, a.cookie);
    assert.equal((await (await resumed.call('/api/local/accounts')).json()).accounts.length, 4);
    assert.equal((await (await resumed.call('/api/local/chats/' + c.id)).json()).turns.length, 1);
    const after = await runtime.store.namespace('gate-synthetic:global').get('meta');
    assert.equal(after.used_micro_cny, before.used_micro_cny); assert.equal(after.call_count, before.call_count);
  } finally {await runtime.close(); clean(dir);}
});

test('table review uses unchanged deterministic calculation and signed Risk; unconfirmed save fails', async t => {
  const {runtime} = await fixture(t), a = await visitor(runtime), c = await (await a.call('/api/local/chats', {})).json();
  const response = await a.call('/api/local/chats/' + c.id + '/review', review()); assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.review.tool.output.total_cents, 10000000);
  assert.equal(data.conversation.turns[0].risk.auth.verified, true);
  assert.equal(data.conversation.turns[0].risk.auth.transport, 'IN_PROCESS_HMAC');
  assert.equal(data.conversation.turns[0].risk.auth.production_identity_verified, false);
  assert.equal(data.conversation.turns[0].risk.result.decision, 'REVIEW');
  const save = await a.call('/api/local/snapshots', {conversation_id: c.id, base_version: 1, base_hash: data.conversation.state.review_hash, confirmed: false, name: '演示'});
  assert.equal(save.status, 422); assert.equal(data.execution_allowed, false);
});

test('bad remote Risk signature blocks data commit and no model fallback is introduced', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({payload: '{}', signature: 'forged'}));
  const {runtime} = await fixture(t, {RISK_TRANSPORT: 'https', RISK_SERVICE_URL: 'https://risk.test/assess'});
  const a = await visitor(runtime), c = await (await a.call('/api/local/chats', {})).json();
  const response = await a.call('/api/local/chats/' + c.id + '/review', review()); assert.equal(response.status, 503);
  const after = await (await a.call('/api/local/chats/' + c.id)).json(); assert.deepEqual(after.state.actual, []);
});

test('SSE replay and repeated turn ID do not create another model task; demo is visibly labelled', async t => {
  const {runtime} = await fixture(t), a = await visitor(runtime), c = await (await a.call('/api/local/chats', {})).json();
  const body = {request_id: randomUUID(), text: '解释一下持仓'};
  const started = await (await a.call('/api/local/chats/' + c.id + '/turns', body)).json(); await runtime.settle();
  const replay = await (await a.call('/api/local/chats/' + c.id + '/turns', body)).json(); assert.equal(replay.id, started.id);
  const saved = await (await a.call('/api/local/chats/' + c.id)).json(), turn = saved.turns[0];
  assert.equal(turn.status, 'COMPLETE'); assert.equal(turn.source, 'TEST_DOUBLE_NOT_LIVE');
  assert.equal(turn.receipts.length, 2); assert.ok(turn.receipts.every(x => x.test_double && x.provider === 'synthetic_fixture'));
  const eventResponse = await a.call(`/api/local/chats/${c.id}/turns/${started.id}/events`);
  assert.match(eventResponse.headers.get('Content-Type'), /event-stream/);
  assert.match(await eventResponse.text(), /TEST_DOUBLE_NOT_LIVE/);
  const trace = await (await a.call(`/api/local/chats/${c.id}/turns/${started.id}/trace`)).json(); assert.equal(trace.trace.live_model_verified, false);
  const root = await runtime.fetch(new Request('https://finance.test/')); assert.match(await root.text(), /未调用真实模型/);
});

test('model-disabled mode cannot silently use a synthetic reply; history stays available', async t => {
  const {runtime} = await fixture(t, {SUBMISSION_MODEL_MODE: 'disabled'}), a = await visitor(runtime), c = await (await a.call('/api/local/chats', {})).json();
  await a.call('/api/local/chats/' + c.id + '/turns', {request_id: randomUUID(), text: '解释一下持仓'}); await runtime.settle();
  const saved = await (await a.call('/api/local/chats/' + c.id)).json(); assert.equal(saved.turns[0].status, 'ERROR');
  assert.equal(saved.turns[0].error.code, 'CHAT_PROVIDER_NOT_CONFIGURED'); assert.equal(saved.turns[0].assistant, '');
});

test('Node HTTP bridge validates host/proxy, strips forged identity and streams responses', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'submission-http-')), logs = [];
  const service = await createNodeServer(base(), {dbPath: path.join(dir, 'test.sqlite'), logger: x => logs.push(x)});
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {await service.close(); clean(dir);});
  const target = 'http://127.0.0.1:' + service.server.address().port;
  const hit = (route, headers = {}) => new Promise((resolve, reject) => {
    const request = http.get(target + route, {headers}, response => {
      const chunks = []; response.on('data', x => chunks.push(x));
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), {status: response.statusCode, headers: response.headers})));
    }); request.on('error', reject);
  });
  assert.equal((await hit('/health')).status, 421);
  assert.equal((await hit('/health', {Host: 'finance.test'})).status, 403);
  const headers = {Host: 'finance.test', 'X-Submission-Proxy': base().PROXY_SECRET, 'X-Forwarded-Proto': 'https'};
  assert.equal((await hit('/health', headers)).status, 200);
  const root = await hit('/', headers); assert.equal(root.status, 200); assert.match(await root.text(), /多场景，多平台/);
  const session = await hit('/api/session', headers); assert.equal(session.status, 200); assert.match(session.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Strict/);
  assert.ok(logs.every(x => !JSON.stringify(x).includes('Cookie')));
});

test('isolated build writes only module output and original source hashes stay unchanged', () => {
  const source = path.resolve(moduleRoot, '../../integration/public-chat/app.html');
  const before = readFileSync(source, 'utf8'); execFileSync(process.execPath, [path.join(moduleRoot, 'build.mjs')]);
  assert.equal(readFileSync(source, 'utf8'), before);
  assert.match(readFileSync(path.join(moduleRoot, 'dist/public/index.html'), 'utf8'), /__SUBMISSION_MODE__/);
});
