"use strict";
const { Sessions, binding, occurrences } = require("../../team-staging/risk/long-text/service.cjs");
const { fail, hash } = require("../../team-staging/risk/long-text/parser.cjs");

class LongTextBridge {
  constructor({ store, gateway, now = () => new Date() }) {
    Object.assign(this, { store, gateway, now });
    this.sessions = new Sessions({ now, capacity: 10 });
    this.sessions.sessions = new Map(Object.entries(store.data.long_text_drafts || {}));
  }
  save() {
    this.sessions.prune();
    this.store.transaction(data => { data.long_text_drafts = Object.fromEntries(this.sessions.sessions); return null; });
  }
  handle(operation, actor, payload) {
    if (operation === "restore") {
      if (!payload || Object.keys(payload).some(k => k !== "draft_id")) fail("INVALID_FIELDS", "恢复草稿只接收草稿编号");
      this.sessions.prune();
      const row = this.sessions.sessions.get(payload.draft_id);
      if (!row || row.owner !== actor) fail("NOT_FOUND", "草稿不存在、已过期或不属于当前会话", 404);
      return this.sessions.export(actor, binding(row.draft));
    }
    const methods = { intake: "create", revise: "revise", correct: "correct", confirm: "confirm", export: "export", "review-draft": "reviewRequest" };
    if (operation === "handoff") return this.handoff(actor, payload);
    const method = methods[operation];
    if (!method) fail("NOT_FOUND", "长文本接口不存在", 404);
    const result = this.sessions[method](actor, payload);
    this.save();
    const link = result.workbench_link;
    if (link && ["revise", "correct"].includes(operation) && link.source_binding.interpretation_sha256 !== result.interpretation_sha256) {
      const record = this.gateway.owner(link.task_id, actor);
      this.gateway.event("LONG_TEXT_SOURCE_REVISED", record, { source_binding: binding(result), execution_allowed: false });
      this.store.transaction(data => {
        const task = data.tasks[link.task_id];
        task.approval.status = "INVALIDATED"; task.input.approval.status = "INVALIDATED";
        if (task.model_review) { task.model_review_history ||= []; task.model_review_history.push(task.model_review); delete task.model_review; }
        return null;
      });
    }
    return result;
  }
  payload(draft) {
    const included = draft.items.filter(x => x.disposition === "INCLUDE");
    const expenses = included.filter(x => x.type === "EXPENSE").flatMap(x => occurrences(x, draft.through));
    const incomes = included.filter(x => x.type === "INCOME" && x.certainty === "EXPECTED").flatMap(x => occurrences(x, draft.through));
    const purposes = expenses.map(x => ({ purpose_id: "lt-" + x.occurrence_id, label: x.text.slice(0, 120), reserved_now_minor: x.amount_minor, remaining_due_minor: x.amount_minor, due_at: x.at }));
    if (purposes.length > 20 || incomes.length > 40) fail("WORKBENCH_EVENT_LIMIT", "工作台最多接收20个保护用途和40笔收入，请缩短测算区间后重新核对");
    const total = included.filter(x => x.type === "INVESTMENT").reduce((sum, x) => sum + x.amount_minor, 0);
    const p = draft.profile;
    return { contract_version: "daily-risk-workbench.v1", facts_confirmed: true, purposes_confirmed: true,
      snapshot: { currency: "CNY", as_of: draft.as_of, cash_ledger_minor: p.cash_minor, purposes,
        hard_floor: { state: p.hard_floor_minor ? "ENABLED_CONFIRMED" : "DISABLED_CONFIRMED", amount_minor: p.hard_floor_minor },
        income_events: incomes.map(x => ({ event_id: "lt-" + x.occurrence_id, label: x.text.slice(0, 120), amount_minor: x.amount_minor, status: "EXPECTED", at: x.at, included_in_balance: false })) },
      action: { type: "INVESTMENT", amount_minor: total, fees_minor: total ? p.fees_minor : 0, at: draft.as_of },
      note: "长文本已逐项核对；投资合计保守按分析日占用。原文及完整解析保存在本任务 long_text_source 中。" };
  }
  handoff(actor, payload) {
    this.sessions.export(actor, payload); // Validate the complete binding and allowed fields.
    const row = this.sessions.match(actor, payload), draft = row.draft;
    if (!draft.confirmation || !draft.result) fail("CONFIRMATION_REQUIRED", "先逐项核对当前版本的原文和资金事实");
    const sourceBinding = binding(draft), previous = draft.workbench_link;
    if (previous && previous.source_binding.interpretation_sha256 === draft.interpretation_sha256) {
      const existing = this.gateway.inspect(previous.task_id, actor);
      if (existing.ledger_stale || existing.source_stale) fail("STALE_WORKBENCH_TASK", "工作台账本或来源已变化，请重新核对当前资金", 409);
      return existing;
    }
    const request = this.payload(draft);
    let record;
    if (previous) {
      const old = this.gateway.inspect(previous.task_id, actor);
      record = this.gateway.revise(previous.task_id, actor, { ...request, task_id: previous.task_id, ledger_id: old.ledger_id, expected_ledger_revision: previous.ledger_revision }, { sourceBinding, reportedHoldMinor: draft.profile.existing_holds_minor });
    } else record = this.gateway.create(actor, request, { reportedHoldMinor: draft.profile.existing_holds_minor });
    const id = record.input.binding.task_id;
    const source = { binding: sourceBinding, source_text: draft.source_text, data_mode: draft.data_mode,
      as_of: draft.as_of, through: draft.through, profile: draft.profile, items: draft.items,
      confirmation: draft.confirmation, interpretation_hash: hash({ items: draft.items, profile: draft.profile }),
      authority: "USER_CONFIRMED_SYNTHETIC_NOT_ACCOUNT_EVIDENCE" };
    this.store.transaction(data => { data.tasks[id].long_text_source = structuredClone(source); return null; });
    draft.workbench_link = { task_id: id, ledger_id: record.ledger_id, ledger_revision: record.ledger_revision, source_binding: sourceBinding };
    this.save();
    record = this.gateway.inspect(id, actor);
    this.gateway.event("LONG_TEXT_HANDOFF_RECEIVED", record, { source_binding: sourceBinding, interpretation_hash: source.interpretation_hash, execution_allowed: false });
    return record;
  }
}
module.exports = { LongTextBridge };
