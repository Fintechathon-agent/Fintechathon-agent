"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { previewConversation } = require("../conversation-intake/preview");
const { normalizeReviewInput } = require("../../integrations/model-review");
const { extractMoneyMentions } = require("./money-mentions");
const VERSION = "life-intake.draft.v1";
const MODES = ["FIXTURE", "LIVE", "SYNTHETIC_REPLAY", "REFERENCE_FIXTURE"];
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const copy = value => structuredClone(value);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function inputText(input) {
  if (!MODES.includes(input?.data_mode)) fail("INVALID_INPUT", "data_mode must be explicit");
  if (!["text", "speech_transcript"].includes(input.channel ?? "text")) fail("INVALID_INPUT", "Unsupported input channel");
  if (input.channel === "speech_transcript" && input.is_final !== true) {
    fail("TRANSCRIPT_NOT_FINAL", "Wait for the final transcript, then let the user check it");
  }
  return input.text;
}

function classify(text, inherited) {
  const hints = [];
  const rules = [
    ["CONDITIONAL", /如果|假如|假设|假定|要是/u],
    ["CANCELLED", /取消|撤销|作废|不再|不打算|不准备/u],
    ["NEGATED", /没(?:有)?(?:买|付|交|投|到账|扣)|未(?:付|交|买|到账|扣)|不是|不买|不投|(?:不(?:想|愿意|打算|准备|计划)|没(?:有)?(?:想|打算|准备|计划)|未(?:打算|计划))\s*(?:再|继续)?(?:买|投|付|交)/u],
    ["COMPLETED", /已经|已(?:经)?(?:付|交|买|到账|扣)|付过|交过|买过/u],
    ["PLANNED", /想|打算|准备|计划|将|要交|要付|待付|下月|下个月|明天|每月|续费|自动扣/u]
  ];
  for (const [status, rule] of rules) if (rule.test(text)) hints.push(status);
  const correction = /改成|改为|更正|说错|不是.+(?:而是|是)/u.test(text);
  // Hints are deliberately not interpreted as confirmed facts or financial instructions.
  const cancellationRequested = /(?:申请|想|准备|打算|计划)取消|取消申请|取消.{0,6}(?:失败|未成功|没成功)/u.test(text);
  const cancellationNegated = /(?:不|没(?:有)?|未)(?:想|愿意|打算|计划|准备|申请)?取消/u.test(text);
  // Complex polarity is a clarification cue, never inferred permission to act.
  const doubleNegation = /(?:不是|并非|没(?:有)?说)\s*(?:不|没|未)/u.test(text);
  const uncertainty = /不一定|未必|可能|也许|或许|是否|要不要|会不会|能不能/u.test(text);
  const withoutNegativeIntent = text.replace(/(?:不|没(?:有)?|未)(?:想|愿意|打算|准备|计划)\s*(?:再|继续)?(?:买|投|付|交)/gu, "");
  const conflictingIntent = hints.includes("NEGATED") &&
    /(?:想|愿意|打算|准备|计划)\s*(?:再|继续)?(?:买|投|付|交)/u.test(withoutNegativeIntent);
  const ambiguous = doubleNegation || uncertainty || conflictingIntent;
  if (ambiguous) hints.push("NEEDS_INTENT_CLARIFICATION");
  const status = correction ? "CORRECTION" : hints.includes("CONDITIONAL") ? "CONDITIONAL"
    : ambiguous ? "AMBIGUOUS"
    : cancellationNegated ? "NEGATED"
    : cancellationRequested ? "CANCELLATION_REQUESTED"
    : hints.includes("CANCELLED") ? "CANCELLED" : hints.includes("NEGATED") ? "NEGATED"
      : hints.includes("COMPLETED") && hints.includes("PLANNED") ? "AMBIGUOUS"
        : hints[0] || inherited || "UNSPECIFIED";
  const subject = /朋友|同事|别人|他人|我妈|我爸|妈妈|爸爸/u.test(text) ? "THIRD_PARTY"
    : /我|本人/u.test(text) ? "SELF_REPORTED" : "UNSPECIFIED";
  return { status, hints, subject };
}

function extract(input, options) {
  const text = inputText(input);
  const original = previewConversation({ text }, options);
  let previous = null;
  let clauseScope = null;
  const candidates = original.candidates.map(item => {
    // Re-read complete phrases in v1; do not inherit v0's truncated sub-yuan amounts.
    item.amount_mentions = extractMoneyMentions(item.text, item.source_span.start);
    item.confirmation_questions = item.confirmation_questions.filter(question => !question.startsWith("金额是多少") && !question.startsWith("每个金额分别"));
    item.confirmation_questions.push(item.amount_mentions.length ? "每个金额分别代表预算、价格、余额还是已经发生的收支？" : "金额是多少？没有明确金额时不要猜。");
    const gap = previous ? text.slice(previous.source_span.end, item.source_span.start) : "";
    const continuation = previous && !/[。！？；;\n]/u.test(gap);
    if (!continuation) clauseScope = null;
    const classification = classify(item.text, clauseScope);
    if (classification.status === "CONDITIONAL") clauseScope = "CONDITIONAL";
    if (clauseScope === "CONDITIONAL" && classification.status !== "CONDITIONAL") {
      classification.hints.push("INHERITED_CONDITION");
      classification.status = "CONDITIONAL";
    }
    const isContinuation = continuation && item.categories[0].code === "UNCLASSIFIED" &&
      /^(?:但|还|并且|然后|其中|分别|金额|每月|下月|下个月|明天|今天|月底|月初|\d|[零一二两三四五六七八九十百千万]|改成|改为|不是|已|没|未|不)/u.test(item.text);
    const link = isContinuation || (continuation && classification.status === "CORRECTION");
    if (continuation && previous?.classification.subject === "THIRD_PARTY" && classification.subject === "UNSPECIFIED") {
      classification.subject = "THIRD_PARTY";
    }
    const result = {
      ...item,
      classification,
      related_candidate_id: link ? previous.candidate_id : null,
      inherited_categories: isContinuation ? [...previous.categories, ...previous.inherited_categories].filter(c => c.code !== "UNCLASSIFIED") : [],
      relationship_status: link ? "NEEDS_CONFIRMATION" : null,
      planning_eligibility: "NEEDS_USER_AND_SOURCE_VERIFICATION",
      warnings: ["识别结果需要核对；不是账户事实、风险结论或执行授权。"]
    };
    if (classification.status === "CORRECTION") result.warnings.push("金额有更正，原句保留；不会自动采用较小的金额。");
    if (classification.status === "AMBIGUOUS") {
      result.warnings.push("这句话包含不确定或冲突的意图，不能当成已决定的收支。");
      result.confirmation_questions.push("你最终是决定进行、决定不进行，还是暂时只想咨询？请明确后再继续。");
    }
    if (item.amount_mentions.length > 1) result.warnings.push("一句话有多个金额，请分别对应具体用途。");
    if (classification.subject === "THIRD_PARTY") result.warnings.push("可能是他人的情况，不计入你的收支。");
    previous = result;
    return result;
  });
  return {
    ...original, draft_version: VERSION, channel: input.channel || "text", data_mode: input.data_mode,
    speech_recognition_performed: false, candidates,
    interpretation_sha256: hash({ version: VERSION, text, data_mode: input.data_mode, candidates }),
    confirmation: null
  };
}

class IntakeSessions {
  constructor({ now = () => new Date(), ttlMs = 30 * 60 * 1000, capacity = 128 } = {}) {
    this.now = now;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || !Number.isSafeInteger(capacity) || capacity < 1) throw new TypeError("Invalid session limits");
    this.ttlMs = ttlMs;
    this.capacity = capacity;
    this.sessions = new Map();
  }
  prune() {
    for (const [id, value] of this.sessions) if (this.now().getTime() >= value.expires_at_ms) this.sessions.delete(id);
  }
  create(input) {
    this.prune();
    if (this.sessions.size >= this.capacity) fail("INTAKE_CAPACITY", "Too many active drafts");
    const draft = { ...extract(input, { now: this.now }), draft_id: "intake-" + randomUUID(), revision: 1 };
    this.sessions.set(draft.draft_id, { draft, expires_at_ms: this.now().getTime() + this.ttlMs });
    return copy(draft);
  }
  match(input) {
    this.prune();
    const stored = this.sessions.get(input?.draft_id);
    if (!stored) fail("INTAKE_NOT_FOUND", "Draft is missing or expired");
    if (input.revision !== stored.draft.revision || input.interpretation_sha256 !== stored.draft.interpretation_sha256) {
      fail("INTAKE_CHANGED", "The draft changed; review and confirm the latest version");
    }
    return stored;
  }
  revise(input) {
    const stored = this.match(input);
    const draft = extract({ text: input.text, data_mode: stored.draft.data_mode, channel: "text" }, { now: this.now });
    stored.draft = { ...draft, draft_id: stored.draft.draft_id, revision: stored.draft.revision + 1,
      corrected_from_channel: stored.draft.channel };
    return copy(stored.draft);
  }
  attachPlan(input) {
    const stored = this.match(input);
    if (input.plan_input?.data_mode !== stored.draft.data_mode) fail("DATA_MODE_MISMATCH", "The plan and text must use the same declared data mode");
    const { planPurchases } = require("./planning");
    const plan = planPurchases(input.plan_input);
    if (stored.draft.attached_plan?.plan_sha256 === plan.plan_sha256) return copy(stored.draft);
    // New quote or bill evidence revokes the text/plan confirmation as one revision.
    stored.draft = { ...stored.draft, revision: stored.draft.revision + 1, attached_plan: plan,
      interpretation_sha256: hash({ version: VERSION, source: stored.draft.input_sha256, plan }),
      confirmation: null, status: "AWAITING_USER_CONFIRMATION" };
    return copy(stored.draft);
  }
  confirm(input) {
    const stored = this.match(input);
    const expected = stored.draft.candidates.map(c => c.candidate_id).sort();
    const received = input.reviewed_candidate_ids;
    if (input.confirmed !== true || !Array.isArray(received) ||
        JSON.stringify([...received].sort()) !== JSON.stringify(expected)) {
      fail("INTAKE_INCOMPLETE", "Every candidate must be reviewed, including negations and unknown fields");
    }
    if (stored.draft.attached_plan && input.reviewed_plan_sha256 !== stored.draft.attached_plan.plan_sha256) {
      fail("PLAN_UNCONFIRMED", "Review the current quote and bill calculation before confirming");
    }
    stored.draft.confirmation ||= { receipt_id: "confirmation-" + randomUUID(),
      confirmed_at: this.now().toISOString(), scope: stored.draft.attached_plan ? "TEXT_AND_PLAN_REVIEW_ONLY" : "TEXT_AND_CANDIDATE_REVIEW_ONLY",
      reviewed_plan_sha256: stored.draft.attached_plan?.plan_sha256 ?? null,
      trusted_account_verified: false, memory_authorized: false, risk_approved: false };
    stored.draft.status = "USER_REVIEWED_UNVERIFIED_FACTS";
    return copy(stored.draft);
  }
  reviewRequest(input) {
    const { draft } = this.match(input);
    if (!draft.confirmation) fail("INTAKE_UNCONFIRMED", "Review the text before preparing a model request");
    const categories = new Set(draft.candidates.flatMap(c => [...c.categories, ...c.inherited_categories].map(x => x.code)));
    const scenario = categories.has("LIVING_COST") ? "FUNDING_CONFLICT" : categories.has("SHOPPING")
      ? "DOUBLE11_COMPARE" : categories.has("SUBSCRIPTION") ? "SUBSCRIPTION_REVIEW" : "GENERAL_REVIEW";
    const context = { intake_draft_version: VERSION, interpretation_sha256: draft.interpretation_sha256,
      confirmation: draft.confirmation, input_authority: "USER_REVIEWED_UNVERIFIED_FACTS",
      candidates: draft.candidates.map(c => ({ id: c.candidate_id, span: c.source_span,
        classification: c.classification, categories: c.categories.map(x => x.code),
        inherited_categories: c.inherited_categories.map(x => x.code), related: c.related_candidate_id })) };
    if (draft.attached_plan) {
      const plan = draft.attached_plan;
      context.plan = { plan_sha256: plan.plan_sha256, as_of: plan.as_of,
        input_authority: "USER_REVIEWED_UNVERIFIED_FACTS", known_purchase_and_bills_minor: plan.known_purchase_and_bills_minor,
        money_unit: "CNY_MINOR", incomplete: plan.incomplete, affordability: plan.affordability,
        quotes: plan.comparison.quotes, bills: plan.subscriptions.bills };
    }
    // Respect the locked model-review context limit; never silently truncate evidence.
    if (JSON.stringify(context).length > 12000) fail("CONTEXT_TOO_LARGE", "Split this draft into smaller reviewed messages");
    return {
      submitted: false, requires_source_verification: true, execution_allowed: false,
      request: normalizeReviewInput({ schema_version: "model-review.v1", text: draft.source_text, kind: "combined",
        source: "life-planning-experiment-v1", request_id: "req-" + draft.confirmation.receipt_id,
        idempotency_key: draft.interpretation_sha256 + ":" + draft.confirmation.receipt_id,
        data_mode: draft.data_mode, scenario, execution_mode: "PAPER", capability: "REVIEW_ONLY",
        memory_consent: false, allow_rule_fallback: false, output_formats: ["json"], context })
    };
  }
}

module.exports = { VERSION, MODES, extract, IntakeSessions, fail, hash };
