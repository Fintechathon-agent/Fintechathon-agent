// Internal Durable Object only. The public Worker must never forward arbitrary gate routes.
// Every paid call reserves its full conservative bound before provider access. Verified
// usage can reduce the estimate; incomplete calls keep their entire reservation.
// Neither usage estimates nor reservations are a platform invoice.
import {CLOUD_PROVIDER as PROVIDER, CLOUD_MODEL as MODEL, gatewayPolicy, estimatedMicroCny, reservationForInput} from './gateway-policy.mjs';
const CALL_CENTS = 10;
const CALL_MICRO = CALL_CENTS * 10_000;
const LEASE_MS = 180_000;
const MINUTE = 60_000;
const DAY = 86_400_000;
const TERMINAL = new Set(['COMPLETE', 'ERROR', 'TIMEOUT', 'ABORTED', 'IDENTITY_REJECTED', 'UNKNOWN']);
const error = (code, message, status = 400) => Object.assign(new Error(message), {code, status});
const id = (value, name) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw error('INVALID_REQUEST', `${name} 无效。`);
  return value;
};
const hash = (value, name) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw error('INVALID_REQUEST', `${name} 必须是哈希。`);
  return value.toLowerCase();
};
const beijingDay = ms => new Date(ms + 8 * 3_600_000).toISOString().slice(0, 10);
const initial = () => ({version: 2, used_micro_cny: 0, call_count: 0, receipt_count: 0, completed_count: 0, settled_count: 0, by_day: {}, daily_model_stats: {}, provider_by_day: {}, active: {}, owner_rate: {}, ip_rate: {}});

function config(env) {
  const cents = key => {
    const text = String(env[key] ?? '');
    if (!/^\d+$/.test(text)) throw error('BUDGET_CONFIG_INVALID', '服务预算未正确配置，暂不接受新的模型请求。', 503);
    const n = Number(text);
    // Existing human authorization is 10 CNY in total. A cloud allocation must be
    // carved out of that amount, never silently treated as an additional 10 CNY.
    if (!Number.isSafeInteger(n) || n < CALL_CENTS || n > 1000) throw error('BUDGET_CONFIG_INVALID', '服务预算超出已授权范围。', 503);
    return n;
  };
  const cap = cents('DEMO_BUDGET_CENTS'), daily = cents('DAILY_BUDGET_CENTS');
  const date = key => {
    const value = env[key];
    if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw error('BUDGET_CONFIG_INVALID', '服务运行期限未正确配置。', 503);
    return Date.parse(value);
  };
  const start = date('DEMO_START_AT'), end = date('DEMO_END_AT');
  if (daily > cap || end - start < 15 * DAY) throw error('BUDGET_CONFIG_INVALID', '预算或至少十五天的运行期限未正确配置。', 503);
  return {cap, daily, start, end};
}

function receipt(input, reservation, now) {
  const reservedMicro = reservation.reserved_micro_cny ?? CALL_MICRO;
  const policy = reservation.policy || {mode: 'cloudflare', slots: [{provider: PROVIDER, model: MODEL}]};
  const selected = policy.slots.find(slot => slot.provider === input.provider && slot.model === input.model);
  if (!selected) throw error('MODEL_IDENTITY_INVALID', '模型身份与已授权配置不一致。', 409);
  if (!TERMINAL.has(input.status)) throw error('INVALID_REQUEST', '调用状态无效。');
  if (!Number.isInteger(input.duration_ms) || input.duration_ms < 0 || input.duration_ms > LEASE_MS) throw error('INVALID_REQUEST', '调用时长无效。');
  const usage = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'input_tokens', 'output_tokens']) {
    const n = input.usage?.[key];
    if (n === undefined) continue;
    if (!Number.isInteger(n) || n < 0 || n > 100_000) throw error('INVALID_REQUEST', 'Token 用量无效。');
    usage[key] = n;
  }
  let responseId = null;
  if (input.provider_response_id != null) responseId = id(input.provider_response_id, 'provider_response_id');
  let attempts = null;
  if (policy.mode !== 'cloudflare') {
    if (!Array.isArray(input.attempts) || input.attempts.length > 2 || input.attempt_count !== input.attempts.length || (!input.attempts.length && input.status === 'COMPLETE')) throw error('INVALID_REQUEST', '模型尝试记录不完整。');
    let lastIndex = -1;
    const counts = new Map();
    attempts = input.attempts.map(attempt => {
      const index = policy.slots.findIndex(slot => slot.provider === attempt.provider && slot.model === attempt.model);
      const allowed = policy.slots[index];
      if (!allowed) throw error('MODEL_IDENTITY_INVALID', '备用模型与预留策略不一致。', 409);
      if (index < lastIndex) throw error('MODEL_IDENTITY_INVALID', '模型尝试顺序与预留策略不一致。', 409);
      lastIndex = index;
      counts.set(index, (counts.get(index) || 0) + 1);
      if (counts.get(index) > allowed.max_attempts) throw error('MODEL_IDENTITY_INVALID', '模型重试超过预留策略。', 409);
      if (!allowed || attempt.provider !== allowed.provider || attempt.model !== allowed.model || !Number.isInteger(attempt.duration_ms) || attempt.duration_ms < 0 || attempt.duration_ms > LEASE_MS || !Number.isInteger(attempt.http_status) || attempt.http_status < 0 || attempt.http_status > 599) throw error('MODEL_IDENTITY_INVALID', '备用模型或请求记录与预留策略不一致。', 409);
      return {provider: allowed.provider, model: allowed.model, http_status: attempt.http_status, duration_ms: attempt.duration_ms,
        error_code: typeof attempt.error_code === 'string' && /^[A-Z][A-Z0-9_]{0,80}$/.test(attempt.error_code) ? attempt.error_code : null};
    });
    if (attempts.length && (attempts.at(-1).provider !== input.provider || attempts.at(-1).model !== input.model)) throw error('MODEL_IDENTITY_INVALID', '最终模型与尝试记录不一致。', 409);
    if (policy.mode === 'hybrid' && attempts.length && (attempts[0].provider !== PROVIDER || attempts.slice(1).some(attempt =>
      attempt.provider !== policy.slots.find(slot => slot.slot === reservation.authorized_backup_slot)?.provider ||
      attempt.model !== policy.slots.find(slot => slot.slot === reservation.authorized_backup_slot)?.model))) throw error('MODEL_IDENTITY_INVALID', '混合模式只允许已预留的备用模型。', 409);
    if (input.status === 'COMPLETE' && (!attempts.length || attempts.at(-1).http_status < 200 || attempts.at(-1).http_status >= 300 || attempts.at(-1).error_code)) throw error('INVALID_REQUEST', '成功状态与上游响应不一致。');
  }
  // Missing or out-of-bound usage cannot reduce a reservation. The legacy
  // Cloudflare estimate uses FX=10 and official $0.293/$2.253 per million rates;
  // external price and FX caps are validated in the stored reservation policy.
  const p = usage.prompt_tokens, c = usage.completion_tokens;
  const consistentUsage = (usage.total_tokens === undefined || usage.total_tokens === p + c) &&
    (usage.input_tokens === undefined || usage.input_tokens === p) &&
    (usage.output_tokens === undefined || usage.output_tokens === c);
  const inputLimit = reservation.input_bound_tokens ?? selected.max_input_tokens ?? 24_000;
  const validUsage = input.status === 'COMPLETE' && input.attempt_count === 1 && responseId && consistentUsage &&
    Number.isInteger(p) && p > 0 && p <= inputLimit && Number.isInteger(c) && c >= 0 && c <= (selected.max_output_tokens || 1024);
  const estimated = validUsage ? (policy.mode === 'cloudflare' ? Math.ceil((p * 293 + c * 2253) / 100) : estimatedMicroCny(usage, selected.prices)) : reservedMicro;
  const settled = validUsage && estimated <= reservedMicro;
  // Explicit allowlist: never persist request text, errors with financial content,
  // credentials, headers, raw IPs, complete responses, or arbitrary caller fields.
  return {
    at: new Date(now).toISOString(), request_id: reservation.request_id,
    provider: input.provider, model: input.model, phase: reservation.phase,
    usage: Object.keys(usage).length ? usage : null,
    duration_ms: input.duration_ms, status: input.status,
    error_code: typeof input.error_code === 'string' && /^[A-Z][A-Z0-9_]{0,80}$/.test(input.error_code) ? input.error_code : null,
    provider_response_id: responseId, retry_count: Math.max(0, (input.attempt_count ?? 1) - 1), attempt_count: [0, 1, 2].includes(input.attempt_count) ? input.attempt_count : null,
    ...(attempts ? {attempts} : {}),
    reserved_cents: reservedMicro / 10_000, reserved_micro_cny: reservedMicro, charged_micro_cny: settled ? estimated : reservedMicro,
    usage_estimate_verified: Boolean(settled),
    cost_basis: settled ? (policy.mode === 'cloudflare' ? 'USAGE_ESTIMATE_FX_10_NOT_INVOICE' :
      selected.prices.currency === 'CNY' ? 'USAGE_ESTIMATE_CNY_NOT_INVOICE' : 'USAGE_ESTIMATE_CONFIGURED_FX_NOT_INVOICE') : 'CONSERVATIVE_RESERVATION_NOT_INVOICE',
  };
}

export class ChatGate {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  now() { return Date.now(); }

  async admit(body) {
    const ip = hash(body.ip_hash, 'ip_hash');
    if (!['session', 'create', 'read', 'mutation', 'stream', 'account'].includes(body.kind)) throw error('INVALID_REQUEST', '请求类型无效。');
    const window = Math.floor(this.now() / MINUTE);
    // This separate fixed-minute ledger never inspects or changes the AI ledger.
    // At most 1200 IP keys exist per window, including at minute rollover. The
    // bounded index fits one DO value; individual IP counters are separate values.
    return this.ctx.storage.transaction(async txn => {
      let global = await txn.get('admission');
      if (!global || global.window !== window) {
        const old = global?.ips || [];
        for (let offset = 0; offset < old.length; offset += 100) await txn.delete(old.slice(offset, offset + 100).map(value => `admit-ip:${value}`));
        global = {window, count: 0, ips: []};
      }
      if (global.count >= 1200) throw error('GLOBAL_RATE_LIMIT', '当前访问量较大，请一分钟后重试。', 429);
      const key = `admit-ip:${ip}`;
      let counters = await txn.get(key);
      if (!counters || counters.window !== window) counters = {window, count: 0, create: 0, session: 0};
      if (counters.count >= 120 || (body.kind === 'create' && counters.create >= 5) || (body.kind === 'session' && counters.session >= 15)) throw error('RATE_LIMIT', '当前网络请求过于频繁，请一分钟后重试。', 429);
      if (!counters.count) global.ips.push(ip);
      counters.count++; global.count++;
      if (body.kind === 'create') counters.create++;
      if (body.kind === 'session') counters.session++;
      await txn.put(key, counters);
      await txn.put('admission', global);
      return {ok: true};
    });
  }

  async fetch(request) {
    if (request.method !== 'POST') return Response.json({ok: false, code: 'METHOD_NOT_ALLOWED'}, {status: 405});
    const route = new URL(request.url).pathname.slice(1);
    if (!['admit', 'begin', 'reserve', 'receipt', 'release', 'status'].includes(route)) return Response.json({ok: false, code: 'NOT_FOUND'}, {status: 404});
    try {
      if (Number(request.headers.get('content-length')) > 8192) throw error('REQUEST_TOO_LARGE', '请求过长。', 413);
      const text = await request.text();
      if (text.length > 8192) throw error('REQUEST_TOO_LARGE', '请求过长。', 413);
      let body;
      try { body = JSON.parse(text); } catch { throw error('INVALID_REQUEST', '请求格式无效。'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw error('INVALID_REQUEST', '请求格式无效。');
      // Reading existing history must remain available even if paid-call config
      // is disabled, invalid, expired, or exhausted.
      if (route === 'admit') return Response.json(await this.admit(body));
      const cfg = config(this.env), now = this.now();
      const result = await this.ctx.storage.transaction(async txn => {
        const meta = await txn.get('meta') || initial();
        if (meta.version !== 2) throw error('BUDGET_LEDGER_VERSION', '费用账本版本不一致，暂不接受新的调用。', 503);
        // Additive operational counters only; never replace existing spend, dates,
        // reservations, or caps when an older version-2 object resumes.
        meta.settled_count ??= 0;
        meta.daily_model_stats ??= {};
        meta.provider_by_day ??= {};
        // Retain deployment period and monotonic budget caps across evictions and
        // redeploys. Renaming an object to reset its ledger is not a budget increase.
        if (meta.config && (meta.config.start !== cfg.start || meta.config.end !== cfg.end || cfg.cap > meta.config.cap || cfg.daily > meta.config.daily)) throw error('BUDGET_CONFIG_CHANGED', '持久预算配置与部署配置不一致；不能重置运行期限或提高额度。', 503);
        meta.config = cfg;
        for (const [leaseId, active] of Object.entries(meta.active)) {
          if (active.expires_at <= now) {
            const lease = await txn.get(`lease:${leaseId}`);
            if (lease && !lease.released_at) await txn.put(`lease:${leaseId}`, {...lease, released_at: now, status: 'EXPIRED'});
            delete meta.active[leaseId];
          }
        }
        for (const rates of [meta.owner_rate, meta.ip_rate]) for (const [key, timestamps] of Object.entries(rates)) {
          rates[key] = timestamps.filter(t => t > now - MINUTE);
          if (!rates[key].length) delete rates[key];
        }
        const today = beijingDay(now);
        const dailyStats = day => meta.daily_model_stats[day] ||= {reserved_calls: 0, receipts: 0, failed_calls: 0, provider_attempts: 0, input_tokens: 0, output_tokens: 0, usage_reported_calls: 0, estimated_micro_cny: 0, tracking_started_at: new Date(now).toISOString()};
        const paidAllowed = (requiredMicro = 1) => {
          if (now < cfg.start) throw error('DEMO_NOT_STARTED', '服务尚未开始接受模型请求。', 403);
          if (now >= cfg.end) throw error('DEMO_ENDED', '本次演示期已结束，历史对话仍可查看。', 403);
          if (meta.used_micro_cny + requiredMicro > cfg.cap * 10_000) throw error('DEMO_BUDGET_EXHAUSTED', '本次演示模型额度已用完，历史对话仍可查看。', 429);
          if ((meta.by_day[today] || 0) + requiredMicro > cfg.daily * 10_000) throw error('DAILY_BUDGET_EXHAUSTED', '本站今日模型费用上限已触发，请在北京时间次日重试。历史对话仍可查看。', 429);
        };
        let output;
        if (route === 'status') {
          output = {ok: true, provider: PROVIDER, model: MODEL, stage_allocation_cents: cfg.cap, daily_cap_cents: cfg.daily,
            used_micro_cny: meta.used_micro_cny, used_cents: meta.used_micro_cny / 10_000, conservative_used_cny: meta.used_micro_cny / 1_000_000,
            remaining_cents: Math.max(0, cfg.cap - meta.used_micro_cny / 10_000), today_used_cents: (meta.by_day[today] || 0) / 10_000,
            day_timezone: 'Asia/Shanghai', day: today, call_count: meta.call_count, receipt_count: meta.receipt_count,
            complete_count: meta.completed_count, incomplete_count: meta.call_count - meta.completed_count,
            usage_settled_count: meta.settled_count, full_reservation_count: meta.call_count - meta.settled_count,
            recent_receipts: (meta.recent_receipts || []).slice(-20),
            active_count: Object.keys(meta.active).length, max_active: 10, per_call_reserved_cents: null,
            legacy_per_call_reserved_cents: CALL_CENTS, reservation_strategy: 'INPUT_BOUND_OUTPUT_CAP_WITH_LEGACY_FALLBACK',
            today_model_stats: meta.daily_model_stats[today] || {reserved_calls: 0, receipts: 0, failed_calls: 0, provider_attempts: 0, input_tokens: 0, output_tokens: 0, usage_reported_calls: 0, estimated_micro_cny: 0, tracking_started_at: null},
            today_provider_usage: Object.entries(meta.provider_by_day[today] || {}).map(([identity, value]) => ({identity, reserved_or_charged_calls: value.calls, reserved_or_estimated_micro_cny: value.micro_cny})),
            start_at: new Date(cfg.start).toISOString(), end_at: new Date(cfg.end).toISOString(),
            accepting_calls: now >= cfg.start && now < cfg.end && meta.used_micro_cny < cfg.cap * 10_000 && (meta.by_day[today] || 0) < cfg.daily * 10_000,
            accepting_calls_requires_request_estimate: true,
            cost_basis: 'CONSERVATIVE_RESERVATIONS_PLUS_USAGE_ESTIMATES_NOT_INVOICE'};
        } else if (route === 'begin') {
          const owner = id(body.owner, 'owner'), ip = hash(body.ip_hash, 'ip_hash'), turn = id(body.turn_id, 'turn_id'), requestId = id(body.request_id, 'request_id');
          const existing = await txn.get(`begin:${requestId}`);
          if (existing) {
            if (existing.owner !== owner || existing.ip_hash !== ip || existing.turn_id !== turn) throw error('IDEMPOTENCY_CONFLICT', '重复请求的身份或内容不一致。', 409);
            output = {ok: true, lease: existing.lease, duplicate: true};
          } else {
            paidAllowed();
            if(body.evaluation_run){
              if(!this.env.QUALITY_EVAL_RUN||body.evaluation_run!==this.env.QUALITY_EVAL_RUN)throw error('EVALUATION_DISABLED','评测入口未启用。',403);
              const key='evaluation:'+body.evaluation_run,count=await txn.get(key)||0;
              if(count>=3)throw error('EVALUATION_CALL_LIMIT','本轮评测最多3次，不自动重试。',429);
              await txn.put(key,count+1);
            }
            if (Object.values(meta.active).some(x => x.owner === owner)) throw error('OWNER_BUSY', '当前访客已有回答正在生成，请等待或停止后重试。', 409);
            if (Object.keys(meta.active).length >= 10) throw error('CONCURRENCY_LIMIT', '当前服务繁忙，请稍后重试。', 429);
            if ((meta.owner_rate[owner]?.length || 0) >= 6 || (meta.ip_rate[ip]?.length || 0) >= 20) throw error('RATE_LIMIT', '请求过于频繁，请稍后重试。', 429);
            const lease = crypto.randomUUID(), expires = now + LEASE_MS;
            const entry = {lease, owner, ip_hash: ip, turn_id: turn, request_id: requestId, created_at: now, expires_at: expires, phases: [], calls: 0};
            await txn.put(`lease:${lease}`, entry);
            await txn.put(`begin:${requestId}`, {owner, ip_hash: ip, turn_id: turn, lease});
            meta.active[lease] = {owner, expires_at: expires};
            (meta.owner_rate[owner] ||= []).push(now); (meta.ip_rate[ip] ||= []).push(now);
            output = {ok: true, lease, duplicate: false, expires_at: new Date(expires).toISOString()};
          }
        } else {
          const leaseId = id(body.lease, 'lease'), lease = await txn.get(`lease:${leaseId}`);
          if (!lease) throw error('LEASE_NOT_FOUND', '请求凭证无效。', 404);
          if (route === 'release') {
            if (!TERMINAL.has(body.status)) throw error('INVALID_REQUEST', '结束状态无效。');
            if (!lease.released_at) { lease.released_at = now; lease.status = body.status; await txn.put(`lease:${leaseId}`, lease); }
            delete meta.active[leaseId];
            output = {ok: true, released: true};
          } else {
            const requestId = id(body.request_id, 'request_id'), key = `call:${requestId}`, call = await txn.get(key);
            if (route === 'reserve') {
              const requestHash = hash(body.request_hash, 'request_hash');
              if (!['plan', 'answer'].includes(body.phase)) throw error('PHASE_NOT_ALLOWED', '未授权的模型步骤。');
              const inputBound = body.input_bound_tokens == null ? null : body.input_bound_tokens;
              if (inputBound !== null && (!Number.isSafeInteger(inputBound) || inputBound < 512 || inputBound > 100_000)) throw error('INVALID_REQUEST', '模型输入预算无效。');
              const preferredBackup = body.preferred_backup_slot == null ? null : body.preferred_backup_slot;
              if (preferredBackup !== null && !['A', 'B'].includes(preferredBackup)) throw error('INVALID_REQUEST', '备用模型选择无效。');
              if (call) {
                if (call.lease !== leaseId || call.request_hash !== requestHash || call.phase !== body.phase || (call.input_bound_tokens ?? null) !== inputBound) throw error('IDEMPOTENCY_CONFLICT', '重复模型请求与已有记录不一致。', 409);
                output = {ok: true, request_id: requestId, reserved_cents: (call.reserved_micro_cny ?? CALL_MICRO) / 10_000, duplicate: true, call_allowed: false, receipt_status: call.receipt?.status || 'UNKNOWN'};
              } else {
                if (lease.released_at || lease.expires_at <= now) throw error('LEASE_EXPIRED', '本次请求已结束，请主动重试。', 409);
                if (lease.calls >= 2 || lease.phases.includes(body.phase)) throw error('AGENT_STEP_LIMIT', '本次请求已达到模型调用上限。', 429);
                const policy = gatewayPolicy(this.env);
                let bound = inputBound === null ? {micro: CALL_MICRO, slot_costs: policy.slots.map(slot => slot.max_micro_cny || CALL_MICRO)} : reservationForInput(policy, inputBound);
                let authorizedBackupSlot = null;
                if (policy.mode !== 'cloudflare') {
                  const providerDay = meta.provider_by_day[today] ||= {};
                  const available = ([index, slot]) => {
                    if (policy.mode === 'hybrid' && inputBound !== null && bound.slot_costs[0] + bound.slot_costs[index] > CALL_MICRO) return false;
                    const identity = `${slot.provider}:${slot.model}`, row = providerDay[identity] || {calls: 0, micro_cny: 0};
                    return row.calls + slot.max_attempts <= slot.daily_max_calls && row.micro_cny + slot.max_attempts * bound.slot_costs[index] <= slot.daily_cap_micro_cny;
                  };
                  const candidates = policy.slots.map((slot, index) => [index, slot]).filter(([, slot]) => slot.provider !== PROVIDER);
                  if (policy.mode === 'hybrid' && preferredBackup) candidates.sort((a, b) => Number(b[1].slot === preferredBackup) - Number(a[1].slot === preferredBackup));
                  const selected = policy.mode === 'hybrid' ? candidates.find(available) : null;
                  if ((policy.mode === 'hybrid' && !selected) || (policy.mode === 'external' && candidates.some(candidate => !available(candidate)))) throw error('MODEL_DAILY_LIMIT', '所选模型的独立日限额已用完，未发起上游请求。', 429);
                  authorizedBackupSlot = selected?.[1].slot || null;
                  if (inputBound !== null && policy.mode === 'hybrid') bound = reservationForInput(policy, inputBound, authorizedBackupSlot);
                  paidAllowed(bound.micro);
                  for (const [index, slot] of policy.mode === 'hybrid' ? [selected] : candidates) {
                    const identity = `${slot.provider}:${slot.model}`, row = providerDay[identity] ||= {calls: 0, micro_cny: 0};
                    row.calls += slot.max_attempts;row.micro_cny += slot.max_attempts * bound.slot_costs[index];
                  }
                }
                else paidAllowed(bound.micro);
                lease.calls++; lease.phases.push(body.phase);
                await txn.put(`lease:${leaseId}`, lease);
                await txn.put(key, {lease: leaseId, request_id: requestId, phase: body.phase, request_hash: requestHash, at: new Date(now).toISOString(), day: today,
                  reserved_cents: bound.micro / 10_000, reserved_micro_cny: bound.micro, input_bound_tokens: inputBound,
                  provider_slot_costs: bound.slot_costs, authorized_backup_slot: authorizedBackupSlot, policy});
                meta.used_micro_cny += bound.micro; meta.call_count++; meta.by_day[today] = (meta.by_day[today] || 0) + bound.micro;
                dailyStats(today).reserved_calls++;
                output = {ok: true, request_id: requestId, reserved_cents: bound.micro / 10_000, reserved_micro_cny: bound.micro, backup_slot: authorizedBackupSlot, duplicate: false, call_allowed: true};
              }
            } else {
              if (!call || call.lease !== leaseId) throw error('RESERVATION_NOT_FOUND', '调用缺少匹配的费用预留。', 409);
              const safe = receipt(body, call, now);
              if (call.receipt) {
                const equal = ({at, ...x}) => JSON.stringify(x);
                if (equal(safe) !== equal(call.receipt)) throw error('RECEIPT_CONFLICT', '调用已有不同的结果记录。', 409);
                output = {ok: true, duplicate: true, reserved_cents: (call.reserved_micro_cny ?? CALL_MICRO) / 10_000, charged_micro_cny: call.receipt.charged_micro_cny};
              } else {
                call.receipt = safe; await txn.put(key, call);
                const released = (call.reserved_micro_cny ?? CALL_MICRO) - safe.charged_micro_cny;
                meta.used_micro_cny -= released;
                meta.by_day[call.day] = (meta.by_day[call.day] || 0) - released;
                if (call.policy && call.policy.mode !== 'cloudflare') {
                  const providerDay = meta.provider_by_day[call.day];
                  for (const [index, slot] of call.policy.slots.entries()) {
                    if (slot.provider === PROVIDER) continue;
                    if (call.policy.mode === 'hybrid' && slot.slot !== call.authorized_backup_slot) continue;
                    const row = providerDay[`${slot.provider}:${slot.model}`], actual = (safe.attempts || []).filter(attempt => attempt.provider === slot.provider && attempt.model === slot.model).length;
                    const slotCost = call.provider_slot_costs?.[index] ?? slot.max_micro_cny;
                    const charge = safe.usage_estimate_verified && actual === 1 && safe.provider === slot.provider && safe.model === slot.model ? safe.charged_micro_cny : actual * slotCost;
                    row.calls -= slot.max_attempts - actual;row.micro_cny -= slot.max_attempts * slotCost - charge;
                  }
                }
                meta.receipt_count++; if (safe.status === 'COMPLETE') meta.completed_count++;
                if (safe.usage_estimate_verified) meta.settled_count++;
                const stats = dailyStats(call.day);stats.receipts++;stats.provider_attempts += safe.attempt_count ?? 1;
                if (safe.status !== 'COMPLETE') stats.failed_calls++;
                if (safe.usage) {stats.input_tokens += safe.usage.prompt_tokens ?? safe.usage.input_tokens ?? 0;stats.output_tokens += safe.usage.completion_tokens ?? safe.usage.output_tokens ?? 0;stats.usage_reported_calls++;}
                stats.estimated_micro_cny += safe.charged_micro_cny;
                meta.recent_receipts = [...(meta.recent_receipts || []), safe].slice(-20);
                output = {ok: true, duplicate: false, reserved_cents: (call.reserved_micro_cny ?? CALL_MICRO) / 10_000, charged_micro_cny: safe.charged_micro_cny};
              }
            }
          }
        }
        await txn.put('meta', meta);
        return output;
      });
      return Response.json(result);
    } catch (e) {
      return Response.json({ok: false, code: e.code || 'GATE_UNAVAILABLE', message: e.code ? e.message : '费用保护服务暂时不可用，请稍后重试。'}, {status: e.status || 503});
    }
  }
}
