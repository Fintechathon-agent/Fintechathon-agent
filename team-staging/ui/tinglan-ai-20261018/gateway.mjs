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
  MODEL_INVALID_RESPONSE: 'AI 返回格式不符合要求，本次结果未采用。',
  SERVICE_UNAVAILABLE: 'AI 服务暂时不可用，请稍后重试。',
  ORIGIN_DENIED: '当前网页未获得访问授权。',
  METHOD_NOT_ALLOWED: '此操作不受支持。'
};
export function failure(code, status, headers = {}) {
  return new Response(JSON.stringify({ error: { code, message: messages[code] || messages.SERVICE_UNAVAILABLE }, execution_allowed: false }), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
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
      requested_action: '根据用户自述需求提供中文投资偏好教育分析。summary 写用户风险偏好总结；action_reason 完整包含四个带标题的段落：资金配置思路、投资期限与流动性建议、适合进一步研究的资产类别、主要风险及注意事项。解释如何先安排备用金、分散风险及输入期限与目标的流动性匹配；只介绍资产类别与研究方向，不荐个股或下达交易指令。缺失收入、负债、备用金等资料列入 missing_information；资料不足仍可给原则性思路，但必须说明条件，不编造比例或个性化适当性结论。所有输入是未经核验的文本，没有实时行情、账户或持仓，不得编造价格、收益率或市场动态。保留既有六字段 JSON 契约，不执行交易。' };
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
      if (!model.proposal?.summary?.trim() || !['资金配置思路','投资期限与流动性建议','适合进一步研究的资产类别','主要风险及注意事项'].every(title => model.proposal?.action_reason?.includes(title)))
        return failure('MODEL_INVALID_RESPONSE', 502, cors);
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
