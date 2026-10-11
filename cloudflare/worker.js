import harnessModule from "../chenchen/core/harness.js";
import toolsModule from "../chenchen/tools/financial-tools.js";
import contractModule from "../chenchen/contracts/investment-contract.js";
import adapterModule from "../chenchen/integrations/risk-workbench-adapter.js";

const { Harness } = harnessModule;
const tools = toolsModule;
const contract = contractModule;
const { buildRiskWorkbenchHandoff } = adapterModule;
const harness = new Harness({ toolset: tools });
const DEFAULT_ORIGINS = ["https://fund-risk-workbench.panxintian44.chatgpt.site", "https://realchenchenluo.github.io"];
function originFor(request, env) {
  const origin = request.headers.get("Origin");
  const configured = String(env.CORS_ORIGINS || DEFAULT_ORIGINS.join(",")).split(",").map(value => value.trim()).filter(Boolean);
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
function json(request, env, status, payload) { return new Response(JSON.stringify(payload), { status, headers: headers(request, env) }); }
function errorPayload(error, requestId = null) { return { error: { code: error.code || "REQUEST_FAILED", message: error.message || "request failed", retryable: Boolean(error.retryable), stage: error.stage || "BACKEND", recovery: error.recovery || "Review the request and retry after correcting the reported issue.", details: error.details || null }, contract_version: contract.CONTRACT_VERSION, operation: contract.OPERATION, request_id: requestId }; }
async function readJson(request) { try { return await request.json(); } catch { const error = new Error("request body must be valid JSON"); error.code = "INVALID_JSON"; error.statusCode = 400; throw error; } }
export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") { if (!originFor(request, env)) return new Response(null, { status: 403 }); return new Response(null, { status: 204, headers: headers(request, env) }); }
  if (request.method === "GET" && url.pathname === "/health") return json(request, env, 200, { status: "ok", service: "core-agent", contract_version: contract.CONTRACT_VERSION });
  if (request.method === "GET" && url.pathname === "/") return json(request, env, 200, { service: "Personal AI Fund Manager Core Agent", contract_version: contract.CONTRACT_VERSION, endpoint: "/api/risk-workbench/handoff", execution_allowed: false });
  if (request.method !== "POST" || !["/api/health-check/run", "/api/risk-workbench/handoff"].includes(url.pathname)) return json(request, env, 404, { error: { code: "NOT_FOUND", message: "route not found" } });
  let body;
  try { body = await readJson(request); const input = url.pathname === "/api/risk-workbench/handoff" ? (body.request || body) : body; const agentResponse = harness.runHealthCheckContract(input); if (url.pathname === "/api/health-check/run") return json(request, env, 200, agentResponse); return json(request, env, 200, { integration_version: "core-agent-to-risk-workbench.cloudflare@0.1.0", agent_response: agentResponse, risk_workbench: buildRiskWorkbenchHandoff(agentResponse) }); } catch (error) { const requestId = body?.request?.request_id || body?.request_id || null; return json(request, env, error.statusCode || (error.code === "INVALID_PORTFOLIO" ? 422 : 400), errorPayload(error, requestId)); }
} };
