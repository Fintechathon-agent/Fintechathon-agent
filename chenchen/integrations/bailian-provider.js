"use strict";

const MODEL = "qwen3.8-flash";
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
  const dailyBudget = Number(env.BAILIAN_DAILY_BUDGET_CNY || 0);
  let issue = null;
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(workspace) || workspace === "trial") {
    issue = "Set BAILIAN_WORKSPACE_ID to the dedicated Beijing workspace ID.";
  } else if (env.BAILIAN_REGION && env.BAILIAN_REGION !== "cn-beijing") {
    issue = "This Bailian adapter is configured only for the Beijing access region.";
  } else if (!/^(?:qwen3\.8-flash|qwen3\.7-flash(?:-2026-07-15)?)$/.test(model)) {
    issue = "This acceptance profile supports qwen3.8-flash or the verified qwen3.7-flash rollback models only.";
  } else if (env.MODEL_API_URL && env.MODEL_API_URL !== endpoint) {
    issue = "MODEL_API_URL must match the selected Beijing workspace endpoint.";
  } else if (env.MODEL_API_STYLE && env.MODEL_API_STYLE !== "chat_completions") {
    issue = "Bailian review uses the chat_completions protocol.";
  } else if (env.MODEL_RESPONSE_FORMAT && env.MODEL_RESPONSE_FORMAT !== "json_object") {
    issue = "This Bailian acceptance profile requires json_object output.";
  } else if (!Number.isInteger(maxOutput) || maxOutput < 1 || maxOutput > 1600) {
    issue = "BAILIAN_MAX_OUTPUT_TOKENS must be an integer from 1 to 1600.";
  } else if (String(env.BAILIAN_ALLOW_PAID_CALLS) !== "true" || !Number.isFinite(budget) || budget <= 0 || budget > 5 ||
    !Number.isFinite(dailyBudget) || dailyBudget <= 0 || dailyBudget > budget) {
    issue = "Bailian calls require an authorized total budget and daily budget (total at most CNY 5).";
  }
  return {
    provider: "aliyun_bailian", apiKey, endpoint, model, style: "chat_completions",
    responseFormat: "json_object", maxOutputTokens: maxOutput,
    requestBytesLimit: REQUEST_BYTES_LIMIT, configurationIssue: issue,
    fallbackToRules: false, disableRuleFallback: true
  };
}

module.exports = { resolveBailianConfig, REQUEST_BYTES_LIMIT, RESERVATION_CNY_PER_ATTEMPT };
