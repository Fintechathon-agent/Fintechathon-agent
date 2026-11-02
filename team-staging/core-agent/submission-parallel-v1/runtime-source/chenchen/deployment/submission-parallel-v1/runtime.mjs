import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import worker, {ChatSession} from '../../integration/public-chat/worker.mjs';
import {ChatGate} from '../../integration/public-chat/gate.mjs';
import riskWorker from '../../integration/public-chat/risk.mjs';
import {gatewayPolicy} from '../../integration/public-chat/gateway-policy.mjs';
import {SqliteStore} from './storage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const error = code => Object.assign(new Error(code), {code});
function origin(value) {
  let url; try {url = new URL(value);} catch {throw error('PUBLIC_ORIGIN_REQUIRED');}
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.origin !== value || (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password) throw error('PUBLIC_ORIGIN_INVALID');
  return url.origin;
}
export function configuration(input) {
  const mode = input.SUBMISSION_MODEL_MODE || 'disabled';
  if (!['disabled', 'demo', 'external'].includes(mode)) throw error('MODEL_MODE_INVALID');
  for (const name of ['SESSION_SECRET', 'RISK_HMAC_SECRET']) if (typeof input[name] !== 'string' || input[name].length < 32 || /REPLACE|CHANGE_ME|PLACEHOLDER/i.test(input[name])) throw error(name + '_REQUIRED');
  const origins = [origin(input.PUBLIC_ORIGIN), ...(input.ADDITIONAL_PUBLIC_ORIGINS || '').split(',').filter(Boolean).map(value => origin(value.trim()))];
  if (!['local-readonly', 'https'].includes(input.RISK_TRANSPORT || 'local-readonly')) throw error('RISK_TRANSPORT_INVALID');
  if (input.RISK_TRANSPORT === 'https') {
    const url = new URL(input.RISK_SERVICE_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.hostname.endsWith('.example.com')) throw error('RISK_URL_INVALID');
  }
  const env = {...input, MODEL_ENABLED: mode === 'disabled' ? 'false' : 'true', MODEL_NAME: MODEL,
    RELEASE_ID: input.RELEASE_ID || 'submission-parallel-v1-20261029',
    LLM_GATEWAY_MODE: mode === 'external' ? 'external' : 'cloudflare'};
  if (mode === 'demo' && (input.LLM_A_API_KEY || input.LLM_B_API_KEY || input.LLM_PAID_PROVIDER_APPROVED === 'true')) throw error('DEMO_MUST_NOT_HAVE_PAID_PROVIDER');
  if (mode === 'external') {
    if (input.SUBMISSION_EXTERNAL_APPROVED !== 'true') throw error('EXTERNAL_DEPLOYMENT_NOT_APPROVED');
    gatewayPolicy(env); // Existing provider, price, capability and budget checks remain mandatory.
  }
  // Exercise the original gate config at startup without creating a fresh ledger.
  for (const key of ['DEMO_BUDGET_CENTS', 'DAILY_BUDGET_CENTS']) if (!/^\d+$/.test(input[key] || '') || +input[key] < 10 || +input[key] > 1000) throw error('BUDGET_CONFIG_INVALID');
  if (+input.DAILY_BUDGET_CENTS > +input.DEMO_BUDGET_CENTS) throw error('BUDGET_CONFIG_INVALID');
  const start = Date.parse(input.DEMO_START_AT), end = Date.parse(input.DEMO_END_AT);
  if (![start, end].every(Number.isFinite) || ![input.DEMO_START_AT, input.DEMO_END_AT].every(x => /(Z|[+-]\d{2}:\d{2})$/.test(x)) || end - start < 15 * 86400000) throw error('BUDGET_CONFIG_INVALID');
  return {mode, origins, env};
}

class DemoExplanationModel {
  async run(_model, input) {
    this.lastRequestId = 'TEST_DOUBLE_NOT_LIVE-' + randomUUID();
    if (!input.stream) return {response: JSON.stringify({operation: 'explain', changes: [], transfer: null, question: ''}), usage: {prompt_tokens: 1, completion_tokens: 1}};
    const text = '这是演示模型的固定回复，没有调用真实大模型。请先通过表格核对持仓金额，再查看服务端计算结果。演示不会执行交易。';
    return new ReadableStream({start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('data: ' + JSON.stringify({response: text, usage: {prompt_tokens: 1, completion_tokens: 1}}) + '\n\n'));
      controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close();
    }});
  }
}

export async function createRuntime(input, options = {}) {
  const {mode, origins, env} = configuration(input);
  const store = new SqliteStore(options.dbPath || input.SQLITE_PATH || path.join(here, 'local', mode + '.sqlite'));
  const pending = new Set(), objects = new Map();
  const track = promise => {pending.add(promise); promise.finally(() => pending.delete(promise)).catch(() => {});};
  class SubmissionSession extends ChatSession {
    publicTurn(t, c) {
      const result = super.publicTurn(t, c);
      if (mode === 'demo') {
        if (result.source === 'LIVE_MODEL') result.source = 'TEST_DOUBLE_NOT_LIVE';
        for (const receipt of result.receipts || []) Object.assign(receipt, {provider: 'synthetic_fixture', model: 'demo-explanation-fixture', test_double: true});
      }
      return result;
    }
    async calculate(...args) {
      const result = await super.calculate(...args);
      result.risk.auth = {...result.risk.auth, transport: env.RISK_TRANSPORT === 'https' ? 'HTTPS_HMAC' : 'IN_PROCESS_HMAC', production_identity_verified: false};
      return result;
    }
    async save(c, t) {
      if (mode === 'demo' && t) {
        if (t.source === 'LIVE_MODEL') t.source = 'TEST_DOUBLE_NOT_LIVE';
        if (t.trace) {t.trace.deployment_model_mode = 'TEST_DOUBLE_NOT_LIVE'; t.trace.live_model_verified = false;}
      }
      return super.save(c, t);
    }
  }
  const namespace = (name, Class) => ({
    idFromName: id => String(id),
    get(id) {
      const key = name + ':' + id;
      if (!objects.has(key)) {
        if (objects.size >= 1000) throw error('OBJECT_CAPACITY_REACHED');
        const ctx = {storage: store.namespace(key), waitUntil: track, blockConcurrencyWhile: fn => fn()};
        objects.set(key, new Class(ctx, env));
      }
      return {fetch: request => objects.get(key).fetch(request)};
    },
  });
  env.CHAT_GATE = namespace('gate-' + (mode === 'demo' ? 'synthetic' : 'real'), ChatGate);
  env.CHAT_SESSIONS = namespace('session-' + (mode === 'demo' ? 'synthetic' : 'real'), SubmissionSession);
  if (mode === 'demo') env.AI = new DemoExplanationModel();
  env.AMOUNT_RISK = {fetch: request => env.RISK_TRANSPORT === 'https'
    ? fetch(new Request(env.RISK_SERVICE_URL, {method: request.method, headers: request.headers, body: request.body, duplex: 'half', signal: request.signal, redirect: 'error'}))
    : riskWorker.fetch(request, {RISK_HMAC_SECRET: env.RISK_HMAC_SECRET})};
  const assets = options.assets || path.join(here, 'dist', 'public');
  env.ASSETS = {fetch: async request => {
    const name = new URL(request.url).pathname;
    const files = {'/': ['index.html', 'text/html; charset=utf-8'], '/health.js': ['health.js', 'text/javascript; charset=utf-8'], '/health.css': ['health.css', 'text/css; charset=utf-8']};
    if (!files[name]) return new Response(null, {status: 404});
    const [file, type] = files[name];
    const content = readFileSync(path.join(assets, file), 'utf8').replaceAll('__SUBMISSION_MODE__', mode === 'demo' ? '合成数据演示 · 固定测试回复 · 未调用真实模型' : mode === 'disabled' ? '部署验证版 · 模型尚未开通' : '外部模型模式 · 金额仍由服务端工具计算');
    return new Response(request.method === 'HEAD' ? null : content, {headers: {'Content-Type': type}});
  }};
  return {
    mode, origins, store,
    async fetch(request) {
      if (!origins.includes(new URL(request.url).origin)) return Response.json({error: {code: 'WRONG_HOST'}, execution_allowed: false}, {status: 421});
      const response = await worker.fetch(request, {...env, PUBLIC_ORIGIN: new URL(request.url).origin});
      const result = new Response(response.body, response);
      result.headers.set('X-Submission-Module', 'submission-parallel-v1');
      result.headers.set('X-Model-Mode', mode);
      return result;
    },
    async settle() {while (pending.size) await Promise.allSettled([...pending]);},
    async close() {
      for (const item of objects.values()) for (const control of item.live?.values() || []) control.controller.abort();
      await this.settle(); await store.close();
    },
  };
}
