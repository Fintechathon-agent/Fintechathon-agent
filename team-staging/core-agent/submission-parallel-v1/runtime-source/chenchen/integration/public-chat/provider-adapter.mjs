// Prepared external-provider transport. It is deliberately not selected by the
// production model path until the providers, models, prices and budget gate are
// verified together. No browser code imports this file.
const MAX_CHARS = 12000;
const MAX_OUTPUT = 1024;
const COOLDOWN_MS = 30000;
const cooldown = new Map();
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {signal.removeEventListener('abort', abort);reject(new ProviderError('MODEL_TIMEOUT'));};
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, {once: true});
    Promise.resolve(promise).then(value => {signal.removeEventListener('abort', abort);resolve(value);}, error => {signal.removeEventListener('abort', abort);reject(error);});
  });
}

export class ProviderError extends Error {
  constructor(code, {status = 0, partial = false} = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.partial = partial;
  }
}

export function classifyProviderStatus(status) {
  if (status === 401 || status === 403) return 'MODEL_AUTH_FAILED';
  if (status === 402) return 'MODEL_QUOTA_EXHAUSTED';
  if (status === 429) return 'MODEL_RATE_LIMITED';
  if (status >= 500) return 'MODEL_UPSTREAM_FAILED';
  return 'MODEL_REQUEST_REJECTED';
}

export function classifyProviderFailure(status, code) {
  if (['insufficient_quota', 'insufficient_balance', 'billing_hard_limit_reached', 'Arrearage'].includes(code)) return 'MODEL_QUOTA_EXHAUSTED';
  return classifyProviderStatus(status);
}

export function providerSlot(env, slot) {
  if (!['A', 'B'].includes(slot)) throw new ProviderError('MODEL_SLOT_INVALID');
  const provider = env[`LLM_${slot}_PROVIDER`];
  const protocol = env[`LLM_${slot}_PROTOCOL`];
  const base = env[`LLM_${slot}_BASE_URL`];
  const model = env[`LLM_${slot}_MODEL`];
  const key = env[`LLM_${slot}_API_KEY`];
  if (!provider || !protocol || !base || !model || !key) throw new ProviderError('MODEL_SLOT_NOT_CONFIGURED');
  if (protocol !== 'chat-completions') throw new ProviderError('MODEL_PROTOCOL_UNVERIFIED');
  let url;
  try { url = new URL(base); } catch { throw new ProviderError('MODEL_BASE_URL_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) {
    throw new ProviderError('MODEL_BASE_URL_INVALID');
  }
  if (provider === 'xai' && (url.origin !== 'https://api.x.ai' || url.pathname.replace(/\/$/, '') !== '/v1')) {
    throw new ProviderError('MODEL_BASE_URL_INVALID');
  }
  if (provider === 'openai' && (url.origin !== 'https://api.openai.com' || url.pathname.replace(/\/$/, '') !== '/v1')) throw new ProviderError('MODEL_BASE_URL_INVALID');
  if (provider === 'deepseek' && (url.origin !== 'https://api.deepseek.com' || !['', '/', '/v1', '/v1/'].includes(url.pathname))) throw new ProviderError('MODEL_BASE_URL_INVALID');
  // This acceptance profile is deliberately limited to one Beijing workspace
  // and one non-thinking model. A generic proxy or trial host is not equivalent.
  if (provider === 'bailian') {
    if (url.port || !/^llm-[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?\.cn-beijing\.maas\.aliyuncs\.com$/.test(url.hostname) ||
        url.pathname.replace(/\/$/, '') !== '/compatible-mode/v1' || env[`LLM_${slot}_REGION`] !== 'cn-beijing') {
      throw new ProviderError('MODEL_BASE_URL_INVALID');
    }
    if (model !== 'qwen3.8-flash') throw new ProviderError('MODEL_NAME_INVALID');
    if (env[`LLM_${slot}_ENABLE_THINKING`] !== 'false') throw new ProviderError('MODEL_THINKING_POLICY_INVALID');
  }
  if (env[`LLM_${slot}_PROTOCOL_VERIFIED`] !== 'true') {
    throw new ProviderError('MODEL_PROTOCOL_UNVERIFIED');
  }
  if (env[`LLM_${slot}_JSON_VERIFIED`] !== 'true' || env[`LLM_${slot}_STREAM_VERIFIED`] !== 'true') {
    throw new ProviderError('MODEL_CAPABILITY_UNVERIFIED');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,119}$/.test(model)) throw new ProviderError('MODEL_NAME_INVALID');
  const integer = (name, fallback, min, max) => {const raw = env[`LLM_${slot}_${name}`];if (raw == null) return fallback;if (!/^\d+$/.test(String(raw)) || Number(raw) < min || Number(raw) > max) throw new ProviderError('MODEL_SLOT_LIMIT_INVALID');return Number(raw);};
  const temperatureText = env[`LLM_${slot}_TEMPERATURE`] ?? '0';
  if (temperatureText !== 'omit' && (!/^(?:0|1|2)(?:\.\d{1,2})?$/.test(String(temperatureText)) || Number(temperatureText) > 2)) throw new ProviderError('MODEL_SLOT_LIMIT_INVALID');
  const jsonMode = env[`LLM_${slot}_JSON_MODE`] || 'prompt';
  if (!['prompt', 'json_object'].includes(jsonMode) || provider === 'bailian' && jsonMode !== 'json_object') throw new ProviderError('MODEL_PROTOCOL_UNVERIFIED');
  return {slot, provider, protocol, url: new URL(url.href.replace(/\/$/, '') + '/chat/completions'), model, key,
    ...(provider === 'bailian' ? {enableThinking: false} : {}),
    connectTimeoutMs: integer('CONNECT_TIMEOUT_MS', 8000, 1000, 15000), responseTimeoutMs: integer('RESPONSE_TIMEOUT_MS', 45000, 1000, 60000),
    maxOutputTokens: integer('MAX_OUTPUT_TOKENS', MAX_OUTPUT, 1, MAX_OUTPUT), maxAttempts: integer('MAX_ATTEMPTS', 1, 1, 2),
    maxMessageChars: integer('MAX_MESSAGE_CHARS', MAX_CHARS, 6000, MAX_CHARS), temperature: temperatureText === 'omit' ? null : Number(temperatureText), jsonMode};
}

export function providerCooling(env, slot) {
  try {
    const config = providerSlot(env, slot);
    return (cooldown.get(`${config.provider}:${config.model}:${config.url.origin}`) || 0) > Date.now();
  } catch {return false;}
}

async function readStream(response, onDelta, signal, nonThinking = false) {
  if (!response.body) throw new ProviderError('MODEL_STREAM_REQUIRED');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', text = '', usage = null, responseId = null, reportedModel = null, done = false, finishReason = null, partial = false;
  const event = value => {
    if (value === '[DONE]') { done = true; return; }
    let chunk;
    try { chunk = JSON.parse(value); } catch { throw new ProviderError('MODEL_STREAM_INVALID', {partial}); }
    if (chunk.error) throw new ProviderError('MODEL_UPSTREAM_FAILED', {partial});
    if (nonThinking && chunk.choices?.[0]?.delta?.reasoning_content) throw new ProviderError('MODEL_THINKING_UNEXPECTED', {partial});
    responseId ||= chunk.id || null;
    reportedModel ||= chunk.model || null;
    usage ||= chunk.usage || null;
    finishReason ||= chunk.choices?.[0]?.finish_reason || null;
    if (chunk.choices?.[0]?.delta?.tool_calls || finishReason === 'tool_calls') throw new ProviderError('MODEL_TOOL_CALL_UNSUPPORTED', {partial});
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta == null) return;
    if (typeof delta !== 'string') throw new ProviderError('MODEL_STREAM_INVALID', {partial});
    text += delta;
    if (text.length > 16000) throw new ProviderError('MODEL_OUTPUT_TOO_LONG', {partial: true});
    if (delta) { partial = true; onDelta(delta); }
  };
  const drain = line => {
    if (!line.startsWith('data:')) return;
    event(line.slice(5).trim());
  };
  try {
    while (true) {
      if (signal.aborted) throw new ProviderError('MODEL_TIMEOUT', {partial});
      const part = await abortable(reader.read(), signal);
      if (part.done) break;
      buffer += decoder.decode(part.value, {stream: true});
      if (buffer.length > 100000) throw new ProviderError('MODEL_STREAM_INVALID', {partial});
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) { drain(buffer.slice(0, end).trimEnd()); buffer = buffer.slice(end + 1); }
    }
    if (buffer.trim()) drain(buffer.trim());
    if (!done || !text.trim()) throw new ProviderError('MODEL_STREAM_INTERRUPTED', {partial});
    if (finishReason === 'length') throw new ProviderError('MODEL_OUTPUT_TRUNCATED', {partial});
    if (finishReason && finishReason !== 'stop') throw new ProviderError('MODEL_INCOMPLETE_RESPONSE', {partial});
    return {text, usage, provider_response_id: responseId, reported_model: reportedModel, finish_reason: finishReason};
  } catch (error) {
    if (error instanceof ProviderError) throw new ProviderError(error.code, {status: error.status, partial: partial || error.partial});
    throw new ProviderError(signal.aborted ? 'MODEL_TIMEOUT' : 'MODEL_STREAM_INTERRUPTED', {partial});
  } finally {
    // Cleanup must not extend the response deadline if the upstream never
    // acknowledges cancellation. Cancel synchronously, then release the lock.
    try { reader.cancel().catch(() => {}); } catch {}
    reader.releaseLock();
  }
}

export async function callProvider(config, messages, {stream = false, phase, onDelta = () => {}, fetchImpl = fetch, connectTimeoutMs = config.connectTimeoutMs || 8000, responseTimeoutMs = config.responseTimeoutMs || 45000, requestId, signal} = {}) {
  if (!Array.isArray(messages) || JSON.stringify(messages).length > (config.maxMessageChars || MAX_CHARS) || !messages.every(m =>
    ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string')) {
    throw new ProviderError('CHAT_CONTEXT_TOO_LONG');
  }
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, {once: true});
  if (controller.signal.aborted) throw new ProviderError('MODEL_ABORTED');
  let timer = setTimeout(() => controller.abort(), connectTimeoutMs);
  const started = Date.now();
  try {
    let response;
    try {
      response = await abortable(fetchImpl(config.url, {method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: {'Authorization': `Bearer ${config.key}`, 'Content-Type': 'application/json', 'X-Client-Request-Id': requestId || crypto.randomUUID()},
        body: JSON.stringify({model: config.model, messages, stream, max_tokens: config.maxOutputTokens || MAX_OUTPUT,
          ...(config.enableThinking === false ? {enable_thinking: false} : {}),
          ...(config.temperature === null ? {} : {temperature: config.temperature ?? 0}),
          ...(phase === 'plan' && config.jsonMode === 'json_object' ? {response_format: {type: 'json_object'}} : {}),
          ...(stream ? {stream_options: {include_usage: true}} : {})})}), controller.signal);
    } catch {
      throw new ProviderError(signal?.aborted ? 'MODEL_ABORTED' : controller.signal.aborted ? 'MODEL_TIMEOUT' : 'MODEL_NETWORK_FAILED');
    }
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), responseTimeoutMs);
    if (response.status >= 300 && response.status < 400) throw new ProviderError('MODEL_REDIRECT_REJECTED', {status: response.status});
    if (!response.ok) {
      let code = null;
      try { const error = await abortable(response.json(), controller.signal); code = error?.error?.code || error?.error?.type || error?.code || null; } catch {}
      throw new ProviderError(classifyProviderFailure(response.status, code), {status: response.status});
    }
    let result;
    if (stream) result = await readStream(response, onDelta, controller.signal, config.enableThinking === false);
    else {
      let raw;
      try { raw = await abortable(response.json(), controller.signal); } catch { throw new ProviderError(controller.signal.aborted ? 'MODEL_TIMEOUT' : 'MODEL_RESPONSE_INVALID'); }
      const text = raw?.choices?.[0]?.message?.content;
      if (config.enableThinking === false && raw?.choices?.[0]?.message?.reasoning_content) throw new ProviderError('MODEL_THINKING_UNEXPECTED');
      if (raw?.choices?.[0]?.message?.tool_calls || raw?.choices?.[0]?.finish_reason === 'tool_calls') throw new ProviderError('MODEL_TOOL_CALL_UNSUPPORTED');
      if (typeof text !== 'string' || !text.trim()) throw new ProviderError('MODEL_EMPTY_RESPONSE');
      if (raw.choices[0].finish_reason === 'length') throw new ProviderError('MODEL_OUTPUT_TRUNCATED');
      if (raw.choices[0].finish_reason && raw.choices[0].finish_reason !== 'stop') throw new ProviderError('MODEL_INCOMPLETE_RESPONSE');
      result = {text, usage: raw.usage || null, provider_response_id: raw.id || null, reported_model: raw.model || null, finish_reason: raw.choices[0].finish_reason || null};
    }
    return {...result, provider: config.provider, model: config.model, status: response.status, duration_ms: Date.now() - started};
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

// Two upstream attempts total: either one safe retry or one fallback. Agent
// planning, tools, Memory, Risk and writes are never replayed by this router.
export async function routeProviders(env, messages, options = {}) {
  const maxTotalAttempts = options.maxTotalAttempts === 1 ? 1 : 2;
  const primary = env.LLM_PRIMARY === 'B' ? 'B' : 'A';
  const order = [primary, primary === 'A' ? 'B' : 'A'];
  const errors = [];
  let attempted = 0;
  for (const slot of order) {
    if (attempted >= maxTotalAttempts) break;
    if (options.signal?.aborted) throw new ProviderError('MODEL_ABORTED');
    let config;
    try { config = providerSlot(env, slot); } catch (error) { errors.push({slot, code: error.code}); continue; }
    const cooldownKey = `${config.provider}:${config.model}:${config.url.origin}`;
    if ((cooldown.get(cooldownKey) || 0) > Date.now()) { errors.push({slot, code: 'MODEL_COOLDOWN'}); continue; }
    for (let localAttempt = 0; localAttempt < config.maxAttempts && attempted < maxTotalAttempts; localAttempt++) {
      if (options.signal?.aborted) throw new ProviderError('MODEL_ABORTED');
      const started = Date.now();
      attempted++;
      try {
        const result = await callProvider(config, messages, options);
        options.onAttempt?.({slot, provider: config.provider, model: config.model, status: result.status, error_code: null, duration_ms: result.duration_ms, usage: result.usage, provider_response_id: result.provider_response_id});
        return {...result, slot, attempts: attempted};
      } catch (error) {
        errors.push({slot, code: error.code || 'MODEL_UPSTREAM_FAILED', status: error.status || 0});
        options.onAttempt?.({slot, provider: config.provider, model: config.model, status: error.status || 0, error_code: error.code || 'MODEL_UPSTREAM_FAILED', duration_ms: Date.now() - started, usage: null, provider_response_id: null});
        if (options.signal?.aborted || error.code === 'MODEL_ABORTED') throw new ProviderError('MODEL_ABORTED', {partial: error.partial});
        if (error.partial) throw new ProviderError('MODEL_PARTIAL_RESPONSE', {partial: true});
        const retryable = ['MODEL_RATE_LIMITED', 'MODEL_NETWORK_FAILED', 'MODEL_TIMEOUT', 'MODEL_UPSTREAM_FAILED'].includes(error.code);
        const fallbackable = retryable || error.code === 'MODEL_QUOTA_EXHAUSTED';
        if (!fallbackable) throw error;
        if (retryable && localAttempt + 1 < config.maxAttempts && attempted < maxTotalAttempts) continue;
        cooldown.set(cooldownKey, Date.now() + COOLDOWN_MS);
        break;
      }
    }
  }
  // Preserve a precise billing error when there was no usable backup. The UI
  // must not imply that a second provider was tried or charged.
  if (attempted === 1 && errors.some(item => item.code === 'MODEL_QUOTA_EXHAUSTED') &&
      errors.every(item => ['MODEL_QUOTA_EXHAUSTED', 'MODEL_SLOT_NOT_CONFIGURED'].includes(item.code))) {
    throw Object.assign(new ProviderError('MODEL_QUOTA_EXHAUSTED'), {attempts: errors});
  }
  throw Object.assign(new ProviderError('MODEL_PROVIDERS_UNAVAILABLE'), {attempts: errors});
}
