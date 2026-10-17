"use strict";
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const yuan = value => value === null || value === undefined ? "待补信息" : (value / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rawYuan = value => value === null || value === undefined ? "" : String(value / 100);
const labels = { CASH: "现金线索", RESERVE: "保底线索", EXPENSE: "生活支出", INCOME: "收入", INVESTMENT: "投资计划", ASSET: "现有资产", OTHER: "待识别事项" };
const stateLabels = { PLANNED: "计划", COMPLETED: "已发生", CONDITIONAL: "条件假设", NEGATED: "否定语句待核对", CANCELLED: "取消", CANCELLATION_REQUESTED: "申请取消（未必成功）", CORRECTION: "金额更正", AMBIGUOUS: "时态混合", UNSPECIFIED: "未注明时态" };
let draft = null, busy = false, inputRevision = 0, modelEnabled = false;
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
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch("/api/long-text/v1/" + route, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
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
  $("nonoverlap").checked = false; $("step-result").classList.remove("active");
  if (sourceChanged) { $("review").hidden = true; draft = null; $("step-review").classList.remove("active"); }
  $("status").textContent = "输入已变化，旧结果已隐藏；请重新核对并测算。";
}
function selectOptions(values, current) { return Object.entries(values).map(([key, label]) => `<option value="${key}" ${key === current ? "selected" : ""}>${esc(label)}</option>`).join(""); }
function renderDraft() {
  $("review").hidden = false; $("step-review").classList.add("active"); $("revision").textContent = "版本 " + draft.revision;
  $("items").innerHTML = draft.items.map((item, i) => `<article class="item" data-id="${esc(item.id)}"><div class="section-head"><strong>${i + 1}. ${esc(labels[item.type])}</strong><span class="meta">${esc(stateLabels[item.classification.status])} · 原文 ${item.source_span.start}–${item.source_span.end}</span></div><p class="source">${esc(item.text)}</p><div class="item-grid">
    <div><label for="${item.id}-type">事项类型</label><select id="${item.id}-type" data-field="type">${selectOptions(labels, item.type)}</select></div>
    <div><label for="${item.id}-amount">金额（元）</label><input id="${item.id}-amount" data-field="amount_minor" type="number" min="0" step="0.01" value="${rawYuan(item.amount_minor)}" placeholder="未知"></div>
    <div><label for="${item.id}-date">下一次日期</label><input id="${item.id}-date" data-field="due_date" type="date" value="${esc(item.due_date || "")}"></div>
    <div><label for="${item.id}-repeat">周期</label><select id="${item.id}-repeat" data-field="recurrence">${selectOptions({ ONCE: "一次", MONTHLY: "每月", WEEKLY: "每周", DAILY: "每天" }, item.recurrence)}</select></div>
    <div><label for="${item.id}-disposition">本次如何处理</label><select id="${item.id}-disposition" data-field="disposition">${selectOptions({ INCLUDE: "计入测算", EXCLUDE: "不计入", UNRESOLVED: "待核对" }, item.disposition)}</select></div>
    <div><label for="${item.id}-certainty">是否确定纳入</label><select id="${item.id}-certainty" data-field="certainty">${selectOptions({ EXPECTED: "按此计划安排", UNCERTAIN: "可能发生／未确定" }, item.certainty)}</select></div>
    <div class="wide"><label for="${item.id}-reason">不计入的原因</label><input id="${item.id}-reason" data-field="exclusion_reason" maxlength="240" value="${esc(item.exclusion_reason)}" placeholder="例如：已支付、他人情况、只是提问"></div></div>
    <p class="item-notes">${esc([...item.issues, ...item.date_notes, ...(item.duplicate_of ? ["与前面的原文重复，请确认是另一笔支出还是重复描述"] : []), ...(item.related_item_id ? ["可能延续上一事项，请核对是否合并或更正，避免重复计算"] : [])].join("；"))}</p>
    <label class="check"><input class="item-reviewed" type="checkbox" data-id="${esc(item.id)}">已核对这条原文及以上解释</label></article>`).join("");
  for (const [id, key] of Object.entries({ cash: "cash_minor", floor: "hard_floor_minor", holds: "existing_holds_minor", fees: "fees_minor" })) $(id).value = rawYuan(draft.profile[key]);
  renderQuestions();
}
function renderQuestions() {
  $("questions").innerHTML = draft.questions.length ? `<p><strong>待补信息 · ${draft.questions.length}项</strong></p><ul>${draft.questions.map(q => `<li>${q.item_id ? `事项${Number(q.item_id.split("-")[1]) + 1}：` : ""}${esc(q.message)}</li>`).join("")}</ul>` : "";
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
  $("json").textContent = JSON.stringify({ result, audit: draft.audit }, null, 2); $("model-review").hidden = !modelEnabled;
}
function download(value, name) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
for (const id of ["source", "as-of", "horizon"]) $(id).addEventListener("input", () => { invalidate(true); $("counter").textContent = $("source").value.length.toLocaleString() + " / 20,000"; });
$("review").addEventListener("input", event => {
  if (event.target.matches(".item-reviewed, #nonoverlap")) return;
  invalidate(); const card = event.target.closest(".item"); if (card) card.querySelector(".item-reviewed").checked = false;
});
document.querySelectorAll("[data-example]").forEach(button => button.addEventListener("click", () => { $("source").value = examples[button.dataset.example]; invalidate(true); $("counter").textContent = $("source").value.length + " / 20,000"; }));
$("parse").addEventListener("click", () => action(async () => {
  const revision = inputRevision; const result = await request("intake", { text: $("source").value, data_mode: "SYNTHETIC_REPLAY", as_of: $("as-of").value, horizon_days: Number($("horizon").value) });
  if (revision !== inputRevision) return; draft = result; renderDraft(); $("status").textContent = `已拆分${draft.items.length}项。请逐项核对，补齐必要信息。`; $("review").scrollIntoView({ block: "start" });
}));
$("save").addEventListener("click", () => action(async () => {
  if (!draft) return; const revision = inputRevision; const result = await request("correct", corrections());
  if (revision !== inputRevision) return; draft = result; renderDraft(); $("result").hidden = true; $("nonoverlap").checked = false; $("status").textContent = "纠错已保存；请核对当前版本后再测算。";
}));
$("confirm").addEventListener("click", () => action(async () => {
  if (!draft) return;
  const checked = [...document.querySelectorAll(".item-reviewed:checked")].map(x => x.dataset.id), nonoverlap = $("nonoverlap").checked;
  if (checked.length !== draft.items.length || !nonoverlap) throw Error("请逐条勾选核对，并确认资金事实没有重复计算。");
  const revision = inputRevision; const corrected = await request("correct", corrections());
  if (revision !== inputRevision) return; draft = corrected; renderQuestions();
  const result = await request("confirm", { ...binding(), reviewed_item_ids: checked, confirmed: true, nonoverlap_confirmed: true });
  if (revision !== inputRevision) return; draft = result; renderResult(); $("revision").textContent = "已核对 · 版本 " + draft.revision; $("status").textContent = "已按当前版本完成测算。修改任一输入后需重新核对。"; $("result").scrollIntoView({ block: "start" });
}));
$("download").addEventListener("click", () => action(async () => { const value = await request("export", binding()); download(value, "生活资金核对与风险.json"); }));
$("review-draft").addEventListener("click", () => action(async () => { const value = await request("review-draft", binding()); download(value, "model-review-request.json"); $("model-status").textContent = "已导出既有 model-review.v1 请求；尚未提交在线模型。"; }));
$("model-review").addEventListener("click", () => action(async () => {
  const revision = inputRevision; $("model-status").textContent = "正在进行在线只读复核…";
  try { const value = await request("model-review", binding()); if (revision !== inputRevision) return; $("model-output").hidden = false; $("model-output").textContent = JSON.stringify(value.model, null, 2); $("model-status").textContent = "在线复核已返回。上方确定性风险结果保持原样。"; }
  catch (error) { $("model-status").textContent = "在线复核失败；未产生在线成功结果。"; throw error; }
}));
$("as-of").value = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
request("health").then(data => { modelEnabled = data.network_model_enabled; }).catch(e => { $("error").textContent = "本地服务未连接：" + e.message; });
