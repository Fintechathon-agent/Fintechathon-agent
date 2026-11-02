/* Finance Lab · MCP 能力中心控制台
   前端 Agent 平台侧的最小实现：initialize → tools/list → tools/call。
   不提供 confirm 按钮：待确认事项必须到任务台由人完成确认/强验证。 */
(() => {
  "use strict";

  const CLIENT_INFO = { name: "finance-lab-web-console", version: "1.0.0" };
  const FIELD_LABELS = {
    period: "账期",
    include_cancelled: "包含已取消",
    last4: "卡号后四位",
    include_scheduled: "包含定时任务",
    include_expired: "包含已过期",
    limit: "返回条数",
    action: "动作名过滤",
    question: "自然语言请求",
    payee: "收款人",
    amount: "金额（元）",
    memo: "备注",
    scheduled_at: "预约时间（ISO）",
    aa_participants: "AA 参与人数",
    merchant: "商户名",
    operation: "操作",
    new_limit: "新额度（元）",
    birthday: "生日（YYYY-MM-DD）",
    relation: "人物关系",
    lock_amount: "锁定活期金额（元）",
    order_gifts: "生日前 2 天订花订蛋糕",
  };
  const OPERATION_LABELS = {
    query: "查询", lock: "锁卡", unlock: "解锁", limit_adjust: "额度调整",
    loss_report: "挂失", loss_release: "解挂",
  };
  const KIND_LABELS = { query: "QUERY / 只读", action: "ACTION / 只入队", plan: "PLAN / 联动计划" };
  const KIND_GROUPS = [
    ["query", "查询能力 · 自动执行"],
    ["action", "业务动作 · 只入队"],
    ["plan", "联动计划 · 子步骤确认"],
  ];

  const state = { tools: [], selected: null, seq: 0 };
  const $ = (id) => document.getElementById(id);

  const els = {
    status: $("conn-status"),
    total: $("stat-total"), query: $("stat-query"), action: $("stat-action"), plan: $("stat-plan"),
    toolList: $("tool-list"), toolCount: $("tool-count"),
    empty: $("tool-empty"), detail: $("tool-detail"),
    kind: $("tool-kind"), title: $("tool-title"), name: $("tool-name"),
    tier: $("tool-tier"), confirm: $("tool-confirm"), desc: $("tool-desc"),
    confirmCallout: $("confirm-callout"), form: $("tool-form"), fields: $("form-fields"),
    schema: $("tool-schema"), fillExample: $("fill-example"), invoke: $("invoke-btn"),
    result: $("result"), resultStatus: $("result-status"), resultMessage: $("result-message"),
    pendingBox: $("pending-box"), resultJson: $("result-json"),
    rpcLog: $("rpc-log"),
  };

  function setStatus(text, mode) {
    els.status.className = "status" + (mode ? " " + mode : "");
    els.status.innerHTML = "<i></i>" + text;
  }

  function log(kind, label, payload) {
    const line = document.createElement("div");
    line.className = kind;
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    line.textContent = `${time} ${label} ${JSON.stringify(payload)}`;
    els.rpcLog.appendChild(line);
    while (els.rpcLog.childElementCount > 60) els.rpcLog.removeChild(els.rpcLog.firstChild);
    els.rpcLog.scrollTop = els.rpcLog.scrollHeight;
  }

  async function rpc(method, params) {
    const payload = { jsonrpc: "2.0", id: ++state.seq, method, params: params || {} };
    log("req", "→", payload);
    const response = await fetch("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error(`HTTP ${response.status}：响应不是 JSON`);
    }
    log(data.error ? "err" : "res", "←", data);
    if (data.error) {
      const error = new Error(data.error.message || "JSON-RPC 错误");
      error.data = data.error;
      throw error;
    }
    return data.result;
  }

  function tierClass(tier) { return ["green", "yellow", "red"].includes(tier) ? tier : "green"; }
  function tierLabel(tier) {
    return { green: "绿 · 自动执行", yellow: "黄 · 确认后执行", red: "红 · 强验证" }[tier] || tier;
  }

  function renderStats() {
    const count = (kind) => state.tools.filter((t) => (t._meta || {}).kind === kind).length;
    els.total.textContent = state.tools.length;
    els.query.textContent = count("query");
    els.action.textContent = count("action");
    els.plan.textContent = count("plan");
    els.toolCount.textContent = state.tools.length;
  }

  function renderCatalog() {
    els.toolList.textContent = "";
    KIND_GROUPS.forEach(([kind, label]) => {
      const tools = state.tools.filter((t) => (t._meta || {}).kind === kind);
      if (!tools.length) return;
      const group = document.createElement("div");
      group.className = "group-label";
      group.textContent = label;
      els.toolList.appendChild(group);
      tools.forEach((tool) => {
        const meta = tool._meta || {};
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tool-item" + (state.selected === tool.name ? " active" : "");
        button.dataset.tool = tool.name;
        button.innerHTML = `
          <span class="tname">${escapeHtml(tool.title || tool.name)}</span>
          <span class="tier-dot ${tierClass(meta.tier)}" aria-label="${escapeHtml(tierLabel(meta.tier))}"></span>
          <span class="tsrc">${escapeHtml(tool.name)}</span>`;
        button.addEventListener("click", () => selectTool(tool.name));
        els.toolList.appendChild(button);
      });
    });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  function selectTool(name) {
    const tool = state.tools.find((t) => t.name === name);
    if (!tool) return;
    state.selected = name;
    renderCatalog();
    const meta = tool._meta || {};
    els.empty.hidden = true;
    els.detail.hidden = false;
    els.kind.textContent = KIND_LABELS[meta.kind] || String(meta.kind || "").toUpperCase();
    els.title.textContent = tool.title || tool.name;
    els.name.textContent = tool.name;
    els.tier.textContent = tierLabel(meta.tier);
    els.tier.className = "tier " + tierClass(meta.tier);
    els.confirm.textContent = meta.requiresHumanConfirmation ? "需人工确认" : "只读安全";
    els.confirm.className = "badge" + (meta.requiresHumanConfirmation ? " human" : "");
    els.desc.textContent = tool.description || "";
    els.confirmCallout.hidden = !meta.requiresHumanConfirmation;
    els.schema.textContent = JSON.stringify(tool.inputSchema || {}, null, 2);
    els.result.hidden = true;
    buildForm(tool);
  }

  function buildForm(tool) {
    const schema = tool.inputSchema || {};
    const properties = schema.properties || {};
    const required = new Set(schema.required || []);
    els.fields.textContent = "";

    if (!Object.keys(properties).length) {
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = "该能力无需参数，直接调用即可。";
      els.fields.appendChild(note);
      return;
    }

    Object.entries(properties).forEach(([name, spec]) => {
      const wrapper = document.createElement("div");
      wrapper.className = "field" + (name === "question" ? " span-2" : "");
      const id = `field-${name}`;
      const label = document.createElement("label");
      label.htmlFor = id;
      label.innerHTML = `${escapeHtml(FIELD_LABELS[name] || name)}${required.has(name) ? " <small>必填</small>" : ""}`;
      wrapper.appendChild(label);

      let input;
      if (spec.enum) {
        input = document.createElement("select");
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = required.has(name) ? "请选择" : "默认";
        input.appendChild(blank);
        spec.enum.forEach((value) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = OPERATION_LABELS[value] || value;
          input.appendChild(option);
        });
      } else if (spec.type === "boolean") {
        const check = document.createElement("div");
        check.className = "check";
        input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(spec.default);
        const text = document.createElement("span");
        text.textContent = spec.description || "启用";
        check.appendChild(input);
        check.appendChild(text);
        wrapper.appendChild(check);
        input.id = id;
        input.dataset.field = name;
        input.dataset.type = "boolean";
        els.fields.appendChild(wrapper);
        return;
      } else if (name === "question") {
        input = document.createElement("textarea");
        input.rows = 3;
        input.placeholder = (tool._meta && tool._meta.examples && tool._meta.examples[0] && tool._meta.examples[0].question) || "用一句话描述要办的事";
      } else {
        input = document.createElement("input");
        input.type = spec.type === "number" || spec.type === "integer" ? "number" : "text";
        if (input.type === "number") input.step = spec.type === "integer" ? "1" : "0.01";
        if (spec.default !== undefined && spec.default !== null) input.value = spec.default;
        input.placeholder = spec.description || "";
      }
      input.id = id;
      input.dataset.field = name;
      input.dataset.type = spec.type || "string";
      if (spec.maxLength) input.maxLength = spec.maxLength;
      if (spec.minimum !== undefined) input.min = spec.minimum;
      if (spec.maximum !== undefined) input.max = spec.maximum;
      input.required = required.has(name);
      wrapper.appendChild(input);

      if (spec.description && !input.placeholder) {
        const hint = document.createElement("span");
        hint.className = "hint";
        hint.textContent = spec.description;
        wrapper.appendChild(hint);
      }
      els.fields.appendChild(wrapper);
    });
  }

  function collectArguments() {
    const tool = state.tools.find((t) => t.name === state.selected);
    const schema = (tool && tool.inputSchema) || {};
    const required = new Set(schema.required || []);
    const args = {};
    els.fields.querySelectorAll("[data-field]").forEach((input) => {
      const name = input.dataset.field;
      const type = input.dataset.type;
      let value;
      if (type === "boolean") {
        value = input.checked;
      } else if (type === "number" || type === "integer") {
        if (input.value === "") return;
        value = Number(input.value);
        if (!Number.isFinite(value)) throw new Error(`${FIELD_LABELS[name] || name} 不是有效数字`);
      } else {
        value = input.value.trim();
        if (value === "") return;
      }
      if (required.has(name) && value === "") throw new Error(`请填写${FIELD_LABELS[name] || name}`);
      args[name] = value;
    });
    for (const name of required) {
      if (!(name in args)) throw new Error(`请填写${FIELD_LABELS[name] || name}`);
    }
    return args;
  }

  function fillExample() {
    const tool = state.tools.find((t) => t.name === state.selected);
    const example = tool && tool._meta && tool._meta.examples && tool._meta.examples[0];
    if (!example) return;
    els.fields.querySelectorAll("[data-field]").forEach((input) => {
      const name = input.dataset.field;
      if (!(name in example)) return;
      if (input.dataset.type === "boolean") input.checked = Boolean(example[name]);
      else input.value = example[name];
    });
  }

  async function invoke(event) {
    event.preventDefault();
    if (!state.selected) return;
    let args;
    try {
      args = collectArguments();
    } catch (error) {
      showError(error.message);
      return;
    }
    els.invoke.disabled = true;
    els.invoke.textContent = "调用中…";
    try {
      const result = await rpc("tools/call", {
        name: state.selected,
        arguments: args,
        _meta: { clientInfo: CLIENT_INFO },
      });
      renderResult(result);
    } catch (error) {
      showError(error.message);
    } finally {
      els.invoke.disabled = false;
      els.invoke.textContent = "调用工具 ↗";
    }
  }

  function showError(message) {
    els.result.hidden = false;
    els.resultStatus.textContent = "ERROR";
    els.resultStatus.className = "pill error";
    els.resultMessage.textContent = message;
    els.pendingBox.hidden = true;
    els.resultJson.textContent = "";
  }

  function renderResult(result) {
    els.result.hidden = false;
    const structured = result.structuredContent || {};
    const status = structured.status || (result.isError ? "error" : "ok");
    const isPending = ["pending_confirmation", "scheduled", "needs_clarification"].includes(status);
    els.resultStatus.textContent = result.isError ? "IS ERROR" : String(status).toUpperCase();
    els.resultStatus.className = "pill " + (result.isError ? "error" : isPending ? "pending" : "ok");
    els.resultMessage.textContent = (result.content && result.content[0] && result.content[0].text) || structured.message || "";
    els.resultJson.textContent = JSON.stringify(structured, null, 2);

    const ids = structured.pending_ids || [];
    els.pendingBox.hidden = !ids.length;
    if (ids.length) {
      els.pendingBox.innerHTML = `
        <strong>已创建待确认事项，尚未执行</strong>
        <p>${escapeHtml(structured.confirmation_policy || "请由用户在前端完成确认/强验证。")}</p>
        <div class="ids">${ids.map((id) => `<code>${escapeHtml(id)}</code>`).join("")}</div>
        <a href="/compare">打开任务台完成确认 ↗</a>`;
    }
  }

  async function boot() {
    try {
      const init = await rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: CLIENT_INFO,
      });
      const listed = await rpc("tools/list", {});
      state.tools = listed.tools || [];
      setStatus(`已连接 · ${init.serverInfo.name} · ${init.protocolVersion}`, "ok");
      renderStats();
      renderCatalog();
      const first = state.tools.find((t) => t.name === "banking_account_overview") || state.tools[0];
      if (first) selectTool(first.name);
    } catch (error) {
      setStatus("连接失败：" + error.message, "bad");
      els.toolList.innerHTML = `<div class="catalog-note">无法读取能力目录：${escapeHtml(error.message)}</div>`;
      els.empty.innerHTML = `<p class="eyebrow"><span></span>CONNECTION ERROR</p><h2>能力中心未就绪</h2><p>${escapeHtml(error.message)}</p>`;
    }
  }

  els.form.addEventListener("submit", invoke);
  els.fillExample.addEventListener("click", fillExample);
  boot();
})();
