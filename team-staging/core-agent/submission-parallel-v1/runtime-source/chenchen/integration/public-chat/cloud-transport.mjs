// Transport-only Workers AI call for the opt-in hybrid gateway. The caller owns
// the single atomic reservation and receipt across Workers AI and one backup.
import {ProviderError} from './provider-adapter.mjs';
import {CLOUD_MODEL, CLOUD_PROVIDER, MAX_OUTPUT_TOKENS} from './gateway-policy.mjs';

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {signal.removeEventListener('abort', abort); reject(new ProviderError('MODEL_ABORTED'));};
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, {once: true});
    Promise.resolve(promise).then(value => {signal.removeEventListener('abort', abort); resolve(value);}, error => {signal.removeEventListener('abort', abort); reject(error);});
  });
}

export function classifyCloudflareError(error) {
  const declared = Number(error?.code ?? error?.cause?.code);
  const text = typeof error?.message === 'string' ? error.message : '';
  const embedded = Number(/\b(3036|3040|3007|3008|5035)\b/.exec(text)?.[1]);
  const code = Number.isInteger(declared) && declared > 0 ? declared : embedded;
  const status = Number(error?.status) || 0;
  if (code === 3036) return new ProviderError('CLOUDFLARE_NEURONS_EXHAUSTED', {status: 429});
  if (code === 3040) return new ProviderError('MODEL_UPSTREAM_CAPACITY', {status: 429});
  if (code === 5035) return new ProviderError('CLOUDFLARE_PLAN_REQUIRED', {status: 403});
  if (code === 3007 || status === 408) return new ProviderError('MODEL_TIMEOUT', {status: status || 408});
  if (code === 3008) return new ProviderError('MODEL_ABORTED', {status: status || 408});
  if (status === 429) return new ProviderError('MODEL_RATE_LIMITED', {status});
  if (status >= 500) return new ProviderError('MODEL_UPSTREAM_FAILED', {status});
  return new ProviderError('MODEL_PROVIDER_FAILURE', {status});
}

async function readCloudStream(stream, onDelta, signal) {
  if (!stream || typeof stream.getReader !== 'function') throw new ProviderError('MODEL_STREAM_REQUIRED');
  const reader = stream.getReader(), decoder = new TextDecoder();
  let buffer = '', eventData = [], text = '', usage = null, reportedModel = null, finishReason = null, done = false;
  const dispatch = () => {
    const payload = eventData.join('\n').trim(); eventData = [];
    if (!payload) return;
    if (payload === '[DONE]') {done = true; return;}
    let chunk;
    try {chunk = JSON.parse(payload);} catch {throw new ProviderError('MODEL_STREAM_INVALID', {partial: !!text});}
    if (chunk.error || chunk.errors?.length || chunk.choices?.[0]?.delta?.tool_calls) throw new ProviderError('MODEL_STREAM_FAILED', {partial: !!text});
    const raw = chunk.response ?? chunk.choices?.[0]?.delta?.content ?? '';
    const delta = typeof raw === 'string' ? raw : typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : null;
    if (delta === null) throw new ProviderError('MODEL_STREAM_INVALID', {partial: !!text});
    if (delta) {text += delta; if (text.length > 16_000) throw new ProviderError('MODEL_OUTPUT_TOO_LONG', {partial: true}); onDelta(delta);}
    if (chunk.usage) usage = chunk.usage;
    if (chunk.model) reportedModel = chunk.model;
    finishReason = chunk.choices?.[0]?.finish_reason || chunk.finish_reason || finishReason;
  };
  const line = value => {
    value = value.replace(/\r$/, '');
    if (!value) {dispatch(); return;}
    if (value.startsWith('data:')) eventData.push(value.slice(5).replace(/^ /, ''));
  };
  try {
    while (true) {
      const part = await abortable(reader.read(), signal);
      if (part.done) {buffer += decoder.decode(); if (buffer) line(buffer); dispatch(); break;}
      buffer += decoder.decode(part.value, {stream: true});
      if (buffer.length > 100_000) throw new ProviderError('MODEL_STREAM_INVALID', {partial: !!text});
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {line(buffer.slice(0, at)); buffer = buffer.slice(at + 1);}
    }
    if (!done || !text.trim()) throw new ProviderError('MODEL_STREAM_INTERRUPTED', {partial: !!text});
    if (finishReason === 'length') throw new ProviderError('MODEL_OUTPUT_TRUNCATED', {partial: !!text});
    if (finishReason && finishReason !== 'stop') throw new ProviderError('MODEL_INCOMPLETE_RESPONSE', {partial: !!text});
    return {text, usage, reported_model: reportedModel, finish_reason: finishReason};
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(signal.aborted ? 'MODEL_ABORTED' : 'MODEL_STREAM_INTERRUPTED', {partial: !!text});
  } finally {
    try {await abortable(reader.cancel(), AbortSignal.timeout(1_000));} catch {}
    reader.releaseLock();
  }
}

export async function callCloudProvider(env, messages, {stream = false, signal, onDelta = () => {}} = {}) {
  if (!env.AI || env.MODEL_NAME !== CLOUD_MODEL || env.MODEL_ENABLED !== 'true') throw new ProviderError('CHAT_PROVIDER_NOT_CONFIGURED');
  const timeout = AbortSignal.timeout(70_000), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const started = Date.now();
  try {
    const raw = await abortable(env.AI.run(CLOUD_MODEL, {messages, max_tokens: MAX_OUTPUT_TOKENS, temperature: 0, stream}), combined);
    const provider_response_id = env.AI.lastRequestId || null;
    if (!provider_response_id) throw new ProviderError('MODEL_RECEIPT_MISSING');
    let result;
    if (stream) result = await readCloudStream(raw, onDelta, combined);
    else {
      const text = raw?.choices?.[0]?.message?.content ?? (typeof raw?.response === 'object' ? JSON.stringify(raw.response) : raw?.response);
      if (raw?.choices?.[0]?.message?.tool_calls) throw new ProviderError('MODEL_TOOL_CALL_UNSUPPORTED');
      if (typeof text !== 'string' || !text.trim()) throw new ProviderError('MODEL_EMPTY_RESPONSE');
      const finish_reason = raw?.choices?.[0]?.finish_reason || raw?.finish_reason || null;
      if (finish_reason === 'length') throw new ProviderError('MODEL_OUTPUT_TRUNCATED');
      if (finish_reason && finish_reason !== 'stop') throw new ProviderError('MODEL_INCOMPLETE_RESPONSE');
      result = {text, usage: raw?.usage || null, reported_model: raw?.model || null, finish_reason};
    }
    combined.throwIfAborted();
    return {...result, provider_response_id, provider: CLOUD_PROVIDER, model: CLOUD_MODEL, status: 200, duration_ms: Date.now() - started};
  } catch (error) {
    if (signal?.aborted) throw new ProviderError('MODEL_ABORTED', {partial: error.partial});
    if (timeout.aborted) throw new ProviderError('MODEL_TIMEOUT', {partial: error.partial});
    if (error instanceof ProviderError) throw error;
    throw classifyCloudflareError(error);
  }
}
