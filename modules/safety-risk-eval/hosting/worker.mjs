import { randomUUID } from "node:crypto";
import gatewayModule from "../gateway.cjs";
import adapter from "../core-adapter.cjs";
import security from "../security.cjs";
import policy from "../policy.cjs";
import modelAgent from "../model-agent.cjs";
import remoteCore from "../handoff/remote.cjs";
import handoffReceiver from "../handoff/receiver.cjs";
import handoffExample from "../handoff/example.response.json" with { type: "json" };
import core from "../../../chenchen/core/harness.js";
import baseRequest from "../../../chenchen/contracts/examples/health-check.request.json" with { type: "json" };
import financialTools from "../../../chenchen/tools/financial-tools.js";
import { CloudStore, getSession } from "./cloud-store.mjs";
import assets from "virtual:risk-assets";
const { ActionGateway, GatewayError } = gatewayModule;

function only(data, fields) {
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some((key) => !fields.includes(key))) throw new GatewayError("UNTRUSTED_CONTROL_FIELD", "请提交允许的业务字段，不能提交身份、权限或审批状态。", "BLOCK", 400);
}
function profile(data) {
  only(data, ["confirmed", "reserve_cash", "max_drawdown", "forbidden", "plan_id", "memory_consent"]);
  if (typeof data.confirmed !== "boolean" || !Number.isFinite(data.reserve_cash) || data.reserve_cash < 0 || !Number.isFinite(data.max_drawdown) || data.max_drawdown < 0 || data.max_drawdown > 1 || !Array.isArray(data.forbidden) || data.forbidden.length > 20 || data.forbidden.some((s) => typeof s !== "string" || s.length > 80) || !["A", "B", "C"].includes(data.plan_id)) throw new GatewayError("INVALID_PROFILE", "请填写有效的演示条件。", "ERROR", 400);
  return { confirmed: data.confirmed, reserveCash: data.reserve_cash, maxDrawdown: data.max_drawdown, forbidden: data.forbidden, planId: data.plan_id };
}
function json(value, status = 200, session) {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  if (session?.fresh) headers.set("Set-Cookie", `risk_session=${session.session_id}; HttpOnly; Secure; SameSite=Strict; Path=/`);
  return new Response(JSON.stringify(value), { status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") return Response.redirect(url.origin + "/risk", 302);
    // Recover links saved from the original navigation; the merchant module is not hosted here.
    if (["/merchant", "/merchant/"].includes(url.pathname)) return Response.redirect(url.origin + "/investment", 302);
    if (!url.pathname.startsWith("/api/")) {
      const asset = assets[url.pathname === "/risk/" ? "/risk" : url.pathname];
      if (!asset) return new Response("页面不存在", { status: 404 });
      return new Response(asset.body, { headers: { "Content-Type": asset.type, "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
    }
    let session, store, gateway, payload;
    try {
      if (request.headers.get("origin") && request.headers.get("origin") !== url.origin) throw new GatewayError("ORIGIN_MISMATCH", "拒绝跨来源请求。", "BLOCK", 403);
      if (request.headers.get("sec-fetch-site") === "cross-site") throw new GatewayError("CROSS_SITE_REQUEST", "拒绝跨站请求。", "BLOCK", 403);
      session = await getSession(env.DB, request);
      if (request.method === "GET" && url.pathname === "/api/safety/session") return json({ csrf: session.csrf, user_id: session.user_id, mode: "ONLINE_SYNTHETIC_DEMO" }, 200, session);
      if (request.method === "GET" && url.pathname === "/api/safety/policy") return json(policy.describe(), 200, session);
      if (request.method === "GET" && url.pathname === "/api/safety/model-status") return json(modelAgent.status(env), 200, session);
      if (request.method === "GET" && url.pathname === "/api/safety/core-status") return json(await remoteCore.health(), 200, session);
      if (request.method === "GET" && url.pathname === "/api/safety/handoffs/example") return json({ import_version: handoffReceiver.VERSION, agent_response: handoffExample }, 200, session);
      if (request.method === "GET" && url.pathname === "/api/demo/portfolio") return json(financialTools.validatePortfolio(financialTools.getDemoPortfolio()), 200, session);
      if (request.method === "POST") {
        if (request.headers.get("x-risk-csrf") !== session.csrf) throw new GatewayError("CSRF_REQUIRED", "请使用当前浏览器会话确认。", "BLOCK", 403);
        const text = await request.text();
        if (new TextEncoder().encode(text).length > 65536) throw new GatewayError("BODY_TOO_LARGE", "演示请求过大。", "ERROR", 413);
        try { payload = JSON.parse(text); } catch { throw new GatewayError("INVALID_JSON", "请求必须是有效 JSON。", "ERROR", 400); }
      } else if (request.method !== "GET") throw new GatewayError("METHOD_NOT_ALLOWED", "不支持该操作。", "BLOCK", 405);
      store = await CloudStore.open(env.DB, session);
      const harness = new core.Harness();
      gateway = new ActionGateway({ store, projectPlan: adapter.projectPlan, executePlan: adapter.executePlan,
        beforeExecute: () => store.flush(),
        onSuccess: (record, result) => {
          // Reuse the Core Memory method, then persist its confirmed decision to D1.
          harness.tasks.set(record.input.binding.task_id, { state: record.input.upstream.task_state, events: [] });
          const entry = harness.saveMemory(record.input.binding.task_id, { type: "decision", consent: true, key: "paper_execution", value: { receipt_id: result.receipt.receipt_id, mode: result.mode } });
          store.transaction((data) => { data.memories ||= []; data.memories.push(entry); return null; }); return entry;
        }
      });
      const actor = session.user_id;
      function createTask(settings, request = structuredClone(baseRequest)) {
        if (Object.keys(store.data.tasks).length >= 20) throw new GatewayError("DEMO_TASK_LIMIT", "当前浏览器已达20个演示任务，请使用新的浏览器会话继续。", "REVIEW", 429);
        request.request_id = `req-${randomUUID()}`;
        if (request.context.task_id || request.context.session_id) throw new GatewayError("EXISTING_CONTEXT_FORBIDDEN", "不能冒用已有任务。", "BLOCK", 403);
        const upstream = harness.runHealthCheckContract(request);
        if (!upstream.risk_handoff) return { upstream, risk: null };
        const input = adapter.fromHandoff(upstream, actor, settings);
        const risk = gateway.register(input, { memoryConsent: settings.memoryConsent === true });
        store.transaction((data) => { data.tasks[input.binding.task_id].core_audit = harness.getAudit(input.binding.task_id); return null; });
        return { upstream, risk };
      }
      let result;
      if (request.method === "POST" && url.pathname === "/api/safety/core-handoff") result = await remoteCore.run({ payload, actor, gateway, persist: () => store.flush() });
      else if (request.method === "GET" && url.pathname === "/api/safety/core-requests") result = store.events.filter(e => e.user_id === actor && e.event_type.startsWith("REMOTE_CORE_"));
      else if (request.method === "POST" && url.pathname === "/api/safety/model-demo") result = await modelAgent.run({ gateway, harness, actor, payload, env, persist: () => store.flush(), claimBudget: async () => {
        const day = new Date().toISOString().slice(0, 10);
        const claimed = await env.DB.prepare("INSERT INTO risk_model_budget(day,calls) VALUES(?1,1) ON CONFLICT(day) DO UPDATE SET calls=calls+1 WHERE calls<30").bind(day).run();
        if (!claimed.success || claimed.meta.changes !== 1) throw new GatewayError("MODEL_DAILY_LIMIT", "今日模型演示次数已达30次上限。", "REVIEW", 429);
      } });
      else if (request.method === "GET" && url.pathname === "/api/safety/task") result = gateway.inspect(url.searchParams.get("task_id"), actor);
      else if (request.method === "GET" && url.pathname === "/api/safety/audit") {
        const id = url.searchParams.get("task_id"); gateway.inspect(id, actor); result = store.events.filter((e) => (e.task_id || e.binding?.task_id) === id);
      } else if (request.method === "GET" && url.pathname.startsWith("/api/audit/")) {
        const record = gateway.inspect(url.pathname.slice(11), actor);
        result = { core: record.handoff_import?.original_response.audit_evidence || record.core_audit || null, core_provenance: record.handoff_import?.provenance || "LOCAL_CORE", safety: store.events.filter((e) => (e.task_id || e.binding?.task_id) === record.input.binding.task_id) };
      } else if (request.method === "GET" && url.pathname.startsWith("/api/task/")) {
        const id = url.pathname.slice(10).replace(/\/export$/, ""); result = gateway.inspect(id, actor);
      } else if (request.method === "POST" && url.pathname === "/api/safety/handoffs") {
        result = handoffReceiver.receive({ payload, actor, gateway });
      } else if (request.method === "POST" && url.pathname === "/api/safety/tasks") {
        const settings = profile(payload), request = structuredClone(baseRequest); request.input.risk_profile.max_drawdown = settings.maxDrawdown;
        result = createTask({ ...settings, memoryConsent: payload.memory_consent === true }, request);
      } else if (request.method === "POST" && url.pathname === "/api/health-check/run") result = createTask({ confirmed: false, maxDrawdown: payload.input?.risk_profile?.max_drawdown ?? .1 }, payload).upstream;
      else if (request.method === "POST" && url.pathname === "/api/safety/profile") {
        only(payload, ["task_id", "profile"]); const record = gateway.inspect(payload.task_id, actor), settings = profile(payload.profile);
        gateway.replace(payload.task_id, actor, adapter.fromHandoff(record.input.upstream, actor, settings));
        store.transaction((data) => { data.tasks[payload.task_id].memory_consent = payload.profile.memory_consent === true; return null; });
        result = gateway.review(payload.task_id, actor);
      } else if (request.method === "POST" && url.pathname === "/api/safety/confirm") {
        only(payload, ["task_id", "risk_check_id", "binding", "accepted_reason_ids", "confirmed"]); result = gateway.confirm(payload.task_id, actor, payload);
      } else if (request.method === "POST" && ["/api/safety/reject", "/api/safety/revoke"].includes(url.pathname)) {
        only(payload, ["task_id"]); result = gateway.reject(payload.task_id, actor, url.pathname.endsWith("revoke"));
      } else if (request.method === "POST" && url.pathname === "/api/paper-trade/execute") {
        only(payload, ["task_id", "idempotency_key"]); result = await gateway.execute(payload.task_id, actor, payload.idempotency_key);
      } else if (request.method === "POST" && url.pathname === "/api/safety/attack-demo") {
        only(payload, ["source", "text"]);
        if (Object.keys(store.data.tasks).length >= 20) throw new GatewayError("DEMO_TASK_LIMIT", "当前浏览器已达演示任务上限。", "REVIEW", 429);
        result = await security.runAttackDemo({ gateway, harness, actor, source: payload.source, text: payload.text });
      } else throw new GatewayError("NOT_FOUND", "该接口未开放。", "ERROR", 404);
      await store.flush();
      return json(result, 200, session);
    } catch (error) {
      if (store && url.pathname === "/api/safety/handoffs") { try { await store.flush(); } catch { /* No execution is permitted when audit persistence fails. */ } }
      if (store && payload?.task_id && gateway) {
        try { const record = gateway.inspect(payload.task_id, session.user_id); gateway.event("REQUEST_REJECTED", record, { decision: error.decision || "ERROR", code: error.code || "PERSISTENCE_UNAVAILABLE" }); await store.flush(); } catch { /* Do not fabricate durable audit success. */ }
      }
      return json({ decision: error.decision || "ERROR", execution_allowed: false, error: { code: error.code || "PERSISTENCE_UNAVAILABLE", message: error.code ? error.message : "必要检查或云端存储不可用，操作已暂停。" } }, error.status || 503, session);
    } finally { if (store) { try { await store.close(); } catch { /* Lease expiry preserves the execution claim. */ } } }
  }
};
