"use strict";

// Local, synthetic Core/Risk runtime for the Personal AI Fund Manager gateway.
// This is deliberately separate from production deployment configuration.
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { prepareCoreSnapshot } = require("./core-snapshot.cjs");
const { createCoreHttpContext } = require("./harness.cjs");
const { createConversationServer } = require("../interface-adapters/conversation-server.cjs");
const { ConversationStore } = require("../interface-adapters/conversation-store.cjs");

async function main() {
  const snapshot = prepareCoreSnapshot({ currentSource: true });
  let core;
  let risk;
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    if (risk) {
      risk.server.closeAllConnections();
      await new Promise(resolve => risk.server.close(resolve));
      risk.store.close();
    }
    if (core) await core.close();
    snapshot.dispose();
  }
  try {
    core = await createCoreHttpContext(snapshot, "personal-fund-local-joint");
    const riskKey = randomBytes(32).toString("hex");
    risk = createConversationServer({
      store: new ConversationStore(path.join(snapshot.directory, "personal-risk-journal")),
      env: {
        RISK_CONVERSATION_API_KEY: riskKey,
        CORE_AGENT_BASE_URL: core.origin,
        CORE_AGENT_API_KEY: core.credentials.machine,
        RISK_SERVICE_HMAC_SECRET: core.credentials.risk,
        RISK_REVIEWER_ID: core.reviewer,
        RISK_ALLOW_LOCAL_HTTP: "true",
      },
    });
    await new Promise(resolve => risk.server.listen(0, "127.0.0.1", resolve));
    process.stdout.write(JSON.stringify({
      core_origin: core.origin,
      core_key: core.credentials.machine,
      risk_origin: `http://127.0.0.1:${risk.server.address().port}`,
      risk_key: riskKey,
      model: "SYNTHETIC_TEST_ADAPTER",
      execution_allowed: false,
    }) + "\n");
    process.stdin.resume();
    process.stdin.on("end", () => close().then(() => process.exit(0)));
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.once(signal, () => close().then(() => process.exit(0)));
    }
  } catch (error) {
    await close();
    throw error;
  }
}

main().catch(error => {
  process.stderr.write(`Local Core/Risk startup failed: ${error.message}\n`);
  process.exitCode = 1;
});
