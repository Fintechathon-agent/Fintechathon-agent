'use strict';
// Manual paid acceptance only. Never invoked by the default test suite.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { parseEnv } = require('node:util');
const { pathToFileURL } = require('node:url');

(async () => {
  const args = process.argv.slice(2);
  const option = name => args.find(x => x.startsWith(name + '='))?.slice(name.length + 1);
  const student = args.includes('--student'), authorizedCalls = student ? 1 : 2;
  if (Number(option('--authorized-calls')) !== authorizedCalls || !option('--env-file') || !option('--candidate-root')) {
    throw new Error('Explicit per-run authorization, server env file and prepared candidate are required.');
  }
  const candidate = path.resolve(option('--candidate-root'));
  const moduleRoot = path.join(candidate, 'team-staging/ui/tinglan-ai-20261018');
  const evidence = path.join(moduleRoot, student ? 'evidence/live-student.json' : 'evidence/live-local.json');
  if (fs.existsSync(evidence)) throw new Error('Evidence already exists; refusing an accidental paid rerun.');
  const local = parseEnv(fs.readFileSync(option('--env-file'), 'utf8'));
  const key = process.env.MODEL_API_KEY || local.MODEL_API_KEY;
  const endpoint = process.env.MODEL_API_URL || local.MODEL_API_URL;
  const model = process.env.MODEL_NAME || local.MODEL_NAME;
  const url = new URL(endpoint);
  assert(key && model === 'qwen3.8-flash');
  assert(url.protocol === 'https:' && /^[a-z0-9-]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(url.hostname));
  assert(url.pathname === '/compatible-mode/v1/chat/completions' && !url.search && !url.hash && !url.username && !url.password);
  for (const name of ['MODEL_API_KEY', 'MODEL_API_URL', 'MODEL_NAME']) {
    assert(!process.env[name] || !local[name] || process.env[name] === local[name], 'Conflicting server environment');
  }
  // All credentials remain in this server process; no environment file is copied.
  const env = { MODEL_PROVIDER: 'aliyun_bailian', MODEL_NAME: model, MODEL_API_STYLE: 'chat_completions',
    MODEL_RESPONSE_FORMAT: 'json_object', MODEL_MAX_ATTEMPTS: '1', MODEL_TIMEOUT_MS: '30000',
    MODEL_DISABLE_RULE_FALLBACK: 'true', MODEL_FALLBACK_TO_RULES: 'false',
    DASHSCOPE_API_KEY: key, CORE_AGENT_API_KEY: require('node:crypto').randomBytes(32).toString('hex'),
    BAILIAN_WORKSPACE_ID: url.hostname.split('.')[0], BAILIAN_REGION: 'cn-beijing',
    BAILIAN_ALLOW_PAID_CALLS: 'true', BAILIAN_TEST_BUDGET_CNY: '0.01', BAILIAN_MAX_OUTPUT_TOKENS: student ? '1600' : '800' };
  const report = { timestamp: new Date().toISOString(), scope: 'LOCAL_REAL_PROVIDER', cloudflareDeployed: false,
    cloudflareAccessVerified: false, storage: 'in-memory test adapter, not Cloudflare SQLite',
    identity: 'injected local test identity, not Cloudflare Access', mainlandNetworkVerified: false,
    authorizedCalls, budgetCny: student ? 0.01 : 0.02, attempts: 0, model, baseUrl: url.origin + '/compatible-mode/v1', steps: [] };
  const save = () => {
    fs.mkdirSync(path.dirname(evidence), { recursive: true });
    const safe = JSON.stringify(report, null, 2);
    assert(!safe.includes(key) && !safe.includes(env.CORE_AGENT_API_KEY), 'Credential detected in evidence');
    fs.writeFileSync(evidence, safe + '\n');
  };
  const nativeFetch = global.fetch;
  global.fetch = async (target, options) => {
    assert.equal(String(target), endpoint);
    assert(report.attempts < authorizedCalls, 'Authorized call count exceeded');
    const requestBody = JSON.parse(options.body);
    assert.equal(requestBody.model, model);
    assert(requestBody.max_tokens <= (student ? 1600 : 800));
    assert(options.body.length < 12000, 'Short input budget exceeded');
    report.attempts++; save();
    const started = performance.now();
    try {
      const response = await nativeFetch(target, { ...options, redirect: 'error' });
      const data = await response.clone().json();
      report.steps.push({ phase: student || report.attempts > 1 ? 'browser-local-server-bailian' : 'server-to-bailian',
        http: response.status, durationMs: Math.round(performance.now() - started), model: data.model || null,
        responseId: data.id || null, usage: data.usage || null, finishReason: data.choices?.[0]?.finish_reason || null,
        content: response.ok ? data.choices?.[0]?.message?.content : null, errorCode: data.error?.code || data.code || null });
      save(); return response;
    } catch (error) {
      report.steps.push({ phase: report.attempts === 1 ? 'server-to-bailian' : 'browser-local-server-bailian',
        http: null, durationMs: Math.round(performance.now() - started), error: error.name, causeCode: error.cause?.code || null });
      save(); throw new Error('Real provider request failed; see sanitized evidence.');
    }
  };
  let server, browser;
  try {
    if (!student) {
    const direct = await global.fetch(endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 32, enable_thinking: false, stream: false,
        response_format: { type: 'json_object' }, messages: [{ role: 'user', content: '仅返回 JSON：{"ok":true}' }] }), signal: AbortSignal.timeout(30000) });
    assert.equal(direct.status, 200);
    const response = await direct.json(); assert.equal(response.model, model);
    assert.equal(JSON.parse(response.choices[0].message.content).ok, true);
    }
    const { createGateway } = await import(pathToFileURL(path.join(moduleRoot, 'gateway.mjs')));
    const { default: core } = await import(pathToFileURL(path.join(candidate, 'chenchen/deployment/worker.js')));
    const { ReviewService } = await import(pathToFileURL(path.join(moduleRoot, 'worker-entry.mjs')));
    const data = new Map();
    const storage = { get: async key => structuredClone(data.get(key)), put: async (key, value) => {
      for (const [k, v] of Object.entries(typeof key === 'string' ? { [key]: value } : key)) data.set(k, structuredClone(v));
    } };
    const service = new ReviewService({ storage }, env);
    env.REVIEW_SERVICE = { idFromName: x => x, get: () => service };
    const gateway = createGateway(core, async () => 'c'.repeat(64));
    let apiResult;
    server = http.createServer(async (req, res) => {
      try {
        const base = 'http://127.0.0.1:' + server.address().port;
        const address = new URL(req.url, base);
        if (address.pathname === '/api/review') {
          const chunks = []; for await (const chunk of req) chunks.push(chunk);
          const result = await gateway.fetch(new Request(address, { method: req.method, headers: req.headers, body: Buffer.concat(chunks) }), env);
          const text = await result.text(); apiResult = { http: result.status, body: JSON.parse(text) };
          res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(text); return;
        }
        if (address.pathname.endsWith('/tinglan-config.json')) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ endpoint: '/api/review', model, mode: 'CLOUDFLARE_ACCESS' })); return;
        }
        const publicRoot = path.join(moduleRoot, 'public');
        const file = path.resolve(publicRoot, '.' + decodeURIComponent(address.pathname));
        if (!file.startsWith(publicRoot + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
        res.end(fs.readFileSync(file));
      } catch { res.writeHead(503, { 'Content-Type': 'application/json' }).end('{"error":{"code":"SERVICE_UNAVAILABLE"}}'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await require('playwright').chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto('http://127.0.0.1:' + server.address().port + '/investment-only/investment.html');
    await page.locator('#tinglan-form button:not([disabled])').waitFor();
    await page.locator('[name=amount]').fill('10000');await page.locator('[name=risk]').selectOption('medium_low');
    await page.locator('[name=goal]').fill(student ? '制定未来三年的投资计划' : '学习生活备用金');
    await page.locator('[name=inputMode]').selectOption('sample');
    await page.locator('[name=horizon]').fill(student ? '1095' : '365'); await page.locator('[name=drawdown]').fill(student ? '' : '10');
    await page.locator('[name=liquidity]').selectOption('medium');
    const testInput = student ? '我是一名中国大学生，目前有10000元闲置资金，风险承受能力中低，希望制定未来三年的投资计划，请分析我的投资偏好、资金配置思路和风险。' : '虚构示例：希望保留备用金，未提供持仓。请解释偏好并列出待补充信息，不给交易建议。';
    await page.locator('[name=text]').fill(testInput);report.testInput = testInput;
    await page.locator('[name=consent]').check();
    const started = performance.now();
    await page.locator('#tinglan-form button').click();
    await page.waitForFunction(() => !document.querySelector('#tinglan-result').hidden || document.querySelector('#tinglan-status').getAttribute('role') === 'alert', null, { timeout: 40000 });
    report.browser = { http: apiResult?.http, durationMs: Math.round(performance.now() - started),
      status: await page.locator('#tinglan-status').innerText(), visible: await page.locator('#tinglan-result').isVisible(),
      summary: await page.locator('[data-result=summary]').innerText(), meta: await page.locator('[data-result=meta]').innerText(),
      analysis: await page.locator('[data-result=reason]').innerText(),
      runId: apiResult?.body?.run_id, auditId: apiResult?.body?.audit?.audit_id,
      source: apiResult?.body?.model?.source, callSucceeded: apiResult?.body?.model?.model_response?.call_succeeded };
    assert.equal(report.browser.http, 200); assert.equal(report.browser.visible, true);
    assert.equal(report.browser.summary, apiResult.body.model.model_response.proposal.summary);
    assert.equal(apiResult.body.execution.execution_allowed, false);
    const raw = JSON.parse(apiResult.body.model.model_response.raw_text);
    assert.equal(raw.summary, report.browser.summary);
    assert.deepEqual(raw, JSON.parse(report.steps[student ? 0 : 1].content));
    assert.equal(report.browser.analysis, raw.action_reason);
    if (student) {
      assert(/\d+(?:\.\d+)?\s*(?:%|万|元|人民币)/.test(raw.action_reason), 'Analysis has no concrete amount or ratio');
      assert(raw.action_reason.includes('你'), 'Analysis is not addressed to the user');
      assert(!/适当性|教育性分析|仅供参考|不构成投资建议|无法提供具体/.test(raw.summary + raw.action_reason), 'Analysis is disclaimer boilerplate');
    }
    report.browser.matchesProvider = true; report.result = 'LOCAL_REAL_CHAIN_PASSED'; save();
    await page.locator('#ai-assistant').screenshot({ path: path.join(moduleRoot, student ? 'evidence/live-student-panel.png' : 'evidence/live-local-panel.png') });
    console.log(JSON.stringify(report));
  } catch (error) {
    report.result = 'FAILED'; report.failure = error.code || error.name; save();
    console.log(JSON.stringify(report)); process.exitCode = 1;
  } finally {
    global.fetch = nativeFetch;
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.code || error.name); process.exitCode = 1; });
