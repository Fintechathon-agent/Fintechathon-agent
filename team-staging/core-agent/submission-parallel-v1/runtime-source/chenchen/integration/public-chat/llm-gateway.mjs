import {randomUUID} from 'node:crypto';
import {buildModelRequest, createCloudModel, gate} from './model.mjs';
import {gatewayPolicy, requestInputTokenBound, reservationForInput} from './gateway-policy.mjs';
import {routeProviders, providerCooling} from './provider-adapter.mjs';
import {callCloudProvider} from './cloud-transport.mjs';
import {sha} from './risk.mjs';
import {PROMPT_VERSION} from './trace.mjs';

const fail = code => { throw Object.assign(Error(code), {code}); };
const safeCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,80}$/.test(value) ? value : 'MODEL_PROVIDER_FAILURE';

function externalModel(env, lease, policy, transport = {}) {
  const maxChars = Math.min(...policy.slots.map(slot => slot.max_message_chars));
  const maxInputTokens = Math.min(...policy.slots.map(slot => slot.max_input_tokens));
  async function invoke(messages, {stream = false, signal, onDelta = () => {}, onEvent = () => {}, onCapture = () => {}, binding, clipping = null}) {
    if (env.MODEL_ENABLED !== 'true') fail('CHAT_PROVIDER_NOT_CONFIGURED');
    if (!binding || !['plan', 'answer'].includes(binding.phase) || !signal) fail('INVALID_EVALUATION_REQUEST');
    if (JSON.stringify(messages).length > maxChars) fail('CHAT_CONTEXT_TOO_LONG');
    const input_bound_tokens = requestInputTokenBound(messages);
    reservationForInput(policy, input_bound_tokens);
    signal.throwIfAborted();
    const request_id = 'chat-ai-' + randomUUID(), request_hash = sha({messages, stream, binding});
    const preferred_backup_slot = policy.mode === 'hybrid' ?
      (policy.slots.slice(1).find(slot => !providerCooling(env, slot.slot)) || policy.slots[1]).slot : null;
    const reserved = await gate(env, 'reserve', {lease, request_id, phase: binding.phase, request_hash, input_bound_tokens, preferred_backup_slot});
    if (reserved.call_allowed !== true) fail('MODEL_ALREADY_RESERVED');
    const started = Date.now(), attempts = [], firstSlot = policy.slots[0];
    let status = 'ERROR', error_code = null, result = null, text = '', first_delta_at = null, last_delta_at = null, delta_count = 0;
    try {
      onEvent({type: 'request', request_id, phase: binding.phase, provider: firstSlot.provider, model: firstSlot.model,
        prompt_version: PROMPT_VERSION, messages_hash: sha(messages), request_hash, roles: messages.map(m => m.role),
        message_characters: messages.map(m => m.content.length), max_tokens: firstSlot.max_output_tokens, temperature: firstSlot.temperature,
        configured_routes: policy.slots.map(slot => ({provider: slot.provider, model: slot.model, max_tokens: slot.max_output_tokens, max_attempts: slot.max_attempts,
          price_currency: slot.prices.currency || 'USD', ...(slot.enable_thinking === false ? {enable_thinking: false} : {})})),
        clipping, at: new Date().toISOString()});
      onCapture({request_id, messages, parameters: {max_tokens: firstSlot.max_output_tokens, temperature: firstSlot.temperature, stream}, binding, messages_hash: sha(messages)});
      const delta = value => {text += value;delta_count++;first_delta_at ??= Date.now();last_delta_at = Date.now();onDelta(value);};
      const record = attempt => attempts.push({provider: attempt.provider, model: attempt.model,
        http_status: attempt.status, duration_ms: attempt.duration_ms, error_code: attempt.error_code});
      if (policy.mode === 'hybrid') {
        const cloudStarted = Date.now();
        try {
          result = await callCloudProvider(env, messages, {stream, signal, onDelta: delta});
          record({provider: result.provider, model: result.model, status: 200, duration_ms: result.duration_ms, error_code: null});
        } catch (error) {
          record({provider: policy.slots[0].provider, model: policy.slots[0].model, status: error.status || 0,
            duration_ms: Date.now() - cloudStarted, error_code: safeCode(error.code)});
          if (signal.aborted || error.partial || !['CLOUDFLARE_NEURONS_EXHAUSTED', 'MODEL_UPSTREAM_CAPACITY',
            'MODEL_RATE_LIMITED', 'MODEL_TIMEOUT', 'MODEL_UPSTREAM_FAILED', 'MODEL_PROVIDER_FAILURE',
            'CLOUDFLARE_PLAN_REQUIRED', 'MODEL_STREAM_INTERRUPTED', 'MODEL_STREAM_FAILED'].includes(error.code)) throw error;
          const backupSlot = reserved.backup_slot;
          if (!['A', 'B'].includes(backupSlot)) fail('GATEWAY_POLICY_INVALID');
          const otherSlot = backupSlot === 'A' ? 'B' : 'A';
          const backupEnv = {...env, LLM_PRIMARY: backupSlot, [`LLM_${otherSlot}_PROVIDER`]: undefined};
          result = await routeProviders(backupEnv, messages, {...transport, phase: binding.phase, stream, signal,
            requestId: request_id, maxTotalAttempts: 1, onDelta: delta, onAttempt: record});
        }
      } else result = await routeProviders(env, messages, {...transport, phase: binding.phase, stream, signal,
        requestId: request_id, onDelta: delta, onAttempt: record});
      if (!result.provider_response_id) fail('MODEL_RECEIPT_MISSING');
      text = result.text;
      signal.throwIfAborted();
      status = 'COMPLETE';
      return {text, receipt: {request_id, request_hash, ...binding, provider: result.provider, model: result.model,
        reported_model: result.reported_model || null, provider_response_id: result.provider_response_id,
        usage: result.usage, finish_reason: result.finish_reason || 'NOT_REPORTED', prompt_version: PROMPT_VERSION,
        stream, delta_count, first_delta_at, last_delta_at, duration_ms: Date.now() - started,
        retry_count: attempts.length - 1, attempts: attempts.length, completed: true}};
    } catch (error) {
      status = signal.aborted ? 'ABORTED' : error.code === 'MODEL_TIMEOUT' ? 'TIMEOUT' : 'ERROR';
      error_code = signal.aborted ? 'MODEL_ABORTED' : safeCode(error.code);
      throw error;
    } finally {
      const selected = attempts.at(-1) || firstSlot;
      try {onEvent({type: 'result', request_id, phase: binding.phase, status, error_code,
        provider: selected.provider, model: selected.model, provider_response_id: result?.provider_response_id || null,
        reported_model: result?.reported_model || null, usage: result?.usage || null,
        attempts, finish_reason: result?.finish_reason || 'NOT_REPORTED', terminal_marker: stream && status === 'COMPLETE',
        duration_ms: Date.now() - started, retry_count: Math.max(0, attempts.length - 1), output_hash: sha(text)});}
      finally {await gate(env, 'receipt', {lease, request_id, request_hash, phase: binding.phase,
        provider: selected.provider, model: selected.model, provider_response_id: result?.provider_response_id || null,
        usage: result?.usage || null, duration_ms: Date.now() - started, status, error_code,
        attempt_count: attempts.length, attempts});}
    }
  }
  return {
    evaluate(messages, options) {
      if (!Array.isArray(messages) || messages.length !== 2 || messages[0]?.role !== 'system' || messages[1]?.role !== 'user' ||
        messages.some(m => typeof m.content !== 'string' || Object.keys(m).some(k => !['role', 'content'].includes(k)))) fail('INVALID_EVALUATION_REQUEST');
      return invoke(messages, {...options, stream: true});
    },
    async plan(context, options) {
      const request = buildModelRequest('plan', context, maxChars, maxInputTokens), result = await invoke(request.messages, {...options, clipping: request.clipping});
      let value;
      try {value = JSON.parse(result.text.replace(/^```(?:json)?\s*|\s*```$/g, ''));} catch {fail('MODEL_PLAN_INVALID');}
      return {value, receipt: result.receipt};
    },
    answer(context, options) {
      const request = buildModelRequest('answer', context, maxChars, maxInputTokens);
      return invoke(request.messages, {...options, clipping: request.clipping, stream: true});
    },
  };
}

export function createModelGateway(env, lease, transport) {
  const policy = gatewayPolicy(env);
  return policy.mode === 'cloudflare' ? createCloudModel(env, lease) : externalModel(env, lease, policy, transport);
}
