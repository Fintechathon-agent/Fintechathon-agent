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
    method: "POST",
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
    REJECTED: "已拒绝",
    MODEL_FAILED: "模型失败"
  }[status] || status;
}

function renderWorkflow(record) {
  workflowRecord = record;
  $("#workflow-result").hidden = false;
  $("#workflow-status").textContent = workflowStatusLabel(record.status);
  const proposal = record.proposed_action;
  $("#workflow-metrics").innerHTML = [
    ["任务", record.task_id], ["模型", record.model?.model_response?.model || "已配置模型"],
    ["Risk", record.risk_decision?.decision || record.risk_handoff?.decision || "等待"],
    ["执行", record.execution?.status || "阻断"]
  ].map(([label, value]) => '<div class="workflow-metric"><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></div>').join("");
  $("#workflow-proposal-title").textContent = proposal ? workflowLabel(proposal.proposed_action) : "模型未形成拟议动作";
  $("#workflow-proposal-reason").textContent = proposal?.action_reason || record.error?.message || "等待模型结果";
  $("#workflow-proposal-source").textContent = record.model?.source ? "来源：" + record.model.source + "；拟议动作不等于授权。" : "模型调用失败；Risk 和执行端均已阻断。";
  const hash = proposal?.proposal_sha256 || "";
  const actions = [];
  if (record.status === "PENDING_RISK") {
    actions.push(['risk-approve', 'Risk 通过', '']);
    actions.push(['risk-reject', 'Risk 拒绝', 'danger']);
    actions.push(['risk-more', '要求补充信息', '']);
  } else if (record.status === "PENDING_APPROVAL") {
    actions.push(['approval-approve', '审批通过', '']);
    actions.push(['approval-reject', '审批拒绝', 'danger']);
  } else if (record.status === "READY_FOR_SIMULATION") {
    actions.push(['simulate', '执行模拟', '']);
  }
  $("#workflow-actions").innerHTML = actions.length
    ? actions.map(([action, label, tone]) => '<button type="button" data-workflow-action="'+action+'" class="'+tone+'">'+label+' →</button>').join("")
    : '<span class="small muted">当前阶段没有可继续的动作；完整记录已保留。</span>';
  $("#workflow-json").textContent = JSON.stringify(record, null, 2);
}

$("#run-workflow").addEventListener("click", async () => {
  const button = $("#run-workflow");
  button.disabled = true;
  button.textContent = "正在调用模型…";
  try {
    const result = await workflowRequest("/api/review", {
      request_id: "req-workbench-" + (globalThis.crypto?.randomUUID?.() || Date.now()),
      kind: "bill",
      source: "risk-workbench-demo",
      text: $("#workflow-text").value,
      requested_action: $("#workflow-action").value,
      action_parameters: { amount: 1280, currency: "CNY", due_date: "2026-10-20", synthetic: true },
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
    if (action.startsWith("risk-")) next = await workflowRequest("/api/review/risk-decision", { ...base, reviewer: "demo-risk-owner", decision: action === "risk-approve" ? "APPROVE" : action === "risk-reject" ? "REJECT" : "REQUEST_MORE_INFO", reason: "演示环境记录的统一 Risk 决策" });
    else if (action.startsWith("approval-")) next = await workflowRequest("/api/review/approval", { ...base, approver: "demo-approver", decision: action === "approval-approve" ? "APPROVE" : "REJECT", reason: "演示环境记录的人工审批" });
    else next = await workflowRequest("/api/review/simulate", base);
    $("#workflow-message").textContent = "状态已更新；执行端仍只允许模拟，不连接真实系统。";
    renderWorkflow(next);
  } catch (error) {
    $("#workflow-message").textContent = error.message;
    if (error.payload?.workflow) renderWorkflow(error.payload.workflow);
  } finally {
    button.disabled = false;
  }
});
