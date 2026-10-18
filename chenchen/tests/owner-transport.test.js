"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { dispatchRiskHandoff } = require("../integrations/owner-bridge");
const env = { RISK_SERVICE_URL: "https://synthetic-risk.invalid/review", RISK_SERVICE_HMAC_SECRET: "synthetic-only" };
const handoff = { trace: { task_id: "synthetic-task" }, handoff_id: "synthetic-handoff" };

test("signed handoffs reject redirects without forwarding credentials", async () => {
  let calls = 0;
  await assert.rejects(dispatchRiskHandoff(handoff, env, { fetchImpl: async (_url, init) => {
    calls++; assert.equal(init.redirect, "manual");
    return new Response(null, { status: 302, headers: { Location: "https://elsewhere.invalid" } });
  } }), e => e.code === "OWNER_SERVICE_REJECTED");
  assert.equal(calls, 1);
});

test("HTTP 200 with rejection, HTML, invalid JSON or oversized data is not a successful handoff", async () => {
  for (const response of [Response.json({ accepted: false }), Response.json({ error: "not accepted" }),
    new Response("<html>login</html>"), new Response("{", { headers: { "Content-Type": "application/json" } }),
    Response.json(["accepted"]), Response.json({ text: "字".repeat(1400) })]) {
    await assert.rejects(dispatchRiskHandoff(handoff, env, { fetchImpl: async () => response }), e => e.code === "OWNER_SERVICE_REJECTED");
  }
});

test("response-body timeout remains bounded after headers arrive", async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"accepted":')); }, cancel() { cancelled = true; } });
  const started = Date.now();
  await assert.rejects(dispatchRiskHandoff(handoff, env, { timeoutMs: 1000,
    fetchImpl: async () => new Response(body, { headers: { "Content-Type": "application/json" } }) }),
  e => e.code === "OWNER_SERVICE_UNAVAILABLE" && e.details.cause === "TIMEOUT");
  assert.ok(Date.now() - started < 5000); assert.equal(cancelled, true);
});

test("Owner errors cannot leak an upstream secret in public error details", async () => {
  await assert.rejects(dispatchRiskHandoff(handoff, env, { fetchImpl: async () => Response.json({ secret: "private-upstream-value" }, { status: 503 }) }),
    e => e.code === "OWNER_SERVICE_REJECTED" && e.retryable && !JSON.stringify(e).includes("private-upstream-value"));
});

test("credential-bearing URLs are rejected before transport", async () => {
  for (const url of ["https://user:pass@synthetic-risk.invalid/review", "https://synthetic-risk.invalid/review#secret"]) {
    await assert.rejects(dispatchRiskHandoff(handoff, { ...env, RISK_SERVICE_URL: url }, { fetchImpl: () => { throw new Error("must not call"); } }),
      e => e.code === "OWNER_URL_INVALID");
  }
});
