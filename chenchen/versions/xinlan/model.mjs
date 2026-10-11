// Browser-only fixtures. These are not API schemas, risk rules or authorization controls.
export const decisionLabels = Object.freeze({ ALLOW: "风险检查通过", REVIEW: "需要进一步核实", BLOCK: "操作已拦截", ERROR: "风险检查暂不可用" });
export const reviewLabels = Object.freeze({ NOT_REQUIRED: "无需复核", PENDING: "待复核", IN_REVIEW: "复核中", RESOLVED: "复核已记录" });
export function decisionLabel(value) { return decisionLabels[value] || "风险状态待确认"; }
export function reviewLabel(value) { return reviewLabels[value] || "复核状态待确认"; }
export function fixtures() {
  return [
    { id: "DEMO-001", title: "调整计划需要补充说明", decision: "REVIEW", review: "PENDING", category: "计划核实", time: "2026-10-11 09:42", amount: 12800, reason: "这份虚构案例的资金用途说明尚不完整，需要核实后再继续。", next: "核对计划用途与资金来源，补充说明；不要重复提交。", evidence: "界面样例：用途说明缺失。并非真实风控规则计算结果。", read: false },
    { id: "DEMO-002", title: "重复操作已在演示中阻止", decision: "BLOCK", review: "PENDING", category: "操作保护", time: "2026-10-11 09:18", amount: 3600, reason: "这份虚构案例展示重复操作保护，模拟执行流程已暂停。", next: "先查看原操作记录，确认是否已有回执；没有回执请等待核实。", evidence: "界面样例：重复请求场景。未调用银行接口。", read: false },
    { id: "DEMO-003", title: "计划风险检查已通过", decision: "ALLOW", review: "NOT_REQUIRED", category: "计划检查", time: "2026-10-11 08:56", amount: 5000, reason: "这份虚构案例的风险检查结果为通过，仍不代表交易完成。", next: "阅读完整计划、费用及风险说明；用户确认与模拟执行尚未接入本页面。", evidence: "界面样例：通过状态。无实际交易回执。", read: true },
    { id: "DEMO-004", title: "风险检查暂时无法完成", decision: "ERROR", review: "PENDING", category: "服务异常", time: "2026-10-10 16:20", amount: null, reason: "这份虚构案例展示检查服务不可用时的状态，不能据此判断操作安全。", next: "暂停操作，待服务恢复后重新检查；不要以未知状态继续执行。", evidence: "界面样例：服务异常。没有可用判定。", read: true }
  ];
}
export function createDemo() { return { events: fixtures(), audit: [], sequence: 0 }; }
export function appendAudit(state, event, action, actor, note = "") {
  state.sequence += 1;
  state.audit.unshift({ id: "LOCAL-" + state.sequence, eventId: event.id, action, actor, note, decision: event.decision, review: event.review, time: new Date().toISOString() });
}
export function acknowledge(state, id) {
  const event = state.events.find(item => item.id === id);
  if (!event || event.read) return false;
  event.read = true;
  appendAudit(state, event, "标记通知已读（模拟）", "普通用户");
  return true;
}
export function recordReview(state, id, actor, note) {
  const event = state.events.find(item => item.id === id);
  const clean = typeof note === "string" ? note.trim() : "";
  // Presentation gating only. Real authorization must run on the server.
  if (!event || !["analyst", "supervisor"].includes(actor) || !["PENDING", "IN_REVIEW"].includes(event.review) || clean.length < 5 || clean.length > 500) return false;
  event.review = actor === "supervisor" ? "RESOLVED" : "IN_REVIEW";
  appendAudit(state, event, actor === "supervisor" ? "记录复核结论（模拟）" : "提交复核意见（模拟）", actor === "supervisor" ? "风控主管" : "风控分析员", clean);
  return true;
}
export function overview(events) {
  return { total: events.length, pending: events.filter(item => ["PENDING", "IN_REVIEW"].includes(item.review)).length, unread: events.filter(item => !item.read).length };
}
export function parseRoute(hash) {
  const [workspace, page, id] = hash.replace(/^#/, "").split("/");
  const pages = { personal: ["dashboard", "assistant", "alerts", "event", "history"], console: ["overview", "queue", "review", "audit"], admin: ["access"] };
  return pages[workspace]?.includes(page) ? { workspace, page, id } : { workspace: "personal", page: "dashboard" };
}
