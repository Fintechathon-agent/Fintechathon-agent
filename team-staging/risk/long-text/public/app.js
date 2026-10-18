"use strict";
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const yuan = value => value === null || value === undefined ? "待补信息" : (value / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rawYuan = value => value === null || value === undefined ? "" : String(value / 100);
const labels = { CASH: "现金线索", RESERVE: "保底线索", EXPENSE: "生活支出", INCOME: "收入", INVESTMENT: "投资计划", ASSET: "现有资产", OTHER: "待识别事项" };
const expenseLabels = { STUDY: "留学／教育费用", TRANSPORT: "机票／交通费用", LIVING: "生活费", HOUSING: "房租／住宿费用", TRAVEL: "旅游计划" };
const contextLabels = { HEADING: "标题", QUESTION: "提问", CONCERN: "资金顾虑", LOCATION: "留学地点", TRAVEL_DETAIL: "旅游目的地" };
const itemLabel = item => item.context_kind && item.type === "OTHER" ? contextLabels[item.context_kind] : item.type === "EXPENSE" ? expenseLabels[item.expense_category] || labels.EXPENSE : labels[item.type];
const isContext = item => item.context_kind && item.type === "OTHER" && item.disposition === "EXCLUDE";
const rangeYuan = range => !range ? "待补信息" : range.min === range.max ? yuan(range.min) : `${yuan(range.min)} – ${yuan(range.max)}`;
const stateLabels = { PLANNED: "计划", COMPLETED: "已发生", CONDITIONAL: "条件假设", NEGATED: "否定语句待核对", CANCELLED: "取消", CANCELLATION_REQUESTED: "申请取消（未必成功）", CORRECTION: "金额更正", AMBIGUOUS: "时态混合", UNSPECIFIED: "未注明时态" };
let draft = null, busy = false, inputRevision = 0, modelEnabled = false;
const integrated = location.pathname.startsWith("/risk/long-text");
let riskSession = null, sourceDirty = false;
const examples = {
  conflict: "我目前现金5万元，保底1万元。每月5号交房租3500元，下个月20号交学费2万元。我每月10号工资8000元，想拿2万元买基金。",
  safe: "我目前现金8万元，保底1万元。下个月5号交房租3500元，下个月20号交学费2万元。我想投资2万元。",
  uncertain: "我目前现金5万元，保底1万元。学费6000元已经交了。下个月5号要交房租3500元。如果下个月10号奖金10000元到账，再买基金5000元。朋友要交房租3000元。"
};
function binding() { return { draft_id: draft.draft_id, revision: draft.revision, interpretation_sha256: draft.interpretation_sha256 }; }
function cents(value) {
  if (value === "") return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw Error("金额须为非负数，最多两位小数");
  const parts = value.split("."), n = Number(parts[0]) * 100 + Number((parts[1] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(n)) throw Error("金额过大"); return n;
}
async function request(route, body) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), route.includes("model-review") ? 75000 : 45000);
  try {
    const path = integrated ? route === "daily-model-review" ? "/api/safety/daily/model-review" : "/api/safety/long-text/" + route : "/api/long-text/v1/" + route;
    const response = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", headers: { "Content-Type": "application/json", ...(integrated ? { "X-Risk-Csrf": riskSession?.csrf || "" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
    const value = await response.json(); if (!response.ok) throw Error(value.error?.message || value.error?.code || "请求失败"); return value;
  } finally { clearTimeout(timeout); }
}
async function action(fn) {
  if (busy) return;
  busy = true; $("error").textContent = "";
  document.querySelectorAll("button").forEach(b => { b.disabled = true; });
  try { await fn(); } catch (e) { $("error").textContent = e.name === "AbortError" ? "请求超时；旧结果未更新，请重试。" : e.message; $("error").scrollIntoView({ block: "center" }); }
  finally { busy = false; document.querySelectorAll("button").forEach(b => { b.disabled = false; }); }
}
function invalidate(sourceChanged = false) {
  inputRevision++; $("result").hidden = true; $("model-output").hidden = true; $("model-status").textContent = "";
  $("handoff-result").hidden = true;
  $("nonoverlap").checked = false; $("step-result").classList.remove("active");
  if (sourceChanged) { $("review").hidden = true; sourceDirty = true; if (!integrated) draft = null; $("step-review").classList.remove("active"); }
  $("status").textContent = "输入已变化，旧结果已隐藏；请重新核对并测算。";
  $("planning-preview").hidden = true;
}
function selectOptions(values, current) { return Object.entries(values).map(([key, label]) => `<option value="${key}" ${key === current ? "selected" : ""}>${esc(label)}</option>`).join(""); }
function renderPlanning() {
  const p = draft.planning_preview;
  $("planning-preview").hidden = !p;
  if (!p) return;
  $("planning-preview").innerHTML = `<div class="planning-head"><h3>预算概览</h3><span class="tag">待核对 · 人民币元</span></div>
    <div class="metric-grid"><div class="metric"><small>当前现金</small><strong>${esc(yuan(p.cash_minor))}</strong></div><div class="metric"><small>已知支出合计</small><strong>${esc(rangeYuan(p.known_expense_range_minor))}</strong></div><div class="metric"><small>扣除已知支出后的余额区间</small><strong>${esc(rangeYuan(p.remaining_after_known_expenses_minor))}</strong></div></div>
    <p class="muted">余额区间尚未扣除未知预算、投资和独立保底；不是可直接投入的额度。</p>
    <div class="budget-rows">${p.expense_rows.map(row => `<div><span>${esc(row.label)}${row.occurrence_count > 1 ? ` · ${row.occurrence_count}次` : ""}</span><strong>${row.range_minor ? esc(rangeYuan(row.range_minor)) : "预算待定 · 未计入"}</strong></div>`).join("") || "尚无可计入的支出事项。"}</div>
    ${p.investment_items.length ? `<p><strong>投资意向已记录</strong><br>${p.investment_items.map(x => `${esc(x.text)} — ${x.amount_minor === null ? "金额待分配" : `${esc(yuan(x.amount_minor))} 元`}`).join("<br>")}<br><span class="muted">以核对栏填写的金额测算；未确定的方向保留为意向，不会自动分配全部余款。</span></p>` : ""}
    ${p.next_steps.length ? `<h3>接下来只需明确</h3><ul>${p.next_steps.map(s => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
    <details><summary>预算概览怎么算</summary><ul>${p.assumptions.map(s => `<li>${esc(s)}</li>`).join("")}</ul></details>`;
}
function renderDraft() {
  $("review").hidden = false; $("step-review").classList.add("active"); $("revision").textContent = "版本 " + draft.revision;
  renderPlanning();
  const cards = draft.items.map((item, i) => `<article class="item${isContext(item) ? " context-item" : ""}" data-id="${esc(item.id)}"><div class="section-head"><strong>${i + 1}. ${esc(itemLabel(item))}</strong><span class="meta">${esc(isContext(item) ? "补充背景 · 不单独计费" : stateLabels[item.classification.status])} · 原文 ${item.source_span.start}–${item.source_span.end}</span></div><p class="source">${esc(item.text)}</p>
    ${isContext(item) ? "<details><summary>修改归类或处理方式</summary>" : ""}<div class="item-grid">
    <div><label for="${item.id}-type">事项类型</label><select id="${item.id}-type" data-field="type">${selectOptions(labels, item.type)}</select></div>
    <div><label for="${item.id}-amount">金额（元）</label><input id="${item.id}-amount" data-field="amount_minor" type="number" min="0" step="0.01" value="${rawYuan(item.amount_minor)}" placeholder="${item.amount_range_minor ? esc(rangeYuan(item.amount_range_minor)) : item.amount_basis === "REMAINING" ? "剩余资金 · 待分配" : "未知"}">${item.amount_range_minor ? `<button class="link range-choice" type="button" data-id="${item.id}" data-amount="${item.amount_range_minor.max}">按上限 ${esc(yuan(item.amount_range_minor.max))} 元预留</button>` : ""}</div>
    <div data-temporal ${["CASH", "RESERVE"].includes(item.type) ? "hidden" : ""}><label for="${item.id}-date">下一次日期</label><input id="${item.id}-date" data-field="due_date" type="date" value="${esc(item.due_date || "")}"></div>
    <div data-temporal ${["CASH", "RESERVE"].includes(item.type) ? "hidden" : ""}><label for="${item.id}-repeat">周期</label><select id="${item.id}-repeat" data-field="recurrence">${selectOptions({ ONCE: "一次", MONTHLY: "每月", WEEKLY: "每周", DAILY: "每天" }, item.recurrence)}</select></div>
    <div><label for="${item.id}-disposition">本次如何处理</label><select id="${item.id}-disposition" data-field="disposition">${selectOptions({ INCLUDE: "计入测算", EXCLUDE: "不计入", UNRESOLVED: "待核对" }, item.disposition)}</select></div>
    <div><label for="${item.id}-certainty">是否确定纳入</label><select id="${item.id}-certainty" data-field="certainty">${selectOptions({ EXPECTED: "按此计划安排", UNCERTAIN: "可能发生／未确定" }, item.certainty)}</select></div>
    <div class="wide"><label for="${item.id}-reason">不计入的原因</label><input id="${item.id}-reason" data-field="exclusion_reason" maxlength="240" value="${esc(item.exclusion_reason)}" placeholder="例如：已支付、他人情况、只是提问"></div></div>${isContext(item) ? "</details>" : ""}
    <p class="item-notes">${esc([...item.issues, ...item.date_notes, ...(item.duplicate_of ? ["与前面的原文重复，请确认是另一笔支出还是重复描述"] : []), ...(item.related_item_id ? ["可能延续上一事项，请核对是否合并或更正，避免重复计算"] : [])].join("；"))}</p>
    <label class="check"><input class="item-reviewed" type="checkbox" data-id="${esc(item.id)}">已核对这条原文及以上解释</label></article>`);
  const contexts = cards.filter((_, i) => isContext(draft.items[i]));
  $("items").innerHTML = cards.filter((_, i) => !isContext(draft.items[i])).join("") + (contexts.length ? `<details id="context-items"><summary>补充背景与提问 · ${contexts.length}条（不作为独立收支）</summary>${contexts.join("")}</details><label class="check"><input id="contexts-reviewed" type="checkbox">我已核对补充背景与提问，无需作为独立收支</label>` : "");
  for (const [id, key] of Object.entries({ cash: "cash_minor", floor: "hard_floor_minor", holds: "existing_holds_minor", fees: "fees_minor" })) $(id).value = rawYuan(draft.profile[key]);
  renderQuestions();
}
function renderQuestions() {
  $("questions").innerHTML = draft.questions.length ? `<details><summary><strong>逐日测算与在线复核前，还需确认 ${draft.questions.length} 项</strong></summary><ul>${draft.questions.map(q => `<li>${q.item_id ? `${esc(itemLabel(draft.items.find(x => x.id === q.item_id)))}（事项${Number(q.item_id.split("-")[1]) + 1}）：` : ""}${esc(q.message)}</li>`).join("")}</ul></details>` : "";
}
function corrections() {
  const items = [...document.querySelectorAll(".item")].map(card => {
    const row = { id: card.dataset.id };
    card.querySelectorAll("[data-field]").forEach(el => { row[el.dataset.field] = el.dataset.field === "amount_minor" ? cents(el.value) : el.dataset.field === "due_date" ? el.value || null : el.value; }); return row;
  });
  return { ...binding(), items, profile: { cash_minor: cents($("cash").value), hard_floor_minor: cents($("floor").value), existing_holds_minor: cents($("holds").value), fees_minor: cents($("fees").value) } };
}
function renderResult() {
  const result = draft.result; if (!result) return;
  $("result").hidden = false; $("step-result").classList.add("active");
  const decision = { ALLOW: "未触发硬冲突", BLOCK: "存在资金冲突", REVIEW: "需要补充核实", ERROR: "计算未完成" }[result.decision];
  $("decision").textContent = decision; $("decision").className = "tag " + (result.decision === "BLOCK" ? "danger" : result.decision === "ALLOW" ? "good" : "warning");
  $("summary").textContent = result.summary;
  const m = result.metrics || {};
  $("metrics").innerHTML = [["计划投资合计", m.requested_investment_minor], ["期间生活支出预留", m.expense_total_minor], ["安排前可用额度", m.available_for_new_action_minor], ["安排后剩余额度", m.projected_free_after_minor], ["保护资金缺口", m.shortfall_minor], ["未来预计收入（未计当前现金）", m.expected_income_minor]].map(([label, value]) => `<div class="metric"><small>${esc(label)}</small><strong>${esc(yuan(value))}</strong></div>`).join("");
  $("reasons").innerHTML = [...(result.review?.reasons || []), ...(result.review?.warnings || []), ...(result.review?.info || [])].map(r => `<div class="reason"><strong>${esc(r.message_zh)}</strong><span>${esc(r.recovery?.message_zh || "")}</span></div>`).join("");
  $("timeline").innerHTML = (m.cashflow || []).map(row => {
    const id = row.event_id?.replace(/-\d+$/, ""), source = draft.items.find(item => item.id === id);
    const name = row.kind === "OPENING" ? "期初可结算现金" : row.kind === "ACTION" ? "投资计划合计占用" : source?.text || row.event_id;
    return `<tr><td>${esc(row.at?.slice(0, 10))}</td><td>${esc(name)}</td><td>${row.kind === "OPENING" ? "—" : esc(yuan(row.amount_minor))}</td><td class="${row.balance_minor < 0 ? "negative" : ""}">${esc(yuan(row.balance_minor))}</td></tr>`;
  }).join("");
  $("assumptions").innerHTML = (result.assumptions || []).map(s => `<li>${esc(s)}</li>`).join("");
  $("json").textContent = JSON.stringify({ result, audit: draft.audit }, null, 2); $("model-review").hidden = integrated || !modelEnabled; $("handoff").hidden = !integrated;
}
function download(value, name) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
for (const id of ["source", "as-of", "horizon"]) $(id).addEventListener("input", () => { invalidate(true); $("counter").textContent = $("source").value.length.toLocaleString() + " / 20,000"; });
$("review").addEventListener("input", event => {
  if (event.target.id === "contexts-reviewed") { document.querySelectorAll(".context-item .item-reviewed").forEach(el => { el.checked = event.target.checked; }); return; }
  if (event.target.matches(".item-reviewed, #nonoverlap")) return;
  invalidate(); const card = event.target.closest(".item"); if (card) {
    card.querySelector(".item-reviewed").checked = false;
    if (event.target.dataset.field === "type") card.querySelectorAll("[data-temporal]").forEach(el => { el.hidden = ["CASH", "RESERVE"].includes(event.target.value); });
  }
  if ($("contexts-reviewed")) $("contexts-reviewed").checked = false;
});
$("items").addEventListener("click", event => {
  const button = event.target.closest(".range-choice");
  if (!button || busy) return;
  const field = $(button.dataset.id + "-amount"); field.value = rawYuan(Number(button.dataset.amount)); field.dispatchEvent(new Event("input", { bubbles: true }));
  $("status").textContent = "已选择区间上限作为预留金额；保存后更新预算概览，核对后再测算。";
});
document.querySelectorAll("[data-example]").forEach(button => button.addEventListener("click", () => { $("source").value = examples[button.dataset.example]; invalidate(true); $("counter").textContent = $("source").value.length + " / 20,000"; }));
$("parse").addEventListener("click", () => action(async () => {
  if (integrated && !riskSession) throw Error("工作台会话尚未就绪，请稍后再试");
  const revision = inputRevision, revising = integrated && draft;
  const result = await request(revising ? "revise" : "intake", { ...(revising ? binding() : { data_mode: "SYNTHETIC_REPLAY" }), text: $("source").value, as_of: $("as-of").value, horizon_days: Number($("horizon").value) });
  draft = result;
  if (integrated) { const url = new URL(location.href); url.searchParams.set("draft_id", draft.draft_id); history.replaceState(null, "", url); }
  if (revision !== inputRevision) return; sourceDirty = false; renderDraft();
  $("status").textContent = `已识别${draft.items.filter(x => !isContext(x)).length}条资金事项，另有${draft.items.filter(isContext).length}条背景与提问。可先查看预算概览。`; $("review").scrollIntoView({ block: "start" });
}));
$("save").addEventListener("click", () => action(async () => {
  if (!draft) return; const revision = inputRevision; const result = await request("correct", corrections());
  draft = result; if (revision !== inputRevision) return; renderDraft(); $("result").hidden = true; $("nonoverlap").checked = false; $("status").textContent = "纠错已保存；请核对当前版本后再测算。";
}));
$("confirm").addEventListener("click", () => action(async () => {
  if (!draft) return;
  const checked = [...document.querySelectorAll(".item-reviewed:checked")].map(x => x.dataset.id), nonoverlap = $("nonoverlap").checked;
  if (checked.length !== draft.items.length || !nonoverlap) throw Error("请逐条勾选核对，并确认资金事实没有重复计算。");
  const revision = inputRevision; const corrected = await request("correct", corrections());
  draft = corrected; if (revision !== inputRevision) return; renderQuestions();
  const result = await request("confirm", { ...binding(), reviewed_item_ids: checked, confirmed: true, nonoverlap_confirmed: true });
  draft = result; if (revision !== inputRevision) return; renderResult(); $("revision").textContent = "已核对 · 版本 " + draft.revision; $("status").textContent = "已按当前版本完成测算。修改任一输入后需重新核对。"; $("result").scrollIntoView({ block: "start" });
}));
$("download").addEventListener("click", () => action(async () => { const value = await request("export", binding()); download(value, "生活资金核对与风险.json"); }));
$("review-draft").addEventListener("click", () => action(async () => { const value = await request("review-draft", binding()); download(value, "model-review-request.json"); $("model-status").textContent = "已导出既有 model-review.v1 请求；尚未提交在线模型。"; }));
$("model-review").addEventListener("click", () => action(async () => {
  const revision = inputRevision; $("model-status").textContent = "正在进行在线只读复核…";
  try { const value = await request("model-review", binding()); if (revision !== inputRevision) return; $("model-output").hidden = false; $("model-output").textContent = JSON.stringify(value.model, null, 2); $("model-status").textContent = "在线复核已返回。上方确定性风险结果保持原样。"; }
  catch (error) { $("model-status").textContent = "在线复核失败；未产生在线成功结果。"; throw error; }
}));
$("handoff").addEventListener("click", () => action(async () => {
  const revision = inputRevision;
  if (!draft?.confirmation || sourceDirty) throw Error("请重新核对本版本再提交");
  $("model-status").textContent = "正在登记到风控工作台…";
  const task = await request("handoff", binding());
  if (revision !== inputRevision) return;
  $("handoff-result").hidden = false;
  $("handoff-link").href = "/risk?task_id=" + encodeURIComponent(task.input.binding.task_id);
  $("handoff-summary").textContent = `任务 ${task.input.binding.task_id} · 风控 ${task.review.decision} · 尚未审批或执行`;
  $("model-status").textContent = "正在调用团队在线模型，核对当前原文、资金与规则结果…";
  try {
    const model = task.model_review || await request("daily-model-review", { task_id: task.input.binding.task_id });
    if (revision !== inputRevision) return;
    $("model-output").textContent = JSON.stringify(model, null, 2); $("model-output").hidden = false;
    $("model-status").textContent = `在线模型已返回：${model.proposal.summary}（运行编号 ${model.run_id}）`;
  } catch (error) {
    if (revision === inputRevision) { $("model-status").textContent = "在线模型复核失败。工作台任务已保留；再次点击可重试同一任务，不会重复登记或自动执行。"; $("model-output").hidden = true; }
    throw error;
  }
}));
$("as-of").value = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
async function initialize() {
  if (integrated) {
    const response = await fetch("/api/safety/session", { credentials: "same-origin" });
    if (!response.ok) throw Error("无法连接风控工作台会话");
    riskSession = await response.json(); $("workbench-home").hidden = false; $("mode-label").textContent = "风控工作台 · 长文本入口";
    $("storage-note").textContent = "草稿核对有效期30分钟；已提交任务的原文与审计沿用工作台存储。在线复核会发送已核对的虚构原文与资金信息到团队 Core 模型；不执行真实交易。";
  }
  const health = await request("health"); modelEnabled = health.network_model_enabled;
  const id = new URLSearchParams(location.search).get("draft_id");
  if (integrated && id) {
    draft = await request("restore", { draft_id: id }); $("source").value = draft.source_text; $("as-of").value = draft.as_of; $("horizon").value = String(draft.horizon_days);
    $("counter").textContent = draft.source_text.length + " / 20,000"; renderDraft(); renderResult(); $("status").textContent = "已恢复当前会话草稿。修改后需重新核对。";
  }
}
initialize().catch(e => { $("error").textContent = "服务连接或草稿恢复失败：" + e.message; });
