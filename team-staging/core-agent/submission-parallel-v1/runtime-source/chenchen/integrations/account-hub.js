'use strict';

const crypto = require('node:crypto');

const VERSION = 'account-hub.v1';
const MAX_ACCOUNTS = 20;
const MAX_ENTRIES = 50;
const PLATFORMS = Object.freeze(['bank', 'fund', 'wallet', 'credit_card', 'ledger']);
const ACCOUNT_TYPES = Object.freeze(['bank', 'brokerage', 'fund', 'wallet', 'credit_card', 'ledger']);
const ENTRY_KINDS = Object.freeze(['holding', 'cash', 'obligation', 'income', 'expense']);
const RESERVED_KEYS = /password|passwd|secret|token|api[_-]?key|authorization|cookie|private[_-]?key|credential/i;

function fail(code, message = code, status = 422) {
  throw Object.assign(new Error(message), { code, status });
}

function clone(value) {
  return structuredClone(value);
}

function text(value, field, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail('ACCOUNT_FIELD_INVALID', field);
  return value.trim();
}

function id(value, field = 'account_id') {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) fail('ACCOUNT_ID_INVALID', field);
  return value;
}

function cents(value, field) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000_000_00) fail('ACCOUNT_AMOUNT_INVALID', field);
  return value;
}

function date(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('ACCOUNT_DATE_INVALID', field);
  return value;
}

function rejectCredentials(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (RESERVED_KEYS.test(key)) fail('ACCOUNT_CREDENTIALS_NOT_ALLOWED', '账户适配器不接收登录密码、密钥或 Token');
    if (child && typeof child === 'object') rejectCredentials(child);
  }
}

function normalizeSource(source = {}, {demo = false, asOf = null} = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('ACCOUNT_SOURCE_INVALID', 'source');
  const channel = source.channel || (demo ? 'DEMO_FIXTURE' : 'USER_ENTERED');
  if (!['USER_ENTERED', 'CSV_IMPORT', 'DEMO_FIXTURE', 'READ_ONLY_CONNECTOR'].includes(channel)) fail('ACCOUNT_SOURCE_INVALID', 'source.channel');
  const confirmed = source.confirmed === true;
  return {
    channel,
    label: text(source.label || (demo ? '合成演示数据' : '用户手工录入'), 'source.label', 80),
    as_of: date(source.as_of ?? asOf, 'source.as_of'),
    confirmed,
    data_status: demo ? 'DEMO' : confirmed ? 'CONFIRMED' : 'PENDING_CONFIRMATION',
  };
}

function normalizeEntry(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('ACCOUNT_ENTRY_INVALID', `entries[${index}]`);
  const kind = entry.kind || 'holding';
  if (!ENTRY_KINDS.includes(kind)) fail('ACCOUNT_ENTRY_INVALID', `entries[${index}].kind`);
  const amount = cents(entry.amount_cents, `entries[${index}].amount_cents`);
  return {
    entry_id: id(entry.entry_id, `entries[${index}].entry_id`) || `entry-${crypto.randomUUID()}`,
    label: text(entry.label || entry.name, `entries[${index}].label`, 100),
    kind,
    amount_cents: amount,
    due_on: date(entry.due_on, `entries[${index}].due_on`),
    status: entry.status === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING_CONFIRMATION',
  };
}

function normalizeAccount(input, {accountId = null, now = new Date().toISOString()} = {}) {
  rejectCredentials(input);
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('ACCOUNT_INPUT_INVALID', 'account');
  const platform = input.platform;
  const accountType = input.account_type || platform;
  if (!PLATFORMS.includes(platform)) fail('ACCOUNT_PLATFORM_UNSUPPORTED', 'platform');
  if (!ACCOUNT_TYPES.includes(accountType)) fail('ACCOUNT_TYPE_UNSUPPORTED', 'account_type');
  if (input.currency !== undefined && input.currency !== 'CNY') fail('ACCOUNT_CURRENCY_UNSUPPORTED', '当前账户适配器只接受人民币金额');
  const source = normalizeSource(input.source, {demo: input.demo === true, asOf: input.as_of});
  const entries = input.entries === undefined ? [] : input.entries;
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) fail('ACCOUNT_ENTRIES_LIMIT', `每个账户最多${MAX_ENTRIES}条明细`);
  const normalizedEntries = entries.map(normalizeEntry);
  const resolvedId = accountId || id(input.account_id) || `account-${crypto.randomUUID()}`;
  const balance = cents(input.balance_cents ?? 0, 'balance_cents');
  const available = cents(input.available_cents ?? balance, 'available_cents');
  const liability = cents(input.liability_cents ?? 0, 'liability_cents');
  if (available > balance && accountType !== 'credit_card') fail('ACCOUNT_BALANCE_CONFLICT', '可用金额不能大于账户金额');
  if (accountType === 'credit_card' && liability === 0 && balance > 0) fail('ACCOUNT_BALANCE_CONFLICT', '信用卡请把待还金额填入 liability_cents');
  return {
    account_id: resolvedId,
    display_name: text(input.display_name || input.name, 'display_name', 80),
    platform,
    account_type: accountType,
    currency: 'CNY',
    balance_cents: balance,
    available_cents: available,
    liability_cents: liability,
    entries: normalizedEntries,
    source,
    demo: input.demo === true,
    permissions: {read: 'OWNER_SESSION', write: 'SIMULATION_ONLY', real_actions: false},
    updated_at: typeof input.updated_at === 'string' ? input.updated_at : now,
  };
}

function emptyHub() {
  return {schema_version: VERSION, accounts: [], audit: [], idempotency: {}};
}

function ensureHub(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.accounts)) return emptyHub();
  return {
    schema_version: VERSION,
    accounts: value.accounts,
    audit: Array.isArray(value.audit) ? value.audit.slice(-100) : [],
    idempotency: value.idempotency && typeof value.idempotency === 'object' ? value.idempotency : {},
  };
}

function sortDue(entries) {
  return entries.filter(entry => entry.due_on && entry.kind === 'obligation')
    .sort((a, b) => a.due_on.localeCompare(b.due_on) || a.amount_cents - b.amount_cents)
    .slice(0, 8);
}

function summarize(accounts) {
  const totalAssets = accounts.reduce((sum, account) => sum + account.balance_cents, 0);
  const available = accounts.reduce((sum, account) => sum + account.available_cents, 0);
  const liabilities = accounts.reduce((sum, account) => sum + account.liability_cents, 0);
  const entries = accounts.flatMap(account => account.entries.map(entry => ({...entry, account_id: account.account_id, account_name: account.display_name, platform: account.platform})));
  const obligations = entries.filter(entry => entry.kind === 'obligation');
  const platforms = Object.fromEntries(PLATFORMS.map(platform => [platform, accounts.filter(account => account.platform === platform).length]));
  const confirmed = accounts.filter(account => account.source.data_status === 'CONFIRMED' || account.source.data_status === 'DEMO').length;
  return {
    total_assets_cents: totalAssets,
    available_cents: available,
    liabilities_cents: liabilities,
    net_worth_cents: totalAssets - liabilities,
    obligations_cents: obligations.reduce((sum, entry) => sum + entry.amount_cents, 0),
    upcoming_obligations: sortDue(obligations),
    by_platform: platforms,
    data_quality: {
      account_count: accounts.length,
      confirmed_account_count: confirmed,
      pending_account_count: accounts.length - confirmed,
      all_sources_confirmed: accounts.length > 0 && confirmed === accounts.length,
    },
    execution_allowed: false,
  };
}

function publicHub(value) {
  const hub = ensureHub(value);
  return {
    schema_version: VERSION,
    accounts: clone(hub.accounts),
    summary: summarize(hub.accounts),
    audit: clone(hub.audit.slice(-20)),
    execution_allowed: false,
  };
}

function addAudit(hub, operation, accountId, requestId, source) {
  hub.audit.push({
    audit_id: `audit-${crypto.randomUUID()}`,
    operation,
    account_id: accountId || null,
    request_id: requestId || null,
    source: source || 'ACCOUNT_HUB',
    at: new Date().toISOString(),
    execution_allowed: false,
  });
  hub.audit = hub.audit.slice(-100);
}

function upsert(hubValue, input, {requestId, idempotencyKey, now} = {}) {
  const hub = ensureHub(hubValue);
  if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(idempotencyKey)) fail('ACCOUNT_IDEMPOTENCY_REQUIRED', '请提供请求编号，避免重复保存');
  if (hub.idempotency[idempotencyKey]) return {hub, ...clone(hub.idempotency[idempotencyKey]), replayed: true};
  const existingId = input.account_id || null;
  const account = normalizeAccount(input, {accountId: existingId, now});
  const index = hub.accounts.findIndex(item => item.account_id === account.account_id);
  if (index < 0 && hub.accounts.length >= MAX_ACCOUNTS) fail('ACCOUNT_LIMIT', `最多管理${MAX_ACCOUNTS}个账户来源`);
  if (index < 0) hub.accounts.unshift(account); else hub.accounts[index] = account;
  addAudit(hub, index < 0 ? 'ACCOUNT_ADDED' : 'ACCOUNT_UPDATED', account.account_id, requestId, account.source.channel);
  const result = {account: clone(account), notice: index < 0 ? '账户来源已加入统一账户目录。' : '账户来源已更新。'};
  hub.idempotency[idempotencyKey] = result;
  const keys = Object.keys(hub.idempotency);
  for (const key of keys.slice(0, Math.max(0, keys.length - 50))) delete hub.idempotency[key];
  return {hub, ...result, replayed: false};
}

function seedDemo(hubValue, {idempotencyKey = 'account-hub-demo-v1', requestId = 'demo-seed-v1'} = {}) {
  const hub = ensureHub(hubValue);
  if (hub.idempotency[idempotencyKey]) return {hub, ...clone(hub.idempotency[idempotencyKey]), replayed: true};
  const source = {channel: 'DEMO_FIXTURE', label: '合成演示数据（不可连接真实账户）', as_of: '2026-10-28', confirmed: true};
  const accounts = [
    normalizeAccount({account_id: 'demo-bank', display_name: '演示银行账户', platform: 'bank', account_type: 'bank', balance_cents: 5000000, available_cents: 4200000, source, demo: true, entries: [
      {label: '房租', kind: 'obligation', amount_cents: 800000, due_on: '2026-11-01', status: 'CONFIRMED'},
      {label: '学费', kind: 'obligation', amount_cents: 1200000, due_on: '2026-11-15', status: 'CONFIRMED'},
    ]}),
    normalizeAccount({account_id: 'demo-fund', display_name: '演示基金账户', platform: 'fund', account_type: 'fund', balance_cents: 8000000, available_cents: 0, source, demo: true, entries: [
      {label: '演示基金组合', kind: 'holding', amount_cents: 8000000, status: 'CONFIRMED'},
    ]}),
    normalizeAccount({account_id: 'demo-wallet', display_name: '演示支付钱包', platform: 'wallet', account_type: 'wallet', balance_cents: 300000, available_cents: 200000, source, demo: true, entries: []}),
    normalizeAccount({account_id: 'demo-card', display_name: '演示信用卡', platform: 'credit_card', account_type: 'credit_card', balance_cents: 0, available_cents: 0, liability_cents: 500000, source, demo: true, entries: [
      {label: '信用卡待还', kind: 'obligation', amount_cents: 500000, due_on: '2026-11-05', status: 'CONFIRMED'},
    ]}),
  ];
  const map = new Map(hub.accounts.map(account => [account.account_id, account]));
  for (const account of accounts) map.set(account.account_id, account);
  hub.accounts = [...map.values()];
  addAudit(hub, 'DEMO_ACCOUNTS_SEEDED', null, requestId, 'DEMO_FIXTURE');
  const result = {notice: '已加入4个合成账户来源。它们只用于演示，不连接真实银行，也不产生资金动作。'};
  hub.idempotency[idempotencyKey] = result;
  return {hub, ...result, replayed: false};
}

function routeScenario(question, hubValue) {
  if (typeof question !== 'string' || !question.trim() || question.length > 1000) fail('ACCOUNT_QUESTION_INVALID', '请先写下想核对的事情');
  const hub = ensureHub(hubValue), textValue = question.trim();
  const hasInvest = /基金|股票|持仓|投资|买入|理财/.test(textValue);
  const hasDue = /房租|学费|账单|还款|到期|付款|交费|订阅/.test(textValue);
  let scenario = 'ACCOUNT_OVERVIEW', title = '账户总览', reason = '先把不同平台的余额、待付款和来源放在一起看清楚。';
  if (hasInvest && hasDue) {scenario = 'FUNDING_CONFLICT'; title = '投资与生活用款冲突'; reason = '这句话同时提到了投资和近期用款，应该先检查未来付款会不会挤占可用资金。';}
  else if (hasDue) {scenario = 'BILL_TRACKING'; title = '账单与待付款跟进'; reason = '先按日期列出需要处理的账单，再判断当前可用资金是否够用。';}
  else if (hasInvest) {scenario = 'PORTFOLIO_REVIEW'; title = '持仓与资金安排'; reason = '先核对持仓来源和金额，再讨论是否影响生活资金。';}
  else if (/比价|优惠券|外卖|双十一/.test(textValue)) {scenario = 'CROSS_PLATFORM_COMPARE'; title = '跨平台比价'; reason = '可以把用户提供的不同平台截图或价格放在一起比较，结果仍需用户确认。';}
  else if (/订阅|会员/.test(textValue)) {scenario = 'SUBSCRIPTION_REVIEW'; title = '订阅费用检查'; reason = '先整理订阅的金额和扣款日期，再决定是否提醒或模拟调整。';}
  return {
    schema_version: VERSION,
    scenario,
    title,
    reason,
    question: textValue,
    account_count: hub.accounts.length,
    suggested_inputs: scenario === 'FUNDING_CONFLICT' ? ['近期必须付款的金额和日期', '哪些账户的钱可以使用', '投资金额和计划日期'] : ['账户来源', '金额或账单截图', '数据截至日期'],
    next_step: 'READ_ONLY_PREVIEW',
    execution_allowed: false,
    risk_required_for_actions: true,
  };
}

module.exports = {
  VERSION,
  PLATFORMS,
  ACCOUNT_TYPES,
  ENTRY_KINDS,
  MAX_ACCOUNTS,
  emptyHub,
  ensureHub,
  normalizeAccount,
  summarize,
  publicHub,
  upsert,
  seedDemo,
  routeScenario,
};
