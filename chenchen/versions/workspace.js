import { $, api } from "./common.js";
import { healthTask, labels, auditEvents } from "./workspace-model.mjs";

let current = null, auditRevision = 0, restoreRevision = 0;
const eventNames = {
  "session.created": "任务会话已创建", "contract.accepted": "已记录请求契约",
  "stage.started": "阶段开始", "stage.completed": "阶段完成",
  "checkpoint.saved": "检查点已保存", "risk.handoff": "等待风险交接",
  "task.handoff": "任务交接", "tool.completed": "工具返回结果"
};
function text(id, value) { $(id).textContent = value; }
export function navigate(view, focus = false) {
  if (!["workspace", "banking", "tasks", "safety"].includes(view)) view = "workspace";
  document.querySelectorAll("[data-panel]").forEach(panel => { panel.hidden = panel.dataset.panel !== view; });
  document.querySelectorAll("[data-view]").forEach(link => {
    if (link.dataset.view === view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (focus) document.getElementById(view + "-heading")?.focus();
}
function route(focus = true) {
  const key = location.hash.slice(1);
  navigate(key === "portfolio-flow" ? "banking" : key || (location.pathname === "/investment" ? "banking" : "workspace"), Boolean(focus));
}
window.addEventListener("hashchange", route);
route(false);
$("#open-portfolio").onclick = () => {
  const draft = $("#task-intent").value.trim();
  $("#intent-preview").hidden = !draft;
  text("#intent-preview", "你的目标（仅本页草稿，未发送模型）：" + draft);
  location.hash = "banking";
};
export function progress(state) {
  const done = state === "WAITING_RISK";
  document.querySelectorAll("[data-step]").forEach(item => {
    const key = item.dataset.step;
    item.dataset.phase = done && ["input", "diagnose", "compare"].includes(key) ? "done" :
      (state === "RUNNING" && key === "diagnose") || (done && key === "risk") ||
      (state === "WAITING_INPUT" && key === "input") ? "current" : "pending";
    if (item.dataset.phase === "current") item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });
}
export function inputChanged() {
  restoreRevision++; auditRevision++;
  if (current) { $("#task-stale").hidden = false; text("#task-stale", "输入或检查已更新。旧任务仅供回看，不代表当前输入。"); }
  progress("WAITING_INPUT");
  text("#run-feedback", "输入已变更，请重新检查。旧任务只作为历史证据。");
}
export function requestStarted() {
  restoreRevision++;
  if (current) $("#task-stale").hidden = false;
  progress("RUNNING");
  $("#run").setAttribute("aria-busy", "true");
  text("#run-feedback", "正在请求 Core 校验持仓、诊断与比较；尚未执行交易。");
}
export function requestFailed(error) {
  progress("ERROR");
  const message = (error.code ? error.code + " · " : "") + error.message;
  text("#run-feedback", "ERROR · " + message + " 未生成新的成功结果。");
  $("#input-feedback").hidden = false;
  text("#input-feedback", message);
}
function renderAudit(audit, id) {
  const events = auditEvents(audit, id);
  const list = $("#audit-timeline"); list.replaceChildren();
  for (const item of events) {
    const li = document.createElement("li"), title = document.createElement("strong"), meta = document.createElement("small");
    title.textContent = eventNames[item.event_type] || item.event_type;
    meta.textContent = [item.timestamp, item.actor, item.event_id].filter(Boolean).join(" · ");
    li.append(title, meta); list.append(li);
  }
  text("#audit-message", events.length ? "来自本任务服务端的 " + events.length + " 条记录；当前存储不等于生产持久化。" : "服务端未返回审计事件。");
}
export async function refreshAudit() {
  if (!current) return;
  const id = current.task_state.task_id, revision = ++auditRevision;
  text("#audit-message", "正在读取服务端审计…");
  $("#retry-audit").disabled = true;
  try {
    const data = await api("/api/audit/" + encodeURIComponent(id));
    if (revision !== auditRevision || current?.task_state.task_id !== id) return;
    renderAudit(data, id);
  } catch (error) {
    if (revision === auditRevision) {
      $("#audit-timeline").replaceChildren();
      text("#audit-message", "ERROR · 审计读取失败：" + error.message + "。可单独重读记录，无需重新交易。");
    }
  } finally { $("#retry-audit").disabled = false; }
}
export function renderTaskStates(view) {
  text("#risk-label", view.risk === "REQUIRED" || view.risk === "NOT_CONNECTED" ? "等待正式 Risk 结论" : view.risk);
  text("#risk-reason", view.reason);
  text("#approval-label", labels[view.approval] || ({APPROVED:"审批已通过 · 未执行",REJECTED:"审批已拒绝"})[view.approval] || "审批状态待核验");
  text("#execution-label", labels[view.execution.state]);
  text("#execution-copy", view.execution.text);
}
export function showHealth(data, { restored = false } = {}) {
  current = data;
  const view = healthTask(data);
  $("#task-empty").hidden = true; $("#task-detail").hidden = false; $("#task-stale").hidden = false;
  if (!restored) $("#task-stale").hidden = true;
  text("#task-stale", restored ? "这是查询得到的历史记录，未与当前表单绑定。" : "输入已修改。旧任务仅供回看，请重新检查。");
  text("#task-label", labels[view.state]); $("#task-label").dataset.state = view.state;
  text("#task-id", "task_id · " + view.taskId);
  $("#restore-id").value = view.taskId;
  text("#task-source", "DEMO / FIXTURE · 本地 Core 响应 · " + (data.contract_version || data.task_state.contract_version) + " · 原始任务编号未改写");
  renderTaskStates(view);
  text("#task-raw", JSON.stringify(data, null, 2));
  text("#run-feedback", view.state === "WAITING_RISK" ? "分析与方案比较已完成。Risk 仍待交接，未审批、未执行。" : labels[view.state]);
  $("#audit-timeline").replaceChildren();
  if (data.audit_evidence) {
    try { renderAudit(data.audit_evidence, view.taskId); }
    catch (error) { text("#audit-message", error.message); }
  }
  progress(view.state); refreshAudit();
}
$("#retry-audit").onclick = refreshAudit;
$("#restore-form").onsubmit = async event => {
  event.preventDefault();
  const id = $("#restore-id").value.trim(), revision = ++restoreRevision;
  if (!id) { text("#restore-message", "WAITING_INPUT · 请填写原任务编号。"); return; }
  text("#restore-message", "正在只读查询原任务，不重新执行。");
  try {
    const task = await api("/api/task/" + encodeURIComponent(id));
    if (revision !== restoreRevision) return;
    if (task.task_state?.task_id !== id || task.task_state?.contract_version !== "investment-agent.v1")
      throw new Error("任务响应不匹配，未采用。");
    auditEvents(task.audit_evidence, id);
    showHealth(task, { restored: true });
    text("#restore-message", "已读取服务端原任务；仅供回看，不与当前表单绑定。");
  } catch (error) {
    if (revision === restoreRevision) text("#restore-message", "ERROR · " + error.message + "。服务重启可能导致进程内记录丢失。");
  }
};
progress("WAITING_INPUT");
