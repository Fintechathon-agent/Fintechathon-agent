"use strict";

const { createHash } = require("node:crypto");
const { extract } = require("../../../chenchen/experiments/life-planning-v1/intake");
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const MAX_MINOR = 100_000_000_00;
const TYPES = ["CASH", "RESERVE", "EXPENSE", "INCOME", "INVESTMENT", "ASSET", "OTHER"];
const LABELS = { CASH: "当前现金", RESERVE: "现金保底", EXPENSE: "生活支出", INCOME: "收入", INVESTMENT: "投资计划", ASSET: "现有资产", OTHER: "待识别事项" };
const NUM = "[零〇一二两三四五六七八九十百千万亿点\\d.]+";
const MONEY = /[-负]?(?:\d+(?:,\d{3})*(?:\.\d+)?[亿万千百kKwW]?|[零〇一二两三四五六七八九十百千万亿点]+)\s*(?:人民币|CNY|RMB|美元|美金|港元|港币|欧元|USD|HKD|EUR|元|块钱|块)?/giu;
const MONEY_DATE = new RegExp("\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|" + NUM + "\\s*(?:年|个月|月|日|号|天|周|星期|岁|%|％|成|期|次|个)|(?:下下周|下周|本周|这周|每周|每星期)[一二三四五六日天]", "gu");
const FINANCE = /现金|余额|存款|活期|手头|应急|备用|保底|房租|租金|房贷|学费|生活费|水电|医疗|保费|工资|收入|奖金|基金|投资|理财|股票|信用卡|还款|消费|支出|买手机|订阅|会员|报销/u;

function fail(code, message, status = 422) { const error = new Error(message); error.code = code; error.status = status; throw error; }
function minor(value, name = "金额", nullable = true) {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MINOR) fail("INVALID_AMOUNT", `${name}须为0至${MAX_MINOR}的人民币整数分，未知须传null`);
  return value;
}
function chinese(raw) {
  raw = raw.replaceAll("两", "二").replaceAll("〇", "零").replaceAll(",", "");
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000, 亿: 100000000, k: 1000, K: 1000, w: 10000, W: 10000 };
  const arabic = raw.match(/^(\d+(?:\.\d+)?)([亿万千百kKwW])?$/u);
  if (arabic) return Number(arabic[1]) * (units[arabic[2]] || 1);
  if (/[亿万千百][一二三四五六七八九]$/u.test(raw)) return null;
  if (raw.includes("点")) {
    const match = raw.match(/^(.+)点([零一二三四五六七八九]+)([万亿])?$/u);
    if (!match) return null;
    const left = chinese(match[1]);
    return left === null ? null : (left + Number("0." + [...match[2]].map(x => "零一二三四五六七八九".indexOf(x)).join(""))) * (units[match[3]] || 1);
  }
  let total = 0, section = 0, digit = 0;
  for (const char of raw) {
    const n = "零一二三四五六七八九".indexOf(char);
    if (n >= 0) digit = n;
    else if (["十", "百", "千"].includes(char)) { section += (digit || 1) * units[char]; digit = 0; }
    else if (char === "万") { total += (section + digit) * 10000; section = digit = 0; }
    else if (char === "亿") { total = (total + section + digit) * 100000000; section = digit = 0; }
    else return null;
  }
  return total + section + digit;
}
function parseAmount(text) {
  if (/[0-9０-９零〇一二两三四五六七八九十百千万亿点.,]{65}/u.test(text)) fail("NUMBER_TOKEN_TOO_LONG", "连续数字过长，请核对金额或移除无关编号");
  const ignored = [...text.matchAll(MONEY_DATE)].map(m => [m.index, m.index + m[0].length]);
  const amounts = [], issues = [];
  for (const m of text.matchAll(MONEY)) {
    if (ignored.some(([a, b]) => m.index < b && m.index + m[0].length > a)) continue;
    const token = m[0].trim();
    if (/^[一二两三四五六七八九十万千百]$/u.test(token)) continue;
    if (/^\s*[/%％]/u.test(text.slice(m.index + m[0].length))) continue;
    const raw = token.replace(/\s*(?:人民币|CNY|RMB|美元|美金|港元|港币|欧元|USD|HKD|EUR|元|块钱|块)$/iu, "");
    const amount = chinese(raw);
    const cents = amount === null ? null : Math.round(amount * 100);
    if (amount === null || amount < 0 || Math.abs(amount * 100 - cents) > 0.00001 || !Number.isSafeInteger(cents) || cents > MAX_MINOR) issues.push("金额无效或口语金额不明确，请填写完整人民币金额");
    else amounts.push({ text: token, amount_minor: cents });
  }
  if (/美元|美金|港元|港币|欧元|USD|HKD|EUR|\$/iu.test(text)) issues.push("请将非人民币金额明确换算为人民币，系统不猜测汇率");
  if (/大概|大约|约莫|差不多|左右|几千|几万|至少|至多|最多|不少于|不超过|[~～至到]\s*\d/u.test(text)) issues.push("金额有范围或估计，请确认用于测算的金额");
  if (amounts.length > 1) issues.push("多个金额尚未一一对应，请分别拆开或手动确认");
  return { amount_minor: amounts.length === 1 && !issues.length ? amounts[0].amount_minor : null, amounts, issues };
}
function isoDay(value, name = "日期", nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/u.test(value)) fail("INVALID_DATE", `${name}须为2000—2099年的YYYY-MM-DD日期`);
  const d = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) fail("INVALID_DATE", `${name}不是有效日历日期`);
  return value;
}
const day = d => d.toISOString().slice(0, 10);
function plusDays(value, count) { return day(new Date(Date.parse(value + "T00:00:00Z") + count * 86400000)); }
function plusMonths(value, count, anchor) {
  const d = new Date(value + "T00:00:00Z"), n = anchor || d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + count);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(n, last)); return day(d);
}
function parseDate(text, asOf) {
  let due = null, anchor = null;
  const notes = [];
  const recurrence = /每(?:个)?月|月供|月租/u.test(text) ? "MONTHLY" : /每(?:个)?周|每星期/u.test(text) ? "WEEKLY" : /每天/u.test(text) ? "DAILY" : "ONCE";
  try {
    const full = text.match(/(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})(?:日|号)?/u);
    const md = text.match(/(?:(今年|明年|后年))?(\d{1,2})月(\d{1,2})(?:日|号)/u);
    const rm = text.match(new RegExp("(下下个月|下下月|下个月|下月|这个月|本月|每个月|每月)(?:的)?(" + NUM + ")(?:日|号)", "u"));
    const rel = text.match(new RegExp("(" + NUM + ")(天|周|个月)后", "u"));
    const week = text.match(/(下下周|下周|本周|这周|每周|每星期)([一二三四五六日天])/u);
    if (full) due = `${full[1]}-${full[2].padStart(2, "0")}-${full[3].padStart(2, "0")}`;
    else if (md) {
      const year = Number(asOf.slice(0, 4)) + ({ 今年: 0, 明年: 1, 后年: 2 }[md[1]] || 0);
      due = `${year}-${md[2].padStart(2, "0")}-${md[3].padStart(2, "0")}`;
      if (!md[1] && due < asOf) { due = `${year + 1}${due.slice(4)}`; notes.push("未写年份的月日按下一次到期解析，请核对"); }
    } else if (rm) {
      anchor = chinese(rm[2]);
      if (!Number.isInteger(anchor) || anchor < 1 || anchor > 31) throw Error("day");
      const month = plusMonths(asOf.slice(0, 8) + "01", rm[1].includes("下下") ? 2 : rm[1].includes("下") ? 1 : 0);
      due = recurrence === "MONTHLY" ? plusMonths(month, 0, anchor) : month.slice(0, 8) + String(anchor).padStart(2, "0");
      if (recurrence === "MONTHLY" && due < asOf) due = plusMonths(month, 1, anchor);
    } else if (rel) {
      const n = chinese(rel[1]);
      if (!Number.isInteger(n) || n < 0 || n > 3650) throw Error("period");
      due = rel[2] === "个月" ? plusMonths(asOf, n) : plusDays(asOf, n * (rel[2] === "周" ? 7 : 1));
    } else if (week) {
      const dow = new Date(asOf + "T00:00:00Z").getUTCDay() || 7;
      const target = "一二三四五六日".indexOf(week[2].replace("天", "日")) + 1;
      due = plusDays(asOf, target - dow + (week[1].includes("下下") ? 14 : week[1].includes("下") ? 7 : 0));
      if (recurrence === "WEEKLY" && due < asOf) due = plusDays(due, 7);
    } else if (/大后天|后天|明天|今天|今日|现在|马上/u.test(text)) {
      const token = text.match(/大后天|后天|明天|今天|今日|现在|马上/u)[0];
      due = plusDays(asOf, ({ 大后天: 3, 后天: 2, 明天: 1 })[token] || 0);
    } else if (recurrence === "DAILY") due = asOf;
    else if (/月底/u.test(text)) {
      const next = plusMonths(asOf.slice(0, 8) + "01", /下(?:个)?月底/u.test(text) ? 2 : 1);
      due = plusDays(next, -1); notes.push("月底按最后一个日历日测算，请核对实际扣款日");
    }
    if (due) isoDay(due);
  } catch { due = null; notes.push("日期无效或不精确，请填写实际日期"); }
  return { due_date: due, recurrence, anchor_day: anchor || (due ? Number(due.slice(-2)) : null), date_notes: notes };
}
function typeOf(text) {
  if (/持有|市值|定期存款|锁定|不可赎回|不能赎回|冻结/u.test(text) && !/想|打算|准备|计划|拟/u.test(text)) return "ASSET";
  if (/应急金|应急资金|备用金|保底|预留.*不动|保留.*现金/u.test(text)) return "RESERVE";
  if (/现金|余额|活期|手头|可用资金|存款|银行卡.*(?:有|剩)/u.test(text)) return "CASH";
  if (/房租|租金|学费|教育费|培训费|生活费|水电|房贷|车贷|信用卡|还款|医疗|保费|消费|支出|开销|购物|买手机|买电脑|订阅|续费|会员/u.test(text)) return "EXPENSE";
  if (/工资|薪水|月薪|收入|奖金|报销|回款|退款/u.test(text)) return "INCOME";
  if (/投资|基金|理财|股票|定投|买入|申购/u.test(text)) return "INVESTMENT";
  return "OTHER";
}
function normalizeText(text) { return text.replace(/[０-９．－]/gu, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)); }
function parse(input, now = () => new Date()) {
  if (!input || !["FIXTURE", "SYNTHETIC_REPLAY"].includes(input.data_mode)) fail("DEMO_MODE_REQUIRED", "本共创版仅接受明确标记的FIXTURE或SYNTHETIC_REPLAY输入");
  const asOf = isoDay(input.as_of, "分析日");
  const horizon = input.horizon_days ?? 90;
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 365) fail("INVALID_HORIZON", "测算区间须为1至365天");
  if (typeof input.text === "string" && /[0-9０-９零〇一二两三四五六七八九十百千万亿点.,]{65}/u.test(input.text)) fail("NUMBER_TOKEN_TOO_LONG", "连续数字过长，请核对金额或移除无关编号");
  const core = extract(input, { now });
  const items = [];
  for (const c of core.candidates) {
    // Keep every character in a reviewed span; split only explicit coordinating clauses.
    const cuts = [0];
    for (const m of c.text.matchAll(/但是|不过|还有|还要|还需|然后|另外|同时|以及|[和及与]/gu)) {
      const left = c.text.slice(cuts.at(-1), m.index), right = c.text.slice(m.index + m[0].length);
      if (FINANCE.test(left) && FINANCE.test(right) && parseAmount(normalizeText(left)).amounts.length) cuts.push(m.index);
    }
    cuts.push(c.text.length);
    for (let i = 0; i < cuts.length - 1; i++) {
      let start = c.source_span.start + cuts[i], end = c.source_span.start + cuts[i + 1];
      while (/\s/u.test(input.text[start] || "") && start < end) start++;
      while (/\s/u.test(input.text[end - 1] || "") && end > start) end--;
      const text = input.text.slice(start, end), normalized = normalizeText(text);
      const local = cuts.length > 2 ? extract({ ...input, text }, { now }).candidates[0] : c;
      let type = typeOf(normalized);
      const previous = items.at(-1);
      const continuation = c.related_candidate_id && previous && type === "OTHER";
      if (continuation) type = previous.type;
      const amount = parseAmount(normalized), temporal = parseDate(normalized, asOf);
      if (continuation && !temporal.due_date && previous.due_date) Object.assign(temporal, { due_date: previous.due_date, recurrence: previous.recurrence, anchor_day: previous.anchor_day });
      const classification = { ...local.classification };
      if (c.classification.status === "CONDITIONAL") classification.status = "CONDITIONAL";
      if (c.classification.subject === "THIRD_PARTY") classification.subject = "THIRD_PARTY";
      const excluded = ["COMPLETED", "CANCELLED"].includes(classification.status) || classification.subject === "THIRD_PARTY" || type === "ASSET";
      const unclear = ["NEGATED", "AMBIGUOUS", "CORRECTION", "CONDITIONAL"].includes(classification.status) || continuation;
      const purposeCount = [/房租|租金/u, /学费|教育费/u, /房贷|车贷/u, /生活费/u, /医疗/u, /水电/u, /保费/u, /信用卡|还款/u].filter(re => re.test(normalized)).length;
      const mixedInvestment = /投资|基金|股票|理财|定投/u.test(normalized) && /房租|学费|现金|工资|收入|保底/u.test(normalized);
      const requiresSplit = (purposeCount > 1 && !/合计|一共|共计|总共/u.test(normalized)) || mixedInvestment;
      const duplicate = items.find(x => normalizeText(x.text).replace(/[\s，。；！？]/gu, "") === normalized.replace(/[\s，。；！？]/gu, ""));
      if (requiresSplit) amount.issues.push("多个资金用途或投资意图共用一个句子，请回到原文分别写明金额和日期");
      const defaultDate = type === "INVESTMENT" && temporal.due_date === null && !local.time_mentions.length && !/近期|以后|之后|过几天|到期|年|周|月|天/u.test(normalized);
      if (defaultDate) { temporal.due_date = asOf; temporal.date_notes.push("未给出投资日期，草稿按分析日占用测算，须核对"); }
      items.push({ id: "item-" + items.length, text, source_span: { start, end }, type,
        classification, ...amount, ...temporal,
        certainty: /可能|也许|不一定|不确定|或许|如果|假如/u.test(normalized) ? "UNCERTAIN" : "EXPECTED",
        disposition: excluded ? "EXCLUDE" : unclear || requiresSplit || duplicate || type === "OTHER" ? "UNRESOLVED" : "INCLUDE",
        exclusion_reason: excluded ? type === "ASSET" ? "现有资产不等于可用现金" : classification.subject === "THIRD_PARTY" ? "他人事项" : "已完成或已取消" : "",
        related_item_id: continuation ? previous.id : null, requires_split: requiresSplit, duplicate_of: duplicate?.id || null, corrected: false });
    }
  }
  if (items.length > 100) fail("TOO_MANY_ITEMS", "最多100个事项，请分批整理");
  const single = type => {
    const rows = items.filter(x => x.type === type && x.disposition === "INCLUDE");
    return rows.length === 1 ? rows[0].amount_minor : null;
  };
  return { schema_version: "long-text-risk.v1", source_text: input.text, data_mode: input.data_mode,
    as_of: asOf, horizon_days: horizon, through: plusDays(asOf, horizon), span_encoding: "UTF16_CODE_UNITS_END_EXCLUSIVE",
    parser_mode: "EVIDENCE_RULES", items, profile: { cash_minor: single("CASH"), hard_floor_minor: single("RESERVE"), existing_holds_minor: null, fees_minor: null },
    interpretation_sha256: hash({ text: input.text, items, asOf, horizon }), execution_allowed: false, memory_write_performed: false };
}

module.exports = { parse, parseAmount, parseDate, typeOf, chinese, minor, isoDay, plusDays, plusMonths, hash, fail, TYPES, LABELS, MAX_MINOR };
