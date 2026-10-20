import { verifyAccess } from './access.mjs';

const messages = {
  AUTHENTICATION_REQUIRED: '请先使用获准的团队账号登录。',
  ACCESS_NOT_CONFIGURED: '团队访问权限尚未配置，请联系管理员。',
  MODEL_NOT_CONFIGURED: '百炼服务或测试预算尚未启用。',
  RATE_LIMITED: '请求次数或测试额度已用完，请联系管理员。',
  INVALID_REVIEW_INPUT: '请填写有效的投资期限、风险承受能力、资金需求和分析问题。',
  INVALID_JSON: '请求数据格式不正确，请刷新后重试。',
  MODEL_TIMEOUT: 'AI 分析超时，本次没有返回有效结果。请勿连续重复提交。',
  MODEL_PROVIDER_ERROR: '模型服务鉴权失败、限流或暂时不可用，请联系管理员核查。',
  MODEL_INVALID_RESPONSE: 'AI 这次没有给出可执行的分析，结果已拦下；请补充资金用途后重试一次。',
  SERVICE_UNAVAILABLE: 'AI 服务暂时不可用，请稍后重试。',
  ORIGIN_DENIED: '当前网页未获得访问授权。',
  METHOD_NOT_ALLOWED: '此操作不受支持。'
};
export function failure(code, status, headers = {}) {
  return new Response(JSON.stringify({ error: { code, message: messages[code] || messages.SERVICE_UNAVAILABLE }, execution_allowed: false }), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}
// 分析要像顾问在说话，不是合规文书：先给结论和具体配置，再解释为什么。
// 这段指令由服务端写死，浏览器无法改写，也不会被用户输入覆盖。
export const ADVISOR_INSTRUCTIONS = [
  '你是这位用户自己的投资顾问，不是审核员。用第二人称“你”直接说话，不要用第三人称转述他的情况。',
  'summary 写一句话结论，必须给出具体配置：金额或比例加产品类别，例如“25 天要用的钱，140 万放货币基金，10 万以内做宽基 ETF”。',
  'action_reason 写 3 到 4 段中文自然段：这笔钱具体怎么放；为什么这么放，用用户给的数字算给他看（如 150 万×7% 最多亏 10.5 万）；这样做的代价和大致收益量级；什么情况下要改。必须出现具体金额或比例。',
  '用户的目标和约束矛盾时直接说破，例如期限只有 25 天却想“冲高”，或回撤上限 7% 却想满仓权益。',
  '不要写“适当性”“教育性分析”“仅供参考”“不构成投资建议”这类套话。专业词第一次出现要用一句大白话解释，例如“回撤，就是账户从高点最多跌掉多少”。',
  '信息不全时先按合理假设给出方案并写明假设；missing_information 最多 2 条，只列真正会改变结论的问题，不要拿缺资料当作拒绝给建议的理由。',
  'evidence 只列你实际用到的输入。不编造实时行情、收益率、持仓或产品名，不推荐个股，不执行任何交易。'
].join('');
const ADVISOR_CLICHES = /适当性|教育性分析|仅供参考|不构成投资建议|无法提供具体|无法给出具体/;
// 只卡“像顾问”的下限：有具体数字、用第二人称、不堆套话；不评价投资观点对错。
export function advisorQuality(proposal) {
  const summary = String(proposal?.summary || '').trim();
  const reason = String(proposal?.action_reason || '').trim();
  const amounts = (reason.match(/\d+(?:\.\d+)?\s*(?:%|万|元|人民币)/g) || []).length;
  const missing = Array.isArray(proposal?.missing_information) ? proposal.missing_information.length : 0;
  return summary.length >= 12 && reason.length >= 100 && amounts >= 2 &&
    (summary + reason).includes('你') && missing <= 3 && !ADVISOR_CLICHES.test(summary + reason);
}
export function validInput(body) {
  const profile = body?.context?.risk_profile;
  return body && !Array.isArray(body) && body.kind === 'combined' && typeof body.text === 'string' && body.text.trim().length > 0 && body.text.length <= 2000 &&
    body.execution_mode === 'PAPER' && body.capability === 'REVIEW_ONLY' && body.allow_rule_fallback === false &&
    ((body.data_mode === 'SYNTHETIC_REPLAY' && body.context?.synthetic === true) || (body.data_mode === 'LIVE' && body.context?.synthetic === false)) &&
    Number.isInteger(profile?.investment_horizon_days) && profile.investment_horizon_days >= 1 && profile.investment_horizon_days <= 36500 &&
    (profile.max_drawdown === undefined || (Number.isFinite(profile.max_drawdown) && profile.max_drawdown > 0 && profile.max_drawdown <= 1)) && ['low', 'medium', 'high'].includes(profile.liquidity_need);
}
export function createGateway(core, authenticate = verifyAccess) {
  return { async fetch(request, env, ctx) {
    const url = new URL(request.url), origin = request.headers.get('Origin');
    const allowed = new Set([url.origin, ...String(env.CORS_ORIGINS || '').split(',').map(x => x.trim()).filter(x => x && x !== '*')]);
    const cors = origin && allowed.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key' } : {};
    const sensitive = url.pathname.startsWith('/api/review') || url.pathname === '/api/tinglan/status';
    if (!sensitive) {
      if (url.pathname === '/investment-only/tinglan-config.json') return Response.json({ endpoint: '/api/review', model: env.MODEL_NAME, mode: 'CLOUDFLARE_ACCESS' }, { headers: { 'Cache-Control': 'no-store' } });
      if (url.pathname.startsWith('/investment-only/') && env.ASSETS) return env.ASSETS.fetch(request);
      return core.fetch(request, env, ctx);
    }
    if (request.method === 'OPTIONS') return origin && allowed.has(origin) ? new Response(null, { status: 204, headers: cors }) : failure('ORIGIN_DENIED', 403);
    if (origin && !allowed.has(origin)) return failure('ORIGIN_DENIED', 403);
    // Machine-to-machine callers retain the existing authenticated workflow.
    const machineKey = String(env.CORE_AGENT_API_KEY || '');
    if (machineKey && request.headers.get('X-Core-Agent-Key') === machineKey) return core.fetch(request, env, ctx);
    if (!machineKey || env.MODEL_PROVIDER !== 'aliyun_bailian' || !['qwen3.8-flash','qwen3.8-max'].includes(env.MODEL_NAME)) return failure('MODEL_NOT_CONFIGURED', 503, cors);
    let subject;
    try { subject = await authenticate(request, env); } catch (error) {
      const known = ['AUTHENTICATION_REQUIRED', 'ACCESS_NOT_CONFIGURED'].includes(error.message);
      return failure(known ? error.message : 'SERVICE_UNAVAILABLE', error.message === 'AUTHENTICATION_REQUIRED' ? 401 : 503, cors);
    }
    if (url.pathname === '/api/tinglan/status' && request.method === 'GET') return Response.json({ authenticated: true, provider: env.MODEL_PROVIDER,
      model: env.MODEL_NAME, enabled: env.BAILIAN_ALLOW_PAID_CALLS === 'true' && Number(env.BAILIAN_TEST_BUDGET_CNY) > 0 }, { headers: { ...cors, 'Cache-Control': 'no-store' } });
    if (request.method !== 'POST' || url.pathname !== '/api/review') return failure('METHOD_NOT_ALLOWED', 403, cors);
    if (!origin || !/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) return failure('INVALID_REVIEW_INPUT', 422, cors);
    let body;
    try {
      const reader = request.body?.getReader(); let bytes = 0, chunks = [];
      if (!reader) return failure('INVALID_JSON', 400, cors);
      while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
        if (bytes > 16000) { await reader.cancel(); return failure('INVALID_REVIEW_INPUT', 413, cors); } chunks.push(part.value); }
      const merged = new Uint8Array(bytes); let offset = 0; for (const part of chunks) { merged.set(part, offset); offset += part.length; }
      body = JSON.parse(new TextDecoder().decode(merged));
    } catch { return failure('INVALID_JSON', 400, cors); }
    if (!validInput(body)) return failure('INVALID_REVIEW_INPUT', 422, cors);
    const id = body.idempotency_key;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(id)) return failure('INVALID_REVIEW_INPUT', 422, cors);
    // Reconstruct the public request: no client-supplied task, owner, action or session authority.
    body = { schema_version: 'model-review.v1', kind: 'combined', text: body.text.trim(), source: 'tinglan-access-ui', data_mode: body.data_mode,
      execution_mode: 'PAPER', capability: 'REVIEW_ONLY', allow_rule_fallback: false, memory_consent: false,
      idempotency_key: subject + '-' + id, context: { synthetic: body.context.synthetic, risk_profile: {
        investment_horizon_days: body.context.risk_profile.investment_horizon_days,
        max_drawdown: body.context.risk_profile.max_drawdown,
        liquidity_need: body.context.risk_profile.liquidity_need
      }, market_data_available: false },
      requested_action: ADVISOR_INSTRUCTIONS };
    const headers = new Headers({ 'Content-Type': 'application/json', 'X-Core-Agent-Key': machineKey, 'X-Tinglan-Subject': subject });
    const forwarded = new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
    try {
      const response = await core.fetch(forwarded, env, ctx);
      const data = await response.json();
      if (!response.ok) {
        let code = data.error?.code;
        if (['MODEL_PROVIDER_INVALID_JSON', 'MODEL_EMPTY_RESPONSE', 'MODEL_UNSAFE_ACTION'].includes(code)) code = 'MODEL_INVALID_RESPONSE';
        if (data.error?.details?.status === 429) code = 'RATE_LIMITED';
        return failure(messages[code] ? code : 'SERVICE_UNAVAILABLE', code === 'MODEL_TIMEOUT' ? 504 : response.status, cors);
      }
      const model = data.model?.model_response;
      if (data.model?.source !== 'model' || model?.call_succeeded !== true || model.model !== env.MODEL_NAME || data.execution?.execution_allowed !== false)
        return failure('MODEL_INVALID_RESPONSE', 502, cors);
      if (!advisorQuality(model.proposal)) return failure('MODEL_INVALID_RESPONSE', 502, cors);
      delete model.endpoint;
      let safe = JSON.stringify(data);
      for (const secret of [env.DASHSCOPE_API_KEY, machineKey, env.MODEL_API_URL]) if (secret) safe = safe.replaceAll(JSON.stringify(secret).slice(1, -1), '[REDACTED]');
      return new Response(safe, { status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    } catch { return failure('SERVICE_UNAVAILABLE', 503, cors); }
  } };
}

export async function reserveUser(storage, subject, env, now = Date.now()) {
  if (!/^[a-f0-9]{64}$/.test(subject)) throw new Error('AUTHENTICATION_REQUIRED');
  const limit = Number(env.TINGLAN_DAILY_REQUESTS || 5);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('ACCESS_NOT_CONFIGURED');
  const key = 'tinglan-user-quota:' + subject;
  const old = await storage.get(key) || { day: '', count: 0, minute: 0, minute_count: 0 };
  if (![old.count, old.minute, old.minute_count].every(x => Number.isSafeInteger(x) && x >= 0)) throw new Error('SERVICE_UNAVAILABLE');
  const day = new Date(now + 8 * 3600000).toISOString().slice(0, 10), minute = Math.floor(now / 60000);
  const count = old.day === day ? old.count : 0, minuteCount = old.minute === minute ? old.minute_count : 0;
  if (count >= limit || minuteCount >= 2) throw new Error('RATE_LIMITED');
  await storage.put(key, { day, count: count + 1, minute, minute_count: minuteCount + 1 });
}
