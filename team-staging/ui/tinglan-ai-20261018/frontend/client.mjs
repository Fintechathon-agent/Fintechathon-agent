export const messages = {
  UNCONFIGURED: '安全 AI 入口待团队管理员配置；本次没有发送模型请求。',
  AUTHENTICATION_REQUIRED: '请先打开团队安全工作台并登录获准的账号。',
  INVALID_REVIEW_INPUT: '请完整填写投资期限、风险承受能力、资金需求和分析问题。',
  RATE_LIMITED: '请求频率或测试额度已达上限，请稍后重试或联系管理员。',
  MODEL_TIMEOUT: 'AI 分析超时，本次没有取得结果。请勿连续重复提交。',
  MODEL_NOT_CONFIGURED: '团队尚未启用百炼或调用预算，请联系管理员。',
  MODEL_INVALID_RESPONSE: 'AI 返回格式或模型身份不符合要求，本次结果未采用。',
  SERVICE_UNAVAILABLE: 'AI 后端不可用或网络连接失败，请检查登录与网络后重试。',
  MODEL_PROVIDER_ERROR: '模型服务鉴权失败、限流或暂时不可用，请联系管理员。'
};
export function buildInput(values, id) {
  const horizon = Number(values.horizon), drawdown = Number(values.drawdown), text = String(values.text || '').trim();
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 36500 || !Number.isFinite(drawdown) || drawdown <= 0 || drawdown > 100 ||
      !['low','medium','high'].includes(values.liquidity) || !text || text.length > 2000 || values.synthetic !== true) throw new Error('INVALID_REVIEW_INPUT');
  return { schema_version: 'model-review.v1', kind: 'combined', text, source: 'tinglan-ui', data_mode: 'SYNTHETIC_REPLAY', execution_mode: 'PAPER',
    capability: 'REVIEW_ONLY', memory_consent: false, allow_rule_fallback: false, idempotency_key: id,
    context: { synthetic: true, risk_profile: { investment_horizon_days: horizon, max_drawdown: drawdown / 100, liquidity_need: values.liquidity }, market_data_available: false } };
}
export function readResult(data, modelName) {
  const model = data?.model?.model_response, p = model?.proposal;
  if (data?.model?.source !== 'model' || data.status !== 'PENDING_RISK' || model?.call_succeeded !== true || model.model !== modelName ||
      data.execution?.execution_allowed !== false || typeof p?.summary !== 'string' || !p.summary.trim() || typeof p.action_reason !== 'string' ||
      !Array.isArray(p.evidence) || !p.evidence.every(x => typeof x === 'string') || !Array.isArray(p.missing_information) ||
      !p.missing_information.every(x => typeof x === 'string') || typeof data.run_id !== 'string' || !data.audit?.audit_id) throw new Error('MODEL_INVALID_RESPONSE');
  return { summary: p.summary, reason: p.action_reason, evidence: p.evidence.join('；') || '未返回证据，请核实来源。',
    missing: p.missing_information.join('；') || '请继续核实输入资料与适用条件。', model: model.model,
    tokens: Number.isSafeInteger(model.usage?.total_tokens) ? model.usage.total_tokens : null, runId: data.run_id, auditId: data.audit.audit_id };
}
export async function analyze(config, body, fetchImpl, base = location.href) {
  if (!config?.endpoint || config.mode !== 'CLOUDFLARE_ACCESS' || config.model !== 'qwen3.8-flash') throw new Error('UNCONFIGURED');
  const endpoint = new URL(config.endpoint, base);
  if (endpoint.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(endpoint.hostname)) throw new Error('UNCONFIGURED');
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/api/review') throw new Error('UNCONFIGURED');
  try {
    const response = await fetchImpl(endpoint.href, { method: 'POST', credentials: 'include', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(35000) });
    if (response.status === 401 || response.status === 403) throw new Error('AUTHENTICATION_REQUIRED');
    if (response.status === 429) throw new Error('RATE_LIMITED');
    if (response.status === 504) throw new Error('MODEL_TIMEOUT');
    let data;
    try { data = await response.json(); } catch { throw new Error('MODEL_INVALID_RESPONSE'); }
    if (!response.ok) throw new Error(messages[data.error?.code] ? data.error.code : 'SERVICE_UNAVAILABLE');
    return readResult(data, config.model);
  } catch (error) {
    if (['TimeoutError', 'AbortError'].includes(error.name)) throw new Error('MODEL_TIMEOUT');
    if (messages[error.message]) throw error;
    throw new Error('SERVICE_UNAVAILABLE');
  }
}
