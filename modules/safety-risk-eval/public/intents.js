"use strict";
(() => {
  const $ = id => document.getElementById("intent-" + id), esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let auth, catalog, result, revision = 0, busy = false;
  const states = { ACTIVE: "候选需求", BACKGROUND: "仅作背景", NEEDS_CONFIRMATION: "先核对语义" };
  const capabilities = { BUDGET: "预算核对已接通", BUDGET_ONLY: "仅预算核对已接通", PORTFOLIO: "持仓演示已接通", NOT_CONNECTED: "专用工具未接通", OFFICIAL_CHANNEL: "转官方渠道", CONTEXT: "保留背景", CLARIFY: "需要明确需求" };
  async function api(path, data) {
    const response = await fetch(path, { credentials: "same-origin", ...(data ? { method: "POST", headers: { "Content-Type": "application/json", "X-Risk-Csrf": auth.csrf }, body: JSON.stringify(data) } : {}) });
    const value = await response.json(); if (!response.ok) throw Error(value.error?.message || "服务未完成请求"); return value;
  }
  function invalidate() { revision++; result = null; $("result").hidden = true; $("status").textContent = "输入已变化，请重新分类。"; }
  $("text").addEventListener("input", invalidate);
  function render(value) {
    const label = code => catalog.categories.find(c => c.code === code)?.label || code;
    $("result").innerHTML = `<h2>本次涉及 ${value.groups.filter(g => g.code !== "CONTEXT").length} 类需求</h2><div class="intent-groups">${value.groups.map(g => `<article class="intent-card"><h3>${esc(g.label)}</h3><span class="intent-state">${esc(capabilities[g.capability])}</span><p>${esc(g.next_step)}</p><ul>${value.clauses.filter(c => g.clauses.includes(c.id)).map(c => `<li>${esc(c.text)} <span class="intent-state">· ${esc(states[c.state])}</span></li>`).join("")}</ul></article>`).join("")}</div>
      ${value.relationships.map(r => `<p class="intent-relation">${esc(r.message)}</p>`).join("")}
      ${value.questions.length ? `<details><summary>按类别补充资料（${value.questions.length}项）</summary><ul class="intent-steps">${value.questions.map(q => `<li><strong>${esc(label(q.category))}：</strong>${esc(q.question)}</li>`).join("")}</ul></details>` : ""}
      <div class="actions">${value.next_actions.map(a => a.code === "BUDGET" ? '<button type="button" id="intent-budget">带着原文进入预算核对 →</button>' : `<a href="${esc(a.route)}" class="secondary">${esc(a.label)} →</a>`).join("")}</div><p class="fine">分类只是处理路径；已发生、否定、条件和他人情况须单独核对，不会自动执行任何资金操作。</p>`;
    $("result").hidden = false;
    $("budget")?.addEventListener("click", async () => {
      if (busy || !result) return; busy = true; const version = revision; $("budget").disabled = true;
      try {
        const asOf = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        const draft = await api("/api/safety/long-text/intake", { text: result.source_text, data_mode: "SYNTHETIC_REPLAY", as_of: asOf, horizon_days: 365 });
        if (version === revision) location.assign("/risk/long-text?draft_id=" + encodeURIComponent(draft.draft_id));
      } catch (e) { $("status").textContent = e.message; } finally { busy = false; if ($("budget")) $("budget").disabled = false; }
    });
  }
  $("classify").addEventListener("click", async () => {
    if (busy || !auth) return; busy = true; $("classify").disabled = true; const version = revision;
    $("result").hidden = true; $("status").textContent = "正在拆分与归类…";
    try { const value = await api("/api/safety/intents/classify", { text: $("text").value }); if (version !== revision) return; result = value; render(value); $("status").textContent = "已保留各类需求与原文依据，请核对后选择下一步。"; }
    catch (e) { if (version === revision) $("status").textContent = e.message; }
    finally { busy = false; $("classify").disabled = false; }
  });
  function samples() { $("sample").innerHTML = catalog.cases.filter(x => !$("filter").value || x.expected.includes($("filter").value)).map(x => `<option value="${esc(x.id)}">${esc(x.text)}</option>`).join(""); }
  $("filter").addEventListener("change", samples);
  $("use-sample").addEventListener("click", () => { if (!catalog || busy) return; const sample = catalog.cases.find(x => x.id === $("sample").value); if (sample) { $("text").value = sample.text; invalidate(); } });
  $("access").textContent = ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname) ? "当前是本机入口：仅此电脑可访问。关闭服务后需要重新启动；同一电脑换 Wi-Fi 不改变这个地址，其他设备需要固定线上地址。" : "当前为固定线上入口；更换网络继续使用此网址。草稿按浏览器会话隔离，网址不是账户登录凭证。";
  (async () => {
    auth = await api("/api/safety/session"); catalog = await api("/api/safety/intents/catalog");
    $("filter").innerHTML = '<option value="">全部类别</option>' + catalog.categories.map(c => `<option value="${esc(c.code)}">${esc(c.label)}</option>`).join(""); samples();
    const c = catalog.coverage; $("coverage").textContent = `内置 ${c.total} 条合成场景，本版本分类标签符合预期 ${c.passed} 条。开发与回归分组：${c.splits.map(x => `${x.split} ${x.count}条`).join("；")}。`;
    $("coverage-table").innerHTML = `<table><thead><tr><th>类别</th><th>样本覆盖</th><th>目前可走到哪一步</th></tr></thead><tbody>${c.categories.map(x => `<tr><td>${esc(x.label)}</td><td>${x.samples}</td><td>${esc(capabilities[x.capability])}</td></tr>`).join("")}</tbody></table>`;
    $("classify").disabled = false; $("status").textContent = "可同时填写多种需求；这里只分类，不向在线模型发送内容。";
  })().catch(e => { $("status").textContent = "分类服务连接失败：" + e.message + "。本机请重新运行启动脚本。"; });
})();
