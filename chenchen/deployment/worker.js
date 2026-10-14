import harnessModule from "../core/harness.js";
import toolsModule from "../tools/financial-tools.js";
import contractModule from "../contracts/investment-contract.js";
import adapterModule from "../integrations/risk-workbench-adapter.js";
import modelReviewModule from "../integrations/model-review.js";
import legacyReviewAdapterModule from "../integrations/legacy-review-adapter.js";
import riskHandoffModule from "../integrations/risk-handoff.js";
import reviewWorkflowModule from "../integrations/review-workflow.js";
import fundingPlanModule from "../integrations/funding-plan.js";
import { reviewDocs } from "./review-docs.js";

const { Harness } = harnessModule;
const tools = toolsModule;
const contract = contractModule;
const { buildRiskWorkbenchHandoff } = adapterModule;
const modelReview = modelReviewModule;
const legacyReviewAdapter = legacyReviewAdapterModule;
const riskHandoff = riskHandoffModule;
const { ReviewWorkflowStore, WorkflowError } = reviewWorkflowModule;
const { FundingPlanStore } = fundingPlanModule;
const harness = new Harness({ toolset: tools });
const DEFAULT_ORIGINS = [
  "https://fund-risk-workbench.panxintian44.chatgpt.site",
  "https://realchenchenluo.github.io"
];
const rateBuckets = new Map();

function originFor(request, env) {
  const origin = request.headers.get("Origin");
  const configured = String(env.CORS_ORIGINS || DEFAULT_ORIGINS.join(","))
    .split(",").map(value => value.trim()).filter(Boolean);
  return origin && (configured.includes("*") || configured.includes(origin)) ? origin : null;
}

function headers(request, env, contentType = "application/json; charset=utf-8") {
  const result = { "Content-Type": contentType, "Cache-Control": "no-store" };
  const origin = originFor(request, env);
  if (origin) {
    result["Access-Control-Allow-Origin"] = origin;
    result["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
    result["Access-Control-Allow-Headers"] = "Content-Type, X-Core-Agent-Key";
    result.Vary = "Origin";
  }
  return result;
}

function json(request, env, status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { ...headers(request, env), ...extraHeaders } });
}

function errorPayload(error, requestId = null) {
  return contract.buildErrorResponse(error, {
    requestId,
    taskId: error.trace?.task_id || null,
    sessionId: error.trace?.session_id || null,
    auditId: error.trace?.audit_id || null
  });
}

async function readJson(request) {
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 100000) {
        await reader.cancel();
        throw new modelReview.ReviewError("REQUEST_TOO_LARGE", "请求正文不能超过 100KB。", { statusCode: 413, stage: "VALIDATION" });
      }
      chunks.push(value);
    }
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    const error = new Error("request body must be valid JSON");
    error.code = "INVALID_JSON";
    error.statusCode = 400;
    throw error;
  }
}

function authFailure() {
  const error = new Error("API authentication is required");
  error.code = "AUTHENTICATION_REQUIRED";
  error.statusCode = 401;
  error.recovery = "Provide the configured X-Core-Agent-Key and retry.";
  return error;
}

function rateLimitFailure() {
  const error = new Error("rate limit exceeded");
  error.code = "RATE_LIMITED";
  error.statusCode = 429;
  error.retryable = true;
  error.recovery = "Wait before retrying the request.";
  return error;
}

function requestIdentity(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0].trim() || "anonymous";
}

function allowedByRateLimit(request, env) {
  const configuredLimit = Number(env.RATE_LIMIT_PER_MINUTE || 60);
  if (!Number.isInteger(configuredLimit) || configuredLimit <= 0) return true;
  const now = Date.now();
  const windowStart = Math.floor(now / 60000) * 60000;
  const key = requestIdentity(request) + ":" + windowStart;
  for (const bucketKey of rateBuckets.keys()) {
    if (Number(bucketKey.slice(bucketKey.lastIndexOf(":") + 1)) < windowStart) rateBuckets.delete(bucketKey);
  }
  const count = rateBuckets.get(key) || 0;
  if (count >= configuredLimit) return false;
  rateBuckets.set(key, count + 1);
  return true;
}

function requiresApiKey(request, env) {
  const expected = String(env.CORE_AGENT_API_KEY || "").trim();
  return !expected || request.headers.get("X-Core-Agent-Key") === expected;
}

function workflowErrorPayload(error) {
  const record = error.workflowRecord || error.record || null;
  return {
    review_version: modelReview.REVIEW_VERSION,
    error: {
      code: error.code || "WORKFLOW_FAILED",
      message: error.message || "workflow failed",
      retryable: Boolean(error.retryable),
      stage: error.stage || "WORKFLOW",
      recovery: error.recovery || "Review the task state and retry.",
      details: error.details || null
    },
    trace: {
      contract_version: modelReview.REVIEW_VERSION,
      request_id: record?.request_id || null,
      task_id: record?.task_id || error.taskId || null,
      run_id: record?.run_id || error.runId || null,
      audit_id: record?.audit?.audit_id || error.auditId || null
    },
    workflow: record
  };
}

// One durable coordinator keeps demo workflow updates ordered and audit reads
// consistent across edge locations and Worker restarts.
export class ReviewService {
  constructor(state, env) {
    this.storage = state.storage;
    this.env = env;
    this.queue = Promise.resolve();
    this.modelBuckets = new Map();
  }

  fetch(request) {
    const pending = this.queue.then(() => this.handle(request));
    this.queue = pending.catch(() => {});
    return pending;
  }

  async persist(record, fundingPlans = null) {
    if (!record?.run_id) return;
    const entries = {
      ["run:" + record.run_id]: record,
      ["task:" + record.task_id]: record.run_id
    };
    // One atomic storage operation commits both the simulation receipt and its allocation.
    for (const plan of fundingPlans?.plans.values() || []) entries["funding:" + plan.plan_id] = plan;
    await this.storage.put(entries);
  }

  async loadFundingPlan(store, planId) {
    if (typeof planId !== "string") return;
    const plan = await this.storage.get("funding:" + planId);
    if (plan) store.save(plan);
  }

  async lookupTask(taskId) {
    const runId = await this.storage.get("task:" + taskId);
    return runId ? this.storage.get("run:" + runId) : null;
  }

  async handle(request) {
    const env = this.env;
    const url = new URL(request.url);
    const fundingPlans = new FundingPlanStore();
    try {
      if (request.method === "GET" && url.pathname.startsWith("/api/funding-demo/plan/")) {
        const planId = decodeURIComponent(url.pathname.slice("/api/funding-demo/plan/".length));
        await this.loadFundingPlan(fundingPlans, planId);
        return json(request, env, 200, fundingPlans.summary(planId));
      }
      if (request.method === "GET") {
        const handoffRequested = url.pathname.endsWith("/risk-handoff");
        const key = decodeURIComponent(url.pathname.slice("/api/review/".length, handoffRequested ? -"/risk-handoff".length : undefined));
        const result = key.startsWith("task/") ? await this.lookupTask(key.slice(5)) : await this.storage.get("run:" + key);
        return json(request, env, result ? 200 : 404, result ? (handoffRequested ? riskHandoff.buildRiskHandoffPackage(result) : result) : { error: { code: "REVIEW_NOT_FOUND", message: "没有找到这个运行编号。" } });
      }
      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new modelReview.ReviewError("INVALID_REVIEW_INPUT", "请求正文必须是 JSON 对象。", { statusCode: 422, stage: "VALIDATION" });
      }
      if (["/api/funding-demo/plan", "/api/funding-demo/plan/revise"].includes(url.pathname)) {
        await this.loadFundingPlan(fundingPlans, body.plan_id);
        const plan = url.pathname.endsWith("/revise") ? fundingPlans.revise(body) : fundingPlans.create(body);
        await this.storage.put({ ["funding:" + plan.plan_id]: fundingPlans.require(plan.plan_id) });
        return json(request, env, 200, plan);
      }
      const workflow = new ReviewWorkflowStore({ fundingPlans });
      let result;
      if (["/api/review", "/api/review/legacy"].includes(url.pathname)) {
        const input = url.pathname === "/api/review/legacy"
          ? legacyReviewAdapter.normalizeLegacyReviewInput(body)
          : modelReview.normalizeReviewInput(body);
        if (input.task_id && await this.lookupTask(input.task_id)) {
          throw new WorkflowError("TASK_ALREADY_EXISTS", "task_id already exists; load its record or create a new task", {
            statusCode: 409,
            stage: "VALIDATION",
            recovery: "Use the existing task record or create a new task_id."
          });
        }
        const minute = Math.floor(Date.now() / 60000);
        for (const [ip, bucket] of this.modelBuckets) if (bucket.minute !== minute) this.modelBuckets.delete(ip);
        const ip = requestIdentity(request);
        const bucket = this.modelBuckets.get(ip) || { minute, count: 0 };
        if (bucket.count >= Number(env.MODEL_REQUESTS_PER_MINUTE || 6)) {
          return json(request, env, 429, errorPayload(rateLimitFailure()), { "Retry-After": "60" });
        }
        bucket.count++;
        this.modelBuckets.set(ip, bucket);
        await this.loadFundingPlan(fundingPlans, input.action_parameters?.funding_plan_id);
        result = await workflow.start(input, env);
      } else {
        const record = await this.lookupTask(body.task_id);
        if (record) workflow.save(record);
        await this.loadFundingPlan(fundingPlans, record?.proposed_action?.funding?.plan_id);
        if (url.pathname === "/api/review/risk-callback") {
          const callback = await workflow.receiveRiskCallback(body);
          await this.persist(callback.workflow);
          return json(request, env, 200, { callback_version: riskHandoff.CALLBACK_VERSION, ...callback, handoff: riskHandoff.buildRiskHandoffPackage(callback.workflow) });
        }
        const method = {
          "/api/review/risk-decision": "decideRisk",
          "/api/review/approval": "decideApproval",
          "/api/review/simulate": "simulate"
        }[url.pathname];
        if (!method) return json(request, env, 404, { error: { code: "NOT_FOUND" } });
        result = await workflow[method](body);
      }
      await this.persist(result, fundingPlans);
      return json(request, env, 200, url.pathname === "/api/review/legacy"
        ? legacyReviewAdapter.mapWorkflowToLegacyResponse(result)
        : result);
    } catch (error) {
      if (error.name === "ReviewError" || error.name === "WorkflowError") {
        await this.persist(error.workflowRecord || error.record, fundingPlans);
        return json(request, env, error.statusCode || 502, workflowErrorPayload(error));
      }
      if (error.code === "INVALID_JSON") return json(request, env, 400, errorPayload(error));
      return json(request, env, 503, { error: { code: "REVIEW_SERVICE_UNAVAILABLE", message: "复核服务暂时不可用，请稍后重试。", retryable: true } });
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      if (!originFor(request, env)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: headers(request, env) });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      const config = modelReview.resolveModelConfig(env);
      return json(request, env, 200, {
        status: "ok", service: "core-agent", contract_version: contract.CONTRACT_VERSION,
        review_endpoint: "/api/review", docs: "/docs",
        model: { provider: config.provider, name: config.model, configured: config.style === "workers_ai" ? Boolean(env.AI) : Boolean(config.apiKey) },
        audit_storage: env.REVIEW_SERVICE ? "durable_object" : "unconfigured"
      });
    }
    if (request.method === "GET" && ["/docs", "/api/review"].includes(url.pathname)) {
      return new Response(reviewDocs, { headers: {
        ...headers(request, env, "text/html; charset=utf-8"),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
      } });
    }
    if (request.method === "GET" && url.pathname === "/") {
      return json(request, env, 200, {
        service: "Personal AI Fund Manager Core Agent",
        contract_version: contract.CONTRACT_VERSION,
        endpoint: "/api/risk-workbench/handoff",
        review_endpoint: "/api/review",
        docs: "/docs",
        execution_allowed: false
      });
    }
    const isReviewRead = request.method === "GET" && (url.pathname.startsWith("/api/review/") || url.pathname.startsWith("/api/funding-demo/plan/"));
    const isKnownPost = request.method === "POST" && [
      "/api/health-check/run", "/api/risk-workbench/handoff", "/api/review", "/api/review/legacy",
      "/api/review/risk-decision", "/api/review/risk-callback", "/api/review/approval", "/api/review/simulate",
      "/api/funding-demo/plan", "/api/funding-demo/plan/revise"
    ].includes(url.pathname);
    if (!isKnownPost && !isReviewRead) {
      return json(request, env, 404, { error: { code: "NOT_FOUND", message: "route not found" } });
    }
    if (!requiresApiKey(request, env)) return json(request, env, 401, errorPayload(authFailure()), { "WWW-Authenticate": "X-Core-Agent-Key" });
    if (!allowedByRateLimit(request, env)) return json(request, env, 429, errorPayload(rateLimitFailure()), { "Retry-After": "60" });
    if (url.pathname === "/api/review" || url.pathname.startsWith("/api/review/") || url.pathname.startsWith("/api/funding-demo/")) {
      try {
        const service = env.REVIEW_SERVICE.get(env.REVIEW_SERVICE.idFromName("team-review-v1"));
        return await service.fetch(request);
      } catch {
        return json(request, env, 503, { error: { code: "REVIEW_SERVICE_UNAVAILABLE", message: "复核服务暂时不可用，请稍后重试。", retryable: true } });
      }
    }
    let body;
    try {
      body = await readJson(request);
      const input = url.pathname === "/api/risk-workbench/handoff" ? (body.request || body) : body;
      const agentResponse = harness.runHealthCheckContract(input);
      if (url.pathname === "/api/health-check/run") return json(request, env, 200, agentResponse);
      return json(request, env, 200, {
        integration_version: "core-agent-to-risk-workbench.cloudflare@0.1.0",
        agent_response: agentResponse,
        risk_workbench: buildRiskWorkbenchHandoff(agentResponse)
      });
    } catch (error) {
      if (error?.name === "ReviewError") {
        return json(request, env, error.statusCode || 502, error.workflowRecord ? workflowErrorPayload(error) : modelReview.buildReviewError(error));
      }
      if (error?.name === "WorkflowError") return json(request, env, error.statusCode || 409, workflowErrorPayload(error));
      const requestId = body?.request?.request_id || body?.request_id || null;
      return json(request, env, error.statusCode || (error.code === "INVALID_PORTFOLIO" ? 422 : 400), errorPayload(error, requestId));
    }
  }
};
