"use strict";

const { resolveModelConfig } = require("../integrations/model-review");

// Read configuration names without reading or printing secret values. This
// command does not contact Alibaba Cloud, Cloudflare or a model provider.
const config = resolveModelConfig({ ...process.env, MODEL_PROVIDER: "aliyun_bailian" });
const missing = [];
if (!config.apiKey) missing.push("DASHSCOPE_API_KEY");
if (!String(process.env.CORE_AGENT_API_KEY || "").trim()) missing.push("CORE_AGENT_API_KEY");
const ready = !config.configurationIssue && missing.length === 0;
process.stdout.write(JSON.stringify({
  check: "LOCAL_CONFIGURATION_ONLY", network_requests: 0, cost_incurred: false,
  status: ready ? "READY_FOR_AUTHORIZED_ACCEPTANCE" : "NOT_READY",
  region: "cn-beijing", provider: config.provider,
  missing_secret_names: missing, configuration_issue: config.configurationIssue,
  deployment: "No deployment or model call was performed."
}, null, 2) + "\n");
if (!ready) process.exitCode = 2;
