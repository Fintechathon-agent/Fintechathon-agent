"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { CASES, POLICY, RULES, DemoSession, metrics } = require("../model.js");
function checked(id) {
  const session = new DemoSession(id);
  if (session.case.focusOptions) session.setFocus(session.case.focusOptions[0]);
  session.check(); return session;
}
function approved(id) {
  const session = checked(id);
  session.findings.filter(f => f.acknowledgeable).forEach(f => session.accept(f.id, true));
  session.fullPlan = true;
  assert.equal(session.approve(), true); return session;
}
for (const c of CASES) {
  test(`固定案例 ${c.id}：预设结论与确认门槛`, () => {
    const session = checked(c.id);
    assert.equal(session.decision, c.expected);
    assert.equal(session.canExecute, false);
    assert.equal(session.writeCount, 0);
    assert.ok(c.metrics.cash >= 0);
    assert.ok(Math.abs(c.metrics.cash + c.metrics.invested - 1) < 1e-10);
    if (c.expected === "BLOCK" || session.needsRepair) {
      session.fullPlan = true;
      session.findings.filter(f => f.acknowledgeable).forEach(f => session.accept(f.id, true));
      assert.equal(session.approve(), false);
      assert.equal(session.execute(), false);
    }
  });
}
test("预设财务事实与展示值吻合，两个分母均能单独触发", () => {
  const a = checked("single-invested").case.metrics;
  assert.ok(a.singleTotal < POLICY.total.single);
  assert.ok(a.singleInvested > POLICY.invested.single);
  const b = checked("single-total").case.metrics;
  assert.ok(b.singleTotal > POLICY.total.single);
  assert.ok(b.singleInvested < POLICY.invested.single);
  for (const c of CASES) for (const reason of c.findings) {
    const key = reason.code === "SINGLE_ASSET_LIMIT_EXCEEDED" ? "single" : reason.code === "TOP3_LIMIT_EXCEEDED" ? "top3" : reason.code === "SECTOR_LIMIT_EXCEEDED" ? "sector" : null;
    if (key) { const metric = c.metrics[`${key}${reason.basis.includes("投资") ? "Invested" : "Total"}`]; assert.ok(Math.abs(reason.actual - metric) < 1e-9, `${c.id}: ${key}`); }
  }
});
test("普通正常案例确实不超过已配置财务上限", () => {
  const c = CASES.find(c => c.id === "normal"), m = c.metrics;
  for (const basis of ["Total", "Invested"]) for (const key of ["single", "top3", "sector"]) assert.ok(m[`${key}${basis}`] <= POLICY[basis.toLowerCase()][key] + 1e-9);
});
test("等于上限为边界通过，展示精度不改变事实", () => {
  const single = checked("boundary-single").case.metrics;
  assert.ok(Math.abs(single.singleTotal - .35) < 1e-9);
  assert.ok(Math.abs(single.singleInvested - .50) < 1e-9);
  assert.ok(Math.abs(checked("boundary-sector").case.metrics.sectorTotal - .40) < 1e-9);
  assert.equal(checked("boundary-correlation").case.correlatedWeight, .40);
});
test("行业未知单列，不应用缺失映射，也不能覆盖已知硬超限", () => {
  const unknown = checked("industry-unknown");
  assert.equal(unknown.case.metrics.unknownTotal, .20);
  assert.ok(Math.abs(unknown.case.metrics.sectorTotal - .29) < 1e-9);
  const blocked = checked("known-sector-and-unknown");
  assert.equal(blocked.decision, "BLOCK");
  assert.ok(blocked.findings.some(f => f.acknowledgeable));
  assert.equal(blocked.canConfirm, false);
});
test("改善必须由用户选择重点；新增行业硬超限保持阻止", () => {
  const session = new DemoSession("improvement"); session.check();
  assert.ok(session.findings.some(f => f.code === "IMPROVEMENT_FOCUS_REQUIRED"));
  assert.equal(session.canConfirm, false);
  session.setFocus("单只资产集中度");
  assert.equal(session.decision, "PENDING"); session.check();
  assert.equal(session.canConfirm, true);
  const baseline = metrics(session.case.baselineWeights), target = session.case.metrics;
  for (const key of ["singleTotal", "singleInvested", "top3Total", "top3Invested"]) assert.ok(target[key] < baseline[key]);
  assert.equal(checked("improvement-blocked").decision, "BLOCK");
});
test("复核须逐项接受，原始复核结论在确认后仍保留", () => {
  const session = checked("multiple-review"); session.fullPlan = true;
  assert.equal(session.approve(), false);
  session.accept(session.findings[0].id, true);
  assert.equal(session.approve(), false);
  session.findings.filter(f => f.acknowledgeable).forEach(f => session.accept(f.id, true));
  assert.equal(session.approve(), true);
  assert.equal(session.decision, "REVIEW");
  assert.equal(session.canExecute, true);
});
test("关键依赖修复不能由确认替代，修复后必须重检", () => {
  for (const id of ["data-invalid", "check-failed", "audit-failed"]) {
    const session = checked(id); session.fullPlan = true;
    assert.equal(session.approve(), false); session.repair();
    assert.equal(session.decision, "PENDING"); assert.equal(session.canConfirm, false);
    session.check(); assert.equal(session.decision, "ALLOW");
    assert.equal(session.approval, "UNCONFIRMED");
  }
});
test("检查中及未确认阶段，无执行资格", () => {
  const session = new DemoSession("normal");
  assert.equal(session.execute(), false);
  session.startCheck(); assert.equal(session.decision, "CHECKING"); assert.equal(session.canConfirm, false);
  assert.equal(session.execute(), false); session.finishCheck();
  assert.equal(session.decision, "ALLOW"); assert.equal(session.execute(), false);
});
test("相关版本变化使旧授权失效，历史确认记录保留", () => {
  const session = approved("version-change");
  assert.equal(session.canExecute, true); session.invalidateVersion();
  assert.equal(session.approval, "INVALIDATED"); assert.equal(session.canExecute, false);
  assert.equal(session.execute(), false);
  assert.ok(session.audit.some(a => a.event_type === "PLAN_APPROVED" && a.proposal_version === 1));
  assert.equal(session.proposalVersion, 2);
});
test("确认内容绑定不同版本，即使保留已确认状态也不能执行", () => {
  for (const field of ["proposalVersion", "profileVersion", "ruleVersion", "dataVersion", "checkId"]) {
    const session = approved("normal"); session[field] = `${session[field]}-changed`;
    assert.equal(session.canExecute, false, field);
  }
});
test("用户拒绝与撤回都不生成成功回执", () => {
  const rejected = checked("reject"); rejected.reject();
  assert.equal(rejected.approval, "REJECTED"); assert.equal(rejected.execute(), false); assert.equal(rejected.receipt, null);
  const revoked = approved("reject"); revoked.revoke();
  assert.equal(revoked.approval, "INVALIDATED"); assert.equal(revoked.execute(), false); assert.equal(revoked.receipt, null);
});
test("授权原因独立记录，不改变通过的风险结论", () => {
  const session = checked("normal");
  assert.equal(session.decision, "ALLOW"); assert.equal(session.authorizationReasons[0].code, "APPROVAL_REQUIRED");
  session.reject(); assert.equal(session.decision, "ALLOW");
  assert.equal(session.authorizationReasons[0].code, "APPROVAL_REJECTED");
  assert.equal(session.audit.at(-1).authorization_reasons[0].code, "APPROVAL_REJECTED");
  const invalidated = approved("version-change"); invalidated.invalidateVersion();
  assert.equal(invalidated.audit.at(-1).authorization_reasons[0].code, "APPROVAL_INVALIDATED");
});
test("重复请求只返回原回执；执行进行中也不能再发起", () => {
  const session = approved("repeat"); session.beginExecute();
  assert.equal(session.beginExecute(), false); session.finishExecute();
  const receipt = session.receipt;
  assert.equal(session.replay(), receipt); assert.equal(session.writeCount, 1);
  assert.equal(session.execute(), false);
  assert.equal(session.audit.filter(a => a.event_type === "EXECUTION_INTENT_RECORDED").length, 1);
});
test("结果未知不当失败、不能重发；核查只恢复原回执", () => {
  const session = approved("unknown-result"); session.execute();
  assert.equal(session.execution, "UNKNOWN"); assert.equal(session.export().write_count, null);
  assert.equal(session.receipt, null); assert.equal(session.execute(), false); assert.equal(session.canConfirm, false);
  session.reconcile(); assert.equal(session.execution, "SUCCEEDED"); assert.equal(session.writeCount, 1);
  assert.equal(session.audit.filter(a => a.event_type === "EXECUTION_STARTED").length, 1);
  assert.equal(session.reconcile(), false);
});
test("同一标识不同内容阻止，明确失败不生成成功回执", () => {
  const session = approved("idempotency-conflict"); session.execute(); session.conflictKey();
  assert.equal(session.decision, "BLOCK"); assert.equal(session.replay(), false); assert.equal(session.writeCount, 1);
  const failed = approved("execution-failed"); failed.execute();
  assert.equal(failed.execution, "FAILED"); assert.equal(failed.receipt, null); assert.equal(failed.writeCount, 0);
  assert.ok(failed.audit.some(a => a.event_type === "EXECUTION_FAILED"));
});
test("必要审计在执行前；不可写不得继续；缺口不冒充记录", () => {
  const session = approved("normal"); session.execute();
  const before = session.audit.findIndex(a => a.event_type === "EXECUTION_INTENT_RECORDED");
  const after = session.audit.findIndex(a => a.event_type === "EXECUTION_STARTED");
  assert.ok(before >= 0 && before < after);
  const fault = checked("audit-failed"); assert.equal(fault.audit.length, 0); assert.ok(fault.faults.length > 0);
  assert.equal(fault.canConfirm, false);
  const lost = approved("normal"); lost.auditAvailable = false; assert.equal(lost.beginExecute(), false); assert.equal(lost.writeCount, 0);
});
test("风险记录含必需版本、原因、口径、确认与执行关联", () => {
  const session = approved("drawdown"); session.execute();
  const event = session.audit.at(-1);
  for (const field of ["task_id", "session_id", "user_id", "proposal_version", "profile_version", "rule_version", "data_version", "data_mode", "data_source", "data_window", "full_plan", "baseline_metrics", "check_id", "risk_decision", "risk_reasons", "authorization_reasons", "metrics", "thresholds", "allowed_functions", "paused_functions", "fail_closed", "fail_closed_reason_codes", "accepted_reason_ids", "approval_record", "execution_key", "timestamp"]) assert.ok(field in event, field);
  assert.equal(event.risk_decision, "REVIEW");
  assert.equal(event.risk_reasons[0].code, "MAX_DRAWDOWN_EXCEEDED");
  assert.equal(session.export().persistent_audit, false);
  assert.equal(RULES.length, 10);
});
