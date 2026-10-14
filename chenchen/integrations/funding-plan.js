"use strict";

const { randomUUID } = require("node:crypto");
const { ReviewError } = require("./model-review");
const VERSION = "funding-plan-demo.v1";
const MAX_MINOR = 1000000000000;
const copy = value => structuredClone(value);
const timestamp = () => new Date().toISOString();
const normalizedPurposes = purposes => purposes.map(item => ({ purpose_id: item.purpose_id, label: item.label, amount_minor: item.amount_minor }))
  .sort((a, b) => a.purpose_id.localeCompare(b.purpose_id));
const sameSnapshot = (plan, input) => plan.cash_minor === input.cash_minor &&
  JSON.stringify(normalizedPurposes(plan.protected_purposes)) === JSON.stringify(normalizedPurposes(input.protected_purposes));

function fail(code, message, details = null, statusCode = 409) {
  throw new ReviewError(code, message, { statusCode, stage: "FUNDING_GUARD", details,
    recovery: "核对演示资金计划。资金用途或版本改变后，请创建新任务并重新完成 Risk 和审批。" });
}
function minor(value, field, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > MAX_MINOR) {
    fail("INVALID_FUNDING_INPUT", field + " 必须是范围内的整数分。", null, 422);
  }
  return value;
}
function validatePlan(input, updating) {
  const allowed = ["synthetic", "confirmed", "currency", "cash_minor", "protected_purposes", ...(updating ? ["plan_id", "expected_revision"] : [])];
  if (!input || Object.keys(input).some(key => !allowed.includes(key)) || input.synthetic !== true || input.confirmed !== true || input.currency !== "CNY") {
    fail("INVALID_FUNDING_INPUT", "请明确确认虚构资金安排；仅支持 CNY，不能传入已有占用或历史记录。", null, 422);
  }
  minor(input.cash_minor, "cash_minor");
  if (!Array.isArray(input.protected_purposes) || input.protected_purposes.length > 20) fail("INVALID_FUNDING_INPUT", "protected_purposes 必须是最多20项的数组。", null, 422);
  const seen = new Set();
  for (const item of input.protected_purposes) {
    if (!item || Object.keys(item).some(key => !["purpose_id", "label", "amount_minor"].includes(key)) ||
        ![item.purpose_id, item.label].every(v => typeof v === "string" && v.trim() && v.length <= 100) || seen.has(item.purpose_id)) {
      fail("INVALID_FUNDING_INPUT", "每项用途需要独立编号、名称和金额。", null, 422);
    }
    seen.add(item.purpose_id);
    minor(item.amount_minor, "amount_minor", true);
  }
  if (input.protected_purposes.reduce((sum, item) => sum + item.amount_minor, 0) > input.cash_minor) {
    fail("INVALID_FUNDING_INPUT", "预留用途不能超过本次确认的资金总额。", null, 422);
  }
}

class FundingPlanStore {
  constructor() { this.plans = new Map(); }
  save(plan) { this.plans.set(plan.plan_id, copy(plan)); return copy(plan); }
  require(planId) {
    const plan = this.plans.get(planId);
    if (!plan) fail("FUNDING_PLAN_NOT_FOUND", "没有找到演示资金计划。", null, 404);
    return copy(plan);
  }
  create(input) {
    validatePlan(input, false);
    const plan = { plan_version: VERSION, plan_id: "funding-demo-" + randomUUID(), revision: 1,
      authority: "DEMO_USER_CONFIRMED_NOT_TRUSTED_MEMORY", synthetic: true, currency: "CNY",
      cash_minor: input.cash_minor, protected_purposes: copy(input.protected_purposes), allocations: [], revisions: [] };
    plan.revisions.push({ revision: 1, cash_minor: plan.cash_minor, protected_purposes: copy(plan.protected_purposes), confirmed_at: timestamp() });
    return this.summary(this.save(plan));
  }
  revise(input) {
    validatePlan(input, true);
    const plan = this.require(input.plan_id);
    if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision !== plan.revision) fail("FUNDING_PLAN_CHANGED", "资金计划已更新，请重新读取后确认。", { current_revision: plan.revision });
    if (sameSnapshot(plan, input)) return this.summary(plan);
    if (plan.revisions.length >= 100) fail("FUNDING_DEMO_LIMIT", "当前演示计划已达到100次确认上限。请创建新的虚构计划。");
    plan.revision++;
    plan.cash_minor = input.cash_minor;
    plan.protected_purposes = copy(input.protected_purposes);
    plan.revisions.push({ revision: plan.revision, cash_minor: plan.cash_minor, protected_purposes: copy(plan.protected_purposes), confirmed_at: timestamp() });
    return this.summary(this.save(plan));
  }
  summary(planOrId) {
    const plan = typeof planOrId === "string" ? this.require(planOrId) : copy(planOrId);
    const protectedMinor = plan.protected_purposes.reduce((sum, item) => sum + item.amount_minor, 0);
    const allocatedMinor = plan.allocations.reduce((sum, item) => sum + item.amount_minor, 0);
    return { ...plan, protected_minor: protectedMinor, allocated_minor: allocatedMinor,
      available_minor: Math.max(0, plan.cash_minor - protectedMinor - allocatedMinor),
      deficit_minor: Math.max(0, protectedMinor + allocatedMinor - plan.cash_minor), execution_allowed: false };
  }
  bind(parameters = {}) {
    if (!Object.hasOwn(parameters, "funding_plan_id") && !Object.hasOwn(parameters, "funding_plan_revision")) return null;
    const amountMinor = Math.round(parameters.amount * 100);
    if (typeof parameters.funding_plan_id !== "string" || !parameters.funding_plan_id ||
        !Number.isSafeInteger(parameters.funding_plan_revision) || parameters.funding_plan_revision < 1 ||
        parameters.synthetic !== true || parameters.currency !== "CNY" || typeof parameters.amount !== "number" ||
        !Number.isFinite(parameters.amount) || Math.abs(parameters.amount * 100 - amountMinor) > 0.00001) {
      fail("INVALID_FUNDING_INPUT", "绑定资金计划需提供编号、版本、CNY金额和 synthetic=true；金额最多两位小数。", null, 422);
    }
    minor(amountMinor, "amount", true);
    const plan = this.require(parameters.funding_plan_id);
    if (plan.revision !== parameters.funding_plan_revision) fail("FUNDING_PLAN_CHANGED", "资金安排版本已变化，请使用当前版本重新发起。", { current_revision: plan.revision });
    return { guard_version: VERSION, plan_id: plan.plan_id, revision: plan.revision, amount_minor: amountMinor,
      currency: "CNY", authority: plan.authority, cash_minor: plan.cash_minor,
      protected_purposes: copy(plan.protected_purposes) };
  }
  check(binding) {
    const plan = this.summary(binding.plan_id);
    const common = { guard_version: VERSION, plan_id: plan.plan_id, bound_revision: binding.revision,
      current_revision: plan.revision, requested_minor: binding.amount_minor, available_minor: plan.available_minor,
      protected_minor: plan.protected_minor, allocated_minor: plan.allocated_minor, deficit_minor: plan.deficit_minor,
      execution_allowed: false };
    if (plan.revision !== binding.revision) return { ...common, status: "BLOCKED", code: "FUNDING_PLAN_CHANGED", message: "资金安排已经变化，请重新复核和审批。" };
    if (plan.deficit_minor || binding.amount_minor > plan.available_minor) return { ...common, status: "BLOCKED", code: "FUNDING_CONFLICT",
      shortfall_minor: Math.max(binding.amount_minor - plan.available_minor, plan.deficit_minor), message: "本次金额会占用已预留或已被其他任务使用的钱。" };
    return { ...common, status: "AVAILABLE", code: null, message: "当前演示余额足够；仍需 Risk 和必要审批，模拟前会再检查。" };
  }
  allocate(binding, taskId, proposalHash, executionId) {
    const check = this.check(binding);
    if (check.status !== "AVAILABLE") fail(check.code, check.message, check);
    const plan = this.require(binding.plan_id);
    if (plan.allocations.some(item => item.task_id === taskId)) fail("FUNDING_ALLOCATION_EXISTS", "该任务已占用演示资金，不能重复占用。");
    if (plan.allocations.length >= 100) fail("FUNDING_DEMO_LIMIT", "当前演示计划已达到100个占用上限。");
    const allocation = { allocation_id: "allocation-" + randomUUID(), task_id: taskId, proposal_sha256: proposalHash,
      execution_id: executionId, revision: binding.revision, amount_minor: binding.amount_minor, created_at: timestamp(), mode: "SIMULATED", side_effects: false };
    plan.allocations.push(allocation);
    this.save(plan);
    return { allocation, check: { ...check, status: "ALLOCATED", available_after_minor: check.available_minor - binding.amount_minor } };
  }
}

module.exports = { VERSION, FundingPlanStore };
