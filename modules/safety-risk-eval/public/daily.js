"use strict";
(() => {
  const byId = (id) => document.getElementById(`daily-${id}`);
  const make = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
  const states = { ALLOW: "通过", REVIEW: "需要复核", BLOCK: "阻止", ERROR: "检查失败", PASS: "通过", NOT_APPLICABLE: "本次不适用", NOT_EVALUATED: "未能完成", UNCONFIRMED: "未确认", CONFIRMED: "已确认", REJECTED: "已拒绝", REVOKED: "已撤回", INVALIDATED: "已失效", EXPIRED: "已过期", NOT_STARTED: "未启动", RUNNING: "执行中", SUCCEEDED: "沙箱模拟成功", FAILED: "模拟失败", UNKNOWN: "结果未知，等待核查", ABORTED: "已中止" };
  const actionNames = { INVESTMENT: "追加投资", PURPOSE_PAYMENT: "支付已预留用途", SUBSCRIPTION_PAYMENT: "订阅支付", CONSUMPTION: "一般消费" };
  const purposeLabels = { tuition: "学费", rent: "房租", living: "生活费" };
  const eventLabels = { DAILY_TASK_CREATED: "日常资料与用途已接收", DAILY_TASK_REGISTERED: "日常资料与用途已接收", DAILY_TASK_REVISED: "资料修改，旧确认失效", DAILY_RISK_CHECK_COMPLETED: "日常风险检查完成", RISK_CHECK_COMPLETED: "风险检查完成", PLAN_CONFIRMED: "用户确认完整计划", PLAN_REJECTED: "用户拒绝计划", PLAN_REVOKED: "用户撤回确认", PLAN_INVALIDATED: "旧版本确认失效", EXECUTION_REQUESTED: "收到模拟请求", EXECUTION_STARTED: "开始会话沙箱模拟", EXECUTION_SUCCEEDED: "沙箱模拟成功", EXECUTION_BLOCKED: "执行网关阻止操作", EXECUTION_UNKNOWN: "执行结果等待核查", DUPLICATE_REQUEST: "重复请求返回原状态", DAILY_PLAN_CONFIRMED: "用户确认日常计划", DAILY_EXECUTION_SUCCEEDED: "日常沙箱安排成功", DAILY_PLAN_REVISED: "资料修改，旧确认失效", DAILY_EXECUTION_INTENT: "执行前登记与复查", DAILY_DUPLICATE_REQUEST: "查询原回执，没有重复执行", DAILY_MODEL_REVIEW_REQUESTED: "已请求团队模型只读复核", DAILY_MODEL_REVIEW_RECEIVED: "团队模型实际返回已核验", DAILY_MODEL_REVIEW_FAILED: "团队模型复核失败", DAILY_EXECUTION_BLOCKED: "日常执行网关阻止操作" };
  let session = null, task = null, execution = null, requestKey = null, busy = false, dirty = false;
  const money = (value) => Number.isSafeInteger(value) ? new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2 }).format(value / 100) : "未知";
  const dateText = (value) => value && !Number.isNaN(Date.parse(value)) ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "日期未知";
  const currentTaskId = () => task?.input?.binding?.task_id || task?.task_id;
  const approval = () => task?.approval || task?.input?.approval || {};
  const executionState = () => execution?.status || task?.execution?.status || "NOT_STARTED";
  const succeeded = () => executionState() === "SUCCEEDED";
  const tell = (text, error = false) => { byId("notice").textContent = text; byId("notice").classList.toggle("error", error); };
  const status = (id, code, fallback) => { const element = byId(id); element.className = `status ${code || "empty"}`; element.textContent = states[code] || fallback || code; };
  function selectMode(mode) {
    const daily = mode !== "investment";
    document.getElementById("daily-workspace").hidden = !daily;
    document.getElementById("investment-workspace").hidden = daily;
    for (const name of ["daily", "investment"]) document.getElementById(`mode-${name}`).setAttribute("aria-selected", String((name === "daily") === daily));
    const url = new URL(location.href); if (daily) url.searchParams.delete("mode"); else url.searchParams.set("mode", "investment"); history.replaceState(null, "", url);
  }
  document.getElementById("mode-daily").addEventListener("click", () => selectMode("daily"));
  document.getElementById("mode-investment").addEventListener("click", () => selectMode("investment"));
  window.addEventListener("risk:legacy-task", () => selectMode("investment"));
  for (const mode of ["daily", "investment"]) document.getElementById(`mode-${mode}`).addEventListener("keydown", (event) => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); const next = mode === "daily" ? "investment" : "daily"; selectMode(next); document.getElementById(`mode-${next}`).focus(); } });
  selectMode(new URLSearchParams(location.search).get("mode") || "daily");
  async function api(route, data) {
    const response = await fetch(route, data === undefined ? { credentials: "same-origin" } : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Risk-Csrf": session?.csrf || "" }, body: JSON.stringify(data) });
    let body; try { body = await response.json(); } catch { throw new Error("服务没有返回有效结果，请保留当前任务并刷新状态；不会生成成功记录。"); }
    if (!response.ok) { const error = new Error(body.error?.message || body.message_zh || "请求未完成，请刷新状态后再试。"); error.code = body.error?.code || body.code; throw error; }
    return body;
  }
  function confirmedInputs() { return byId("facts-confirmed").checked && byId("purposes-confirmed").checked; }
  function acceptableReasons() { return [...(task?.review?.reasons || [])].filter((reason, index, rows) => reason.acceptance_allowed && rows.findIndex((other) => other.reason_id === reason.reason_id) === index); }
  function renderButtons() {
    const review = task?.review;
    const unresolved = (review?.reasons || []).filter((reason) => !reason.acceptance_allowed);
    const eligible = Boolean(task && !dirty && !["BLOCK", "ERROR"].includes(review?.decision) && unresolved.length === 0 && !succeeded() && !["UNKNOWN", "RUNNING"].includes(executionState()));
    const accepted = [...byId("acceptances").querySelectorAll("input")].every((input) => input.checked);
    byId("check").disabled = busy || !session || !confirmedInputs();
    byId("check").textContent = busy ? "正在处理，请稍候…" : succeeded() ? "使用当前账本检查下一项安排" : task ? "按修改后的资料重新检查" : "确认资料并运行风险检查";
    byId("revise").disabled = busy || !session || !task || !confirmedInputs() || succeeded() || ["UNKNOWN", "RUNNING"].includes(executionState());
    byId("whole-plan").disabled = busy || !eligible;
    byId("approve").disabled = busy || !eligible || !accepted || !byId("whole-plan").checked || approval().status === "CONFIRMED";
    byId("reject").disabled = busy || !task || succeeded() || ["UNKNOWN", "RUNNING"].includes(executionState());
    byId("revoke").disabled = busy || !task || approval().status !== "CONFIRMED" || succeeded() || ["UNKNOWN", "RUNNING"].includes(executionState());
    byId("execute").disabled = busy || dirty || approval().status !== "CONFIRMED" || !["NOT_STARTED", "ABORTED"].includes(executionState()) || !eligible;
    byId("repeat").disabled = busy || !requestKey;
    byId("refresh").disabled = busy || !task;
    byId("model-review").disabled = busy || !task || dirty || task.ledger_stale;
    byId("matched").disabled = byId("action").value !== "PURPOSE_PAYMENT";
    byId("floor").disabled = byId("floor-state").value !== "ENABLED_CONFIRMED";
  }
  async function run(fn) { if (busy) return; busy = true; renderButtons(); try { await fn(); } catch (error) { tell(`${error.message}${error.code ? `（${error.code}）` : ""}`, true); } finally { busy = false; renderButtons(); } }
  function amount(id) {
    const text = byId(id).value.trim(); if (text === "") return null;
    if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error("金额请使用非负数字，最多两位小数；未知金额可留空。");
    const parts = text.split("."), result = Number(parts[0]) * 100 + Number((parts[1] || "").padEnd(2, "0"));
    if (!Number.isSafeInteger(result)) throw new Error("金额超出可校验范围，请缩小输入后重试。");
    return result;
  }
  function instant(id) { const value = byId(id).value; return value ? new Date(value).toISOString() : null; }
  function buildPayload() {
    const incomeAmount = amount("income"), hardState = byId("floor-state").value;
    const snapshot = { currency: "CNY", cash_ledger_minor: amount("cash"), as_of: instant("asof"), purposes: Object.keys(purposeLabels).map((id) => ({ purpose_id: id, label: purposeLabels[id], reserved_now_minor: amount(id), remaining_due_minor: amount(`${id}-due`), due_at: instant(`${id}-at`) })), hard_floor: { state: hardState, amount_minor: hardState === "DISABLED_CONFIRMED" ? 0 : hardState === "UNKNOWN" ? null : amount("floor") }, income_events: incomeAmount === null ? [] : [{ event_id: "income-1", label: "工资／收入", amount_minor: incomeAmount, status: byId("income-state").value, at: instant("income-at"), included_in_balance: byId("income-included").checked }] };
    const action = { type: byId("action").value, amount_minor: amount("amount"), fees_minor: amount("fees"), at: instant("action-at") };
    if (action.type === "PURPOSE_PAYMENT") action.matched_purpose_id = byId("matched").value;
    const payload = { contract_version: "daily-risk-workbench.v1", snapshot, action, facts_confirmed: byId("facts-confirmed").checked, purposes_confirmed: byId("purposes-confirmed").checked, note: byId("note").value };
    if (byId("budget-on").checked) payload.budget = { enabled: true, period_take_home_minor: null, needs_minor: null, goals_minor: null, wants_minor: null, category_remaining_minor: amount("budget-remaining"), require_acceptance: byId("acceptance-required").checked };
    if (byId("emergency-on").checked) { const months = byId("emergency-months").value; payload.emergency = { enabled: true, allocation_minor: amount("emergency-cash"), monthly_essential_minor: amount("essential"), target_months: months === "" ? null : Number(months), require_acceptance: byId("acceptance-required").checked }; }
    return payload;
  }
  function setLocal(id, date) { const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000); byId(id).value = shifted.toISOString().slice(0, 16); }
  function preset() {
    const base = new Date(); base.setHours(12, 0, 0, 0);
    const date = (days) => new Date(base.getTime() + days * 86400000);
    for (const [id, days] of [["asof", 0], ["action-at", 0], ["income-at", -5], ["tuition-at", 3], ["rent-at", 1], ["living-at", 7]]) setLocal(id, date(days));
    for (const [id, value] of Object.entries({ cash: "12000", income: "10000", tuition: "6000", rent: "1500", living: "2500", amount: "8000", fees: "0", floor: "0", "budget-remaining": "200", "emergency-cash": "1000", essential: "2500", "emergency-months": "3" })) byId(id).value = value;
    for (const id of Object.keys(purposeLabels)) byId(`${id}-due`).value = byId(id).value;
    byId("income-state").value = "RECEIVED"; byId("income-included").checked = true; byId("action").value = "INVESTMENT"; byId("matched").value = "tuition"; byId("floor-state").value = "DISABLED_CONFIRMED";
    for (const id of ["budget-on", "emergency-on", "acceptance-required", "facts-confirmed", "purposes-confirmed", "whole-plan"]) byId(id).checked = false;
    const name = byId("preset").value;
    let text = "我想再投入 8,000 元，但这月还要交学费、付房租。会不会影响生活安排？";
    if (name === "affordable") { byId("amount").value = "2000"; text = "我把追加投资减到 2,000 元，学费、房租和生活费还能保留吗？"; }
    if (name === "tuition-payment") { byId("action").value = "PURPOSE_PAYMENT"; byId("amount").value = "6000"; text = "现在支付已经预留的 6,000 元学费，不把它算成额外投资。"; }
    if (name === "date-gap") { byId("cash").value = "5000"; byId("income-state").value = "EXPECTED"; byId("income-included").checked = false; byId("amount").value = "1000"; setLocal("income-at", date(8)); text = "工资八天后到账，但学费三天后就要付。这几天的资金够不够？"; }
    if (name === "soft-goals") { byId("action").value = "CONSUMPTION"; byId("amount").value = "300"; byId("budget-on").checked = true; byId("emergency-on").checked = true; text = "我想花 300 元买东西，预算只剩 200 元，应急储备也还没达到我选择的目标。"; }
    if (name === "missing") { byId("cash").value = ""; text = "我还没核对余额，先告诉我还需要补哪些资料。"; }
    byId("note").value = text; dirty = Boolean(task); render(); renderButtons();
    if (task) tell(succeeded() ? "已载入新的动作条件。下一次检查会沿用服务器当前账本，不会用示例余额覆盖已经执行的记录。" : "已载入条件，请查看并重新确认资料；旧检查和旧确认不能直接执行。");
  }
  function markDirty() { dirty = Boolean(task); byId("whole-plan").checked = false; renderButtons(); byId("stale").hidden = !dirty; if (task) byId("approval-note").textContent = "资料已修改。旧版本结果仅供查看，必须重新检查与确认。"; }
  for (const element of byId("form").querySelectorAll("input,select,textarea")) { if (element.id === "daily-preset") continue; element.addEventListener("input", markDirty); element.addEventListener("change", markDirty); }
  byId("preset").addEventListener("change", preset);
  function renderReasonGroup(targetId, title, rows, warning = false) {
    const target = byId(targetId); target.replaceChildren(); if (!rows.length) return;
    target.className = "daily-reason-group"; target.append(make("h3", title, warning ? "daily-warning-heading" : ""));
    for (const reason of rows) { const block = make("div", undefined, "daily-reason"); block.append(make("h4", `${reason.rule_id} · ${states[reason.decision || reason.status] || (warning ? "提醒" : "需要处理")}`), make("p", reason.message_zh || reason.message || reason.code), make("code", reason.code)); if (reason.recovery?.message_zh) block.append(make("p", `下一步：${reason.recovery.message_zh}`, "recovery")); target.append(block); }
  }
  function renderMetrics(metrics) {
    byId("breakdown").replaceChildren();
    const snapshot = task?.input?.snapshot || {};
    for (const [label, value, total] of [["当前账面现金", snapshot.cash_ledger_minor, false], ["已保护的用途资金", metrics.protected_before_minor, false], ["其他有效占用", metrics.holds_before_minor, false], ["本次动作含手续费", metrics.action_total_minor, false], ["安排后仍未分配的资金", metrics.projected_free_after_minor, true]]) {
      const box = make("div", undefined, `${total ? "daily-total " : ""}${Number.isSafeInteger(value) && value < 0 ? "negative" : ""}`); box.append(make("dt", label), make("dd", money(value))); byId("breakdown").append(box);
    }
    byId("timeline").replaceChildren(); const events = metrics.cashflow || []; byId("timeline-detail").hidden = !events.length;
    const list = make("ol", undefined, "daily-timeline-list");
    for (const event of events) { const li = make("li"); li.append(make("time", dateText(event.at)), make("span", `${event.kind === "OPENING" ? "期初余额" : event.kind === "INCOME" ? "收入情景" : "付款"}${event.event_id ? ` · ${purposeLabels[event.event_id] || event.event_id}` : ""}`), make("strong", money(event.balance_minor))); list.append(li); }
    byId("timeline").append(list);
    if (metrics.gap_date) byId("timeline").append(make("p", `日期缺口：${dateText(metrics.gap_date)}。预计收入不是当前可用资金。`, "fine"));
    byId("metrics-raw").hidden = false; byId("metrics-raw").textContent = JSON.stringify(metrics, null, 2);
  }
  function renderSuggestions(review) {
    const target = byId("suggestions"); target.replaceChildren();
    const codes = [...(review.reasons || []), ...(review.warnings || [])].map((reason) => reason.code), suggestions = [];
    if (codes.some((code) => ["PROTECTED_PURPOSE_CONFLICT", "HARD_FLOOR_CONFLICT", "SHARED_FUNDS_CONFLICT"].includes(code)) && Number.isSafeInteger(review.metrics?.available_for_new_action_minor)) suggestions.push(`按当前已确认用途，可新增安排的参考额度为 ${money(review.metrics.available_for_new_action_minor)}，还需覆盖本次手续费。可降低动作金额后重检，或核实补充资金；系统不会自动取消学费等保护。`);
    if (codes.includes("PAYMENT_DATE_GAP")) suggestions.push("优先处理最早到期的付款。可调整这次可选安排的日期或核实更早到账资金，不能用晚到账工资填补已经发生的缺口。");
    if (codes.includes("PERSONAL_BUDGET_EXCEEDED")) suggestions.push("可减少这次可选消费，或重新讨论本人预算。软预算提醒不会覆盖必要资金与权限检查。");
    if (codes.includes("RESERVE_TARGET_SHORTFALL")) suggestions.push("可把部分自由资金逐步补入应急储备，或保留本次软目标偏离。不要把学费专款再次计算为应急金。");
    if (!suggestions.length && review.decision === "ALLOW") suggestions.push("本次资料下未发现阻止原因。核对完整计划后再确认；通过风险检查不会自动扣款，也不保证投资收益。");
    if (!suggestions.length) suggestions.push("先按上方原因补齐资料或修正方案，再重新运行检查。硬性阻止不能通过勾选接受放行。");
    target.className = "daily-suggestions"; target.append(make("h3", "可以怎样调整")); const list = make("ul"); for (const text of suggestions) list.append(make("li", text)); target.append(list);
  }
  function render() {
    byId("stale").hidden = !dirty;
    if (!task?.review) { renderButtons(); return; }
    const review = task.review, state = executionState();
    status("decision", review.decision); byId("decision").textContent = `${states[review.decision] || review.decision} · ${review.decision}`;
    const shortfall = review.metrics?.shortfall_minor;
    byId("summary").textContent = review.decision === "BLOCK" ? `这项安排暂不能执行。${shortfall > 0 ? `安排后会形成 ${money(shortfall)} 的资金保护缺口。` : "请先处理下方硬性冲突。"}` : review.decision === "ERROR" ? "必要检查未能完成，本次动作暂停。没有改用离线结果或生成成功记录。" : review.decision === "REVIEW" ? "先完成资料核对或明确接受可接受的软提醒；当前还不能执行。" : "按本次已确认资料，当前安排通过检查。仍需确认完整计划，再由网关重检后模拟。";
    renderMetrics(review.metrics || {});
    const reasons = review.reasons || [], warnings = (review.warnings || []).filter((warning) => !reasons.some((reason) => reason.reason_id === warning.reason_id));
    renderReasonGroup("reasons", "需要先处理的事项", reasons); renderReasonGroup("warnings", "提醒：供你权衡，不自动取消保护", warnings, true); renderSuggestions(review);
    byId("rules").replaceChildren();
    for (const check of review.checks || []) { const row = make("tr"), description = make("td"); description.append(make("span", check.scope_note || check.title || "已按当前资料检查")); if (check.measurements?.length) description.append(make("pre", JSON.stringify(check.measurements, null, 2))); row.append(make("td", `${check.rule_id} ${check.title || ""}`), make("td", states[check.status] || check.status), description); byId("rules").append(row); }
    const binding = task.input.binding;
    byId("binding").textContent = `任务 ${currentTaskId()}\n检查 ${review.risk_check_id || "待核验"}\n方案 ${binding.plan_version || "未知"} · 规则 ${review.policy_version || binding.rules_version || "见完整检查"}\n账本 ${task.ledger_id || "未知"} · 检查绑定版本 ${binding.ledger_revision ?? "未知"} / 当前版本 ${task.ledger_revision ?? "未知"}`;
    const action = task.input.action || {}, matched = action.matched_purpose_id ? ` · 对应${purposeLabels[action.matched_purpose_id] || action.matched_purpose_id}` : "";
    byId("plan-summary").textContent = `${actionNames[action.type] || action.type}${matched}，金额 ${money(action.amount_minor)}，演示手续费 ${money(action.fees_minor)}，时间 ${dateText(action.at)}。使用虚构会话账本，不执行真实交易。`;
    status("approval-status", approval().status || "UNCONFIRMED");
    byId("approval-note").textContent = dirty ? "资料已修改，旧确认不能用于新动作。重新检查后再确认。" : `确认状态：${states[approval().status] || "未确认"}。确认绑定本次完整计划、账本和相关版本。`;
    const checkedIds = [...byId("acceptances").querySelectorAll("input:checked")].map((element) => element.value);
    byId("acceptances").replaceChildren();
    for (const reason of acceptableReasons()) { const label = make("label", undefined, "checkline"), box = make("input"); box.type = "checkbox"; box.value = reason.reason_id; box.checked = checkedIds.includes(reason.reason_id); box.addEventListener("change", renderButtons); label.append(box, make("span", `我理解并接受本项软提醒：${reason.message_zh}`)); byId("acceptances").append(label); }
    status("execution-status", state); byId("execution-note").textContent = state === "SUCCEEDED" ? "只完成当前会话沙箱记账，未向银行、券商或真实投资账户发起操作。下一项安排将使用更新后的共享账本。" : state === "UNKNOWN" ? "结果未知：先查询原请求，不能重新创建扣款请求或盲目重试。" : state === "RUNNING" ? "服务器正在处理，请保留当前任务并查询状态。" : "通过风险检查与用户确认分别记录。执行端会再次检查，任一必要条件失败均停止。";
    const receipt = execution || (task.execution?.status !== "NOT_STARTED" ? task.execution : null); byId("receipt-wrap").hidden = !receipt; byId("receipt").hidden = !receipt; const ledger = task.current_ledger; byId("ledger-summary").textContent = ledger ? `服务器当前账本：现金 ${money(ledger.snapshot.cash_ledger_minor)}，有效占用 ${money(ledger.holds.reduce((sum, hold) => sum + hold.amount_minor, 0))}，版本 ${ledger.revision}。上方指标保留本次执行前的测算。` : ""; if (receipt) byId("receipt").textContent = JSON.stringify(receipt, null, 2);
    byId("step-input").classList.add("done"); byId("step-risk").classList.add("done"); byId("step-approval").classList.toggle("done", approval().status === "CONFIRMED"); byId("step-execution").classList.toggle("done", state === "SUCCEEDED"); renderButtons();
  }
  async function refreshAudit() {
    const result = await api(`/api/safety/audit?task_id=${encodeURIComponent(currentTaskId())}`), events = Array.isArray(result) ? result : result.events || [];
    byId("audit").replaceChildren();
    if (!events.length) byId("audit").append(make("p", "当前任务尚无可显示事件。", "empty-copy"));
    for (const event of [...events].reverse()) { const details = make("details", undefined, "audit-row"), summary = make("summary"); summary.append(make("time", dateText(event.occurred_at || event.timestamp)), make("span", eventLabels[event.event_type] || event.message_zh || event.event_type)); details.append(summary, make("pre", JSON.stringify(event, null, 2))); byId("audit").append(details); }
  }
  function loadServerFacts() {
    const snapshot = task.current_ledger.snapshot, input = task.input;
    const put = (id, value) => { byId(id).value = Number.isSafeInteger(value) ? (value / 100).toFixed(2) : ""; };
    const time = (id, value) => { if (value) setLocal(id, new Date(value)); else byId(id).value = ""; };
    put("cash", snapshot.cash_ledger_minor); time("asof", snapshot.as_of);
    for (const id of Object.keys(purposeLabels)) { const row = snapshot.purposes.find(p => p.purpose_id === id); put(id, row?.reserved_now_minor); put(`${id}-due`, row?.remaining_due_minor); time(`${id}-at`, row?.due_at); }
    byId("floor-state").value = snapshot.hard_floor.state; put("floor", snapshot.hard_floor.amount_minor);
    const income = snapshot.income_events[0]; put("income", income?.amount_minor); if (income) { byId("income-state").value = income.status; byId("income-included").checked = income.included_in_balance; time("income-at", income.at); }
    byId("action").value = input.action.type; put("amount", input.action.amount_minor); put("fees", input.action.fees_minor); time("action-at", input.action.at);
    if (input.action.matched_purpose_id) byId("matched").value = input.action.matched_purpose_id;
    byId("note").value = input.note || ""; byId("facts-confirmed").checked = input.facts_confirmed; byId("purposes-confirmed").checked = input.purposes_confirmed;
    byId("budget-on").checked = input.budget?.enabled === true; put("budget-remaining", input.budget?.category_remaining_minor);
    byId("emergency-on").checked = input.emergency?.enabled === true; put("emergency-cash", input.emergency?.allocation_minor); put("essential", input.emergency?.monthly_essential_minor); byId("emergency-months").value = input.emergency?.target_months ?? "3";
    byId("acceptance-required").checked = input.budget?.require_acceptance === true || input.emergency?.require_acceptance === true;
  }
  async function reload() { task = await api(`/api/safety/task?task_id=${encodeURIComponent(currentTaskId())}`); if (!dirty) loadServerFacts(); render(); await refreshAudit(); }
  async function runCheck() {
    const payload = buildPayload();
    if (task && !succeeded()) { payload.task_id = currentTaskId(); payload.ledger_id = task.ledger_id; payload.expected_ledger_revision = task.ledger_revision; task = await api("/api/safety/daily/revise", payload); }
    else { if (task) { payload.ledger_id = task.ledger_id; payload.expected_ledger_revision = task.ledger_revision; delete payload.snapshot; } task = await api("/api/safety/daily/tasks", payload); }
    if (!task.review) { const response = task; task = { input: { binding: { task_id: response.task_id || response.risk?.binding?.task_id } } }; await reload(); }
    dirty = false; execution = null; requestKey = null; byId("model-result").hidden = true; byId("model-status").textContent = "当前方案可请求真实模型只读复核；旧版本结果保留在审计中。"; byId("whole-plan").checked = false; byId("acceptances").replaceChildren(); render(); await refreshAudit();
    const url = new URL(location.href); url.searchParams.set("task_id", currentTaskId()); history.replaceState(null, "", url);
    tell("服务端检查已完成。请查看全部原因、金额与日期，再决定是否确认完整计划。", ["BLOCK", "ERROR"].includes(task.review.decision));
  }
  byId("form").addEventListener("submit", (event) => { event.preventDefault(); run(runCheck); }); byId("revise").addEventListener("click", () => run(runCheck));
  byId("whole-plan").addEventListener("change", renderButtons);
  byId("approve").addEventListener("click", () => run(async () => { await api("/api/safety/confirm", { task_id: currentTaskId(), risk_check_id: task.review.risk_check_id, binding: task.input.binding, accepted_reason_ids: [...byId("acceptances").querySelectorAll("input:checked")].map((input) => input.value), confirmed: byId("whole-plan").checked }); await reload(); tell("完整计划已确认，尚未执行。请在沙箱执行区查看网关最终结果。"); }));
  for (const name of ["reject", "revoke"]) byId(name).addEventListener("click", () => run(async () => { await api(`/api/safety/${name}`, { task_id: currentTaskId() }); byId("whole-plan").checked = false; await reload(); tell(name === "reject" ? "已拒绝当前计划，没有发生模拟扣款。" : "已撤回本次确认。未执行的计划不能再用旧确认继续。"); }));
  async function execute() { requestKey ||= crypto.randomUUID(); execution = await api("/api/paper-trade/execute", { task_id: currentTaskId(), idempotency_key: requestKey }); await reload(); tell(execution.replay ? "已返回同一请求的原有回执，没有再次扣款。" : execution.status === "SUCCEEDED" ? "会话沙箱模拟成功。账本已更新，未执行真实交易。" : "执行未完成，请查看网关原因和原请求状态；不会自动重试或显示成功。", execution.status !== "SUCCEEDED"); }
  byId("execute").addEventListener("click", () => run(execute)); byId("repeat").addEventListener("click", () => run(execute)); byId("refresh").addEventListener("click", () => run(async () => { await reload(); tell("已读取服务器任务状态和关联审计；没有重新执行。"); }));
  byId("model-review").addEventListener("click", () => run(async () => {
    byId("model-status").textContent = "正在调用团队真实模型；失败将显示失败，不切换离线结果。";
    try { const result = await api("/api/safety/daily/model-review", { task_id: currentTaskId() }); byId("model-output").textContent = JSON.stringify(result, null, 2); byId("model-result").hidden = false; byId("model-status").textContent = `真实模型返回已核对。运行编号：${result.run_id}。只读提议，未授权执行。`; await refreshAudit(); }
    catch (error) { byId("model-result").hidden = true; byId("model-status").textContent = `模型复核失败：${error.message}。确定性风控仍保留；没有模型成功记录。`; await refreshAudit(); throw error; }
  }));
  preset();
  run(async () => { session = await window.riskSessionReady; tell("工作台会话已就绪。先核对虚构资料和资金用途，再运行检查。"); const id = new URLSearchParams(location.search).get("task_id"); if (id) { const candidate = await api(`/api/safety/task?task_id=${encodeURIComponent(id)}`); if (candidate.kind === "DAILY_CASHFLOW") { task = candidate; selectMode("daily"); dirty = false; loadServerFacts(); render(); await refreshAudit(); tell("已恢复服务器保存的日常资料、完整计划与审计。请核对后确认，任何修改均需重新检查。"); } } });
})();
