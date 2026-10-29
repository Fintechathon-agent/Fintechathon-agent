"use strict";
(() => {
  const make = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
  const coverage = { FULL: "本次范围完整", PARTIAL: "部分资料可评估", UNAVAILABLE: "尚不可评估" };
  const boundary = make("p", "当前权限边界：允许检查与比较；新的模拟资金写入保持关闭，真实交易始终禁止。历史回执可继续查看。", "unified-boundary");
  document.querySelector("main").prepend(boundary);
  const panel = make("section", null, "unified-grade"); panel.setAttribute("aria-labelledby", "unified-grade-title");
  panel.append(make("h2", "生活资金风险评级", "section-title")); panel.firstChild.id = "unified-grade-title";
  const grade = make("strong", "尚未检查", "unified-grade-value"), details = make("p", "先确认资料并运行日常资金检查。评级由服务端程序生成，模型不能改写。"), note = make("p", "本次范围：用户确认的虚构资金池。没有机构适当性评级，也不代表未来损失上限。", "fine");
  const permissions = make("p", "模拟资金写入已关闭：统一本人审批、团队共享账本及执行网关尚未联合验收。", "unified-permission");
  panel.append(grade, details, note, permissions);
  document.querySelector(".daily-results").prepend(panel);
  function enforce() {
    for (const id of ["daily-execute", "daily-repeat", "execute", "repeat"]) {
      const e = document.getElementById(id); if (e) { e.disabled = true; e.title = "当前权限策略禁止模拟资金写入；仍可检查、比较、确认和查看历史回执。"; }
    }
  }
  window.UnifiedRisk = {
    enforce,
    invalidate() { details.textContent = "资料已修改。这里保留上一次评级，不能代表新方案；请重新确认资料并检查。"; panel.dataset.stale = "true"; enforce(); },
    render(record) {
      delete panel.dataset.stale;
      const a = record?.unified_assessment;
      if (!a) { grade.textContent = "未知"; details.textContent = "服务端尚未返回可核验的统一评级。不能用模型文字或旧检查替代。"; enforce(); return; }
      grade.textContent = `${a.label_zh} · ${a.business_risk_band}`; panel.dataset.band = a.business_risk_band;
      details.textContent = `${coverage[a.coverage] || "覆盖未知"}。原风险判定 ${a.risk_decision || "未运行"}；检查编号 ${a.source_risk_check_id || "未知"}。规则 ${a.policy_version}，来源 ${a.source_policy_version}。`;
      note.textContent = a.scope + "低风险也不构成安全保证。";
      const p = record.unified_permission;
      permissions.textContent = p ? `执行权限：${p.decision}。${p.message_zh} 风险评级、用户确认与执行权限分别记录。` : "执行权限尚未核验，写入保持关闭。";
      enforce();
    }
  };
  const help = make("details", null, "unified-help"); help.append(make("summary", "查看 L0—L4 权限边界与独立能力"));
  const status = make("p", "正在加载权限目录…"); help.append(status); panel.append(help);
  fetch("/api/safety/unified-policy", { credentials: "same-origin", cache: "no-store" }).then(async r => {
    if (!r.ok) throw new Error("unavailable"); const p = await r.json();
    if (p.contract_version !== "unified-workbench-info.v1" || p.permission?.decision !== "ALLOW") throw new Error("invalid");
    status.textContent = "L0 公开读取；L1 本人范围私有读取；L2 分析与比较；L3 完整计划模拟写入（关闭）；L4 真实交易（禁止）。权限等级不继承其他资源权限。";
    const list = make("ul"); for (const c of p.capabilities) list.append(make("li", `${c.permission_level || "独立能力"} · ${c.label}：${c.workbench_status === "CLOSED" ? "关闭" : c.workbench_status === "REGISTERED_POLICY_HELP_ONLY" ? "仅已登记的公开规则说明" : "须独立授权，未完成统一联调验收"}`)); help.append(list);
  }).catch(() => { status.textContent = "权限目录暂时无法读取；相关写入保持关闭。请检查连接后刷新。"; });
  window.addEventListener("risk:connection", enforce); enforce();
})();
