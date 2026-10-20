"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Harness } = require("./core/harness");
const tools = require("./tools/financial-tools");
const contract = require("./contracts/investment-contract");
const coreError = require("./contracts/core-agent-error");
const { buildRiskWorkbenchHandoff } = require("./integrations/risk-workbench-adapter");
const modelReview = require("./integrations/model-review");
const legacyReviewAdapter = require("./integrations/legacy-review-adapter");
const riskHandoff = require("./integrations/risk-handoff");
const ownerBridge = require("./integrations/owner-bridge");
const { ReviewWorkflowStore, WorkflowError } = require("./integrations/review-workflow");
const { randomUUID } = require("node:crypto");
const { MerchantSession, demo: merchantDemo } = require("./merchant/ledger");
const merchantSessions = new Map();
const reviewRuns = new Map();

function merchantFor(request, response) {
  let id = /(?:^|;\s*)merchant_session=([a-z0-9-]+)/.exec(request.headers.cookie || "")?.[1];
  if (!merchantSessions.has(id)) {
    if (merchantSessions.size >= 500) merchantSessions.delete(merchantSessions.keys().next().value);
    id = randomUUID(); merchantSessions.set(id, new MerchantSession());
    response.setHeader("Set-Cookie", "merchant_session=" + id + "; HttpOnly; SameSite=Strict; Path=/");
  }
  return merchantSessions.get(id);
}

const root = __dirname;
const port = Number(process.env.PORT || 4175);
const harness = new Harness({ toolset: tools });
const reviewWorkflow = new ReviewWorkflowStore({
  memoryWriter: (sessionId, record) => harness.memory.save(sessionId, record)
});
const publicAccessEnabled = () => process.env.PUBLIC_ACCESS === "true";
const corsOrigins = new Set((process.env.CORS_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (!origin || (!corsOrigins.has("*") && !corsOrigins.has(origin))) return false;
  response.setHeader("Access-Control-Allow-Origin", corsOrigins.has("*") ? "*" : origin);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Core-Agent-Key, Idempotency-Key, X-Request-ID, X-Risk-Signature, X-Approval-Signature");
  response.setHeader("Vary", "Origin");
  return true;
}

function sendError(response, error, fallbackStatus = 400) {
  const status = error.statusCode || (error.code === "INVALID_PORTFOLIO" ? 422 : fallbackStatus);
  const payload = contract.buildErrorResponse(error, {
    requestId: error.requestId || null,
    taskId: error.trace?.task_id || null,
    sessionId: error.trace?.session_id || null,
    auditId: error.trace?.audit_id || null
  });
  sendJson(response, status, payload);
}

function sendDownload(response, filename, payload) {
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(filename) });
  response.end(JSON.stringify(payload, null, 2));
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        const error = new Error("request body exceeds 1 MB");
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        error.statusCode = 400;
        error.code = "INVALID_JSON";
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function requireReviewApiKey(request) {
  const expected = String(process.env.CORE_AGENT_API_KEY || "").trim();
  if (!expected || request.headers["x-core-agent-key"] === expected) return;
  throw new modelReview.ReviewError("AUTHENTICATION_REQUIRED", "API authentication is required", {
    statusCode: 401,
    stage: "AUTHENTICATION",
    recovery: "Provide the configured X-Core-Agent-Key and retry."
  });
}

function storeReviewRun(result) {
  if (reviewRuns.size >= 500) reviewRuns.delete(reviewRuns.keys().next().value);
  reviewRuns.set(result.run_id, result);
}

function buildWorkflowError(error) {
  const record = error.workflowRecord || error.record || null;
  const payload = coreError.decorate({
    review_version: modelReview.REVIEW_VERSION,
    contract_version: modelReview.REVIEW_VERSION,
    error: {
      code: error.code || "WORKFLOW_FAILED",
      message: error.message || "workflow failed",
      retryable: Boolean(error.retryable),
      stage: error.stage || "WORKFLOW",
      recovery: error.recovery || "Review the task state and retry.",
      details: error.details || null
    },
    workflow: record
  }, {
    sourceContractVersion: modelReview.REVIEW_VERSION,
    requestId: record?.request_id || error.requestId || null,
    taskId: record?.task_id || error.taskId || null,
    runId: record?.run_id || error.runId || null,
    auditId: record?.audit?.audit_id || error.auditId || null,
    handoffId: record?.risk_handoff?.handoff_id || null,
    operation: "MODEL_REVIEW",
    legacyContractVersion: modelReview.REVIEW_VERSION
  });
  return payload;
}

function resolvePortfolio(body) {
  if (body && body.snapshot) return body.snapshot;
  if (body && body.portfolio) return body.portfolio;
  return body && Object.keys(body).length ? body : tools.getDemoPortfolio();
}

function resolveSnapshot(body) {
  const input = resolvePortfolio(body);
  if (input.snapshot_id) return input;
  const result = tools.validatePortfolio(input);
  if (!result.output.valid) {
    const error = new Error("portfolio validation failed");
    error.code = "INVALID_PORTFOLIO";
    error.details = result.output;
    throw error;
  }
  return result.output.snapshot;
}

async function handleApi(request, response, pathname, url) {
  const method = request.method || "GET";
  let body = {};
  if (method === "POST") body = await parseBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("JSON body must be an object");
  if (method === "POST" && (pathname === "/api/review" || pathname === "/api/review/legacy")) {
    body = {
      ...body,
      ...(body.request_id || !request.headers["x-request-id"] ? {} : { request_id: request.headers["x-request-id"] }),
      ...(body.idempotency_key || !request.headers["idempotency-key"] ? {} : { idempotency_key: request.headers["idempotency-key"] })
    };
  }
  if (method === "POST" && ["/api/funding-demo/plan", "/api/funding-demo/plan/revise"].includes(pathname)) {
    requireReviewApiKey(request);
    sendJson(response, 200, pathname.endsWith("/revise") ? reviewWorkflow.fundingPlans.revise(body) : reviewWorkflow.fundingPlans.create(body));
    return true;
  }
  if (method === "GET" && pathname.startsWith("/api/funding-demo/plan/")) {
    requireReviewApiKey(request);
    sendJson(response, 200, reviewWorkflow.fundingPlans.summary(decodeURIComponent(pathname.slice("/api/funding-demo/plan/".length))));
    return true;
  }
  if (method === "POST" && ["/api/review", "/api/review/legacy"].includes(pathname)) {
    requireReviewApiKey(request);
    const input = pathname === "/api/review/legacy"
      ? legacyReviewAdapter.normalizeLegacyReviewInput(body)
      : body;
    const result = await reviewWorkflow.start(input, process.env);
    storeReviewRun(result);
    sendJson(response, 200, pathname === "/api/review/legacy"
      ? legacyReviewAdapter.mapWorkflowToLegacyResponse(result)
      : result);
    return true;
  }
  if (method === "POST" && pathname === "/api/review/risk-decision") {
    requireReviewApiKey(request);
    const actorAuth = await ownerBridge.verifyOwnerRequest({ owner: "risk", body, headers: request.headers, env: process.env });
    sendJson(response, 200, await reviewWorkflow.decideRisk(body, actorAuth));
    return true;
  }
  if (method === "POST" && pathname === "/api/review/risk-callback") {
    requireReviewApiKey(request);
    const actorAuth = await ownerBridge.verifyOwnerRequest({ owner: "risk", body, headers: request.headers, env: process.env });
    const result = await reviewWorkflow.receiveRiskCallback(body, actorAuth);
    sendJson(response, 200, { callback_version: riskHandoff.CALLBACK_VERSION, ...result, handoff: riskHandoff.buildRiskHandoffPackage(result.workflow) });
    return true;
  }
  if (method === "POST" && pathname === "/api/review/approval") {
    requireReviewApiKey(request);
    const actorAuth = await ownerBridge.verifyOwnerRequest({ owner: "approval", body, headers: request.headers, env: process.env });
    sendJson(response, 200, await reviewWorkflow.decideApproval(body, actorAuth));
    return true;
  }
  if (method === "POST" && pathname === "/api/review/risk-dispatch") {
    requireReviewApiKey(request);
    sendJson(response, 202, await reviewWorkflow.dispatchRiskHandoff(body, handoff => ownerBridge.dispatchRiskHandoff(handoff, process.env)));
    return true;
  }
  if (method === "POST" && pathname === "/api/review/simulate") {
    requireReviewApiKey(request);
    sendJson(response, 200, await reviewWorkflow.simulate(body));
    return true;
  }
  if (method === "POST" && pathname === "/api/review/cancel") {
    requireReviewApiKey(request);
    sendJson(response, 200, await reviewWorkflow.cancel(body));
    return true;
  }
  if (method === "GET" && pathname.startsWith("/api/review/task/")) {
    requireReviewApiKey(request);
    const handoffRequested = pathname.endsWith("/risk-handoff");
    const taskId = decodeURIComponent(pathname.slice("/api/review/task/".length, handoffRequested ? -"/risk-handoff".length : undefined));
    const result = reviewWorkflow.getByTaskId(taskId);
    sendJson(response, result ? 200 : 404, result ? (handoffRequested ? riskHandoff.buildRiskHandoffPackage(result) : result) : { error: { code: "WORKFLOW_NOT_FOUND", message: "review task not found" } });
    return true;
  }
  if (method === "GET" && pathname.startsWith("/api/review/")) {
    requireReviewApiKey(request);
    const handoffRequested = pathname.endsWith("/risk-handoff");
    const runId = decodeURIComponent(pathname.slice("/api/review/".length, handoffRequested ? -"/risk-handoff".length : undefined));
    const result = reviewWorkflow.getByRunId(runId) || reviewRuns.get(runId);
    sendJson(response, result ? 200 : 404, result ? (handoffRequested ? riskHandoff.buildRiskHandoffPackage(result) : result) : { error: { code: "REVIEW_NOT_FOUND", message: "review run not found" } });
    return true;
  }
  if (pathname.startsWith("/api/merchant/")) {
    const session = merchantFor(request, response);
    let result;
    const delay = Number(url.searchParams.get("delay") || 0);
    if (method === "GET" && pathname === "/api/merchant/export") {
      const type = url.searchParams.get("type") || "ledger";
      if (!["ledger", "review", "demo"].includes(type)) throw new Error("unknown export type");
      const s = session.summary(delay);
      const payload = type === "demo" ? merchantDemo() : type === "ledger" ? s.ledger :
        { ledger: s.ledger, revision: s.revision, forecast: s.forecast, costs: s.costs,
          review: session.insights(delay), scope: "已知账单测算；预计日期待核实；未连接支付平台" };
      sendDownload(response, "merchant-" + type + "-" + s.ledger.as_of + ".json", payload); return true;
    }
    if (method === "GET" && pathname === "/api/merchant/ledger") result = session.summary(delay);
    else if (method === "GET" && pathname === "/api/merchant/demo") result = merchantDemo();
    else if (method === "GET" && pathname === "/api/merchant/bill") result = session.detail(url.searchParams.get("id"));
    else if (method === "GET" && pathname === "/api/merchant/scenario") result = session.singleScenario(url.searchParams.get("bill"), delay);
    else if (method === "GET" && pathname === "/api/merchant/insights") result = session.insights(delay);
    else if (method === "POST" && pathname === "/api/merchant/review") result = session.review(body.revision, body.confirmed);
    else if (method === "POST" && pathname === "/api/merchant/import") result = session.replace(body);
    else if (method === "POST" && pathname === "/api/merchant/follow") result = session.follow(body.id, body.delay || 0);
    else if (method === "POST" && pathname === "/api/merchant/notice") result = session.setNoticeStatus(body.id, body.status, body.note);
    else if (method === "POST" && pathname === "/api/merchant/reset") result = session.replace(merchantDemo());
    else return false;
    sendJson(response, 200, result); return true;
  }
  if (method === "GET" && pathname.startsWith("/api/task/")) {
    const exporting = pathname.endsWith("/export");
    const taskId = pathname.slice("/api/task/".length, exporting ? -"/export".length : undefined);
    const task = harness.getTask(taskId);
    if (task && exporting) { sendDownload(response, "portfolio-analysis.json", task); return true; }
    sendJson(response, task ? 200 : 404, task || { error: { code: "TASK_NOT_FOUND", message: "task not found" } }); return true;
  }

  if (method === "GET" && pathname === "/api/demo/portfolio") {
    sendJson(response, 200, tools.validatePortfolio(tools.getDemoPortfolio()));
    return true;
  }
  if (method === "POST" && pathname === "/api/session/init") {
    sendJson(response, 200, harness.createSession(body));
    return true;
  }
  if (method === "POST" && pathname === "/api/health-check/run") {
    let result;
    try {
      result = harness.runHealthCheckContract(body);
    } catch (error) {
      error.requestId = body.request_id || null;
      throw error;
    }
    sendJson(response, 200, result);
    return true;
  }
  if (method === "POST" && pathname === "/api/risk-workbench/handoff") {
    let agentResponse;
    try {
      agentResponse = harness.runHealthCheckContract(body.request || body);
    } catch (error) {
      error.requestId = (body.request || body).request_id || null;
      throw error;
    }
    sendJson(response, 200, {
      integration_version: "core-agent-to-risk-workbench.demo@0.1.0",
      agent_response: agentResponse,
      risk_workbench: buildRiskWorkbenchHandoff(agentResponse)
    });
    return true;
  }
  if (method === "POST" && pathname === "/api/portfolio/import") {
    sendJson(response, 200, tools.validatePortfolio(resolvePortfolio(body)));
    return true;
  }
  if (method === "POST" && pathname === "/api/portfolio/diagnose") {
    sendJson(response, 200, tools.diagnosePortfolio(resolvePortfolio(body)));
    return true;
  }
  if (method === "POST" && pathname === "/api/strategy/generate") {
    const snapshot = resolveSnapshot(body);
    const report = body.health_report || body.report || tools.diagnosePortfolio(snapshot).output;
    sendJson(response, 200, tools.generateCandidates(snapshot, report));
    return true;
  }
  if (method === "POST" && pathname === "/api/simulation/run") {
    const snapshot = resolveSnapshot(body);
    const candidates = body.candidates || body.proposals;
    sendJson(response, 200, tools.runSimulation(snapshot, candidates));
    return true;
  }
  if (method === "POST" && pathname === "/api/paper-trade/execute") {
    sendJson(response, 503, { error: { code: "GATEWAY_NOT_CONNECTED",
      message: "Safety Action Gateway 尚未接入；客户端提交的 approval 不能作为执行授权。" } });
    return true;
  }
  if (method === "GET" && pathname.startsWith("/api/audit/")) {
    const taskId = decodeURIComponent(pathname.slice("/api/audit/".length));
    const audit = harness.getAudit(taskId);
    if (!audit) {
      sendJson(response, 404, { error: { code: "TASK_NOT_FOUND", message: "task not found" } });
    } else {
      sendJson(response, 200, audit);
    }
    return true;
  }
  if (method === "POST" && pathname === "/api/memory/save") {
    sendJson(response, 200, harness.saveMemory(body.task_id, body.record));
    return true;
  }
  if (method === "GET" && pathname === "/api/memory") {
    sendJson(response, 200, { session_id: url.searchParams.get("session_id"), entries: harness.listMemory(url.searchParams.get("session_id")) });
    return true;
  }
  if (method === "POST" && pathname === "/api/memory/clear") {
    sendJson(response, 200, harness.memory.clear(body.session_id));
    return true;
  }
  if (method === "POST" && pathname === "/api/demo/reset") {
    harness.reset();
    tools.resetPaperTrading();
    sendJson(response, 200, { reset: true, data_as_of: tools.constants.DATA_AS_OF });
    return true;
  }
  return false;
}

function serveStatic(response, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    sendJson(response, 400, { error: { code: "INVALID_PATH", message: "invalid URL path" } });
    return;
  }
  const routes = { "/": "versions/investment.html", "/index.html": "versions/investment.html", "/catalog": "versions/home.html", "/investment": "versions/investment.html", "/investment-v0.10": "versions/investment-legacy.html", "/merchant": "versions/merchant.html", "/risk-workbench": "versions/risk-workbench.html" };
  const relativePath = routes[decodedPath] || decodedPath.replace(/^\/+/, "");
  const allowed = new Set(["versions/home.html", "versions/investment.html", "versions/merchant.html", "versions/risk-workbench.html",
    "contracts/risk-handoff.v1.schema.json", "contracts/owner-bridge.v1.schema.json", "contracts/examples/risk-callback.request.json",
    "contracts/funding-plan-demo.v1.schema.json", "contracts/examples/funding-plan.request.json",
    "versions/style.css", "versions/product-overrides.css", "versions/presentation.mjs", "versions/investment-report.mjs", "versions/investment.js", "versions/investment-legacy.js", "versions/investment-legacy.html", "versions/merchant.js", "versions/risk-workbench.js", "versions/common.js",
    "contracts/investment-agent.v1.schema.json", "contracts/core-agent-error.v1.schema.json", "contracts/model-review.v1.schema.json", "contracts/examples/health-check.request.json", "contracts/examples/health-check.response.json", "contracts/examples/core-agent-error.response.json", "contracts/examples/model-review.request.json", "contracts/examples/model-review.response.json", "contracts/examples/risk-decision.request.json", "contracts/examples/approval.request.json", "contracts/examples/simulation.request.json",
    "data/market-brief-2026-10-08.json", "data/market-brief-2026-10-09.json", "data/risk-workbench-demo.json", "index.html", "app.js", "styles.css"]);
  if (!allowed.has(relativePath)) { sendJson(response, 404, { error: { code: "NOT_FOUND", message: "not found" } }); return; }
  const filePath = path.resolve(root, relativePath);
  const relativeToRoot = path.relative(root, filePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    sendJson(response, 403, { error: { code: "FORBIDDEN", message: "forbidden path" } });
    return;
  }
  fs.readFile(filePath, (error, file) => {
    if (error) {
      sendJson(response, error.code === "ENOENT" ? 404 : 500, { error: { code: error.code || "FILE_ERROR", message: error.code === "ENOENT" ? "not found" : "server error" } });
      return;
    }
    response.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(file);
  });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const corsApplied = applyCors(request, response);
    if (request.method === "OPTIONS" && corsApplied) {
      response.writeHead(204);
      response.end();
      return;
    }
    if (!localHost && !publicAccessEnabled()) {
      sendJson(response, 403, { error: { code: "LOCAL_ONLY", message: "Local demo only" } }); return;
    }
    if (!publicAccessEnabled() && request.headers.origin && request.headers.origin !== url.origin) {
      sendJson(response, 403, { error: { code: "ORIGIN_MISMATCH", message: "Cross-origin requests are disabled" } }); return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { status: "ok", service: "core-agent", contract_version: contract.CONTRACT_VERSION });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, url.pathname, url);
      if (!handled) sendJson(response, 404, { error: { code: "API_NOT_FOUND", message: "API route not found" } });
      return;
    }
    serveStatic(response, url.pathname);
  } catch (error) {
    if (!response.headersSent) {
      if (error?.name === "ReviewError") {
        if (error.reviewRecord) storeReviewRun(error.reviewRecord);
        sendJson(response, error.statusCode || 502, error.workflowRecord ? buildWorkflowError(error) : modelReview.buildReviewError(error));
      } else if (error?.name === "WorkflowError") {
        sendJson(response, error.statusCode || 409, buildWorkflowError(error));
      } else sendError(response, error);
    }
  }
});

if (require.main === module) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`Portfolio Sentinel running at http://127.0.0.1:${port}`);
  });
}

module.exports = { server, harness, reviewRuns, reviewWorkflow };
