import { createDemo, decisionLabel, reviewLabel, acknowledge, recordReview, overview, parseRoute } from "./model.mjs";
let state = createDemo();
let role = "personal";
let route = parseRoute(location.hash);
let filter = "";
let search = "";
let toastTimer;
const content = document.querySelector("#content");
const arrow = '<svg class="arrow-ne" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 9 9 3M4.5 3H9v4.5"/></svg>';
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const links = {
  personal: [["dashboard", "风险概况"], ["assistant", "AI 金融助理"], ["alerts", "风险提醒"], ["history", "历史记录"]],
  console: [["overview", "Risk Overview"], ["queue", "Case Queue"], ["review", "Case Review"], ["audit", "Audit Logs"]],
  admin: [["access", "权限边界"]]
};
const badge = (event, internal = false) => '<span class="badge ' + event.decision + '">' + (internal ? escape(event.decision) : decisionLabel(event.decision)) + "</span>";
const reviewBadge = event => '<span class="badge">' + reviewLabel(event.review) + "</span>";
function toast(message) {
  clearTimeout(toastTimer);
  document.querySelector("#toast").textContent = message;
  toastTimer = setTimeout(() => { document.querySelector("#toast").textContent = ""; }, 4500);
}
function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}
function heading(kicker, title, description, action = "") {
  return '<div class="page-heading"><div><p class="eyebrow">' + kicker + '</p><h1>' + title + '</h1><p>' + description + "</p></div>" + action + "</div>";
}
function metric(label, value, note, highlight = false) {
  return '<article class="card' + (highlight ? " highlight" : "") + '"><span class="card-label">' + label + '</span><strong class="metric-number">' + value + '</strong><span class="card-note">' + note + "</span></article>";
}
function rows(events, internal = false) {
  return events.map(event => '<article class="event-row"><div><h3><a href="#' + (internal ? "console/review" : "personal/event") + "/" + event.id + '">' + escape(event.title) + '</a></h3><p>' + event.time + ' · ' + event.category + ' · 虚构案例</p></div><div>' + badge(event, internal) + "</div></article>").join("");
}
function dashboard() {
  const summary = overview(state.events);
  return heading("YOUR FINANCIAL PERSPECTIVE", "看清风险，再做决定。", "每一条提醒都有解释，每一步操作都由你确认。", '<a class="primary-link" href="http://127.0.0.1:4319/investment">进入投资工作台 &nbsp;' + arrow + "</a>") +
    '<section class="cards" aria-label="模拟风险概况">' +
    metric("需要你关注的提醒", summary.unread, "当前样例未读数量 · 非真实账户", true) +
    metric("等待核实的案例", summary.pending, "包含服务异常与模拟拦截") +
    metric("金融健康评分", "未提供", "尚无经验证的评分模型") + '</section><div class="two-column"><section class="panel"><div class="section-header"><h2>最近风险动态</h2><a href="#personal/history">全部记录 ' + arrow + "</a></div>" + rows(state.events.slice(0, 3)) +
    '</section><section class="panel"><p class="eyebrow">UNDERSTAND · CONFIRM</p><h2>把每一步交还给你</h2><ol class="steps"><li><b>01</b><span><strong>先理解风险原因</strong>查看事件说明与可披露的依据。</span></li><li><b>02</b><span><strong>再核对处理指引</strong>需要核实时暂停操作，等待补充。</span></li><li><b>03</b><span><strong>最后亲自确认计划</strong>内部复核不代替你的完整计划确认。</span></li></ol><a class="subtle-link" href="#personal/assistant">让助理解释这些状态 ' + arrow + '</a><p class="note">风险概况不等于 Financial Health Score；风险检查结果也不等于 Transaction Risk Level。</p></section></div>';
}
function personalList(history = false) {
  const events = state.events.filter(event => !filter || event.decision === filter);
  return heading(history ? "YOUR RECORDS" : "RISK NOTIFICATIONS", history ? "历史记录" : "风险提醒", "固定虚构案例，展示风险原因、处理指引与复核进展。") +
    '<div class="filters"><label>风险状态 <select id="decision-filter"><option value="">全部状态</option>' + ["ALLOW", "REVIEW", "BLOCK", "ERROR"].map(value => '<option value="' + value + '"' + (filter === value ? " selected" : "") + ">" + decisionLabel(value) + "</option>").join("") + '</select></label></div><section class="panel">' +
    (events.length ? rows(events) : '<div class="empty">暂无匹配提醒。</div>') + "</section>";
}
function detail(internal = false) {
  const event = state.events.find(item => item.id === route.id);
  if (!event) return heading("CASE DETAIL", internal ? "选择一个案件" : "未找到风险事件", "请从列表选择有效的模拟案例。") + '<a class="primary-link" href="#' + (internal ? "console/queue" : "personal/alerts") + '">返回列表</a>';
  const audit = state.audit.filter(item => item.eventId === event.id);
  return '<a class="back" href="#' + (internal ? "console/queue" : "personal/alerts") + '">返回' + (internal ? "案件队列" : "风险提醒") + "</a>" +
    heading(internal ? "CASE REVIEW / " + event.id : "RISK EVENT / " + event.id, escape(event.title), event.time + " · 固定虚构案例 · 非实时数据") +
    '<div class="two-column"><section class="panel"><h2>' + (internal ? "决策与复核分别追踪" : "了解当前状态") + '</h2><div class="split-status"><div><span class="detail-label">' + (internal ? "风险引擎决策（固定样例）" : "风险检查结果（模拟）") + "</span>" + badge(event, internal) +
    '</div><div><span class="detail-label">案件复核进展（模拟）</span>' + reviewBadge(event) + '</div></div><p class="detail-copy">' + escape(event.reason) + '</p><div class="callout"><h3>下一步可以做什么</h3><p>' + escape(event.next) +
    '</p></div><h3>可披露的依据</h3><p class="muted">' + escape(event.evidence) + '</p><p class="note">模拟金额：' + (event.amount === null ? "未提供" : "¥ " + event.amount.toLocaleString("zh-CN")) +
    ' · 无真实成交或拦截回执。<br>已读通知、内部复核、用户确认和交易执行是不同步骤。</p>' +
    (!internal ? '<button id="acknowledge" class="primary"' + (event.read ? " disabled" : "") + '>' + (event.read ? "通知已读" : "我已阅读提醒") + "</button>" : "") +
    '</section><div class="stack">' + (internal ? reviewForm(event) : '<section class="panel"><h2>处理进度</h2><p>' + reviewLabel(event.review) + '</p><p class="muted">内部复核意见不会自动改变风险检查结果，也不会替你确认完整计划。</p><a class="subtle-link" href="#personal/assistant">查看常见问题</a></section>') +
    '<section class="panel"><h2>' + (internal ? "该案件本地日志" : "本次演示处理记录") + "</h2>" + auditList(audit, internal) + "</section></div></div>";
}
function reviewForm(event) {
  const canReview = ["analyst", "supervisor"].includes(role) && ["PENDING", "IN_REVIEW"].includes(event.review);
  return '<section class="panel"><h2>模拟复核记录</h2><p class="muted">仅更新当前页面中的演示状态，不调用审批接口、不放行交易。</p>' +
    (canReview ? '<form id="review-form"><label for="review-note">复核说明（5–500 字）</label><textarea id="review-note" rows="4" minlength="5" maxlength="500" required placeholder="记录核实依据与下一步建议"></textarea><div class="form-actions"><button class="primary" type="submit">' +
      (role === "supervisor" ? "记录模拟复核结论" : "提交模拟复核意见") + '</button></div><p id="review-error" class="form-error" role="alert"></p></form>' :
      '<p class="note">当前案例无需继续复核，或当前预览身份没有此演示操作。</p>') +
    '<p class="note">分析员意见进入“复核中”；主管记录进入“复核已记录”。以上仅为待审批流程样例，原风险决策保持不变。</p></section>';
}
function auditList(audit, internal = true) {
  return audit.length ? audit.map(item => '<article class="audit-item"><h3>' + escape(item.action) + '</h3><small>' + escape(item.time) + " · " + escape(item.actor) + " · " + escape(item.eventId) +
    '</small><p>' + escape(internal ? (item.note || "此动作不改变风险判定。") : "处理进展已更新；风险检查结果保持不变。") + "</p>" + (internal ? '<span class="mono">' + escape(item.decision) + " / " + escape(item.review) + " · " + escape(item.id) + "</span>" : "") + "</article>").join("") :
    '<p class="muted">尚无本次演示操作。记录只存在于当前页面，刷新或重置后清空。</p>';
}
function consoleOverview() {
  const summary = overview(state.events);
  return heading("RISK OPERATIONS", "Risk Overview", "关注需要核实的案例，把决策、复核与执行分开追踪。", '<a class="primary-link" href="#console/queue">打开案件队列 &nbsp;' + arrow + "</a>") +
    '<section class="cards">' + metric("模拟案例总数", summary.total, "固定样例集合 · 非生产统计") + metric("待处理复核", summary.pending, "待复核与复核中案例", true) + metric("本次本地日志", state.audit.length, "非持久化服务端审计") +
    '</section><div class="two-column"><section class="panel"><div class="section-header"><h2>当前案件</h2><span class="mono">DEMO CASES</span></div>' + rows(state.events, true) +
    '</section><section class="panel"><p class="eyebrow">SEPARATE THE STATES</p><h2>三条独立的状态线</h2><ol class="steps"><li><b>01</b><span><strong>风险引擎决策</strong>ALLOW / REVIEW / BLOCK；ERROR 为检查异常。</span></li><li><b>02</b><span><strong>案件复核流程</strong>待复核、复核中、复核已记录。</span></li><li><b>03</b><span><strong>用户确认与执行</strong>本页面未接入，不由复核状态推断。</span></li></ol><p class="note">主管记录结论不覆盖 BLOCK；系统管理员不默认拥有金融业务审批权限。</p></section></div>';
}
function queue() {
  return heading("CASE QUEUE", "让每一件风险都有去向", "按决策筛选、按编号定位；所有记录均为固定虚构案例。") +
    '<div class="filters"><label>风险决策 <select id="decision-filter"><option value="">全部决策</option>' +
    ["ALLOW", "REVIEW", "BLOCK", "ERROR"].map(value => '<option value="' + value + '"' + (filter === value ? " selected" : "") + ">" + value + "</option>").join("") +
    '</select></label><label>查找案件 <input id="case-search" type="search" placeholder="案件编号或标题" value="' + escape(search) + '"></label></div><div id="queue-results">' + queueTable() + "</div>";
}
function queueTable() {
  const events = state.events.filter(item => (!filter || item.decision === filter) && (item.id + item.title).toLowerCase().includes(search.toLowerCase()));
  if (!events.length) return '<div class="empty"><h2>没有匹配的案件</h2><p>调整筛选条件或搜索词后再试。</p></div>';
  return '<p class="muted">窄屏可横向滚动表格，查看决策与复核状态。</p><div class="table-wrap" tabindex="0" role="region" aria-label="模拟案件表格，可横向滚动"><table><caption class="skip">模拟案件队列</caption><thead><tr><th scope="col">案件 / 时间</th><th scope="col">风险事件</th><th scope="col">引擎决策</th><th scope="col">复核流程</th><th scope="col">操作</th></tr></thead><tbody>' +
    events.map(event => '<tr><td><span class="mono">' + event.id + '</span><br><small>' + event.time + "</small></td><td>" + event.title + "</td><td>" + badge(event, true) + "</td><td>" + reviewBadge(event) + '</td><td><a href="#console/review/' + event.id + '" aria-label="复核 ' + event.id + '">查看案件 ' + arrow + "</a></td></tr>").join("") + "</tbody></table></div>";
}
const answers = [
  ["为什么需要进一步核实？", "表示有信息需要补充或核对，并不等于交易成功或失败。查看对应事件的原因和下一步指引，等待核实期间不要重复提交。"],
  ["操作已拦截，资金被扣了吗？", "本演示没有连接银行或真实资金。“操作已拦截”仅表示模拟流程被阻止，没有真实扣款或银行拦截回执。"],
  ["为什么没有健康分数？", "当前没有经过验证的金融健康评分模型，所以只展示可解释的风险概况。Financial Health Score 与单次交易风险等级是不同概念，两者都不能凭空生成。"],
  ["内部复核能代替我确认吗？", "不能。风险决策、内部复核、用户完整计划确认和模拟执行分别记录；复核意见不会覆盖拦截结果，也不会代表你已确认计划。"]
];
function assistant() {
  return heading("AI FINANCIAL ASSISTANT", "先问清楚，再做选择。", "当前为固定问答演示，尚未接入 AI 服务；不提供投资建议。") +
    '<div class="two-column"><section class="panel"><h2>你可能想了解</h2><div class="question-list">' + answers.map(([question], index) => '<button data-question="' + index + '">' + question + "</button>").join("") +
    '</div><div id="assistant-answer" class="answer" role="status">选择一个问题，查看明确、可解释的处理说明。</div></section><section class="panel"><h2>关于这位助理</h2><p class="muted">这个版本展示对话入口和说明体验。回答来自预先编写的演示文案，不代表模型生成、账户分析或专业投资判断。</p><p class="note">后续接入需确认服务接口、可披露字段与证据来源。</p></section></div>';
}
function render() {
  route = parseRoute(location.hash);
  const expected = role === "personal" ? "personal" : role === "admin" ? "admin" : "console";
  const denied = route.workspace !== expected;
  document.querySelector("#workspace-label").textContent = expected === "personal" ? "PERSONAL HUB" : expected === "console" ? "RISK CONSOLE" : "SYSTEM ADMIN";
  document.querySelector("#navigation").innerHTML = links[expected].map(([page, title], index) => '<a class="nav-link" href="#' + expected + "/" + page + '"' + (route.workspace === expected && (route.page === page || (route.page === "event" && page === "alerts")) ? ' aria-current="page"' : "") + '><span class="nav-icon" aria-hidden="true">0' + (index + 1) + "</span>" + title + "</a>").join("");
  const title = links[expected].find(([page]) => page === route.page)?.[1] || (route.page === "event" ? "风险事件详情" : "页面预览");
  document.querySelector("#breadcrumb").textContent = (expected === "personal" ? "个人工作台" : expected === "console" ? "内部风控工作台" : "系统管理") + " / " + title;
  document.title = title + " · 金融工作台";
  if (denied) content.innerHTML = heading("PREVIEW BOUNDARY", "此页面不属于当前预览身份", "请选择顶部对应身份查看演示。这里的页面限制不是服务端权限保护。") + '<a class="primary-link" href="#' + expected + "/" + links[expected][0][0] + '">返回当前工作台</a>';
  else if (expected === "admin") content.innerHTML = heading("SYSTEM ADMIN", "系统管理与业务审批分离", "系统管理员不默认拥有金融业务审批权限。") + '<section class="panel"><h2>技术权限不等于金融授权</h2><p>本阶段不提供账号授权或业务审核操作。真实登录、能力授予与审计接口需要技术 Owner 批准后接入。</p><p class="note">当前选择仅用于预览界面，不代表已登录管理员账户。</p></section>';
  else if (route.page === "dashboard") content.innerHTML = dashboard();
  else if (route.page === "assistant") content.innerHTML = assistant();
  else if (route.page === "alerts" || route.page === "history") content.innerHTML = personalList(route.page === "history");
  else if (route.page === "event" || route.page === "review") content.innerHTML = detail(expected === "console");
  else if (route.page === "overview") content.innerHTML = consoleOverview();
  else if (route.page === "queue") content.innerHTML = queue();
  else if (route.page === "audit") content.innerHTML = heading("AUDIT LOGS", "每一步，都留有说明", "当前浏览器内的模拟操作记录；不等同于服务端持久化审计。") + '<section class="panel">' + auditList(state.audit) + "</section>";
  bind();
}
function bind() {
  document.querySelector("#decision-filter")?.addEventListener("change", event => { filter = event.target.value; render(); document.querySelector("#decision-filter").focus(); });
  document.querySelector("#case-search")?.addEventListener("input", event => { search = event.target.value; document.querySelector("#queue-results").innerHTML = queueTable(); });
  document.querySelector("#acknowledge")?.addEventListener("click", () => { acknowledge(state, route.id); render(); content.focus(); toast("已标记为已读，仅保存在本次演示中。"); });
  document.querySelector("#review-form")?.addEventListener("submit", event => {
    event.preventDefault();
    const note = document.querySelector("#review-note").value;
    if (!recordReview(state, route.id, role, note)) { document.querySelector("#review-error").textContent = "请填写 5–500 字有效说明，并核对当前案例状态。"; return; }
    render(); content.focus(); toast("模拟复核已记录，风险引擎决策保持不变。");
  });
  document.querySelectorAll("[data-question]").forEach(button => button.addEventListener("click", () => { document.querySelector("#assistant-answer").textContent = answers[Number(button.dataset.question)][1]; }));
}
document.querySelector("#role").addEventListener("change", event => {
  role = event.target.value; filter = ""; search = "";
  navigate(role === "personal" ? "#personal/dashboard" : role === "admin" ? "#admin/access" : "#console/overview");
});
document.querySelector("#reset").addEventListener("click", () => { state = createDemo(); filter = ""; search = ""; render(); content.focus(); toast("演示已重置，固定样例已恢复。"); });
window.addEventListener("hashchange", () => { filter = ""; search = ""; render(); content.focus(); });
render();
