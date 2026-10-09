"use strict";

const sources = {
  brief: { label: "用户提供市场简报", status: "固定参考", url: "", note: "原始 PDF 没有公开网页链接" },
  csindex: { label: "中证指数有限公司", status: "官方入口", url: "https://www.csindex.com.cn/", note: "查看指数定义和资料" },
  szse: { label: "深圳证券交易所", status: "官方入口", url: "https://www.szse.cn/disclosure/notice/general/t20100531_500454.html", note: "查看创业板指定义" },
  cme: { label: "CME Group / NYMEX WTI", status: "官方入口", url: "https://www.cmegroup.com/markets/energy/crude-oil/light-sweet-crude.quotes.html", note: "查看 WTI 行情入口" },
  treasury: { label: "U.S. Treasury", status: "官方入口", url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?field_tdr_date_value_month=202610&type=daily_treasury_yield_curve", note: "查看日度收益率曲线" }
};

const observations = [
  { id: "csi300", label: "权益", sublabel: "CSI 300", icon: "E", title: "大盘偏弱", source: "单日收盘变化", value: "-1.09%", tone: "negative", sourceId: "csindex", sourceStatus: "固定夹具", credibility: "中低", score: "2.5 / 5" },
  { id: "chinext", label: "成长", sublabel: "创业板指", icon: "G", title: "成长风格波动更大", source: "单日收盘变化", value: "-3.15%", tone: "negative", sourceId: "szse", sourceStatus: "固定夹具", credibility: "中低", score: "2.5 / 5" },
  { id: "oil", label: "商品", sublabel: "NYMEX 原油", icon: "C", title: "商品走强", source: "单日价格变化", value: "+4.15%", tone: "positive", sourceId: "cme", sourceStatus: "固定夹具", credibility: "中低", score: "2.5 / 5" },
  { id: "ust", label: "利率", sublabel: "美国 30Y 国债", icon: "R", title: "长端利率小幅上行", source: "收益率变化", value: "5.67%", tone: "neutral", sourceId: "treasury", sourceStatus: "固定夹具", credibility: "中", score: "3 / 5" }
];

const signals = [
  { id: "growth-rate-sensitivity", title: "成长资产对利率更敏感", status: "OBSERVED", label: "已观察", credibility: "低 · 2 / 5", reason: "成长风格跌幅更大，同时长端利率小幅上行；这是同一份参考数据中的并列事实，不是收益预测。" },
  { id: "oil-message-conflict", title: "原油价格与消息解释待复核", status: "REVIEW_REQUIRED", label: "待确认", credibility: "低 · 1.5 / 5", reason: "原油上涨与地缘消息方向出现冲突，来源没有提供足够证据支持单一原因。" }
];

const list = document.getElementById("observationList");
const signalList = document.getElementById("signalList");
const count = document.getElementById("resultCount");
const reviewButton = document.getElementById("showReview");

function renderObservations(mode = "all") {
  const visible = mode === "review" ? observations.filter((item) => item.id === "oil" || item.id === "chinext") : observations;
  list.innerHTML = visible.map((item) => { const source = sources[item.sourceId]; return `<article class="observation ${item.tone}" data-id="${item.id}"><div class="observation-label"><span class="observation-icon">${item.icon}</span><span><strong>${item.label}</strong><small>${item.sublabel}</small></span></div><div><div class="observation-title">${item.title}</div><div class="observation-source">${item.source} · 数据日期 2026-10-08</div><div class="source-meta"><span>${source.label} · ${item.sourceStatus}</span><span class="credibility-tag">可信度 ${item.credibility} · ${item.score}</span>${source.url ? `<a href="${source.url}" target="_blank" rel="noreferrer">查看来源 ↗</a>` : "<span>来源链接：无公网地址</span>"}</div></div><div class="observation-value"><strong>${item.value}</strong><small>价格/收益率观察</small></div></article>`; }).join("");
  count.textContent = `${visible.length} 项观察`;
}

function renderSignals() {
  signalList.innerHTML = signals.map((signal) => {
    const review = signal.status === "REVIEW_REQUIRED";
    return `<article class="signal-item"><div class="signal-head"><strong>${signal.title}</strong><span class="signal-status ${review ? "review" : "observed"}">${signal.label}</span></div><div class="signal-confidence">结论可信度：${signal.credibility}</div><p>${signal.reason}</p><details><summary>为什么保留这条信号</summary><p>它会被带入后续上下文，但不会直接改变组合结果，也不会生成交易授权。</p></details></article>`;
  }).join("");
}

function renderSources() {
  document.getElementById("sourceList").innerHTML = Object.values(sources).map((source) => `<div class="source-row"><span>${source.label}<small>${source.status} · ${source.note}</small></span>${source.url ? `<a href="${source.url}" target="_blank" rel="noreferrer">打开链接 ↗</a>` : "<em>无公网链接</em>"}</div>`).join("");
}

document.getElementById("showAll").addEventListener("click", () => {
  renderObservations("all");
  reviewButton.classList.remove("active");
});
reviewButton.addEventListener("click", () => {
  renderObservations("review");
  reviewButton.classList.add("active");
});
renderObservations();
renderSignals();
renderSources();
