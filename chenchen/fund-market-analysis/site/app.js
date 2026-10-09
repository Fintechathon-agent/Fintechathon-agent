"use strict";

const observations = [
  { id: "csi300", label: "权益", sublabel: "CSI 300", icon: "E", title: "大盘偏弱", source: "单日收盘变化", value: "-1.09%", detail: "价格下行被记录为观察项，不自动解释成趋势反转。", tone: "negative" },
  { id: "chinext", label: "成长", sublabel: "创业板指", icon: "G", title: "成长风格波动更大", source: "单日收盘变化", value: "-3.15%", detail: "跌幅超过示例阈值，进入异常波动提示。", tone: "negative" },
  { id: "oil", label: "商品", sublabel: "NYMEX 原油", icon: "C", title: "商品走强", source: "单日价格变化", value: "+4.15%", detail: "价格与地缘消息方向存在待核对关系，暂不做归因。", tone: "positive" },
  { id: "ust", label: "利率", sublabel: "美国 30Y 国债", icon: "R", title: "长端利率小幅上行", source: "收益率变化", value: "5.67%", detail: "从 5.64% 上行至 5.67%，利率环境信号偏紧。", tone: "neutral" }
];

const signals = [
  { id: "growth-rate-sensitivity", title: "成长资产对利率更敏感", status: "OBSERVED", label: "已观察", reason: "成长风格跌幅更大，同时长端利率小幅上行；这是同一份参考数据中的并列事实，不是收益预测。" },
  { id: "oil-message-conflict", title: "原油价格与消息解释待复核", status: "REVIEW_REQUIRED", label: "待确认", reason: "原油上涨与地缘消息方向出现冲突，来源没有提供足够证据支持单一原因。" }
];

const list = document.getElementById("observationList");
const signalList = document.getElementById("signalList");
const count = document.getElementById("resultCount");
const reviewButton = document.getElementById("showReview");

function renderObservations(mode = "all") {
  const visible = mode === "review" ? observations.filter((item) => item.id === "oil" || item.id === "chinext") : observations;
  list.innerHTML = visible.map((item) => `<article class="observation ${item.tone}" data-id="${item.id}"><div class="observation-label"><span class="observation-icon">${item.icon}</span><span><strong>${item.label}</strong><small>${item.sublabel}</small></span></div><div><div class="observation-title">${item.title}</div><div class="observation-source">${item.source} · 固定参考数据</div></div><div class="observation-value"><strong>${item.value}</strong><small>点击信号看原因</small></div></article>`).join("");
  count.textContent = `${visible.length} 项观察`;
}

function renderSignals() {
  signalList.innerHTML = signals.map((signal) => {
    const review = signal.status === "REVIEW_REQUIRED";
    return `<article class="signal-item"><div class="signal-head"><strong>${signal.title}</strong><span class="signal-status ${review ? "review" : "observed"}">${signal.label}</span></div><p>${signal.reason}</p><details><summary>为什么保留这条信号</summary><p>它会被带入后续上下文，但不会直接改变组合结果，也不会生成交易授权。</p></details></article>`;
  }).join("");
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
