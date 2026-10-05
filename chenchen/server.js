"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Harness } = require("./core/harness");
const tools = require("./tools/financial-tools");
const { randomUUID } = require("node:crypto");
const { MerchantSession, demo: merchantDemo } = require("./merchant/ledger");
const merchantSessions = new Map();

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
const publicAccessEnabled = () => process.env.PUBLIC_ACCESS === "true";
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

function sendError(response, error, fallbackStatus = 400) {
  const status = error.statusCode || (error.code === "INVALID_PORTFOLIO" ? 422 : fallbackStatus);
  sendJson(response, status, {
    error: {
      code: error.code || "REQUEST_FAILED",
      message: error.message,
      details: error.details || null
    }
  });
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
    const result = harness.runHealthCheck({
      task_id: body.task_id,
      session_id: body.session_id,
      risk_profile: body.risk_profile,
      portfolio: body.portfolio || body.snapshot
    });
    sendJson(response, 200, result);
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
  const routes = { "/": "versions/home.html", "/index.html": "versions/home.html", "/investment": "versions/investment.html", "/merchant": "versions/merchant.html" };
  const relativePath = routes[decodedPath] || decodedPath.replace(/^\/+/, "");
  const allowed = new Set(["versions/home.html", "versions/investment.html", "versions/merchant.html",
    "versions/style.css", "versions/product-overrides.css", "versions/presentation.mjs", "versions/investment.js", "versions/merchant.js", "versions/common.js",
    "index.html", "app.js", "styles.css"]);
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
    if (!localHost && !publicAccessEnabled()) {
      sendJson(response, 403, { error: { code: "LOCAL_ONLY", message: "Local demo only" } }); return;
    }
    if (!publicAccessEnabled() && request.headers.origin && request.headers.origin !== url.origin) {
      sendJson(response, 403, { error: { code: "ORIGIN_MISMATCH", message: "Cross-origin requests are disabled" } }); return;
    }
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, url.pathname, url);
      if (!handled) sendJson(response, 404, { error: { code: "API_NOT_FOUND", message: "API route not found" } });
      return;
    }
    serveStatic(response, url.pathname);
  } catch (error) {
    if (!response.headersSent) sendError(response, error);
  }
});

if (require.main === module) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`Portfolio Sentinel running at http://127.0.0.1:${port}`);
  });
}

module.exports = { server, harness };
