const viewLabels = {
  overview: "总览",
  portfolio: "我的持仓",
  replay: "回测与审计",
  memory: "我的记忆"
};

const state = {
  activeView: "overview",
  scenario: "reduce",
  modalOpen: false
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 3000);
}

function setView(view) {
  if (!viewLabels[view]) return;
  state.activeView = view;
  $$(".view").forEach((item) => item.classList.toggle("is-visible", item.dataset.view === view));
  $$(".nav-item").forEach((item) => item.classList.toggle("is-active", item.dataset.viewTarget === view));
  $("#breadcrumb-current").textContent = viewLabels[view];
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openModal() {
  state.modalOpen = true;
  $("#verification-modal").classList.add("is-open");
  $("#verification-modal").setAttribute("aria-hidden", "false");
  $("#verification-step-one").classList.remove("is-hidden");
  $("#verification-step-two").classList.add("is-hidden");
  $("#verification-step-three").classList.add("is-hidden");
  $("#risk-confirm-checkbox").checked = false;
  $("#start-verification-button").disabled = true;
}

function closeModal() {
  state.modalOpen = false;
  $("#verification-modal").classList.remove("is-open");
  $("#verification-modal").setAttribute("aria-hidden", "true");
}

function updateScenario(scenario) {
  state.scenario = scenario;
  const data = {
    reduce: { label: "降低 30% 后", result: "+1.7%", drawdown: "-6.2%", saved: "¥740", copy: "若 3 个交易日前跟进信号，历史回测显示这段回撤可少承受约 6.7%。这只是模拟，不代表未来收益。" },
    hold: { label: "继续持有", result: "-5.0%", drawdown: "-9.8%", saved: "¥0", copy: "继续持有意味着承受完整回撤。模拟结果只用于看清路径，不代表未来一定复现。" },
    cash: { label: "转入货币基金", result: "+0.3%", drawdown: "-1.1%", saved: "¥612", copy: "转入低波动缓冲可以降低组合波动，但也会放弃部分后续上涨空间。请把它当成可比较的选项。" }
  }[scenario];
  $("#chart-scenario-label").textContent = data.label;
  $("#scenario-result").textContent = data.result;
  $("#scenario-result").classList.toggle("negative", scenario === "hold");
  $("#scenario-result").classList.toggle("positive", scenario !== "hold");
  $("#scenario-drawdown").textContent = data.drawdown;
  $("#scenario-saved").textContent = data.saved;
  $("#scenario-copy").textContent = data.copy;
  $$(".scenario-tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.scenario === scenario));
}

function appendChatMessage(message, type) {
  const thread = $("#chat-thread");
  const item = document.createElement("div");
  item.className = `chat-message ${type}-message`;
  item.innerHTML = `<span>${message}</span><small>刚刚</small>`;
  thread.appendChild(item);
  thread.scrollTop = thread.scrollHeight;
}

function getAgentReply(message) {
  if (message.includes("赎回") || message.includes("调整") || message.includes("卖")) {
    return "我听到的是一个执行请求。先确认比例和资金去向，再进入红色权限验证。我不会直接替你下单。";
  }
  if (message.includes("跑") || message.includes("要不要") || message.includes("动")) {
    return "现在还不能只用一句“跑”来回答。我的判断是：风险已升温，但先看模拟结果，再决定是否降低 30% 更稳妥。";
  }
  return "我会先把它拆成：你想解决什么、能接受多大调整、希望观察多久。缺的信息我会直接问，不会替你猜。";
}

function sendMessage(message) {
  const cleanMessage = message.trim();
  if (!cleanMessage) return;
  appendChatMessage(cleanMessage, "user");
  window.setTimeout(() => appendChatMessage(getAgentReply(cleanMessage), "agent"), 280);
}

$(".main-nav").addEventListener("click", (event) => {
  const target = event.target.closest("[data-view-target]");
  if (target) setView(target.dataset.viewTarget);
});

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-view-target]");
  if (target && !target.closest(".main-nav")) setView(target.dataset.viewTarget);
});

$("#open-simulation-button").addEventListener("click", () => {
  $("#simulation-panel").scrollIntoView({ behavior: "smooth", block: "center" });
  showToast("已展开模拟结果。先看清楚，再决定要不要动。");
});

$("#run-check-button").addEventListener("click", (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.innerHTML = "<span aria-hidden=\"true\">⟳</span> 检查中...";
  window.setTimeout(() => {
    button.disabled = false;
    button.innerHTML = "<span aria-hidden=\"true\">⟳</span> 立即检查";
    showToast("检查完成：风险温度 63，1 条信号需要你确认。");
  }, 900);
});

$("#dismiss-signal-button").addEventListener("click", (event) => {
  event.currentTarget.closest(".signal-panel").classList.add("is-dismissed");
  showToast("已记住：暂时不看。下次重大异常仍会提醒你。");
  window.setTimeout(() => event.currentTarget.closest(".signal-panel").classList.remove("is-dismissed"), 1300);
});

$(".scenario-tabs").addEventListener("click", (event) => {
  const target = event.target.closest("[data-scenario]");
  if (target) updateScenario(target.dataset.scenario);
});

$("#chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#chat-input");
  sendMessage(input.value);
  input.value = "";
});

$(".chat-suggestions").addEventListener("click", (event) => {
  const target = event.target.closest("[data-prompt]");
  if (!target) return;
  sendMessage(target.dataset.prompt);
});

$("#dismiss-signal-button").addEventListener("click", () => {
  window.setTimeout(() => showToast("我会继续在后台监护，有新的异常再叫你。"), 250);
});

$("#close-modal-button").addEventListener("click", closeModal);
$("#cancel-verification-button").addEventListener("click", closeModal);
$("#verification-modal").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeModal();
});
$("#risk-confirm-checkbox").addEventListener("change", (event) => {
  $("#start-verification-button").disabled = !event.target.checked;
});
$("#start-verification-button").addEventListener("click", () => {
  $("#verification-step-one").classList.add("is-hidden");
  $("#verification-step-two").classList.remove("is-hidden");
  $(".code-inputs input").focus();
});
$(".code-inputs").addEventListener("input", (event) => {
  const input = event.target;
  if (input.value && input.nextElementSibling) input.nextElementSibling.focus();
});
$("#finish-execution-button").addEventListener("click", () => {
  $("#verification-step-two").classList.add("is-hidden");
  $("#verification-step-three").classList.remove("is-hidden");
  showToast("验证通过，Mock 回执已写入审计时间线。");
});
$("#done-execution-button").addEventListener("click", () => {
  closeModal();
  setView("replay");
});
$("#clear-memory-button").addEventListener("click", () => {
  showToast("演示中不会真的清除数据。真实版本会要求再次确认。");
});

$("#open-verification-button").addEventListener("click", openModal);

window.setTimeout(() => showToast("我已替你盯着持仓。今天有 1 条信号需要确认。"), 800);
