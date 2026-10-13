import harnessModule from "../chenchen/core/harness.js";
import toolsModule from "../chenchen/tools/financial-tools.js";
import contractModule from "../chenchen/contracts/investment-contract.js";
import adapterModule from "../chenchen/integrations/risk-workbench-adapter.js";
import modelReviewModule from "../chenchen/integrations/model-review.js";
import reviewWorkflowModule from "../chenchen/integrations/review-workflow.js";

const { Harness } = harnessModule;
const tools = toolsModule;
const contract = contractModule;
const { buildRiskWorkbenchHandoff } = adapterModule;
const modelReview = modelReviewModule;
const { ReviewWorkflowStore } = reviewWorkflowModule;
const harness = new Harness({ toolset: tools });
const DEFAULT_ORIGINS = [
  "https://fund-risk-workbench.panxintian44.chatgpt.site",
  "https://realchenchenluo.github.io"
];
const rateBuckets = new Map();
const reviewRuns = new Map();
const reviewWorkflow = new ReviewWorkflowStore();

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
  try {
    return await request.json();
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

function storeReviewRun(result) {
  if (reviewRuns.size >= 500) reviewRuns.delete(reviewRuns.keys().next().value);
  reviewRuns.set(result.run_id, result);
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      if (!originFor(request, env)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: headers(request, env) });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json(request, env, 200, { status: "ok", service: "core-agent", contract_version: contract.CONTRACT_VERSION });
    }
    if (request.method === "GET" && url.pathname === "/") {
      return json(request, env, 200, {
        service: "Personal AI Fund Manager Core Agent",
        contract_version: contract.CONTRACT_VERSION,
        endpoint: "/api/risk-workbench/handoff",
        execution_allowed: false
      });
    }
    const isReviewRead = request.method === "GET" && url.pathname.startsWith("/api/review/");
    const isKnownPost = request.method === "POST" && [
      "/api/health-check/run", "/api/risk-workbench/handoff", "/api/review",
      "/api/review/risk-decision", "/api/review/approval", "/api/review/simulate"
    ].includes(url.pathname);
    if (!isKnownPost && !isReviewRead) {
      return json(request, env, 404, { error: { code: "NOT_FOUND", message: "route not found" } });
    }
    if (!requiresApiKey(request, env)) return json(request, env, 401, errorPayload(authFailure()), { "WWW-Authenticate": "X-Core-Agent-Key" });
    if (!allowedByRateLimit(request, env)) return json(request, env, 429, errorPayload(rateLimitFailure()), { "Retry-After": "60" });
    if (isReviewRead) {
      const key = decodeURIComponent(url.pathname.slice("/api/review/".length));
      const result = key.startsWith("task/")
        ? reviewWorkflow.getByTaskId(key.slice("task/".length))
        : reviewWorkflow.getByRunId(key) || reviewRuns.get(key);
      return json(request, env, result ? 200 : 404, result || { error: { code: "REVIEW_NOT_FOUND", message: "review run not found" } });
    }
    let body;
    try {
      body = await readJson(request);
      if (url.pathname === "/api/review") {
        const result = await reviewWorkflow.start(body, env);
        storeReviewRun(result);
        return json(request, env, 200, result);
      }
      if (url.pathname === "/api/review/risk-decision") return json(request, env, 200, await reviewWorkflow.decideRisk(body));
      if (url.pathname === "/api/review/approval") return json(request, env, 200, await reviewWorkflow.decideApproval(body));
      if (url.pathname === "/api/review/simulate") return json(request, env, 200, await reviewWorkflow.simulate(body));
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
        if (error.reviewRecord) storeReviewRun(error.reviewRecord);
        return json(request, env, error.statusCode || 502, error.workflowRecord ? workflowErrorPayload(error) : modelReview.buildReviewError(error));
      }
      if (error?.name === "WorkflowError") return json(request, env, error.statusCode || 409, workflowErrorPayload(error));
      const requestId = body?.request?.request_id || body?.request_id || null;
      return json(request, env, error.statusCode || (error.code === "INVALID_PORTFOLIO" ? 422 : 400), errorPayload(error, requestId));
    }
  }
};
