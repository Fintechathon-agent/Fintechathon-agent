"use strict";

const REQUIRED_COLUMNS = ["snapshot_date", "cash", "instrument_id", "name", "asset_type", "quantity", "current_price", "cost_basis"];
const SAMPLE_CSV = `snapshot_date,cash,instrument_id,name,asset_type,quantity,current_price,cost_basis
2026-10-09,10000,DEMO_EQUITY_ALPHA,示例权益资产,stock,100,47.2,50.0
2026-10-09,10000,DEMO_BOND_ETF,示例债券基金,fund,200,102.4,100.0`;

const state = { rows: [], fileName: "", source: "", confirmed: false, revision: 0 };
const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; continue; }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = []; cell = ""; continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function validate(rawRows) {
  if (!rawRows.length) return { rows: [], headerError: "文件为空", errors: 0, warnings: 0 };
  const header = rawRows[0];
  const headerError = header.join(",") === REQUIRED_COLUMNS.join(",") ? "" : "字段顺序或名称不符合模板";
  const seen = new Set();
  let errors = headerError ? 1 : 0;
  let warnings = 0;
  const rows = rawRows.slice(1).map((values, index) => {
    const row = Object.fromEntries(REQUIRED_COLUMNS.map((key, column) => [key, values[column] ?? ""]));
    const rowIssues = [];
    if (values.length !== REQUIRED_COLUMNS.length) rowIssues.push("列数不完整");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.snapshot_date)) rowIssues.push("日期格式不对");
    for (const key of ["cash", "quantity", "current_price"]) {
      if (!Number.isFinite(Number(row[key]))) rowIssues.push(`${key} 不是数字`);
      else if (Number(row[key]) < 0) rowIssues.push(`${key} 不能为负数`);
    }
    if (!row.instrument_id || !row.name || !row.asset_type) rowIssues.push("基本信息缺失");
    if (seen.has(row.instrument_id)) rowIssues.push("证券代码重复");
    if (row.instrument_id) seen.add(row.instrument_id);
    if (row.cost_basis === "") { warnings += 1; rowIssues.push("缺少成本价"); }
    if (rowIssues.some((issue) => !issue.includes("缺少成本价"))) errors += 1;
    return { ...row, issues: rowIssues, line: index + 2 };
  });
  return { rows, headerError, errors, warnings };
}

function money(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value));
}

function statusFor(row) {
  if (row.issues.some((issue) => !issue.includes("缺少成本价"))) return { className: "bad", label: "需要处理" };
  if (row.issues.length) return { className: "warn", label: "有提示" };
  return { className: "good", label: "可继续" };
}

function render() {
  const rows = state.rows;
  const invalidRows = rows.filter((row) => statusFor(row).className === "bad").length;
  const warningRows = rows.filter((row) => statusFor(row).className === "warn").length;
  const firstCash = rows.find((row) => row.cash !== "")?.cash;
  $("validCount").textContent = String(rows.length - invalidRows);
  $("issueCount").textContent = String(invalidRows + warningRows);
  $("cashValue").textContent = firstCash === undefined ? "—" : `¥${money(firstCash)}`;
  $("qualityValue").textContent = !rows.length ? "未导入" : invalidRows ? "需要处理" : warningRows ? "有提示" : "可继续";
  $("qualityHint").textContent = !rows.length ? "等待一份文件" : invalidRows ? `${invalidRows} 行不能进入确认` : warningRows ? `${warningRows} 行请留意` : "每一行都通过基础检查";
  $("revision").textContent = `Revision ${state.revision}`;
  $("fileMeta").hidden = !state.fileName;
  $("fileName").textContent = state.fileName || "尚未选择文件";
  $("fileSource").textContent = state.source || "等待导入";
  $("emptyState").hidden = rows.length > 0;
  $("tableWrap").hidden = rows.length === 0;
  $("tableFooter").hidden = rows.length === 0;
  $("rowSummary").textContent = rows.length ? `${rows.length} 行记录 · ${invalidRows ? `${invalidRows} 行待处理` : "基础检查完成"}` : "—";
  $("previewBody").innerHTML = rows.map((row) => {
    const status = statusFor(row);
    const issue = row.issues.length ? row.issues.join("；") : "字段完整";
    return `<tr><td>${escapeHtml(row.instrument_id)}<span class="asset-sub">${escapeHtml(row.name)}</span></td><td>${escapeHtml(row.asset_type)}</td><td>${escapeHtml(row.quantity)}</td><td>¥${escapeHtml(row.current_price)}</td><td>${row.cost_basis ? `¥${escapeHtml(row.cost_basis)}` : "—"}</td><td><span class="row-status ${status.className}" title="${escapeHtml(issue)}">${status.label}</span></td></tr>`;
  }).join("");
  const hasBlockingError = Boolean(!rows.length || invalidRows || validateStatus.headerError);
  $("confirmButton").disabled = hasBlockingError || state.confirmed;
  $("confirmButton").textContent = state.confirmed ? "已确认" : "确认这份持仓";
  $("statusLabel").textContent = state.confirmed ? "已确认" : !rows.length ? "等待导入" : invalidRows ? "需要处理" : "待确认";
  $("statusTitle").textContent = state.confirmed ? "这份输入可以交给下一步" : !rows.length ? "确认之前，先把每一行看明白" : invalidRows ? "还有记录需要处理" : "基础检查通过，可以确认";
  $("statusText").textContent = state.confirmed ? "当前只是浏览器内的演示确认，不会上传文件，也不会触发投资分析。" : !rows.length ? "导入数据后，这里会告诉你哪些地方可以继续，哪些地方需要补充。" : invalidRows ? "修正标红记录后，才能把标准化结果交给后续流程。" : "确认后只生成一个演示状态，不会计算收益、回撤或买卖建议。";
  $("confirmPanel").classList.toggle("confirmed", state.confirmed);
}

let validateStatus = { headerError: "" };
function loadText(text, fileName, source) {
  validateStatus = validate(parseCsv(text));
  state.rows = validateStatus.rows;
  state.fileName = fileName;
  state.source = source;
  state.confirmed = false;
  state.revision += 1;
  render();
}

$("loadSample").addEventListener("click", () => loadText(SAMPLE_CSV, "sample-holdings.csv", "内置演示数据 · 2026-10-09"));
$("fileInput").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => loadText(String(reader.result), file.name, "浏览器本地解析"));
  reader.readAsText(file, "utf-8");
});
$("dropzone").addEventListener("click", () => $("fileInput").click());
$("dropzone").addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("fileInput").click(); } });
$("dropzone").addEventListener("dragover", (event) => { event.preventDefault(); });
$("dropzone").addEventListener("drop", (event) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (!file) return; const reader = new FileReader(); reader.addEventListener("load", () => loadText(String(reader.result), file.name, "拖入文件 · 浏览器本地解析")); reader.readAsText(file, "utf-8"); });
$("clearData").addEventListener("click", () => { state.rows = []; state.fileName = ""; state.source = ""; state.confirmed = false; state.revision += 1; validateStatus = { headerError: "" }; $("fileInput").value = ""; render(); });
$("confirmButton").addEventListener("click", () => { if (!$("confirmButton").disabled) { state.confirmed = true; render(); } });
render();
