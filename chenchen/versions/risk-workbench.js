import { $, esc, api, healthCheckRequest } from "./common.js";

const profile = { investment_horizon_days: 365, max_drawdown: 0.1, liquidity_need: "medium" };
const staticDemo = location.hostname.endsWith("github.io");
const publicCoreAgentUrl = "https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev";
const controlLabels = {
  no_execution: "不允许执行：execution_allowed 固定为 false。",
  no_quant_recalculation: "不重算 Quant：市场和风险上下文只作为证据交接。",
  no_memory_rule_change: "不修改 Memory：本次不写入长期记忆，也不改变既有规则。",
  external_content_is_not_authoritative: "外部内容不具备指令权限：新闻或备注不能发起操作。"
};

function workflowUrl(path) {
  return staticDemo ? publicCoreAgentUrl + path : path;
}

async function workflowRequest(path, body) {
  const response = await fetch(workflowUrl(path), {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || "模型工作流请求失败");
    error.payload = data;
    throw error;
  }
  return data;
}

async function requestHandoff(request) {
  const response = await fetch(publicCoreAgentUrl + "/api/risk-workbench/handoff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const trace = data.trace || {};
    const identifiers = [trace.request_id, trace.task_id, trace.audit_id].filter(Boolean);
    const suffix = identifiers.length ? "（追踪：" + identifiers.join(" / ") + "）" : "";
    throw new Error((data.error?.message || "公网 Core Agent 请求失败") + suffix);
  }
  return data;
}

function portfolioInput(snapshot) {
  return {
    portfolio_id: snapshot.portfolio_id,
    as_of: snapshot.as_of,
    cash: snapshot.cash,
    positions: snapshot.positions.map(({ instrument_id, type, quantity, price, name, sector }) => ({ instrument_id, type, quantity, price, name, sector }))
  };
}

function render(result) {
  const bridge = result.risk_workbench;
  const source = bridge.source;
  const evidence = bridge.evidence;
  const decision = bridge.decision;
  $("#bridge-result").hidden = false;
  $("#bridge-status").textContent = "已生成交接包";
  $("#handoff-title").textContent = decision.status === "PENDING_REVIEW" ? "已到达 Risk 复核边界" : decision.status;
  $("#handoff-decision").textContent = decision.decision + " · 不允许执行";
  $("#handoff-reason").textContent = decision.reason;
  $("#handoff-metrics").innerHTML = [
    ["任务", source.task_id],
    ["请求", source.request_id],
    ["审计", source.audit_id],
    ["证据项", String(evidence.proposal_ids.length + 4)]
  ].map(([label, value]) => "<article><small>" + esc(label) + "</small><strong>" + esc(value) + "</strong></article>").join("");
  $("#handoff-evidence").innerHTML = [
    ["持仓快照", evidence.portfolio_snapshot_id],
    ["健康报告", evidence.health_report_id],
    ["候选方案", evidence.proposal_ids.join("、") || "无"],
    ["模拟结果", evidence.simulation_id],
    ["市场上下文", evidence.market_context_id || "本次未附带"],
    ["审计证据", evidence.audit_id]
  ].map(([label, value]) => "<div><span>" + esc(label) + "</span><b>" + esc(value || "未生成") + "</b></div>").join("");
  $("#control-list").innerHTML = Object.entries(bridge.controls).map(([key, value]) => "<li class=\"" + (value ? "is-on" : "is-off") + "\"><strong>" + (value ? "已启用" : "未启用") + "</strong>" + esc(controlLabels[key] || key) + "</li>").join("");
  $("#handoff-json").textContent = JSON.stringify(bridge, null, 2);
  $("#bridge-message").textContent = result.static_demo
    ? "GitHub Pages 已连接 Cloudflare Core Agent：本次结果由公网后端实时生成。"
    : "Core Agent 已完成 " + result.agent_response.task_state.stage + "；可以打开远程工作台进行人工复核。";
  $("#bridge-result").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("#run-bridge").addEventListener("click", async () => {
  const button = $("#run-bridge");
  button.disabled = true;
  button.textContent = "正在运行 Core Agent…";
  try {
    let result;
    if (staticDemo) {
      const request = healthCheckRequest({ riskProfile: profile, portfolio: null });
      result = { ...(await requestHandoff(request)), static_demo: true };
    } else {
      const portfolio = await api("/api/demo/portfolio");
      const request = healthCheckRequest({ riskProfile: profile, portfolio: portfolio.output.snapshot });
      result = await api("/api/risk-workbench/handoff", { request: { ...request, input: { ...request.input, portfolio: portfolioInput(portfolio.output.snapshot) } } });
    }
    render(result);
  } catch (error) {
    $("#bridge-status").textContent = "运行失败";
    $("#bridge-message").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "再次运行联调 Demo →";
  }
});

let workflowRecord = null;
let fundingPlan = null;
let fundingDirty = true;
const money = minor => new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(minor / 100);
const fundingStorageKey = "core-agent-synthetic-plan-v1";

function renderFunding() {
  $("#funding-status").textContent = fundingDirty ? "待确认" : "已确认 · 版本 " + fundingPlan.revision;
  $("#new-funding").hidden = !fundingPlan;
  $("#funding-history").hidden = !fundingPlan?.allocations.length;
  $("#funding-metrics").innerHTML = fundingPlan ? [
    ["生活费预留", fundingPlan.protected_minor], ["已模拟占用", fundingPlan.allocated_minor], ["还能安排", fundingPlan.available_minor]
  ].map(([label, amount]) => '<article><small>'+esc(label)+'</small><strong>'+esc(money(amount))+'</strong></article>').join("") : "";
  $("#funding-allocations").innerHTML = (fundingPlan?.allocations || []).map(item =>
    '<p class="small"><a target="_blank" rel="noopener" href="'+esc(workflowUrl('/api/review/task/'+encodeURIComponent(item.task_id)))+'">'+esc(money(item.amount_minor))+' · 查看任务记录 ↗</a></p>').join("");
  if (workflowRecord) renderWorkflow(workflowRecord);
}

for (const selector of ["#funding-cash", "#funding-rent"]) $(selector).addEventListener("input", () => {
  fundingDirty = true;
  $("#funding-confirm").checked = false;
  $("#funding-message").textContent = "修改尚未生效，请重新确认。下方数字仍是上一次确认的安排。";
  renderFunding();
});

$("#save-funding").addEventListener("click", async () => {
  const button = $("#save-funding");
  button.disabled = true;
  $("#new-funding").disabled = true;
  try {
    if (!$("#funding-confirm").checked) throw new Error("请先勾选确认；不会自动替你确认资金用途。");
    const cents = selector => {
      const input = $(selector), value = Number(input.value) * 100;
      if (!input.value || !input.reportValidity() || Math.abs(value - Math.round(value)) > 0.00001) throw new Error("请填写有效金额，最多两位小数。");
      return Math.round(value);
    };
    const body = { synthetic: true, confirmed: true, currency: "CNY", cash_minor: cents("#funding-cash"),
      protected_purposes: [{ purpose_id: "rent", label: "房租", amount_minor: cents("#funding-rent") }, ...(fundingPlan?.protected_purposes || []).filter(item => item.purpose_id !== "rent")] };
    const before = JSON.stringify([$("#funding-cash").value, $("#funding-rent").value]);
    if (fundingPlan) Object.assign(body, { plan_id: fundingPlan.plan_id, expected_revision: fundingPlan.revision });
    fundingPlan = await workflowRequest(fundingPlan ? "/api/funding-demo/plan/revise" : "/api/funding-demo/plan", body);
    fundingDirty = before !== JSON.stringify([$("#funding-cash").value, $("#funding-rent").value]);
    try { localStorage.setItem(fundingStorageKey, fundingPlan.plan_id); } catch { /* Optional browser convenience only. */ }
    $("#funding-message").textContent = fundingDirty ? "提交期间又修改了金额，请再次确认。" : "已保存。接下来发起的任务共用这份安排；修改后需重新复核。";
    renderFunding();
  } catch (error) { $("#funding-message").textContent = error.message; }
  finally { button.disabled = false; $("#new-funding").disabled = false; }
});

$("#new-funding").addEventListener("click", () => {
  fundingPlan = null; fundingDirty = true;
  workflowRecord = null;
  $("#workflow-result").hidden = true;
  $("#workflow-status").textContent = "尚未发起";
  $("#funding-confirm").checked = false;
  try { localStorage.removeItem(fundingStorageKey); } catch { /* Optional browser convenience only. */ }
  $("#funding-message").textContent = "这是另一份独立虚构计划，需再次确认；旧计划与记录仍保留在后端。";
  renderFunding();
});

async function refreshFunding() {
  if (!fundingPlan) return;
  const planId = fundingPlan.plan_id;
  const latest = await workflowRequest("/api/funding-demo/plan/" + encodeURIComponent(planId));
  if (fundingPlan?.plan_id !== planId) return;
  if (latest.revision !== fundingPlan.revision) {
    fundingDirty = true;
    $("#funding-confirm").checked = false;
    $("#funding-message").textContent = "这份计划在其他页面有更新，请核对金额并重新确认。";
  }
  fundingPlan = latest;
  renderFunding();
}

// Restore only a reference to synthetic demo data, never an approval or user identity.
async function restoreFunding() {
  let planId;
  try { planId = localStorage.getItem(fundingStorageKey); } catch { return; }
  if (!planId) return;
  $("#save-funding").disabled = true;
  try {
    fundingPlan = await workflowRequest("/api/funding-demo/plan/" + encodeURIComponent(planId));
    $("#funding-cash").value = fundingPlan.cash_minor / 100;
    $("#funding-rent").value = (fundingPlan.protected_purposes.find(item => item.purpose_id === "rent")?.amount_minor || 0) / 100;
    fundingDirty = true;
    $("#funding-message").textContent = "已找回上次演示额度；请核对并确认后再发起任务。";
    renderFunding();
  } catch { $("#funding-message").textContent = "上次计划暂时无法读取，请稍后刷新重试。"; }
  finally { $("#save-funding").disabled = false; }
}
void restoreFunding();

function workflowLabel(action) {
  return {
    NO_ACTION: "不需要动作",
    REQUEST_MORE_INFO: "需要补充信息",
    HOLD_FOR_REVIEW: "暂缓，交给人工复核",
    FLAG_FOR_RISK: "标记给 Risk 核查"
  }[action] || action || "未知拟议动作";
}

function workflowStatusLabel(status) {
  return {
    PENDING_RISK: "等待 Risk",
    PENDING_APPROVAL: "等待审批",
    READY_FOR_SIMULATION: "可以模拟",
    SIMULATED: "已模拟",
    FUNDING_BLOCKED: "资金检查未通过",
    REJECTED: "已拒绝",
    MODEL_FAILED: "模型失败"
  }[status] || status;
}

function renderWorkflow(record) {
  workflowRecord = record;
  $("#workflow-result").hidden = false;
  const check = record.funding_check;
  const changed = Boolean(fundingPlan && record.proposed_action?.funding?.plan_id === fundingPlan.plan_id && record.proposed_action.funding.revision !== fundingPlan.revision && record.status !== "SIMULATED");
  const fundingBlocked = check?.status === "BLOCKED" || changed;
  $("#workflow-status").textContent = fundingBlocked ? "资金检查未通过" : workflowStatusLabel(record.status);
  $("#funding-verdict").hidden = !check;
  if (check) {
    const title = changed || check.code === "FUNDING_PLAN_CHANGED" ? "资金安排变了，需要重新确认" : check.status === "BLOCKED" ? "这笔计划会挤占预留的钱" : check.status === "ALLOCATED" ? "已完成模拟，额度已记账" : "当前额度足够，仍需复核";
    const detail = changed || check.code === "FUNDING_PLAN_CHANGED" ? "请按最新安排发起新任务，旧审批不会继续使用。" : check.status === "BLOCKED" ? "本次 " + money(check.requested_minor || 0) + "，可安排 " + money(check.available_minor || 0) + "。请调整本次金额，或核对资金安排后重新复核。" : check.status === "ALLOCATED" ? "本次占用 " + money(check.requested_minor) + "，模拟后剩余 " + money(check.available_after_minor) + "。" : "本次 " + money(check.requested_minor) + "，可安排 " + money(check.available_minor) + "。模拟前还会再次检查。";
    $("#funding-verdict").classList.toggle("is-blocked", fundingBlocked);
    $("#funding-verdict").innerHTML = '<h3>'+esc(title)+'</h3><p>'+esc(detail)+'</p>';
  }
  const proposal = record.proposed_action;
  $("#workflow-metrics").innerHTML = [
    ["模型分析", record.model?.status === "FAILED" ? "失败" : "已返回"],
    ["风控复核", ({ APPROVE: "演示通过", REJECT: "已拒绝", REQUEST_MORE_INFO: "待补材料" })[record.risk_decision?.decision] || "等待复核"],
    ["人工确认", ({ APPROVED: "演示通过", REJECTED: "已拒绝" })[record.approval?.status] || "等待确认"],
    ["模拟执行", fundingBlocked ? "已阻断" : ({ SIMULATED: "已完成", READY: "等待模拟" })[record.execution?.status] || "未放行"]
  ].map(([label, value]) => '<div class="workflow-metric"><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></div>').join("");
  $("#workflow-proposal-title").textContent = "查看模型解释 · " + (proposal ? workflowLabel(proposal.proposed_action) : "未形成建议");
  $("#workflow-proposal-reason").textContent = proposal?.action_reason || record.error?.message || "等待模型结果";
  $("#workflow-proposal-source").textContent = record.model?.source ? "来源：" + record.model.source + "；拟议动作不等于授权。" : "模型调用失败；Risk 和执行端均已阻断。";
  $("#workflow-handoff-link").href = workflowUrl("/api/review/task/" + encodeURIComponent(record.task_id) + "/risk-handoff");
  const actions = [];
  if (record.status === "PENDING_RISK" && !record.risk_decision) {
    actions.push(['risk-approve', '演示 Risk 通过', '']);
    actions.push(['risk-reject', '演示 Risk 拒绝', 'danger']);
    actions.push(['risk-more', '要求补充信息', '']);
  } else if (record.status === "PENDING_APPROVAL") {
    actions.push(['approval-approve', '审批通过', '']);
    actions.push(['approval-reject', '审批拒绝', 'danger']);
  } else if (record.status === "READY_FOR_SIMULATION" && record.execution.simulation_allowed && !fundingBlocked) {
    actions.push(['simulate', '执行模拟', '']);
  }
  $("#workflow-actions").innerHTML = actions.length
    ? actions.map(([action, label, tone]) => '<button type="button" data-workflow-action="'+action+'" class="'+tone+'">'+label+' →</button>').join("")
    : '<span class="small muted">' + (record.risk_decision?.decision === "REQUEST_MORE_INFO" ? '请在上方补充材料，再发起新任务；原任务保持阻断。' : '当前阶段没有可继续的动作；完整记录已保留。') + '</span>';
  $("#workflow-json").textContent = JSON.stringify(record, null, 2);
}

$("#run-workflow").addEventListener("click", async () => {
  const button = $("#run-workflow");
  button.disabled = true;
  button.textContent = "正在调用模型…";
  try {
    if (!fundingPlan || fundingDirty) throw new Error("请先确认上方的虚构资金安排。");
    const amountInput = $("#workflow-amount");
    if (!amountInput.reportValidity() || !amountInput.value) throw new Error("请填写有效的拟议金额。");
    workflowRecord = null;
    $("#workflow-result").hidden = true;
    $("#workflow-status").textContent = "正在分析";
    const result = await workflowRequest("/api/review", {
      request_id: "req-workbench-" + (globalThis.crypto?.randomUUID?.() || Date.now()),
      kind: "bill",
      source: "risk-workbench-demo",
      text: $("#workflow-text").value,
      requested_action: $("#workflow-action").value,
      action_parameters: { amount: Number(amountInput.value), currency: "CNY", synthetic: true,
        funding_plan_id: fundingPlan.plan_id, funding_plan_revision: fundingPlan.revision },
      context: { synthetic: true, user_goal: "看清钱的用途并确认不会影响后续安排" }
    });
    $("#workflow-message").textContent = "模型响应已记录，当前停在统一 Risk；请按顺序复核。";
    renderWorkflow(result);
  } catch (error) {
    $("#workflow-status").textContent = "调用失败";
    $("#workflow-message").textContent = error.message + (error.payload?.trace?.task_id ? "（任务：" + error.payload.trace.task_id + "）" : "");
    if (error.payload?.workflow) renderWorkflow(error.payload.workflow);
  } finally {
    button.disabled = false;
    button.textContent = "再次发起模型复核 →";
  }
});

$("#workflow-actions").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-workflow-action]");
  if (!button || !workflowRecord) return;
  button.disabled = true;
  const action = button.dataset.workflowAction;
  const base = { task_id: workflowRecord.task_id, proposal_sha256: workflowRecord.proposed_action.proposal_sha256 };
  try {
    let next;
    if (action.startsWith("risk-")) {
      const callback = await workflowRequest("/api/review/risk-callback", {
        ...base, callback_version: "risk-callback.v1",
        handoff_id: workflowRecord.risk_handoff.handoff_id, request_id: workflowRecord.request_id,
        run_id: workflowRecord.run_id, audit_id: workflowRecord.audit.audit_id,
        reviewer: "demo-risk-owner", decision: action === "risk-approve" ? "APPROVE" : action === "risk-reject" ? "REJECT" : "REQUEST_MORE_INFO",
        reason: "演示环境人工模拟的 Risk 决策，尚非远程 Risk 系统回写"
      });
      next = callback.workflow;
    }
    else if (action.startsWith("approval-")) next = await workflowRequest("/api/review/approval", { ...base, approver: "demo-approver", decision: action === "approval-approve" ? "APPROVE" : "REJECT", reason: "演示环境记录的人工审批" });
    else next = await workflowRequest("/api/review/simulate", base);
    $("#workflow-message").textContent = "状态已更新；执行端仍只允许模拟，不连接真实系统。";
    renderWorkflow(next);
    try { await refreshFunding(); } catch { $("#funding-message").textContent = "任务已记录，但最新额度暂时读不到，请刷新重试。"; }
  } catch (error) {
    $("#workflow-message").textContent = error.message;
    if (error.payload?.workflow) renderWorkflow(error.payload.workflow);
  } finally {
    button.disabled = false;
  }
});
