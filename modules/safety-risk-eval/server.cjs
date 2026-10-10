"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, randomBytes } = require("node:crypto");
const { JournalStore } = require("./store.cjs");
const { ActionGateway, GatewayError } = require("./gateway.cjs");
const adapter = require("./core-adapter.cjs");
const baseRequest = require("../../chenchen/contracts/examples/health-check.request.json");
const { server: originalServer, harness } = require("../../chenchen/server.js");
const originalHandler = originalServer.listeners("request")[0];

function send(res, status, value) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); res.end(JSON.stringify(value)); }
async function body(req) {
  let text = "";
  for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 512 * 1024) throw new GatewayError("BODY_TOO_LARGE", "请求过大。", "ERROR", 413); }
  try { const data = JSON.parse(text || "{}"); if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(); return data; }
  catch { throw new GatewayError("INVALID_JSON", "请求必须是有效 JSON 对象。", "ERROR", 400); }
}
function only(data, keys) { if (Object.keys(data).some((key) => !keys.includes(key))) throw new GatewayError("UNTRUSTED_CONTROL_FIELD", "客户端不得提交用户身份、审批状态或系统权限等额外控制字段。", "BLOCK", 400); }
function profile(data) {
  only(data, ["confirmed", "reserve_cash", "max_drawdown", "forbidden", "plan_id", "memory_consent"]);
  if (typeof data.confirmed !== "boolean" || !Number.isFinite(data.reserve_cash) || data.reserve_cash < 0 || !Number.isFinite(data.max_drawdown) || data.max_drawdown < 0 || data.max_drawdown > 1 || !Array.isArray(data.forbidden) || data.forbidden.some((s) => typeof s !== "string") || !["A", "B", "C"].includes(data.plan_id)) throw new GatewayError("INVALID_PROFILE", "请填写有效的演示画像与方案。", "ERROR", 400);
  return { confirmed: data.confirmed, reserveCash: data.reserve_cash, maxDrawdown: data.max_drawdown, forbidden: data.forbidden, planId: data.plan_id };
}

function createApplication({ directory = path.join(__dirname, ".runtime"), store = new JournalStore(directory), executePlan = adapter.executePlan } = {}) {
  const gateway = new ActionGateway({ store, projectPlan: adapter.projectPlan, executePlan, onSuccess: (record, result) => harness.saveMemory(record.input.binding.task_id, { type: "decision", consent: true, key: "paper_execution", value: { receipt_id: result.receipt.receipt_id, mode: result.mode, risk_check_id: record.review.risk_check_id } }) });
  function session(req, res) {
    const cookie = /(?:^|;\s*)risk_session=([a-f0-9-]{36})/.exec(req.headers.cookie || "")?.[1];
    let s = store.data.sessions?.[cookie];
    if (!s) {
      const id = randomUUID(); s = { user_id: `demo-user-${randomUUID()}`, csrf: randomBytes(24).toString("hex") };
      store.transaction((data) => { data.sessions ||= {}; data.sessions[id] = s; return null; });
      res.setHeader("Set-Cookie", `risk_session=${id}; HttpOnly; SameSite=Strict; Path=/`);
    }
    return s;
  }
  function createTask(actor, settings, request = structuredClone(baseRequest)) {
    request.request_id = `req-${randomUUID()}`;
    if (request.context.task_id || request.context.session_id) throw new GatewayError("EXISTING_CONTEXT_FORBIDDEN", "新请求不能冒用其他任务上下文。", "BLOCK", 403);
    const upstream = harness.runHealthCheckContract(request);
    if (!upstream.risk_handoff) return { upstream, risk: null };
    const input = adapter.fromHandoff(upstream, actor, settings);
    const risk = gateway.register(input, { memoryConsent: settings.memoryConsent === true });
    return { upstream, risk };
  }
  const server = http.createServer(async (req, res) => {
    let s, payload, record;
    try {
      const url = new URL(req.url, `http://${req.headers.host || "invalid"}`);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || Number(url.port || 80) !== server.address().port) throw new GatewayError("LOCAL_ONLY", "仅在本机演示。", "BLOCK", 403);
      if (req.headers.origin && req.headers.origin !== url.origin) throw new GatewayError("ORIGIN_MISMATCH", "拒绝跨来源请求。", "BLOCK", 403);
      if (url.pathname === "/investment" || url.pathname === "/") {
        const html = fs.readFileSync(path.join(__dirname, "../../chenchen/versions/investment.html"), "utf8").replace("</head>", '<script src="/risk/team-bootstrap.js"></script></head>');
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); res.end(html); return;
      }
      if (url.pathname === "/risk" || url.pathname === "/risk/" || ["/risk/app.js", "/risk/style.css", "/risk/team-bootstrap.js"].includes(url.pathname)) {
        const file = url.pathname.endsWith("team-bootstrap.js") ? "team-bootstrap.js" : url.pathname.endsWith("app.js") ? "app.js" : url.pathname.endsWith("style.css") ? "style.css" : "index.html";
        res.writeHead(200, { "Content-Type": file.endsWith("js") ? "text/javascript; charset=utf-8" : file.endsWith("css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
        res.end(fs.readFileSync(path.join(__dirname, "public", file))); return;
      }
      if (!url.pathname.startsWith("/api/")) { originalHandler(req, res); return; }
      s = session(req, res);
      if (req.method === "GET" && url.pathname === "/api/safety/session") { send(res, 200, { csrf: s.csrf, user_id: s.user_id, mode: "LOCAL_SYNTHETIC_DEMO" }); return; }
      if (req.method === "GET" && url.pathname === "/api/demo/portfolio") { originalHandler(req, res); return; }
      if (req.method === "GET" && (url.pathname.startsWith("/api/task/") || url.pathname === "/api/safety/task")) {
        const id = url.pathname === "/api/safety/task" ? url.searchParams.get("task_id") : url.pathname.slice("/api/task/".length).replace(/\/export$/, "");
        record = gateway.inspect(id, s.user_id);
        if (url.pathname.endsWith("/export")) res.setHeader("Content-Disposition", 'attachment; filename="risk-task.json"');
        send(res, 200, record); return;
      }
      if (req.method === "GET" && url.pathname === "/api/safety/audit") {
        const taskId = url.searchParams.get("task_id"); gateway.inspect(taskId, s.user_id);
        send(res, 200, store.events.filter((e) => (e.task_id || e.binding?.task_id) === taskId)); return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/api/audit/")) {
        const taskId = decodeURIComponent(url.pathname.slice("/api/audit/".length)); gateway.inspect(taskId, s.user_id);
        send(res, 200, harness.getAudit(taskId)); return;
      }
      if (req.method !== "POST") throw new GatewayError("NOT_FOUND", "接口不存在。", "ERROR", 404);
      if (req.headers["x-risk-csrf"] !== s.csrf) throw new GatewayError("CSRF_REQUIRED", "缺少当前会话的确认来源标识。", "BLOCK", 403);
      payload = await body(req);
      if (url.pathname === "/api/health-check/run") {
        const result = createTask(s.user_id, { confirmed: false, maxDrawdown: payload.input?.risk_profile?.max_drawdown ?? .1 }, payload);
        send(res, 200, result.upstream); return;
      }
      if (url.pathname === "/api/safety/tasks") {
        const settings = profile(payload); const request = structuredClone(baseRequest); request.input.risk_profile.max_drawdown = settings.maxDrawdown;
        send(res, 200, createTask(s.user_id, { ...settings, memoryConsent: payload.memory_consent === true }, request)); return;
      }
      if (url.pathname === "/api/safety/profile") {
        only(payload, ["task_id", "profile"]); record = gateway.inspect(payload.task_id, s.user_id);
        const settings = profile(payload.profile); const next = adapter.fromHandoff(record.input.upstream, s.user_id, settings);
        gateway.replace(payload.task_id, s.user_id, next);
        store.transaction((data) => { data.tasks[payload.task_id].memory_consent = payload.profile.memory_consent === true; return null; });
        send(res, 200, gateway.review(payload.task_id, s.user_id)); return;
      }
      if (url.pathname === "/api/safety/confirm") {
        only(payload, ["task_id", "risk_check_id", "binding", "accepted_reason_ids", "confirmed"]);
        send(res, 200, gateway.confirm(payload.task_id, s.user_id, payload)); return;
      }
      if (url.pathname === "/api/safety/reject" || url.pathname === "/api/safety/revoke") {
        only(payload, ["task_id"]); send(res, 200, gateway.reject(payload.task_id, s.user_id, url.pathname.endsWith("revoke"))); return;
      }
      if (url.pathname === "/api/paper-trade/execute") {
        only(payload, ["task_id", "idempotency_key"]); send(res, 200, await gateway.execute(payload.task_id, s.user_id, payload.idempotency_key)); return;
      }
      throw new GatewayError("NOT_FOUND", "该操作未接入安全主流程。", "ERROR", 404);
    } catch (error) {
      if (payload?.task_id && s) {
        try { record = gateway.inspect(payload.task_id, s.user_id); gateway.event("REQUEST_REJECTED", record, { decision: error.decision || "ERROR", code: error.code || "INTERNAL_ERROR" }); } catch { /* Never disclose another user's task. */ }
      }
      if (!res.headersSent) send(res, error.status || 503, { decision: error.decision || "ERROR", execution_allowed: false, error: { code: error.code || "INTERNAL_ERROR", message: error.code ? error.message : "必要检查或存储不可用，操作已暂停。" } });
    }
  });
  return { server, gateway, store, harness, createTask, close: () => { server.close(); store.close(); } };
}
if (require.main === module) {
  const app = createApplication(); const port = Number(process.env.RISK_PORT || 8780);
  app.server.listen(port, "127.0.0.1", () => console.log(`Safety integrated demo: http://127.0.0.1:${port}/risk`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { app.close(); process.exit(0); });
}
module.exports = { createApplication };
