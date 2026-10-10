"use strict";
const $ = (id) => document.getElementById(id);
const labels = { ALLOW: "通过", REVIEW: "需要复核", BLOCK: "阻止", ERROR: "检查失败", PASS: "通过", NOT_APPLICABLE: "执行前再查", NOT_EVALUATED: "未能完成", UNCONFIRMED: "未确认", CONFIRMED: "已确认", REJECTED: "已拒绝", REVOKED: "已撤回", INVALIDATED: "已失效", EXPIRED: "已过期", NOT_STARTED: "未启动", RUNNING: "执行中", SUCCEEDED: "模拟成功", FAILED: "执行失败", UNKNOWN: "结果未知", ABORTED: "已中止" };
const ruleNames = ["权限与工具范围", "必要数据与证据", "资金及用户约束", "单只与前三集中度", "行业集中与未知", "历史最大回撤", "高相关资产集中", "完整计划确认", "防重复执行", "必要审计写入"];
const eventNames = { TASK_REGISTERED: "已接收健康检查", RISK_CHECK_COMPLETED: "风险检查完成", PLAN_CONFIRMED: "用户确认完整计划", PLAN_REJECTED: "用户拒绝计划", PLAN_REVOKED: "用户撤回确认", PLAN_INVALIDATED: "旧版本授权失效", EXECUTION_REQUESTED: "收到执行请求", EXECUTION_STARTED: "开始模拟执行", EXECUTION_SUCCEEDED: "模拟执行成功", EXECUTION_BLOCKED: "执行入口阻止操作", EXECUTION_UNKNOWN: "执行结果待核查", EXECUTION_ABORTED: "执行前中止", DUPLICATE_REQUEST: "重复请求返回原状态", MEMORY_UPDATED: "经同意写入演示记忆", MEMORY_UPDATE_FAILED: "演示记忆写入失败", REQUEST_REJECTED: "请求未通过安全校验" };
let csrf, record = null, lastExecution = null, executionKey = null, dirty = false, busy = false;
let modelConfiguration = null;
eventNames.POLICY_DECIDED = "确定性权限策略检查";
Object.assign(eventNames, { HANDOFF_IMPORTED: "已接收 Core 交接包（来源待验证）", HANDOFF_IMPORT_REPLAY: "重复交接返回原任务", HANDOFF_IMPORT_REJECTED: "交接包未通过验证" });
const node = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
const notice = (text, error = false) => { $("notice").textContent = text; $("notice").classList.toggle("error", error); };
async function api(route, data) {
  const response = await fetch(route, data === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-Risk-Csrf": csrf }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "服务暂不可用，请查看审计记录后重试。");
  return result;
}
async function action(fn) {
  if (busy) return; busy = true; renderButtons();
  try { await fn(); } catch (error) { notice(error.message, true); }
  finally { busy = false; renderButtons(); }
}
function settings() { return { confirmed: $("profile-confirmed").checked, reserve_cash: Number($("reserve").value), max_drawdown: Number($("drawdown").value) / 100, forbidden: [], plan_id: $("plan").value, memory_consent: $("memory-consent").checked }; }
const taskId = () => record?.input.binding.task_id;
function renderButtons() {
  const review = record?.review, canConfirm = review && record?.policy?.allow === true && !dirty && !["ERROR", "BLOCK"].includes(review.decision) && review.reasons.every((r) => r.acceptance_allowed);
  const accepted = [...document.querySelectorAll("#acceptances input")].every((box) => box.checked);
  $("create").disabled = busy || !csrf;
  $("run-attack").disabled = busy || !csrf;
  $("run-model").disabled = busy || !csrf || modelConfiguration?.configured !== true;
  $("import-handoff").disabled = busy || !csrf;
  $("load-handoff-example").disabled = busy || !csrf;
  $("update").disabled = busy || !record;
  $("whole-plan").disabled = busy || !canConfirm;
  $("approve").disabled = busy || !canConfirm || !accepted || !$("whole-plan").checked;
  $("reject").disabled = busy || !record || lastExecution?.status === "SUCCEEDED";
  $("revoke").disabled = busy || record?.input.approval.status !== "CONFIRMED" || lastExecution?.status === "SUCCEEDED";
  $("execute").disabled = busy || dirty || record?.input.approval.status !== "CONFIRMED" || Boolean(lastExecution && lastExecution.status !== "NOT_STARTED");
  $("repeat").disabled = busy || !executionKey;
  $("refresh-audit").disabled = busy || !record;
}
function numeric(m) {
  const number = m.actual === null ? "未知" : m.unit === "RATIO" ? `${(m.actual * 100).toFixed(2)}%` : Number(m.actual.toFixed(4)).toLocaleString("zh-CN");
  const limit = m.threshold === null ? "未设" : m.unit === "RATIO" ? `${(m.threshold * 100).toFixed(2)}%` : m.threshold.toLocaleString("zh-CN");
  return `${m.name}：${number}；阈值 ${limit}${m.basis === "TOTAL_ASSETS" ? " · 含现金总资产" : m.basis === "INVESTED_ASSETS" ? " · 非现金投资部分" : m.basis === "SAMPLE" ? " · 指定历史样本" : ""}${m.denominator !== null ? `（分母 ${m.denominator.toFixed(2)} 元）` : ""}`;
}
function render() {
  if (!record) return;
  const imported = record.handoff_import;
  $("handoff-status").textContent = imported ? "已导入本会话，来源尚未认证。可以查看检查与审计，不能确认或执行此导入任务。" : "当前任务由本工作台生成。";
  $("handoff-lineage").hidden = !imported;
  $("handoff-lineage").textContent = imported ? JSON.stringify({ source: imported.source, source_digest: imported.source_digest, local_task_id: taskId(), provenance: imported.provenance }, null, 2) : "";
  const policy = lastExecution?.policy || record.policy;
  $("policy-decision").textContent = policy ? `${labels[policy.decision]} · ${policy.decision}` : "旧任务需要重新检查";
  $("policy-decision").className = `status ${policy?.decision || "empty"}`;
  $("policy-explanation").textContent = policy ? policy.reasons.length ? policy.reasons.map((r) => `${r.message_zh} 恢复：${r.recovery}`).join("；") : "权限策略通过。执行仍需金融风险具备执行资格、有效确认和审计持久化。" : "此任务尚未绑定当前策略，请点击修改约束并重新检查。";
  $("policy-evidence").hidden = !policy;
  $("policy-evidence").textContent = policy ? JSON.stringify({ policy, approval_binding: record.approval_policy || null }, null, 2) : "";
  const result = lastExecution?.risk || record.review;
  $("decision").className = `status ${result.decision}`; $("decision").textContent = `${labels[result.decision]} · ${result.decision}`;
  $("summary").textContent = result.reasons.length ? `本次检查共发现 ${result.reasons.length} 项原因。可接受的复核与必须修复的事项分别处理。` : "当前阶段所需规则通过。完成用户确认及执行前检查后，才可运行模拟。";
  $("reasons").replaceChildren();
  for (const reason of result.reasons) {
    const box = node("div", undefined, "reason"); box.append(node("h3", `${reason.rule_id} · ${labels[reason.decision]}`), node("p", reason.message_zh), node("code", reason.code), node("p", `恢复方式：${reason.recovery.message_zh}`, "fine")); $("reasons").append(box);
  }
  $("rules").replaceChildren();
  for (const [index, check] of result.checks.entries()) {
    const tr = node("tr"), details = node("td");
    details.append(node("span", check.scope_note)); for (const m of check.measurements) details.append(node("span", numeric(m), "measurement"));
    tr.append(node("td", `${check.rule_id} ${ruleNames[index]}`), node("td", labels[check.status]), details); $("rules").append(tr);
  }
  $("binding").textContent = `任务 ${taskId()}\n方案 ${record.input.binding.plan_version}`;
  const steps = record.input.plan.steps, orders = steps.reduce((n, s) => n + s.orders.length, 0);
  $("plan-summary").textContent = `虚构历史回放 · ${steps.length} 个步骤 · ${orders} 笔买卖动作 · 剩余现金 ${steps.at(-1).cash_after.toLocaleString("zh-CN")} 元。${orders === 0 ? "当前计划为保持持仓。" : "请核对全部步骤。"}`;
  $("approval-state").textContent = `确认状态：${labels[record.input.approval.status]}。${dirty ? "表单已修改，请重新检查。" : "确认绑定当前完整计划和相关版本。"}`;
  $("acceptances").replaceChildren();
  for (const r of record.review.reasons.filter((r) => r.acceptance_allowed)) {
    const label = node("label", undefined, "checkline"), box = node("input"); box.type = "checkbox"; box.value = r.reason_id; box.addEventListener("change", renderButtons); label.append(box, node("span", `我理解并接受：${r.message_zh}`)); $("acceptances").append(label);
  }
  const status = lastExecution?.status || "NOT_STARTED";
  $("execution-state").className = `status ${status}`; $("execution-state").textContent = labels[status] || status;
  $("receipt").hidden = !lastExecution;
  if (lastExecution) $("receipt").textContent = JSON.stringify({ status, replay: lastExecution.replay || false, execution_id: lastExecution.execution_id, code: lastExecution.code, receipt: lastExecution.result?.receipt, memory: lastExecution.memory }, null, 2);
  for (const id of ["flow-core", "flow-risk"]) $(id).classList.add("done");
  $("flow-approval").classList.toggle("done", record.input.approval.status === "CONFIRMED"); $("flow-execution").classList.toggle("done", status === "SUCCEEDED");
  renderButtons();
}
async function reload() { record = await api(`/api/safety/task?task_id=${encodeURIComponent(taskId())}`); render(); await audit(); }
async function audit() {
  const events = await api(`/api/safety/audit?task_id=${encodeURIComponent(taskId())}`); $("audit").replaceChildren();
  for (const event of events.toReversed()) {
    const detail = node("details", undefined, "audit-row"), summary = node("summary"); summary.append(node("time", new Date(event.occurred_at).toLocaleTimeString("zh-CN")), node("span", eventNames[event.event_type] || event.event_type)); detail.append(summary, node("pre", JSON.stringify(event, null, 2))); $("audit").append(detail);
  }
  $("flow-audit").classList.toggle("done", events.length > 0);
}
$("load-handoff-example").addEventListener("click", () => action(async () => {
  $("handoff-json").value = JSON.stringify(await api("/api/safety/handoffs/example"), null, 2);
  $("handoff-status").textContent = "已载入记录的虚构 Core 输出，尚未提交或创建任务。";
}));
$("import-handoff").addEventListener("click", () => action(async () => {
  let parsed;
  try { parsed = JSON.parse($("handoff-json").value); } catch { throw new Error("JSON 格式无效，请复制完整 Core 响应。"); }
  const payload = { import_version: "risk-handoff.import.v1", agent_response: parsed.agent_response || parsed };
  if (new TextEncoder().encode(JSON.stringify(payload)).length > 65536) throw new Error("交接包超过 64 KB，请缩减到本次任务所需证据。");
  const result = await api("/api/safety/handoffs", payload);
  record = { input: { binding: { task_id: result.task_id } } }; lastExecution = null; executionKey = null; dirty = false; $("whole-plan").checked = false;
  await reload(); notice(result.replay ? "重复交接已返回原任务，没有重复创建。" : "交接包已接收并生成风控任务。来源待认证，执行权限保持关闭。");
}));
$("profile-form").addEventListener("submit", (event) => { event.preventDefault(); action(async () => {
  const result = await api("/api/safety/tasks", settings()); record = { input: { binding: result.risk.binding } }; lastExecution = null; executionKey = null; dirty = false; $("whole-plan").checked = false; await reload(); notice("健康检查与风险判断已完成，请查看结果。");
}); });
$("update").addEventListener("click", () => action(async () => { await api("/api/safety/profile", { task_id: taskId(), profile: settings() }); dirty = false; lastExecution = null; executionKey = null; $("whole-plan").checked = false; await reload(); notice("旧确认已失效，当前约束已重新检查。"); }));
$("preset").addEventListener("change", () => { const p = $("preset").value; $("reserve").value = p === "block" ? 11000 : 5000; $("drawdown").value = p === "review" ? 2 : 10; $("plan").value = p === "missing" ? "B" : "A"; dirty = Boolean(record); $("profile-confirmed").checked = false; renderButtons(); });
for (const id of ["reserve", "drawdown", "plan", "profile-confirmed", "memory-consent"]) $(id).addEventListener("change", () => { dirty = Boolean(record); renderButtons(); });
$("whole-plan").addEventListener("change", renderButtons);
$("approve").addEventListener("click", () => action(async () => {
  await api("/api/safety/confirm", { task_id: taskId(), risk_check_id: record.review.risk_check_id, binding: record.input.binding, accepted_reason_ids: [...document.querySelectorAll("#acceptances input:checked")].map((e) => e.value), confirmed: $("whole-plan").checked }); await reload(); notice("当前完整计划已确认，尚未执行。");
}));
for (const id of ["reject", "revoke"]) $(id).addEventListener("click", () => action(async () => { await api(`/api/safety/${id}`, { task_id: taskId() }); await reload(); notice(id === "reject" ? "已拒绝本次计划。" : "已撤回本次确认。"); }));
async function execute() {
  executionKey ||= crypto.randomUUID(); lastExecution = await api("/api/paper-trade/execute", { task_id: taskId(), idempotency_key: executionKey }); await reload(); notice(lastExecution.replay ? "已返回原执行状态，没有重复写入。" : lastExecution.status === "SUCCEEDED" ? "模拟执行成功；本次结果已记录。" : "执行未放行或结果待核查，请查看原因。", lastExecution.status !== "SUCCEEDED");
}
$("execute").addEventListener("click", () => action(execute)); $("repeat").addEventListener("click", () => action(execute)); $("refresh-audit").addEventListener("click", () => action(audit));
$("run-attack").addEventListener("click", () => action(async () => {
  const result = await api("/api/safety/attack-demo", { source: $("attack-source").value, text: $("attack-text").value });
  $("attack-result").hidden = false;
  const blocked = result.risk.decision === "BLOCK" && result.gateway.status === "NOT_STARTED" && result.paper_tool_calls === 0;
  $("attack-verdict").textContent = blocked ? "越权操作已阻止" : "存在异常，请核查审计记录";
  $("attack-tool-count").textContent = `模拟执行工具调用 ${result.paper_tool_calls} 次`;
  $("attack-nodes").replaceChildren();
  const rows = [
    ["Core · 数据与权限分离", `原文：${result.document.text}`, `信任等级 ${result.document.trust}；提升为指令 ${result.core.promoted_instruction_count} 次。`],
    ["Risk · 拒绝外部内容发起的操作", result.risk.reasons.map((r) => r.message_zh).join("；"), result.risk.reasons.map((r) => r.code).join(" / ")],
    ["Action Gateway · 未获得用户授权", `执行状态：${labels[result.gateway.status] || result.gateway.status}`, [...(result.gateway.risk?.reasons || []), ...(result.gateway.policy?.reasons || [])].map((r) => r.code).join(" / ")]
  ];
  for (const [title, detail, code] of rows) { const li = node("li"); li.append(node("h3", title), node("p", detail), node("code", code)); $("attack-nodes").append(li); }
  $("attack-audit").textContent = JSON.stringify(result.audit, null, 2);
  notice(blocked ? "安全演示完成：攻击原文、阻断节点、固定原因及审计记录均已展示。" : "请查看本次演示的异常结果。", !blocked);
}));
function showModelCase() { $("model-case-text").textContent = modelConfiguration?.cases?.[$("model-case").value]?.text || ""; }
$("model-case").addEventListener("change", showModelCase);
$("run-model").addEventListener("click", () => action(async () => {
  $("model-result").hidden = true; $("model-progress").textContent = "正在调用真实模型并保存审计，请等待；不会自动重试。";
  try {
    const result = await api("/api/safety/model-demo", { case_id: $("model-case").value });
    $("model-result").hidden = false;
    const outcome = result.gateway;
    $("model-verdict").textContent = outcome.decision === "ERROR" ? "模型链路已暂停" : outcome.blocking_node === "ACTION_GATEWAY" ? "模型提出的动作被网关阻止" : outcome.blocking_node === "CORE_AGENT" ? "模型拒绝了越权指令" : "模型完成分析，未发起投资操作";
    $("model-summary").textContent = `原因：${outcome.reason_codes.join(" / ")}。模拟执行工具调用 ${outcome.paper_tool_calls} 次。`;
    $("model-raw").textContent = result.model.raw || "本次没有有效模型原文。";
    $("model-evidence").textContent = JSON.stringify({ task_id: result.task_id, run_id: result.model.run_id, provider: result.model.provider, model: result.model.returned_model, risk_decision: result.risk.decision, gateway: outcome }, null, 2);
    $("model-audit").textContent = JSON.stringify(result.audit, null, 2);
    $("model-progress").textContent = outcome.message_zh || "调用结束，原始输出和本次审计已展示。";
  } catch (error) { $("model-progress").textContent = "请求未完成，请勿视为模型成功；检查服务状态后再运行。"; throw error; }
}));
action(async () => {
  const session = await api("/api/safety/session"); csrf = session.csrf;
  try {
    modelConfiguration = await api("/api/safety/model-status"); showModelCase();
    $("model-status").textContent = modelConfiguration.configured ? "服务已配置，待实际调用" : "尚未配置模型服务";
    $("model-progress").textContent = modelConfiguration.configured ? `服务 ${modelConfiguration.provider} · 模型 ${modelConfiguration.model}；选择案例开始，配置存在不代表调用已成功。` : "等待团队在服务端配置授权的模型服务。当前无法运行真实模型案例，执行入口保持关闭。";
  } catch { $("model-status").textContent = "模型状态读取失败"; $("model-progress").textContent = "刷新后重试；无法确认服务状态时不调用模型。"; }
  try {
    const manifest = await api("/api/safety/policy");
    $("policy-runtime").textContent = "确定性策略已接入"; $("policy-runtime").className = "status ALLOW";
    $("policy-summary").textContent = `策略 ${manifest.version} · ${manifest.enforcement_scope}`;
    $("policy-manifest").textContent = JSON.stringify(manifest, null, 2);
  } catch {
    $("policy-runtime").textContent = "策略信息暂不可用"; $("policy-runtime").className = "status ERROR";
    $("policy-summary").textContent = "未能读取策略信息，请刷新重试；执行资格仍由服务器重新判断。";
  }
  const id = new URLSearchParams(location.search).get("task_id");
  if (id) { record = { input: { binding: { task_id: id } } }; await reload(); notice("已接收团队健康检查结果，请确认约束后重新检查。"); }
});
