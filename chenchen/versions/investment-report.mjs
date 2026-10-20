import { dateStatus, planComparison } from "./presentation.mjs";

// Read-only presentation of existing tool outputs. No portfolio calculation or authorization.
const percent = value => (value * 100).toFixed(2) + "%";
const labels = { A: "保持原配置", B: "温和调整", C: "减少高波动资产" };
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const bounded = value => Number.isFinite(value) && value >= 0 && value <= 1;
const limit = "固定虚构数据，未查询真实账户；本报告没有买卖任何资产。风控复核与必要的人工确认完成前，不能执行。";

export function buildInvestmentReport(result, { observedOn = new Date().toISOString().slice(0, 10) } = {}) {
  const state = result?.task_state, a = result?.artifacts;
  const p = a?.portfolio_snapshot, h = a?.health_report, s = a?.simulation;
  const unavailable = reason => ({ available: false, headline: "资料还不完整，暂不能得出结论", context: reason,
    metrics: [], priorities: [], comparison: null, source: null, taskId: state?.task_id || "未提供", limit,
    next: "补齐持仓、数据日期和分析结果后，重新检查。" });
  if (state?.status !== "HANDOFF_REQUIRED" || state.stage !== "RISK_CHECK") return unavailable("任务尚未完成分析，或当前状态需要先处理。");
  if (!p?.snapshot_id || state.portfolio_snapshot_id !== p.snapshot_id || h?.snapshot_id !== p.snapshot_id || s?.snapshot_id !== p.snapshot_id)
    return unavailable("持仓与分析结果没有对应上，不能把不同任务的数据拼在一起。");
  const profile = state.risk_profile;
  if (!profile || !Number.isInteger(profile.investment_horizon_days) || profile.investment_horizon_days < 1 ||
      !bounded(profile.max_drawdown) || profile.max_drawdown === 0 || !["low", "medium", "high"].includes(profile.liquidity_need))
    return unavailable("还缺少用钱时间或能够接受的下跌幅度。");
  const comparisons = s.comparisons;
  if (!Array.isArray(comparisons) || comparisons.length !== 4 || new Set(comparisons.map(c => c?.plan_id)).size !== 4)
    return unavailable("当前组合或三种比较方案不齐全，暂不挑选方案。");
  const view = planComparison(comparisons);
  if (!view.baseline || !view.best || view.plans.length !== 3 || comparisons.some(c => c.metrics.max_drawdown < -1 || c.metrics.cumulative_return < -1 || c.turnover > 1) ||
      !bounded(p.cash_weight) || !bounded(h?.concentration?.top_1)) return unavailable("关键数字缺失或不合法，不能按零处理。");
  const date = dateStatus(p.as_of, observedOn), start = h.data_window?.start, end = h.data_window?.end;
  const observations = h.data_window?.observations;
  if (["unknown", "future"].includes(date.kind) || dateStatus(start, end).ageDays === null || dateStatus(start, end).ageDays < 0 ||
      dateStatus(end, observedOn).ageDays < 0 || dateStatus(end, observedOn).ageDays === null ||
      !Number.isInteger(observations) || observations < 2 || s.historical_window?.start !== start || s.historical_window?.end !== end)
    return unavailable("数据日期缺失、晚于今天，或不同方案使用的日期没有对齐。");
  if (s.assumptions?.data_mode !== "SYNTHETIC_REPLAY") return unavailable("这个报告入口只核验过虚构演示数据，不能据此确认真实账户结果。");
  const baseline = view.baseline.metrics, change = baseline.cumulative_return;
  const direction = change === 0 ? "持平" : change > 0 ? "上涨" : "下跌";
  const magnitude = change !== 0 && Math.abs(change) < 0.00005 ? "不足 0.01%" : percent(Math.abs(change));
  const short = profile.investment_horizon_days <= 90 || profile.liquidity_need === "high";
  const largest = p.positions?.find(item => item.instrument_id === h.concentration.largest_instrument);
  if (!largest) return unavailable("最大持仓没有对应的明细，需先核对数据。");
  const over = Math.abs(baseline.max_drawdown) > profile.max_drawdown;
  const priorities = [
    { title: short ? "近期要花的钱，先单独留出" : "先核对房租、学费和备用金", reason: short ? "你填写了近期用钱需求。" : "报告还没有完整的生活账单。",
      next: "确认金额和使用日期；现金占比不能证明生活费已经留够。" },
    { title: "留意最大的那一项持仓", reason: (largest.name || largest.instrument_id) + "占组合 " + percent(h.concentration.top_1) + "。",
      next: "核对这个比例是否符合你的原计划，再讨论是否需要调整。" },
    { title: over ? "样本中的跌幅超过你填写的上限" : "确认自己能承受多大的下跌", reason: "样本最大跌幅 " + percent(Math.abs(baseline.max_drawdown)) + "；你填写的上限 " + percent(profile.max_drawdown) + "。",
      next: "这里只比较这段数据，未来可能跌得更多；需要调整时先交风控复核。" }
  ];
  const points = view.improvementPoints;
  const difference = Math.abs(points) < 0.005 ? "差异不足 0.01 个百分点" : "相差 " + Math.abs(points).toFixed(2) + " 个百分点";
  const comparison = { code: points > 0 ? "LESS_DROP" : points < 0 ? "MORE_DROP" : "SAME_DROP",
    title: points > 0 ? labels[view.best.plan_id] + "：这段样本跌得较少" : points < 0 ? "这些方案都没有比当前组合少跌" : "最小跌幅与当前组合相同",
    detail: difference + "；该方案需调整 " + percent(view.best.turnover) + " 的配置。仅供比较，不代表更适合你或未来收益更好。",
    planId: view.best.plan_id };
  return { available: true, headline: "这段演示数据里，组合" + direction + (change === 0 ? "" : " " + magnitude),
    context: short ? "先核对近期生活用钱，再看投资调整。" : "先看清变化，再决定是否需要复核。",
    metrics: [
      { label: "这段数据的涨跌", value: change !== 0 && Math.abs(change) < 0.00005 ? direction + "不足 0.01%" : percent(change), help: "只是固定虚构价格的历史比较，不是你的实际盈亏。" },
      { label: "期间最多跌了多少", value: percent(Math.abs(baseline.max_drawdown)), help: "从高点跌到低点的最大跌幅，也叫最大回撤。未来可能更大。" },
      { label: "组合里的现金", value: percent(p.cash_weight), help: "还没买入证券的钱，可能要用于房租、学费，不能全当作可投资的钱。" }
    ], priorities, comparison, source: { start, end, observations, asOf: p.as_of, freshness: date.label },
    taskId: state.task_id || "未提供", limit, next: "当前停在风控复核，尚未取得交易许可。" };
}

export function investmentReportText(report) {
  const lines = ["投资分析 · 易读报告", "", "一、先看结论", report.headline, report.context, "", "二、关键数字",
    ...(report.metrics.length ? report.metrics.map(m => m.label + "：" + m.value + "（" + m.help + "）") : ["资料不全，暂不显示数字。"]),
    "", "三、下一步怎么做", ...report.priorities.flatMap((p, i) => [(i + 1) + ". " + p.title, "原因：" + p.reason, "建议核对：" + p.next]), report.next,
    "", "四、方案有什么不同", report.comparison?.title || "暂不能比较。", report.comparison?.detail || "",
    "", "五、数据与边界", report.source ? report.source.start + " 至 " + report.source.end + "，共 " + report.source.observations + " 个价格观测；" + report.source.freshness : "数据来源或日期待核对。",
    report.limit, "", "六、查找原始记录", "任务编号：" + report.taskId, "详细计算结果和运行记录可在网页的“查看详细记录”中查阅。", ""];
  return lines.join("\n");
}

export function investmentReportHtml(report) {
  const details = (title, body) => '<details class="compact-detail"><summary>' + escape(title) + '</summary><p class="small">' + escape(body) + '</p></details>';
  return '<p class="section-kicker">一分钟看懂 · 固定虚构数据</p><h2>' + escape(report.headline) + '</h2><p>' + escape(report.context) + '</p>' +
    '<div class="metrics compact-metrics">' + report.metrics.map(m => '<article class="metric"><small>' + escape(m.label) + '</small><strong>' + escape(m.value) + '</strong>' + details("这是什么意思？", m.help) + '</article>').join("") + '</div>' +
    '<p class="small">' + escape(report.source ? report.source.start + " 至 " + report.source.end + " · " + report.source.observations + " 个价格观测 · " + report.source.freshness : report.next) + '</p>';
}
