// Deterministic amount-only review. Reuses Core's existing calculation; there are
// no market-data lookups, model calls, prices, returns, or inferred identifiers.
import tools from '../../tools/holdings-readonly.js';
import {createHash} from 'node:crypto';

const fail = code => {throw Object.assign(new Error(code), {code, status: 422});};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const nameKey = name => name.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
const UNAVAILABLE = ['收益与盈亏', '历史回撤', '波动率', '资产相关性', '行业集中度', '基金穿透持仓', '实时行情与市值核验'];

// Decimal parsing uses integer arithmetic throughout. No binary floating-point
// rounding can silently turn a quantity, exponent, or sub-cent amount into money.
export function parseAmountCents(value, unit = '元') {
  if (typeof value !== 'string' || !/^\d{1,12}(?:\.\d{1,6})?$/.test(value) || !['元', '千', '万'].includes(unit)) fail('REVIEW_AMOUNT_INVALID');
  const [whole, fraction = ''] = value.split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const scaled = (BigInt(whole) * denominator + BigInt(fraction || '0')) * ({元: 100n, 千: 100_000n, 万: 1_000_000n}[unit]);
  if (scaled % denominator !== 0n) fail('REVIEW_AMOUNT_PRECISION');
  const cents = scaled / denominator;
  if (cents < 0n || cents > 100_000_000_000n) fail('REVIEW_AMOUNT_RANGE');
  return Number(cents);
}

export function normalizeReview({rows, metadata} = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) fail('REVIEW_METADATA_REQUIRED');
  if (metadata.currency !== 'CNY') fail('REVIEW_CURRENCY_UNSUPPORTED');
  if (metadata.basis !== 'current_value') fail('REVIEW_BASIS_UNSUPPORTED');
  if (!['USER_TEXT', 'USER_TABLE'].includes(metadata.source) || typeof metadata.demo !== 'boolean') fail('REVIEW_SOURCE_REQUIRED');
  if (metadata.as_of !== null && !validDate(metadata.as_of)) fail('REVIEW_DATE_INVALID');
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) fail('REVIEW_ROWS_REQUIRED');
  const seen = new Set();
  const normalized = rows.map(row => {
    if (!row || typeof row !== 'object' || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 80 || /[\u0000-\u001f\u007f]/.test(row.name)) fail('REVIEW_ROW_INVALID');
    if (!['cash', 'unresolved'].includes(row.kind)) fail('REVIEW_KIND_UNSUPPORTED');
    if (row.currency !== undefined && row.currency !== metadata.currency) fail('REVIEW_MIXED_CURRENCY');
    if (row.unit !== undefined && !['元', '千', '万'].includes(row.unit)) fail('REVIEW_AMOUNT_INVALID');
    if (row.basis !== undefined && row.basis !== metadata.basis) fail('REVIEW_BASIS_UNSUPPORTED');
    if (['cost_basis', 'cost', 'quantity', 'shares', 'current_price'].some(key => row[key] !== undefined)) fail('REVIEW_BASIS_UNSUPPORTED');
    for (const field of ['as_of', 'snapshot_date', 'date']) if (row[field] !== undefined && row[field] !== metadata.as_of) fail('REVIEW_MIXED_DATES');
    const name = row.name.trim(), key = nameKey(name);
    if (!key || seen.has(key)) fail('REVIEW_DUPLICATE_NAME');
    seen.add(key);
    let amount = row.amount_cents;
    if (amount === undefined) amount = parseAmountCents(row.amount, row.unit ?? '元');
    else {
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1e11) fail('REVIEW_AMOUNT_INVALID');
      if (row.amount !== undefined && parseAmountCents(row.amount, row.unit ?? '元') !== amount) fail('REVIEW_AMOUNT_CONFLICT');
    }
    return {name, kind: row.kind, amount_cents: amount, instrument_id: null};
  });
  if (!Number.isSafeInteger(normalized.reduce((sum, row) => sum + row.amount_cents, 0))) fail('REVIEW_TOTAL_RANGE');
  return {rows: normalized, metadata: {as_of: metadata.as_of, currency: 'CNY', basis: 'current_value', source: metadata.source, demo: metadata.demo}};
}

export function buildReview(rows, metadata, version) {
  if (!Number.isSafeInteger(version) || version < 0) fail('REVIEW_VERSION_INVALID');
  const normalized = normalizeReview({rows, metadata});
  const input = tools.intake({rows: normalized.rows});
  input.source = normalized.metadata.source;
  input.as_of = normalized.metadata.as_of;
  const tool = tools.calculate(input), output = tool.output;
  const noncash = output.rows.filter(row => row.kind !== 'cash');
  const largest = [...noncash].sort((a, b) => b.amount_cents - a.amount_cents || nameKey(a.name).localeCompare(nameKey(b.name)))[0];
  const findings = [];
  if (output.calculation_available && largest) findings.push({
    code: largest.weight_pct > 50 ? 'SINGLE_HOLDING_OVER_HALF' : 'LARGEST_NONCASH_HOLDING',
    title: `${largest.name}占已录入金额的${largest.weight_pct}%`,
    summary: largest.weight_pct > 50 ? '这一项超过已录入总额的一半；这说明金额分布集中，尚不能据此判断基金底层资产是否分散。' : '这是已录入非现金项目中金额最大的一项；该比例仅描述金额分布，不能据此判断是否适合你的目标。',
    evidence: {name: largest.name, amount_cents: largest.amount_cents, total_cents: output.total_cents, weight_pct: largest.weight_pct},
    formula: 'weight_pct = amount_cents / total_cents × 100，保留两位小数',
    missing: ['标的的准确名称或代码', '底层资产与资产类别', '投资目标和可承受风险'],
  });
  if (!output.calculation_available) findings.push({code: 'TOTAL_ZERO', title: '录入金额合计为0元', summary: '当前金额合计为0，无法计算各项占比；这不代表已经核验你没有其他资产。', evidence: {total_cents: 0}, formula: 'total_cents = sum(amount_cents)', missing: ['本次希望分析的当前市值']});
  const cashWeight = output.total_cents ? Number((BigInt(output.cash_cents) * 10_000n + BigInt(output.total_cents) / 2n) / BigInt(output.total_cents)) / 100 : null;
  findings.push({
    code: output.cash_known ? 'STATED_CASH_ALLOCATION' : 'CASH_NOT_PROVIDED',
    title: output.cash_known ? '已录入的现金金额' : '当前没有录入现金项目',
    summary: output.cash_known ? '现金占比由已录入金额计算；是否足够应急或满足近期用款，还需要用款金额、时间和可支取条件。' : '没有现金条目不等于实际现金为0；本次比例仅覆盖已录入的项目。',
    evidence: {cash_known: output.cash_known, cash_cents: output.cash_known ? output.cash_cents : null, total_cents: output.total_cents, weight_pct: output.cash_known ? cashWeight : null},
    formula: output.cash_known ? 'cash_weight_pct = sum(cash.amount_cents) / total_cents × 100；总额为0时不计算比例' : '未提供的现金金额不补0，不补入分母',
    missing: ['近期用款金额与日期', '现金是否可以随时支取'],
  });
  if (noncash.length) findings.push({code: 'INSTRUMENT_DETAILS_UNKNOWN', title: '标的属性尚未核验', summary: '名称和金额不足以判断行业、持仓重叠或历史风险；当前没有据此生成收益、历史回撤或基金行情。', evidence: {unresolved_names: noncash.map(row => row.name), source: normalized.metadata.source, as_of: normalized.metadata.as_of}, formula: '只使用用户录入的当前市值；不查询或推断行情', missing: ['准确标的名称或代码', '可核验的标的资料与历史数据']});
  const followups = [];
  if (largest) followups.push(`${largest.name}的占比是怎么算出来的？`);
  followups.push('目前哪些结论还不能确定？');
  if (!normalized.metadata.as_of) followups.push('为什么保存记录需要确认日期？');
  else if (noncash.length && output.cash_known) followups.push('如果只调整已录入金额，可以怎样模拟比较？');
  const disclosedFindings = findings.slice(0, 3).map(finding => ({...finding,
    evidence: {...finding.evidence, source: normalized.metadata.source, as_of: normalized.metadata.as_of, basis: 'current_value', demo: normalized.metadata.demo},
    impact: finding.code === 'STATED_CASH_ALLOCATION' || finding.code === 'CASH_NOT_PROVIDED' ? '当前资料不足以判断现金是否能覆盖用款需求。' : finding.code === 'INSTRUMENT_DETAILS_UNKNOWN' ? '无法据此判断行业重叠、收益或历史回撤。' : '该发现只描述本次录入金额，不构成风险等级或买卖结论。',
    next: finding.code === 'STATED_CASH_ALLOCATION' || finding.code === 'CASH_NOT_PROVIDED' ? '如需检查用款覆盖，补充金额、日期和支取条件。' : finding.code === 'INSTRUMENT_DETAILS_UNKNOWN' ? '需要进一步分析时，补充准确名称或代码及可核验资料。' : '先核对录入金额和当前市值口径，再结合目标讨论。',
  }));
  return {...normalized, version, content_hash: hash({...normalized, version}), tool, findings: disclosedFindings,
    chart: output.rows.map(({name, kind, amount_cents, weight_pct}) => ({name, kind, amount_cents, weight_pct})),
    unavailable: [...UNAVAILABLE], followups: followups.slice(0, 3),
  };
}

export function createSnapshot({review, confirmed, created_at, id} = {}) {
  if (confirmed !== true) fail('SNAPSHOT_CONFIRMATION_REQUIRED');
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) fail('SNAPSHOT_ID_INVALID');
  if (typeof created_at !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(created_at) || !Number.isFinite(Date.parse(created_at))) fail('SNAPSHOT_TIMESTAMP_INVALID');
  const verified = buildReview(review?.rows, review?.metadata, review?.version);
  if (!verified.metadata.as_of) fail('SNAPSHOT_DATE_REQUIRED');
  if (review.content_hash !== verified.content_hash) fail('SNAPSHOT_CONTENT_CHANGED');
  return {id, created_at: new Date(created_at).toISOString(), status: 'CONFIRMED', version: verified.version, content_hash: verified.content_hash, rows: verified.rows, metadata: verified.metadata, total_cents: verified.tool.output.total_cents};
}

export function compareSnapshots(before, after) {
  const read = (snapshot, allowDraft = false) => {
    const draft = allowDraft && (snapshot?.status === undefined || snapshot?.status === 'DRAFT');
    if (!snapshot || (!draft && (snapshot.status !== 'CONFIRMED' || !snapshot.metadata?.as_of))) fail('SNAPSHOT_CONFIRMED_REQUIRED');
    const review = buildReview(snapshot.rows, snapshot.metadata, snapshot.version);
    if (review.content_hash !== snapshot.content_hash || (!draft || snapshot.total_cents !== undefined) && snapshot.total_cents !== review.tool.output.total_cents) fail('SNAPSHOT_CONTENT_CHANGED');
    return review;
  };
  const first = read(before), second = read(after, true);
  if (first.metadata.demo !== second.metadata.demo) fail('SNAPSHOT_DEMO_MISMATCH');
  if (second.metadata.as_of && second.metadata.as_of < first.metadata.as_of) fail('SNAPSHOT_DATE_ORDER_INVALID');
  const a = new Map(first.tool.output.rows.map(row => [nameKey(row.name), row]));
  const b = new Map(second.tool.output.rows.map(row => [nameKey(row.name), row]));
  const changes = [...new Set([...a.keys(), ...b.keys()])].map(key => {
    const left = a.get(key), right = b.get(key), oldAmount = left?.amount_cents || 0, newAmount = right?.amount_cents || 0;
    const oldWeight = first.tool.output.calculation_available ? (left?.weight_pct || 0) : null;
    const newWeight = second.tool.output.calculation_available ? (right?.weight_pct || 0) : null;
    return {name: right?.name || left.name, status: !left ? 'added' : !right ? 'removed' : oldAmount !== newAmount || oldWeight !== newWeight ? 'changed' : 'unchanged',
      before_cents: oldAmount, after_cents: newAmount, delta_cents: newAmount - oldAmount,
      before_weight_pct: oldWeight, after_weight_pct: newWeight, weight_delta_pp: oldWeight === null || newWeight === null ? null : (Math.round(newWeight * 100) - Math.round(oldWeight * 100)) / 100};
  });
  return {
    before: {id: before.id, as_of: first.metadata.as_of, total_cents: first.tool.output.total_cents},
    after: {id: after.id || null, as_of: second.metadata.as_of, total_cents: second.tool.output.total_cents, kind: after.status === 'CONFIRMED' ? 'CONFIRMED_SNAPSHOT' : 'CURRENT_DRAFT'},
    total_delta_cents: second.tool.output.total_cents - first.tool.output.total_cents,
    total_change_pct: first.tool.output.total_cents>0?Number((BigInt(Math.abs(second.tool.output.total_cents-first.tool.output.total_cents))*10000n+BigInt(first.tool.output.total_cents)/2n)/BigInt(first.tool.output.total_cents))/100*Math.sign(second.tool.output.total_cents-first.tool.output.total_cents):null,
    total_change_formula: '(after_total - before_total) / before_total × 100; amount change, not investment return; undefined for zero baseline',
    changes, added: changes.filter(row => row.status === 'added').map(row => row.name), removed: changes.filter(row => row.status === 'removed').map(row => row.name),
    attribution: 'NOT_DETERMINED',
    limitations: [after.status === 'CONFIRMED' ? '金额及占比变化仅来自两个已确认快照。' : '金额及占比变化来自已确认快照与当前草稿；草稿没有覆盖已保存快照。',
      ...(second.metadata.as_of ? [] : ['当前草稿的估值日期尚未提供，不能据此声称某一期间的表现。']),
      '缺少交易、转入转出和价格序列，无法把差额归因于盈亏、买卖或资金流。', '同名匹配不代表已核验证券身份；更名项目会作为新增和移除展示。'],
  };
}

export function compareCurrentReview(beforeConfirmedSnapshot, currentReview) {
  if (currentReview?.status === 'CONFIRMED') fail('CURRENT_REVIEW_REQUIRED');
  const comparison = compareSnapshots(beforeConfirmedSnapshot, currentReview);
  comparison.after = {...comparison.after, id: 'current', status: 'CURRENT_INPUT_NOT_SAVED'};
  comparison.limitations.unshift('当前金额尚未保存为新快照。');
  return comparison;
}
