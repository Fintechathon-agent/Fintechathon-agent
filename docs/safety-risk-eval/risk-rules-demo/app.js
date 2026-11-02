"use strict";
const { CASES, RULES, ASSETS, POLICY, DemoSession, pct, money, labels, metrics } = window.RiskDemo;
const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
let sequence = 0;
let session;
let pendingTimer;
function loadCase(id) {
  clearTimeout(pendingTimer);
  session = new DemoSession(id, ++sequence);
  render();
}
function renderCases() {
  const filter = $("case-filter").value;
  const visible = CASES.filter(c => filter === "all" || c.group === filter);
  $("case-count").textContent = `${visible.length} 个`;
  $("case-list").innerHTML = visible.map(c => `<button class="case-button" data-case="${c.id}" aria-pressed="${session.case.id === c.id}"><span>${escape(c.title)}<small>${c.findings.length ? Array.from(new Set(c.findings.map(f => f.rule))).join(" · ") : c.group === "flow" ? "R08 · R09" : "完整检查"}</small></span><span class="case-dot ${c.group}" aria-hidden="true"></span></button>`).join("");
}
function renderMetrics() {
  const c = session.case, m = c.metrics;
  const rows = [["单只资产最高占比", m.singleTotal, POLICY.total.single, m.singleInvested, POLICY.invested.single], ["前三大资产合计", m.top3Total, POLICY.total.top3, m.top3Invested, POLICY.invested.top3], [m.unknownTotal ? "行业最高已知下界" : "最高行业占比", m.sectorTotal, POLICY.total.sector, m.sectorInvested, POLICY.invested.sector]];
  const cell = (actual, limit, unknown) => `<td class="${actual > limit + 1e-9 ? "metric-exceeded" : unknown ? "metric-unknown" : ""}"><strong>${unknown ? "≥ " : ""}${pct(actual)}</strong><small>演示上限 ${pct(limit)}${unknown ? " · 信息不完整" : ""}</small></td>`;
  $("metrics-body").innerHTML = rows.map((r, index) => `<tr><td>${r[0]}</td>${cell(r[1], r[2], index === 2 && m.unknownTotal)}${cell(r[3], r[4], index === 2 && m.unknownTotal)}</tr>`).join("");
  $("portfolio-line").textContent = `总资产 ${money(c.totalValue)} · 非现金投资 ${money(m.invested * c.totalValue)} · 现金 ${money(m.cash * c.totalValue)}${m.unknownTotal ? ` · 行业未知 ${pct(m.unknownTotal)}（总资产）／${pct(m.unknownInvested)}（投资部分）` : ""}`;
  $("supporting-metrics").innerHTML = `<div><span>历史最大回撤</span><strong>${pct(c.drawdown)}</strong> <small>／可接受 ${pct(c.maxDrawdown)}</small></div><div><span>样本相关系数</span><strong>${c.correlation.toFixed(2)}</strong></div><div><span>两项占总资产</span><strong>${pct(c.correlatedWeight)}</strong></div>`;
  $("evidence-details").innerHTML = `<div class="holdings">${ASSETS.map((asset, index) => `<div class="holding"><strong>${asset.name}</strong><span>${asset.id}</span><span>${money(c.weights[index] * c.totalValue)} · ${pct(c.weights[index])}</span></div>`).join("")}</div><p>案例数据版本：${escape(session.dataVersion)}；行业汇总版本：demo-sector-summary.v1。全部为预置虚构数据，未使用真实ETF持仓。</p><p>成长ETF模拟行业权重：科技30%、消费40%、工业30%；消费ETF：科技20%、消费50%、工业30%。股票归科技；债券ETF与现金单独分类，不计入股票行业。${m.unknownTotal ? "本案例成长ETF行业汇总缺失，不应用其预置映射；未知20%单列。" : ""}</p><p>历史指标为预设案例事实，不是量化工具实时计算结果；样本7个交易日，仅用于队内演示。历史日期不按实时行情过期处理。</p><div class="actions-summary"><strong>完整拟议模拟动作</strong><br>将虚构组合调整为上方四项目标金额，现金目标 ${money(m.cash * c.totalValue)}；不提交真实订单。${c.availableCash != null ? `<br>本步可用现金 ${money(c.availableCash)}，拟买入5,000元、费用50元，所需 ${money(c.requiredCash)}；其余现金为模拟冻结。` : ""}${c.externalText ? `<br>外部待分析文字：${escape(c.externalText)}（无权限效力）` : ""}</div>`;
  $("improvement-panel").hidden = !c.focusOptions;
  if (c.focusOptions) {
    const baseline = metrics(c.baselineWeights);
    $("improvement-panel").innerHTML = `<div class="focus-panel"><label for="focus-select">本次重点改善哪个指标？</label><select id="focus-select"><option value="">请由用户选择</option>${c.focusOptions.map(x => `<option ${session.focus === x ? "selected" : ""}>${x}</option>`).join("")}</select><div class="focus-comparison">单只：${pct(baseline.singleTotal)} → ${pct(m.singleTotal)}（总资产），${pct(baseline.singleInvested)} → ${pct(m.singleInvested)}（投资部分）<br>前三：${pct(baseline.top3Total)} → ${pct(m.top3Total)}（总资产），${pct(baseline.top3Invested)} → ${pct(m.top3Invested)}（投资部分）<br>行业：${pct(baseline.sectorTotal)} → ${pct(m.sectorTotal)}（总资产），${pct(baseline.sectorInvested)} → ${pct(m.sectorInvested)}（投资部分）</div><p>重点改善不能覆盖任一口径新增或加重的其他硬超限。</p></div>`;
  }
}
function describeValue(value) {
  if (value == null) return "未设数值／未知";
  if (typeof value === "number") return value <= 1 ? pct(value) : value.toLocaleString("zh-CN");
  if (typeof value === "object") return `相关系数 ${value.correlation}；总资产占比 ${pct(value.totalWeight)}`;
  return String(value);
}
function renderRules() {
  const evaluated = session.evaluation === "CHECKED";
  const decision = session.decision;
  const verdictText = decision === "ALLOW" ? "可查看并确认完整模拟计划。" : decision === "BLOCK" ? "保留比较，禁止执行；修改方案后重新检查。" : decision === "REVIEW" ? session.needsRepair ? "存在必须修复的问题，用户确认不能放行。" : "逐项接受指定风险后，才能确认完整模拟计划。" : decision === "CHECKING" ? "检查期间不允许确认或执行。" : "先运行检查，当前没有有效执行结论。";
  $("verdict").className = `verdict ${evaluated ? decision.toLowerCase() : ""}`;
  $("verdict").innerHTML = `<strong>${labels[decision]}</strong><span>${verdictText}</span>`;
  $("rules").innerHTML = RULES.map(rule => {
    const findings = rule.id === "R08" ? session.authorizationReasons : evaluated ? session.findings.filter(f => f.rule === rule.id) : [];
    let state = evaluated ? aggregateRule(findings) : "PENDING";
    let text = labels[state];
    if (rule.id === "R08") { state = session.approval === "APPROVED" && !findings.length ? "ALLOW" : session.approval === "REJECTED" ? "BLOCK" : session.approval === "INVALIDATED" ? "REVIEW" : "PENDING"; text = `授权：${labels[session.approval]}`; }
    if (evaluated && !findings.length && rule.id === "R09") text = session.execution === "SUCCEEDED" ? "只读返回原回执" : "通过／无重复写入";
    return `<div class="rule"><div class="rule-head"><div><span class="rule-number">${rule.id}</span><span class="rule-title">${rule.title}</span></div><span class="status-label ${state.toLowerCase()}">${text}</span></div>${findings.map(f => `<div class="reason ${f.disposition.toLowerCase()}"><div class="reason-code">${f.code}</div><p>${escape(f.text)}</p><p>恢复：${escape(f.recovery)}</p><div class="reason-meta">实际 ${escape(describeValue(f.actual))} · 限制 ${escape(describeValue(f.limit))} · ${escape(f.basis)}<br>证据 ${escape(f.evidence)} · ${f.acknowledgeable ? "可明确接受此风险" : f.disposition === "BLOCK" ? "不可确认覆盖" : "必须修复／核查"}</div></div>`).join("")}</div>`;
  }).join("");
  $("run-check").disabled = session.evaluation === "CHECKING" || session.execution !== "NOT_STARTED";
  $("run-check").textContent = session.evaluation === "CHECKING" ? "正在检查…" : evaluated ? "重新运行检查" : "运行案例检查";
  $("repair-data").hidden = !session.case.repairable || session.repaired;
  $("repair-data").disabled = session.evaluation === "CHECKING";
  $("repair-note").textContent = session.case.repairable && !session.repaired ? "恢复按钮只演示依赖恢复，不等于用户接受错误数据。" : "";
}
function aggregateRule(findings) { return findings.some(f => f.disposition === "BLOCK") ? "BLOCK" : findings.some(f => f.disposition === "REVIEW") ? "REVIEW" : "ALLOW"; }
function renderApproval() {
  $("state-strip").innerHTML = [["风险检查", session.decision], ["用户确认", session.approval], ["演示执行", session.execution]].map(([title, state]) => `<div><span>${title}</span><strong>${labels[state]}</strong></div>`).join("");
  const acknowledgements = session.evaluation === "CHECKED" ? session.findings.filter(f => f.acknowledgeable) : [];
  $("acceptances").hidden = !acknowledgements.length;
  $("acceptance-list").innerHTML = acknowledgements.map(f => `<label class="check-label"><input type="checkbox" data-accept="${escape(f.id)}" ${session.accepted.has(f.id) ? "checked" : ""} ${session.canConfirm ? "" : "disabled"}><span>我明确接受：${escape(f.text)}<small>${f.code} · 本次接受不会消除原风险记录。</small></span></label>`).join("");
  $("confirm-plan").disabled = !session.canConfirm;
  $("confirm-plan").checked = session.fullPlan;
  $("approve").disabled = !session.canApprove;
  $("reject").disabled = session.evaluation !== "CHECKED" || session.execution !== "NOT_STARTED" || session.approval === "REJECTED";
  $("revoke").hidden = session.approval !== "APPROVED" || session.execution !== "NOT_STARTED";
  $("invalidate").hidden = !session.case.mutateVersion;
  $("invalidate").disabled = session.evaluation === "CHECKING" || ["RUNNING", "UNKNOWN"].includes(session.execution);
  $("execute").disabled = !session.canExecute;
  $("execute").textContent = session.execution === "RUNNING" ? "演示执行中…" : "执行模拟（原型）";
  $("approval-guidance").className = `guidance ${session.decision === "BLOCK" ? "block" : ""}`;
  $("approval-guidance").textContent = session.approval === "APPROVED" ? "已确认当前完整计划。复核原因保留；只接受指定风险，不覆盖硬性拦截。" : session.approval === "REJECTED" ? "用户已拒绝，无执行资格。重新开始本案例可演示新的确认流程。" : session.approval === "INVALIDATED" ? "旧确认已失效。重新检查并确认当前方案后才能执行。" : session.decision === "BLOCK" ? "当前存在硬性阻止，所有接受与执行入口均不可用。" : session.needsRepair && session.evaluation === "CHECKED" ? "先按触发原因修复或核查；这里没有人工勾选放行入口。" : "先查看完整拟议动作；如有可接受复核，须逐项接受，再确认整套计划。";
  $("execution-title").textContent = `演示执行：${labels[session.execution]}`;
  $("execution-guidance").textContent = session.execution === "UNKNOWN" ? "已发出一次请求，结果未知。不能重复执行，请核查原请求。" : session.execution === "FAILED" ? "工具明确失败，已记录中止原因；本轮不自动重试。" : session.execution === "SUCCEEDED" ? `已有成功回执；演示写入次数 ${session.writeCount}。重复请求只返回原回执。` : session.canExecute ? "执行资格满足。点击后仅在本页内存演示一份回执。" : "执行需要：检查有效、无硬性阻止、全部可接受风险已接受、确认绑定当前版本、审计可写、无重复或未知请求。";
  $("repeat").hidden = !session.receipt;
  $("repeat").disabled = session.keyConflict || session.execution !== "SUCCEEDED";
  $("reconcile").hidden = session.execution !== "UNKNOWN";
  $("invalidate-key").hidden = !session.case.keyConflictAction || !session.receipt;
  $("invalidate-key").disabled = session.keyConflict;
  $("receipt").hidden = !session.receipt && session.execution !== "UNKNOWN" && session.execution !== "FAILED";
  $("receipt").className = `receipt ${["UNKNOWN", "FAILED"].includes(session.execution) ? "unknown" : ""}`;
  $("receipt").innerHTML = session.receipt ? `<strong>原型回执 · ${session.receipt.reconciled ? "原请求核查恢复" : "演示成功"}</strong><small>${escape(session.receipt.id)}</small><small>累计演示写入 ${session.writeCount} 次 · 未连接模拟账户或正式交易工具</small>` : session.execution === "UNKNOWN" ? "暂无可信回执；写入是否发生未知，不展示成功，也不允许重新写入。" : "明确失败，无成功回执。";
}
function renderAudit() {
  $("audit-list").innerHTML = session.audit.slice(-6).reverse().map(event => `<li><time datetime="${event.timestamp}">${new Date(event.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}</time><div><strong>${escape(event.description)}</strong><span>${event.event_type} · 方案v${event.proposal_version} · ${escape(event.audit_record_id)}</span></div></li>`).join("") || "<li>本案例尚无成功写入的演示审计记录。</li>";
  $("audit-json").textContent = JSON.stringify(session.export(), null, 2);
  $("audit-error").hidden = !session.faults.length;
  $("audit-error").textContent = session.faults.length ? `存在 ${session.faults.length} 次未写入的审计尝试。${session.auditAvailable ? "依赖已恢复，历史缺口仍保留。" : "相关执行暂停。"}这些屏幕故障提示不算审计成功。` : "";
}
function render() {
  renderCases();
  $("case-meta").textContent = `${session.case.id} · R01—R10固定规则`;
  $("case-title").textContent = session.case.title;
  $("case-description").textContent = session.case.description;
  $("plan-version").textContent = `虚构用户001 · 方案v${session.proposalVersion}`;
  $("reserve").textContent = `${money(session.case.reserve)}（已确认）`;
  renderMetrics(); renderRules(); renderApproval(); renderAudit();
}
function runCheck() {
  if (!session.startCheck()) return;
  const runningSession = session; render();
  pendingTimer = setTimeout(() => { if (session !== runningSession) return; session.finishCheck(); render(); }, 260);
}
$("case-list").addEventListener("click", event => { const button = event.target.closest("[data-case]"); if (button) loadCase(button.dataset.case); });
$("case-filter").addEventListener("change", renderCases);
$("reset-case").addEventListener("click", () => loadCase(session.case.id));
$("run-check").addEventListener("click", runCheck);
$("repair-data").addEventListener("click", () => { if (session.repair()) runCheck(); });
$("improvement-panel").addEventListener("change", event => { if (event.target.id === "focus-select") { session.setFocus(event.target.value); render(); $("focus-select").focus({ preventScroll: true }); } });
$("acceptance-list").addEventListener("change", event => { if (event.target.dataset.accept) { const id = event.target.dataset.accept; session.accept(id, event.target.checked); renderApproval(); renderAudit(); document.querySelector(`[data-accept="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }); } });
$("confirm-plan").addEventListener("change", event => { if (!session.canConfirm) return; session.fullPlan = event.target.checked; renderApproval(); });
$("approve").addEventListener("click", () => { session.approve(); render(); });
$("reject").addEventListener("click", () => { session.reject(); render(); });
$("revoke").addEventListener("click", () => { session.revoke(); render(); });
$("invalidate").addEventListener("click", () => { session.invalidateVersion(); render(); });
$("execute").addEventListener("click", () => { if (!session.beginExecute()) return; const runningSession = session; render(); pendingTimer = setTimeout(() => { if (session !== runningSession) return; session.finishExecute(); render(); }, 350); });
$("repeat").addEventListener("click", () => { session.replay(); render(); });
$("reconcile").addEventListener("click", () => { session.reconcile(); render(); });
$("invalidate-key").addEventListener("click", () => { session.conflictKey(); render(); });
$("export-audit").addEventListener("click", () => { const blob = new Blob([JSON.stringify(session.export(), null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${session.taskId}-prototype-audit.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
loadCase("normal");
