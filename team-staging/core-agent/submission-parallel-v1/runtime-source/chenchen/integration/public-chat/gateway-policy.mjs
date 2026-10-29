import {providerSlot, ProviderError} from './provider-adapter.mjs';

export const CLOUD_PROVIDER = 'cloudflare_workers_ai';
export const CLOUD_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const CALL_RESERVATION_MICRO_CNY = 100_000; // Existing 10-fen bound, not new spending authority.
export const MAX_OUTPUT_TOKENS = 1_024;
export const CLOUD_CONTEXT_TOKENS = 24_000;
export const CLOUD_MAX_INPUT_TOKENS = CLOUD_CONTEXT_TOKENS - MAX_OUTPUT_TOKENS;
export const TOKEN_FRAMING_ALLOWANCE = 512;
export const CLOUD_PRICES = Object.freeze({input: 0.293, output: 2.253, fx: 10});
// Each UTF-8 byte can contribute at most one ordinary text token. The 512-token
// allowance covers message framing; an anomalous usage report never refunds the
// reservation. This bound must be checked against real provider usage in staging.
export const inputTokenBound = maxMessageChars => 3 * maxMessageChars + TOKEN_FRAMING_ALLOWANCE;
export const requestInputTokenBound = messages => new TextEncoder().encode(JSON.stringify(messages)).length + TOKEN_FRAMING_ALLOWANCE;

const invalid = () => new ProviderError('GATEWAY_POLICY_INVALID');
const number = value => {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) throw invalid();
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 100) throw invalid();
  return n;
};
const integer = (value, max) => {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max) throw invalid();
  return Number(value);
};

export function estimatedMicroCny(usage, prices) {
  const input = usage?.prompt_tokens ?? usage?.input_tokens;
  const output = usage?.completion_tokens ?? usage?.output_tokens;
  if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0) throw invalid();
  if (prices.currency === 'CNY') {
    if (prices.fx !== 1) throw invalid();
    // Prices are CNY per million tokens; the result is micro-CNY. Integer
    // arithmetic avoids rounding 0.1 + 0.2 up to an extra micro-CNY.
    const scaled = value => {
      number(String(value));
      const [whole, fraction = ''] = String(value).split('.');
      return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
    };
    const numerator = BigInt(input) * scaled(prices.input) + BigInt(output) * scaled(prices.output);
    const micro = Number((numerator + 999_999n) / 1_000_000n);
    if (!Number.isSafeInteger(micro)) throw invalid();
    return micro;
  }
  if (prices.currency !== undefined && prices.currency !== 'USD') throw invalid();
  return Math.ceil((input * prices.input + output * prices.output) * prices.fx);
}

function slotPrices(env, slot, provider) {
  const prefix = `LLM_${slot}_`;
  const currency = env[prefix + 'PRICE_CURRENCY'] ?? 'USD';
  if (!['CNY', 'USD'].includes(currency) || provider === 'bailian' && currency !== 'CNY') throw invalid();
  const other = currency === 'CNY' ? 'USD' : 'CNY';
  if (env[prefix + `INPUT_${other}_PER_MILLION`] != null || env[prefix + `OUTPUT_${other}_PER_MILLION`] != null) throw invalid();
  return {currency, input: number(env[prefix + `INPUT_${currency}_PER_MILLION`]),
    output: number(env[prefix + `OUTPUT_${currency}_PER_MILLION`]),
    fx: currency === 'CNY' ? 1 : number(env.LLM_CNY_PER_USD_CAP)};
}

export function gatewayPolicy(env) {
  if (env.LLM_GATEWAY_MODE == null || env.LLM_GATEWAY_MODE === 'cloudflare') {
    return {mode: 'cloudflare', slots: [{provider: CLOUD_PROVIDER, model: CLOUD_MODEL,
      prices: CLOUD_PRICES, max_output_tokens: MAX_OUTPUT_TOKENS, max_attempts: 1,
      max_input_tokens: CLOUD_MAX_INPUT_TOKENS, max_message_chars: 12_000}], max_micro_cny: CALL_RESERVATION_MICRO_CNY};
  }
  const hybrid = env.LLM_GATEWAY_MODE === 'hybrid';
  if (!['external', 'hybrid'].includes(env.LLM_GATEWAY_MODE) || env.LLM_PAID_PROVIDER_APPROVED !== 'true') throw invalid();
  const primary = env.LLM_PRIMARY === 'B' ? 'B' : 'A';
  const slots = hybrid ? [{provider: CLOUD_PROVIDER, model: CLOUD_MODEL, prices: CLOUD_PRICES,
    max_output_tokens: MAX_OUTPUT_TOKENS, max_attempts: 1, max_input_tokens: CLOUD_MAX_INPUT_TOKENS,
    max_message_chars: 12_000, temperature: 0}] : [];
  for (const slot of [primary, primary === 'A' ? 'B' : 'A']) {
    if (!env[`LLM_${slot}_PROVIDER`]) {
      if (slot === primary) throw invalid();
      continue;
    }
    const config = providerSlot(env, slot);
    if (env[`LLM_${slot}_BILLING_BOUNDS_VERIFIED`] !== 'true') throw invalid();
    const prices = slotPrices(env, slot, config.provider);
    const max_input_tokens = inputTokenBound(config.maxMessageChars);
    const max_micro_cny = estimatedMicroCny({prompt_tokens: max_input_tokens, completion_tokens: config.maxOutputTokens}, prices);
    slots.push({slot, provider: config.provider, model: config.model, prices, max_micro_cny, max_output_tokens: config.maxOutputTokens,
      max_attempts: hybrid ? 1 : config.maxAttempts, max_duration_ms: config.connectTimeoutMs + config.responseTimeoutMs,
      max_message_chars: config.maxMessageChars, max_input_tokens, temperature: config.temperature, json_mode: config.jsonMode,
      ...(config.enableThinking === false ? {enable_thinking: false} : {}),
      daily_max_calls: integer(env[`LLM_${slot}_DAILY_MAX_CALLS`], 1000), daily_cap_micro_cny: integer(env[`LLM_${slot}_DAILY_CAP_CENTS`], 1000) * 10_000});
  }
  if (new Set(slots.map(slot => `${slot.provider}:${slot.model}`)).size !== slots.length) throw invalid();
  if (hybrid && slots.length < 2) throw invalid();
  // Hybrid allows one Workers AI attempt and at most one external backup.
  const maximumSlotCost = slot => slot.max_micro_cny ?? estimatedMicroCny({prompt_tokens: slot.max_input_tokens, completion_tokens: slot.max_output_tokens}, slot.prices);
  const possibleCosts = slots.map(slot => maximumSlotCost(slot) * slot.max_attempts);
  if (!hybrid && slots.length === 2) possibleCosts.push(slots[0].max_micro_cny + slots[1].max_micro_cny);
  if (hybrid) for (const slot of slots.slice(1)) possibleCosts.push(maximumSlotCost(slots[0]) + maximumSlotCost(slot));
  const max_micro_cny = Math.max(...possibleCosts);
  if (!hybrid && max_micro_cny > CALL_RESERVATION_MICRO_CNY) throw invalid();
  if (!slots.length || 2 * Math.max(...slots.map(slot => slot.max_duration_ms || 70_000)) > 140_000) throw invalid();
  return {mode: hybrid ? 'hybrid' : 'external', slots, max_micro_cny};
}

export function reservationForInput(policy, inputTokens, backupSlot = null) {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < TOKEN_FRAMING_ALLOWANCE || inputTokens > 100_000) throw invalid();
  const slotCosts = policy.slots.map(slot => {
    if (inputTokens > slot.max_input_tokens) throw new ProviderError('CHAT_CONTEXT_TOO_LONG');
    return estimatedMicroCny({prompt_tokens: inputTokens, completion_tokens: slot.max_output_tokens}, slot.prices);
  });
  const possible = policy.mode === 'hybrid' && backupSlot ? [slotCosts[0]] :
    slotCosts.map((cost, index) => cost * policy.slots[index].max_attempts);
  if (policy.mode === 'hybrid') {
    const backups = backupSlot ? policy.slots.slice(1).map((slot, index) => ({slot, index: index + 1})).filter(item => item.slot.slot === backupSlot) :
      policy.slots.slice(1).map((slot, index) => ({slot, index: index + 1}));
    if (!backups.length) throw invalid();
    for (const backup of backups) possible.push(slotCosts[0] + slotCosts[backup.index]);
  }
  else if (slotCosts.length === 2) possible.push(slotCosts[0] + slotCosts[1]);
  const micro = Math.max(...possible);
  // A preliminary hybrid quote may include an expensive backup that will not
  // be selected. Enforce the per-call ceiling only after the gate chooses one.
  if (!Number.isSafeInteger(micro) || micro < 1 || (policy.mode !== 'hybrid' || backupSlot) && micro > CALL_RESERVATION_MICRO_CNY) throw invalid();
  return {micro, slot_costs: slotCosts};
}
