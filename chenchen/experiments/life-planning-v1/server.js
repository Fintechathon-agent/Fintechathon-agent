"use strict";

const http = require("node:http");
const { IntakeSessions } = require("./intake");
const { compareQuotes, subscriptionSchedule, planPurchases } = require("./planning");
const { buildReport } = require("./report");
const { runFixture, example } = require("./fixture");

function createServer() {
  const sessions = new IntakeSessions();
  const routes = {
    "/api/life/v1/intake": body => sessions.create(body),
    "/api/life/v1/revise": body => sessions.revise(body),
    "/api/life/v1/attach-plan": body => sessions.attachPlan(body),
    "/api/life/v1/confirm": body => sessions.confirm(body),
    "/api/life/v1/review-draft": body => sessions.reviewRequest(body),
    "/api/life/v1/compare": compareQuotes,
    "/api/life/v1/subscriptions": subscriptionSchedule,
    "/api/life/v1/plan": body => { const plan = planPurchases(body); return { plan, report: buildReport(plan) }; }
  };
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" });
      res.end(JSON.stringify(value));
    };
    const expectedHost = "127.0.0.1:" + server.address().port;
    if (req.headers.host !== expectedHost || (req.headers.origin && req.headers.origin !== "http://" + expectedHost)
      || req.headers["sec-fetch-site"] === "cross-site") {
      send(403, { error: { code: "LOCAL_ONLY", message: "Use the loopback endpoint from this device" } }); return;
    }
    try {
      if (req.method === "GET" && req.url === "/health") {
        send(200, { status: "ok", mode: "LOCAL_EXPERIMENT", network_model_enabled: false, execution_allowed: false }); return;
      }
      if (req.method === "GET" && req.url === "/fixture") { send(200, await runFixture()); return; }
      if (req.method === "GET" && req.url === "/example") { send(200, example()); return; }
      if (req.method !== "POST" || !Object.hasOwn(routes, req.url)) { send(404, { error: { code: "NOT_FOUND" } }); return; }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) { send(415, { error: { code: "JSON_REQUIRED" } }); return; }
      let bytes = 0;
      const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 65536) { send(413, { error: { code: "INPUT_TOO_LARGE" } }); return; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { send(400, { error: { code: "INVALID_JSON" } }); return; }
      if (!body || typeof body !== "object" || Array.isArray(body)) { send(422, { error: { code: "INVALID_INPUT" } }); return; }
      send(200, await routes[req.url](body));
    } catch (error) {
      const known = Boolean(error.code) || error instanceof TypeError || error instanceof RangeError;
      send(known ? 422 : 500, { error: { code: error.code || (known ? "INVALID_INPUT" : "INTERNAL_ERROR"),
        message: known ? error.message : "Local experiment failed" }, execution_allowed: false });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  return server;
}
if (require.main === module) {
  const port = Number(process.env.LIFE_DEMO_PORT || 4181);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid LIFE_DEMO_PORT");
  createServer().listen(port, "127.0.0.1", () => console.log("Local experiment: http://127.0.0.1:" + port + "/fixture"));
}
module.exports = { createServer };
