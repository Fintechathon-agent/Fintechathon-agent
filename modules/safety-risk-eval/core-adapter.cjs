"use strict";
const { randomUUID } = require("node:crypto");
const tools = require("../../chenchen/tools/financial-tools.js");
const { hash, read } = require("../../docs/safety-risk-eval/contracts/validate.cjs");
const { emptyApproval } = require("./gateway.cjs");
const { measure } = require("./engine.cjs");

function projectPlan(input) {
  const snapshot = input.upstream.artifacts.portfolio_snapshot;
  const candidate = input.upstream.artifacts.candidates.find((c) => c.proposal_id === input.binding.proposal_id);
  const quantities = Object.fromEntries(snapshot.positions.map((p) => [p.instrument_id, p.quantity]));
  const prices = Object.fromEntries(snapshot.positions.map((p) => [p.instrument_id, p.price]));
  const sellable = { ...quantities }, failures = [], steps = [];
  let cash = snapshot.cash;
  for (const step of input.plan.steps) {
    if (Math.abs(step.cash_before - cash) > .01) throw new Error("步骤开始现金与前序结果不一致");
    if (Object.entries(step.sellable_quantities).some(([id, qty]) => !(id in sellable) || qty > sellable[id])) throw new Error("步骤可卖数量超过可靠持仓");
    for (const order of step.orders) {
      const rule = input.data_context.trading_rules?.instruments.find((r) => r.instrument_id === order.instrument_id);
      if (!rule || input.data_context.trading_rules.source !== "SYNTHETIC_DEMO_RULES_ONLY" || rule.calendar_ref !== "demo-snapshot-day" || rule.settlement_ref !== "demo-next-step" || rule.fee_schedule_ref !== "demo-zero-fee" || step.replay_date !== snapshot.as_of.slice(0, 10)) throw new Error("缺少已验证的行情/交易日历/结算/费用模型；暂停该计划");
      if (order.reference_price !== prices[order.instrument_id] || order.estimated_fee !== 0 || order.quantity <= 0 || !Number.isInteger(order.quantity / rule.lot_size)) throw new Error("订单不符合明确标识的演示交易规则");
      const value = order.quantity * order.reference_price + order.estimated_fee;
      if (order.side === "BUY" && cash < value) { failures.push({ code: "INSUFFICIENT_CASH", message: "买入资金不足。", measurements: [measure("cash", cash, value, "CASH", null, "CNY", "LT")] }); continue; }
      if (order.side === "SELL" && order.quantity > Math.min(sellable[order.instrument_id] || 0, step.sellable_quantities[order.instrument_id] || 0)) { failures.push({ code: "INSUFFICIENT_SELLABLE_QUANTITY", message: "卖出数量超过可卖持仓。" }); continue; }
      if (order.side === "BUY") { cash -= value; quantities[order.instrument_id] += order.quantity; }
      else { cash += order.quantity * order.reference_price - order.estimated_fee; quantities[order.instrument_id] -= order.quantity; sellable[order.instrument_id] -= order.quantity; }
    }
    if (!failures.length && Math.abs(step.cash_after - cash) > .01) throw new Error("步骤结束现金与可复算金额不一致");
    steps.push({ step_id: step.step_id, cash_after: cash, held_instruments: Object.keys(quantities).filter((id) => quantities[id] > 0), quantities: { ...quantities } });
    Object.assign(sellable, quantities);
  }
  const total = cash + Object.keys(quantities).reduce((s, id) => s + quantities[id] * prices[id], 0);
  const finalWeights = Object.fromEntries(Object.keys(quantities).map((id) => [id, quantities[id] * prices[id] / total]));
  finalWeights.CASH = cash / total;
  if (!failures.length && Object.keys(candidate.target_weights).some((id) => Math.abs(candidate.target_weights[id] - (finalWeights[id] || 0)) > 1e-6)) throw new Error("候选目标配置尚未对应到可验证的完整交易步骤");
  return { steps, failures, cash, quantities, prices, total };
}

function fromHandoff(upstream, actor, { confirmed = false, reserveCash = 5000, maxDrawdown = .1, forbidden = [], planId = "A", now = new Date().toISOString() } = {}) {
  const input = read("examples/allow.input.json");
  const p = upstream.artifacts.portfolio_snapshot;
  const proposal = upstream.artifacts.candidates.find((c) => c.plan_id === planId);
  if (!proposal) throw new Error("UNKNOWN_PLAN");
  input.upstream = structuredClone(upstream);
  input.risk_request_id = `risk-request-${randomUUID()}`;
  input.requested_at = now;
  input.binding = { ...input.binding, request_id: upstream.request_id, handoff_id: upstream.risk_handoff.handoff_id, task_id: upstream.task_state.task_id, session_id: upstream.task_state.session_id, user_id: actor, proposal_id: proposal.proposal_id, proposal_hash: proposal.proposal_hash, plan_version: `plan-${randomUUID()}`, profile_version: `profile-${randomUUID()}`, constraints_version: `constraints-${randomUUID()}` };
  input.context.actor_user_id = actor; input.context.portfolio_owner_id = actor;
  input.context.identity_source = "DEMO_FIXTURE";
  input.profile = { ...input.profile, confirmed_by_user: confirmed, confirmed_by: confirmed ? actor : null, confirmed_at: confirmed ? now : null, reserve_cash: reserveCash, max_historical_drawdown: maxDrawdown, forbidden_instruments: forbidden, allowed_instruments: p.positions.map((p) => p.instrument_id), unknown_fields: confirmed ? [] : ["user_confirmation"] };
  input.plan.steps = [{ step_id: "step-hold-001", replay_date: p.as_of.slice(0, 10), orders: [], cash_before: p.cash, cash_after: p.cash, sellable_quantities: Object.fromEntries(p.positions.map((pos) => [pos.instrument_id, pos.quantity])) }];
  input.binding.plan_hash = hash(input.plan);
  input.data_context.as_of = p.as_of;
  input.data_context.classification = p.positions.map((pos) => ({ instrument_id: pos.instrument_id, sector_weights: { [pos.sector]: 1 }, unknown_weight: 0, source: "AUTHORED_DEMO_CLASSIFICATION_NOT_ETF_LOOKTHROUGH", as_of: p.as_of, taxonomy: "demo-sectors.v1", version: "demo-classification.v1" }));
  input.approval = emptyApproval();
  input.audit_context = { correlation_id: `audit-${upstream.task_state.task_id}`, pre_execution_record_status: "NOT_ATTEMPTED", pre_execution_record_id: null };
  return input;
}

async function executePlan(input, authorization) {
  // Revalidate every step before invoking the existing synthetic Paper Trading tool.
  const projected = projectPlan(input);
  if (projected.failures.length || projected.steps.some((s) => s.cash_after < input.profile.reserve_cash)) throw new Error("STEP_CHECK_FAILED");
  const candidate = input.upstream.artifacts.candidates.find((c) => c.proposal_id === input.binding.proposal_id);
  const result = tools.paperTrade({ snapshot: input.upstream.artifacts.portfolio_snapshot, proposal: candidate, approval: { status: "APPROVED", token: authorization.approvalId }, idempotency_key: authorization.idempotencyKey });
  if (!["FILLED", "IDEMPOTENT_REPLAY"].includes(result.output.status)) throw new Error("PAPER_TRADE_NOT_FILLED");
  return { status: "SUCCEEDED", mode: "SYNTHETIC_PAPER_ONLY", receipt: result.output.receipt, step_results: projected.steps, ledger: { cash: projected.cash, quantities: projected.quantities, total_value: projected.total }, limitation: "虚构历史回放；不是交易所成交，不支持真实账户。" };
}
module.exports = { fromHandoff, projectPlan, executePlan };
