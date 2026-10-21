import assert from "node:assert/strict";
import test from "node:test";
import serverModule from "../server.js";
import security from "../integrations/service-security.js";

test("Node HTTP shares the Worker authentication and redacted readiness policy", async t => {
  const keys = ["CORE_AGENT_API_KEY", "REQUIRE_TRUSTED_ACTORS", "REQUIRE_RISK_REVIEWER", "RISK_SERVICE_HMAC_SECRET", "RISK_HMAC_SECRET", "RISK_REVIEWER_ID", "MODEL_PROVIDER"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  const { server } = serverModule;
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  });
  const root = "http://127.0.0.1:" + server.address().port;
  await t.test("legacy mode reports missing configuration, never model or joint success", async () => {
    const response = await fetch(root + "/api/review/capabilities");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data, security.capabilityStatus(process.env));
    assert.equal(data.risk.callback_ready, false);
    assert.equal(data.acceptance.joint_acceptance, false);
  });
  await t.test("strict mode refuses missing machine identity on local HTTP too", async () => {
    process.env.REQUIRE_TRUSTED_ACTORS = "true";
    const response = await fetch(root + "/api/review/capabilities");
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "CORE_AUTH_NOT_CONFIGURED");
  });
  await t.test("configured machine identity is required and not exposed", async () => {
    Object.assign(process.env, { CORE_AGENT_API_KEY: "synthetic-local-machine-key", RISK_SERVICE_HMAC_SECRET: "synthetic-local-hmac",
      RISK_REVIEWER_ID: "synthetic-local-risk", REQUIRE_RISK_REVIEWER: "true" });
    assert.equal((await fetch(root + "/api/review/capabilities")).status, 401);
    const response = await fetch(root + "/api/review/capabilities", { headers: { "X-Core-Agent-Key": process.env.CORE_AGENT_API_KEY } });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(data, security.capabilityStatus(process.env));
    assert.equal(data.risk.callback_ready, true);
    for (const key of ["CORE_AGENT_API_KEY", "RISK_SERVICE_HMAC_SECRET", "RISK_REVIEWER_ID"]) assert.equal(JSON.stringify(data).includes(process.env[key]), false);
  });
});
