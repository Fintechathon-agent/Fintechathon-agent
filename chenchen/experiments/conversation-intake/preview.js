"use strict";

const { createHash } = require("node:crypto");

const CATEGORY_RULES = [
  ["INVESTMENT", "投资与持仓", /基金|股票|持仓|理财|投资|定投|买入|赎回/u],
  ["LIVING_COST", "生活开支", /房租|租金|生活费|水电|学费|医疗|吃饭|餐费|交通|房贷/u],
  ["SHOPPING", "购物与优惠", /购物|双十一|双11|优惠|比价|淘宝|京东|美团|买手机|买电脑/u],
  ["SUBSCRIPTION", "订阅与续费", /订阅|续费|会员|自动扣费|自动扣款/u],
  ["INCOME", "收入线索", /工资|收入|奖金|报销|到账/u]
];
const MONEY = /(?:[¥￥]\s*[-+]?\d[\d,]*(?:\.\d+)?|[-+]?(?:\d[\d,]*(?:\.\d+)?(?:万|千)?|[零〇一二两三四五六七八九十百千万亿]+)\s*(?:元|块(?:钱)?))/gu;
const TIME = /\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}月\d{1,2}[日号]?|下个月|本月|下月|这个月|每个月|每月|每年|每周|今天|明天|后天|下周|月底|月初|双十一|双11/gu;

function mentions(text, expression, offset) {
  return [...text.matchAll(expression)].map(match => ({
    text: match[0], source_span: { start: offset + match.index, end: offset + match.index + match[0].length },
    status: "NEEDS_CONFIRMATION"
  }));
}

function previewConversation(input, { now = () => new Date() } = {}) {
  if (!input || typeof input.text !== "string" || !input.text.trim() || input.text.length > 20000) {
    throw new TypeError("text must be a non-empty string of at most 20000 UTF-16 code units");
  }
  const receivedAt = now();
  if (!(receivedAt instanceof Date) || !Number.isFinite(receivedAt.getTime())) throw new TypeError("clock must return a valid Date");
  const text = input.text;
  const candidates = [];
  for (const match of text.matchAll(/[^。！？；;，\n]+/gu)) {
    const content = match[0].trim();
    if (!content) continue;
    if (candidates.length >= 80) throw new RangeError("too many statements; split the input into smaller messages");
    const start = match.index + match[0].indexOf(content);
    const categories = CATEGORY_RULES.filter(([, , rule]) => rule.test(content)).map(([code, label]) => ({ code, label }));
    if (!categories.length) categories.push({ code: "UNCLASSIFIED", label: "待确认归类" });
    const amountMentions = mentions(content, MONEY, start);
    const timeMentions = mentions(content, TIME, start);
    const questions = ["这条信息描述的是谁的情况，是否属实？"];
    if (!amountMentions.length) questions.push("金额是多少？没有明确金额时不要猜。");
    if (!timeMentions.length) questions.push("何时发生或到期？");
    if (timeMentions.length) questions.push("请确认具体日期、时区，以及是否重复发生。");
    if (amountMentions.length) questions.push("每个金额分别代表预算、价格、余额还是已经发生的收支？");
    if (categories.length > 1) questions.push("同一段涉及多类信息，请确认每个金额对应哪件事。");
    if (/不|取消|已经|已付|假如|如果|朋友|别人/u.test(content)) questions.push("这是计划、已发生、取消、假设还是别人的情况？");
    if (categories.some(item => item.code === "SHOPPING")) questions.push("比价还需要同一商品、各平台报价、优惠条件、运费和报价时间。");
    if (categories.some(item => item.code === "SUBSCRIPTION")) questions.push("请核实扣费周期、下次扣费日和取消条件。");
    candidates.push({
      candidate_id: "candidate-" + (candidates.length + 1),
      status: "UNCONFIRMED", text: content,
      source_span: { start, end: start + content.length },
      categories, amount_mentions: amountMentions, time_mentions: timeMentions,
      confirmation_questions: questions
    });
  }
  if (!candidates.length) throw new TypeError("text must contain a statement");
  const categoryCodes = new Set(candidates.flatMap(item => item.categories.map(category => category.code)));
  const possibleFundingConflict = categoryCodes.has("LIVING_COST") &&
    ["INVESTMENT", "SHOPPING", "SUBSCRIPTION"].some(category => categoryCodes.has(category));
  return {
    draft_version: "conversation-intake.draft.v0",
    status: "AWAITING_USER_CONFIRMATION",
    extraction_method: "RULE_BASED_CANDIDATES",
    received_at: receivedAt.toISOString(),
    input_authority: "UNVERIFIED_USER_TEXT",
    input_sha256: createHash("sha256").update(text).digest("hex"),
    source_text: text,
    span_encoding: "UTF16_CODE_UNITS_END_EXCLUSIVE",
    candidates,
    possible_funding_conflict: possibleFundingConflict ? {
      status: "NEEDS_VERIFIED_CONTEXT",
      explanation: "出现生活开支与其他用钱计划，需要核实可用余额、金额和日期；尚未得出冲突结论。",
      required_context: ["用户确认的资金用途", "可信余额及来源", "各项金额和日期", "已有任务占用的资金"]
    } : null,
    next_steps: ["用户逐条确认和更正", "经各模块既有接口核实信息", "发起模型提议", "统一 Risk 与必要审批", "执行检查与审计"],
    memory_write_performed: false,
    risk_decision: null,
    execution_allowed: false,
    side_effects: false
  };
}

// This produces a request draft, not a submission or confirmation mechanism.
// It intentionally does not map guessed amounts into action_parameters or Memory.
function draftReviewRequest(input, options) {
  if (!["FIXTURE", "LIVE", "SYNTHETIC_REPLAY", "REFERENCE_FIXTURE"].includes(input?.data_mode)) {
    throw new TypeError("data_mode must explicitly describe the source of the input");
  }
  const preview = previewConversation(input, options);
  return {
    ready_to_submit: false,
    requires_user_confirmation: true,
    preview,
    request: {
      schema_version: "model-review.v1", kind: "combined", source: "conversation-intake-experiment",
      text: preview.source_text, data_mode: input.data_mode,
      execution_mode: "PAPER", capability: "REVIEW_ONLY", memory_consent: false,
      scenario: "GENERAL_REVIEW", output_formats: ["json"],
      context: { intake_draft_version: preview.draft_version, intake_input_sha256: preview.input_sha256,
        intake_status: preview.status, input_authority: preview.input_authority }
    }
  };
}

module.exports = { previewConversation, draftReviewRequest };
