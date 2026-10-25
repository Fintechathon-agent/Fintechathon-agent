"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { Sessions, describePolicy } = require("./service.cjs");
const { fail } = require("./parser.cjs");
const { runReview } = require("../../../chenchen/integrations/model-review");

function createServer({ sessions = new Sessions(), env = process.env, modelRunner = runReview } = {}) {
  const assets = { "/": ["index.html", "text/html"], "/app.js": ["app.js", "text/javascript"], "/style.css": ["style.css", "text/css"] };
  const routes = {
    "/api/long-text/v1/intake": (owner, body) => sessions.create(owner, body),
    "/api/long-text/v1/revise": (owner, body) => sessions.revise(owner, body),
    "/api/long-text/v1/correct": (owner, body) => sessions.correct(owner, body),
    "/api/long-text/v1/confirm": (owner, body) => sessions.confirm(owner, body),
    "/api/long-text/v1/export": (owner, body) => sessions.export(owner, body),
    "/api/long-text/v1/review-draft": (owner, body) => sessions.reviewRequest(owner, body)
  };
  const modelBusy = new Set();
  const server = http.createServer(async (req, res) => {
    const security = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
    let cookieHeader = {};
    const send = (status, body, type = "application/json") => {
      if (res.writableEnded) return;
      const content = type === "application/json" ? JSON.stringify(body) : body;
      res.writeHead(status, { ...security, ...cookieHeader, "Content-Type": type + "; charset=utf-8" }); res.end(content);
    };
    const host = "127.0.0.1:" + server.address().port;
    const landingNavigation = req.method === "GET" && req.url === "/" && req.headers["sec-fetch-mode"] === "navigate" && req.headers["sec-fetch-dest"] === "document";
    if (req.headers.host !== host || req.headers.origin && req.headers.origin !== "http://" + host || req.headers["sec-fetch-site"] === "cross-site" && !landingNavigation) {
      send(403, { error: { code: "LOCAL_ONLY", message: "请从本机同源页面访问" } }); return;
    }
    const match = /(?:^|;\s*)long_text_session=([a-f0-9]{64})(?:;|$)/u.exec(req.headers.cookie || "");
    let owner = match?.[1];
    if (!owner) { owner = randomBytes(32).toString("hex"); cookieHeader = { "Set-Cookie": `long_text_session=${owner}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800` }; }
    try {
      const url = new URL(req.url, "http://" + host);
      if (req.method === "GET" && Object.hasOwn(assets, url.pathname)) {
        const [file, type] = assets[url.pathname]; send(200, fs.readFileSync(path.join(__dirname, "public", file)), type); return;
      }
      if (req.method === "GET" && url.pathname === "/api/long-text/v1/health") {
        send(200, { ok: true, module: "long-text-risk.v1", mode: "LOCAL_STAGING", network_model_enabled: env.LONG_TEXT_MODEL_REVIEW === "1", execution_allowed: false, policy: describePolicy().policy_version }); return;
      }
      if (req.method !== "POST" || (!Object.hasOwn(routes, url.pathname) && url.pathname !== "/api/long-text/v1/model-review")) { send(404, { error: { code: "NOT_FOUND" } }); return; }
      if (!/^application\/json(?:\s*;|$)/iu.test(req.headers["content-type"] || "")) { send(415, { error: { code: "JSON_REQUIRED" } }); return; }
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 131072) { send(413, { error: { code: "INPUT_TOO_LARGE", message: "请求超过128KiB，请缩短文字" } }); return; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { send(400, { error: { code: "INVALID_JSON", message: "请发送UTF-8 JSON" } }); return; }
      if (!body || typeof body !== "object" || Array.isArray(body)) fail("INVALID_INPUT", "请求必须是JSON对象");
      if (url.pathname === "/api/long-text/v1/model-review") {
        if (env.LONG_TEXT_MODEL_REVIEW !== "1") fail("MODEL_DISABLED", "在线模型复核未启用；本地风险结果仍可使用", 503);
        const request = sessions.reviewRequest(owner, body).request;
        if (modelBusy.has(body.draft_id)) fail("MODEL_BUSY", "该草稿正在复核，请勿重复提交", 409);
        modelBusy.add(body.draft_id);
        try {
          const model = await modelRunner(request, env);
          sessions.match(owner, body); // A concurrent edit invalidates an in-flight response.
          send(200, { source_binding: body, model, execution_allowed: false, risk_result_unchanged: true });
        } finally { modelBusy.delete(body.draft_id); }
      } else send(200, routes[url.pathname](owner, body));
    } catch (error) {
      const known = Boolean(error.code) || error instanceof TypeError || error instanceof RangeError;
      // Provider internals and response bodies can contain credentials; never echo them.
      const provider = req.url === "/api/long-text/v1/model-review" && !["MODEL_DISABLED", "MODEL_BUSY", "STALE_DRAFT", "CONFIRMATION_REQUIRED", "NOT_FOUND", "MODEL_CONTEXT_TOO_LARGE", "INVALID_FIELDS"].includes(error.code);
      send(provider ? 502 : error.status || (known ? 422 : 500), { error: { code: provider ? "MODEL_FAILED" : error.code || (known ? "INVALID_INPUT" : "INTERNAL_ERROR"),
        message: provider ? "在线模型复核失败，未生成在线结果；本地规则结果保持原样。" : known ? error.message : "服务未完成此次分析，请重试" }, execution_allowed: false });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 5000;
  return server;
}
if (require.main === module) {
  const port = Number(process.env.LONG_TEXT_PORT || 4182);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("Invalid LONG_TEXT_PORT");
  createServer().listen(port, "127.0.0.1", () => console.log(`Long text staging: http://127.0.0.1:${port}/`));
}
module.exports = { createServer };
