import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import reviewerModule from "risk-owner/conversation-review.cjs";
import inputModule from "risk-owner/conversation-input.cjs";
import riskModule from "risk-owner/conversation-risk.cjs";
import { RiskCloudStore, hash } from "./risk-cloud-store.js";

const { createConversationReviewer } = reviewerModule;
const { normalizeConversationFinance } = inputModule;
const { assessConversation } = riskModule;
const ACTOR = "finance-lab-cloud-validation";
const MAX_BYTES = 128 * 1024;
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Core × Risk 云端联调</title><style>body{font:17px/1.8 system-ui;max-width:760px;margin:48px auto;padding:20px;color:#193340;background:#f5f8fa}main{background:white;border-radius:20px;padding:32px}h1{font-size:28px}strong{color:#ac4718}code{background:#edf3f5;padding:3px 7px}li{margin:12px 0}a{color:#075b82}</style><main><h1>Core × Risk 云端联调服务</h1><p>服务已部署在 Cloudflare。旧网页与旧后端保持不变。</p><p><strong>这是后端联调入口，不是完整用户产品。</strong>只接收虚构测试资料，不要上传真实账户或个人资料。</p><ul><li><a href="/health">检查服务在线状态</a>：无需登录，不含业务资料。</li><li><code>GET /api/status</code>：服务端鉴权后检查到 Core 的真实网络连接。</li><li><code>POST /api/assess</code>：按已有 Risk 规则核对虚构资金，记录结果，不调用模型、不发送正式回调。</li><li><code>POST /api/review</code>：完整模型→Risk回调路径。当前模型调用开关关闭，返回明确阻断，不伪装成功。</li><li><code>GET /api/records/{请求编号}</code>：鉴权后查看本服务的资金检查记录和审计链。</li></ul><p>机器凭据只放在服务端，不要填进网页、聊天或 GitHub。真实模型、人工审批、执行网关及用户身份隔离尚未联合验收；不能据此宣称已成交。</p></main></html>`;
function json(status, value) { return new Response(JSON.stringify(value), { status, headers: {
  "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
} }); }
function fail(code, message, status = 422) { throw Object.assign(new Error(message), { code, status }); }
function authenticate(request, env) {
  const expected = env.RISK_CONVERSATION_API_KEY;
  if (typeof expected !== "string" || !/^[\x21-\x7e]{24,200}$/.test(expected)) fail("SERVICE_AUTH_NOT_CONFIGURED", "服务端身份未配置，接口暂停。", 503);
  if (request.headers.has("Origin")) fail("BROWSER_ACCESS_DENIED", "该接口只供受信任服务端调用，不接收浏览器机器凭据。", 403);
  const received = request.headers.get("X-Risk-Conversation-Key") || "";
  if (received.length > 200 || !timingSafeEqual(createHash("sha256").update(received).digest(), createHash("sha256").update(expected).digest())) fail("SERVICE_AUTH_REQUIRED", "缺少有效的服务端身份。", 401);
}
async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) fail("INVALID_CONTENT_TYPE", "请求须使用application/json。", 415);
  const reader = request.body?.getReader(); let size = 0; const parts = [];
  if (reader) while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length; if (size > MAX_BYTES) { await reader.cancel(); fail("BODY_TOO_LARGE", "资料超过大小限制。", 413); } parts.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail("INVALID_JSON", "请求须为有效JSON。", 400); }
}
function validatePayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["question", "daily_finance_yuan", "idempotency_key"].includes(key))) fail("UNTRUSTED_CONTROL_FIELD", "只接受问题、虚构资金资料和请求编号。");
  if (typeof value.question !== "string" || !value.question.trim() || value.question.length > 20000) fail("INVALID_QUESTION", "请输入1至20000字的问题。");
  if (typeof value.idempotency_key !== "string" || !/^[A-Za-z0-9_.:-]{8,100}$/.test(value.idempotency_key)) fail("IDEMPOTENCY_KEY_REQUIRED", "需要稳定的8至100位请求编号。");
  return value;
}
export class RiskConversationService {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.store = new RiskCloudStore(ctx.storage); this.pending = 0; this.queue = Promise.resolve();
    const fetchImpl = async (url, options) => { await ctx.storage.sync(); return fetch(url, options); };
    this.reviewer = createConversationReviewer({ store: this.store, fetchImpl, config: {
      baseUrl: env.CORE_AGENT_BASE_URL, apiKey: env.CORE_AGENT_API_KEY, hmacSecret: env.RISK_SERVICE_HMAC_SECRET,
      reviewer: env.RISK_REVIEWER_ID, timeoutMs: 60000, dailyLimit: 5
    } });
  }
  async fetch(request) {
    try { authenticate(request, this.env); } catch (error) { return json(error.status, { error: { code: error.code, message: error.message }, execution_allowed: false }); }
    if (this.pending >= 4) return json(429, { error: { code: "VALIDATION_QUEUE_FULL" }, execution_allowed: false });
    this.pending++;
    const response = this.queue.then(() => this.handle(request)); this.queue = response.catch(() => {});
    try { return await response; } finally { this.pending--; }
  }
  async handle(request) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/status") {
        const origin = new URL(this.env.CORE_AGENT_BASE_URL);
        if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) fail("CORE_URL_INVALID", "Core地址配置无效。", 503);
        const response = await fetch(origin.origin + "/api/review/capabilities", { redirect: "manual", signal: AbortSignal.timeout(15000), headers: { "X-Core-Agent-Key": this.env.CORE_AGENT_API_KEY } });
        if (!response.ok || !/^application\/json/.test(response.headers.get("Content-Type") || "")) fail("CORE_UNAVAILABLE", "Core鉴权或网络检查失败。", 503);
        const core = await response.json();
        return json(200, { service: "risk-conversation", mode: "CLOUD_VALIDATION_SYNTHETIC_ONLY", core_connection_verified: true,
          core_callback_configured: core.risk?.callback_ready === true, model_configured: core.model?.configured === true,
          model_calls_enabled: this.env.RISK_MODEL_CALLS_ENABLED === "true", model_probe: "NOT_RUN", joint_acceptance: false, execution_allowed: false });
      }
      if (request.method === "GET" && url.pathname.startsWith("/api/records/")) {
        const token = decodeURIComponent(url.pathname.slice("/api/records/".length));
        if (!/^[A-Za-z0-9_.:-]{8,100}$/.test(token)) fail("INVALID_RECORD_ID", "请求编号无效。");
        const key = hash({ actor: ACTOR, route: "/api/assess", requestToken: token }), record = this.store.data.requests[key];
        if (!record) fail("NOT_FOUND", "没有该检查记录。", 404);
        return json(200, { record, audit_events: this.store.events.filter(row => row.request_key === key), execution_allowed: false });
      }
      if (request.method !== "POST" || !["/api/assess", "/api/review"].includes(url.pathname)) fail("NOT_FOUND", "接口不存在。", 404);
      if (url.pathname === "/api/review") {
        if (this.env.RISK_MODEL_CALLS_ENABLED !== "true") fail("MODEL_CALLS_DISABLED", "按零付费测试要求，模型调用尚未开放；可使用/api/assess核对虚构资金。没有生成模型响应或正式回调。", 423);
        const value = await this.reviewer.review(validatePayload(await readJson(request)), ACTOR); await this.ctx.storage.sync(); return json(200, value);
      }
      const payload = validatePayload(await readJson(request)), key = hash({ actor: ACTOR, route: url.pathname, requestToken: payload.idempotency_key });
      const begun = this.store.begin(key, hash(payload));
      if (begun.replay) return json(200, { ...begun.response, replayed: true });
      try {
        const now = new Date().toISOString(), finance = normalizeConversationFinance(payload.daily_finance_yuan, now);
        const assessment = assessConversation({ question: payload.question, dailyFinance: finance, now, checkId: `cloud-risk-${randomUUID()}` });
        const event = this.store.audit(key, "PROGRAM_ASSESSMENT_ONLY", { assessment, model_called: false, callback_sent: false, execution_allowed: false });
        const value = { ...assessment, model_status: "NOT_CALLED", decision_source: "PROGRAM_ONLY", formal_risk_callback: "NOT_SENT",
          audit_event_id: event.event_id, data_mode: "SYNTHETIC_REPLAY", execution_allowed: false, executed: false, replayed: false };
        this.store.update(key, { status: "COMPLETE", response: value }); await this.ctx.storage.sync(); return json(200, value);
      } catch (error) {
        this.store.audit(key, "PROGRAM_ASSESSMENT_FAILED", { code: error.code || "ASSESSMENT_FAILED", execution_allowed: false });
        this.store.update(key, { status: "UNKNOWN", error_code: error.code || "ASSESSMENT_FAILED" }); throw error;
      }
    } catch (error) {
      return json(error.status || error.statusCode || 503, { ...error.partial, error: { code: error.code || "RISK_SERVICE_UNAVAILABLE", message: error.code ? error.message : "服务不可用，未执行任何资金操作。" }, executed: false, execution_allowed: false });
    }
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json(200, { status: "ok", service: "risk-conversation", deployment: "CLOUD_VALIDATION", owner_source: "PR27-27bdefb", model_calls_enabled: env.RISK_MODEL_CALLS_ENABLED === "true", joint_acceptance: false, execution_allowed: false });
    if (request.method === "GET" && ["/", "/docs"].includes(url.pathname)) return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" } });
    try {
      authenticate(request, env);
      return await env.RISK_CONVERSATIONS.get(env.RISK_CONVERSATIONS.idFromName("risk-validation-v1")).fetch(request);
    } catch (error) { return json(error.status || 503, { error: { code: error.code || "RISK_SERVICE_UNAVAILABLE", message: error.code ? error.message : "服务不可用。" }, execution_allowed: false }); }
  }
};
