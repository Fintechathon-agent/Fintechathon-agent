import { $, esc, api, healthCheckRequest } from "./common.js";

const profile = { investment_horizon_days: 365, max_drawdown: 0.1, liquidity_need: "medium" };
const staticDemo = location.hostname.endsWith("github.io");
const controlLabels = {
  no_execution: "不允许执行：execution_allowed 固定为 false。",
  no_quant_recalculation: "不重算 Quant：市场和风险上下文只作为证据交接。",
  no_memory_rule_change: "不修改 Memory：本次不写入长期记忆，也不改变既有规则。",
  external_content_is_not_authoritative: "外部内容不具备指令权限：新闻或备注不能发起操作。"
};

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
    ? "GitHub Pages 静态演示：这里展示固定联调结果；本地版会真实调用 Core Agent。"
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
      result = { static_demo: true, agent_response: { task_state: { stage: "RISK_CHECK" } }, risk_workbench: await fetch("./risk-workbench-demo.json").then(response => response.json()) };
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
