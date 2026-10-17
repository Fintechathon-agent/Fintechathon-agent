"use strict";

const MODEL = "qwen3.7-flash";
const PATH = "/compatible-mode/v1/chat/completions";
const REQUEST_BYTES_LIMIT = 24000;
const RESERVATION_CNY_PER_ATTEMPT = 0.01;

function resolveBailianConfig(env = {}) {
  const workspace = String(env.BAILIAN_WORKSPACE_ID || "").trim();
  const model = String(env.MODEL_NAME || MODEL).trim();
  const host = workspace + ".cn-beijing.maas.aliyuncs.com";
  const endpoint = "https://" + host + PATH;
  const apiKey = String(env.DASHSCOPE_API_KEY || "").trim();
  const maxOutput = Number(env.BAILIAN_MAX_OUTPUT_TOKENS || 1600);
  const budget = Number(env.BAILIAN_TEST_BUDGET_CNY || 0);
  let issue = null;
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(workspace) || workspace === "trial") {
    issue = "Set BAILIAN_WORKSPACE_ID to the dedicated Beijing workspace ID.";
  } else if (env.BAILIAN_REGION && env.BAILIAN_REGION !== "cn-beijing") {
    issue = "This Bailian adapter is configured only for the Beijing access region.";
  } else if (!/^qwen3\.7-flash(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) {
    issue = "This acceptance profile supports qwen3.7-flash and its dated snapshots only.";
  } else if (env.MODEL_API_URL && env.MODEL_API_URL !== endpoint) {
    issue = "MODEL_API_URL must match the selected Beijing workspace endpoint.";
  } else if (env.MODEL_API_STYLE && env.MODEL_API_STYLE !== "chat_completions") {
    issue = "Bailian review uses the chat_completions protocol.";
  } else if (env.MODEL_RESPONSE_FORMAT && env.MODEL_RESPONSE_FORMAT !== "json_object") {
    issue = "This Bailian acceptance profile requires json_object output.";
  } else if (!Number.isInteger(maxOutput) || maxOutput < 1 || maxOutput > 1600) {
    issue = "BAILIAN_MAX_OUTPUT_TOKENS must be an integer from 1 to 1600.";
  } else if (String(env.BAILIAN_ALLOW_PAID_CALLS) !== "true" || !Number.isFinite(budget) || budget <= 0 || budget > 5) {
    issue = "Bailian calls are disabled until a test budget (at most CNY 5) is explicitly authorized.";
  }
  return {
    provider: "aliyun_bailian", apiKey, endpoint, model, style: "chat_completions",
    responseFormat: "json_object", maxOutputTokens: maxOutput,
    requestBytesLimit: REQUEST_BYTES_LIMIT, configurationIssue: issue,
    fallbackToRules: false, disableRuleFallback: true
  };
}

module.exports = { resolveBailianConfig, REQUEST_BYTES_LIMIT, RESERVATION_CNY_PER_ATTEMPT };
