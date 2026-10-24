"use strict";

const modelReview = require("./model-review");

const messages = {
  MODEL_NOT_CONFIGURED: "AI 服务尚未配置，请检查本机服务端配置。",
  MODEL_CONFIG_INVALID: "AI 服务配置不符合当前百炼接入要求，请检查后重启服务。",
  MODEL_AUTH_FAILED: "AI 服务鉴权失败，请在本机检查密钥、地域和业务空间。",
  MODEL_RATE_LIMITED: "模型服务请求过于频繁，请稍后重试。",
  MODEL_TIMEOUT: "AI 服务响应超时，请稍后重试。",
  MODEL_INVALID_RESPONSE: "AI 返回的数据格式不正确，本次结果未采用，请重试。",
  MODEL_UNAVAILABLE: "AI 服务暂时不可用，请稍后重试。",
  MODEL_MISMATCH: "模型返回的身份与配置不一致，本次结果未采用。",
  INVALID_REVIEW_INPUT: "请输入 1 至 20000 字的待解读文本，使用新闻或综合解读类型。",
  LOCAL_RATE_LIMITED: "请求过于频繁，请一分钟后重试。",
  LOCAL_BUSY: "已有 AI 请求正在处理，请稍后重试。",
  LOCAL_ONLY: "真实 AI 解读仅限本机服务使用。",
  METHOD_NOT_ALLOWED: "此接口仅接受 POST 请求。"
};

function failure(code, status, runId = null) {
  return { status, body: { review_version: modelReview.REVIEW_VERSION, source: "model", status: "FAILED", run_id: runId,
    error: { code, message: messages[code] || messages.MODEL_UNAVAILABLE }, execution_allowed: false } };
}

function validateConfig(env) {
  if (!env.MODEL_API_KEY?.trim()) throw new Error("MODEL_NOT_CONFIGURED");
  let endpoint;
  try { endpoint = new URL(env.MODEL_API_URL); } catch { throw new Error("MODEL_CONFIG_INVALID"); }
  if (endpoint.protocol !== "https:" || !/^[a-zA-Z0-9-]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(endpoint.hostname) ||
      endpoint.pathname !== "/compatible-mode/v1/chat/completions" || endpoint.search || endpoint.hash || endpoint.username || endpoint.password ||
      env.MODEL_NAME !== "qwen3.8-flash" || env.MODEL_PROVIDER !== "http" || env.MODEL_API_STYLE !== "chat_completions" ||
      env.MODEL_RESPONSE_FORMAT !== "json_object" || env.MODEL_TIMEOUT_MS !== "30000" ||
      env.MODEL_FALLBACK_TO_RULES !== "false" || env.MODEL_DISABLE_RULE_FALLBACK !== "true") throw new Error("MODEL_CONFIG_INVALID");
}

function validateProviderPayload(payload, env) {
  if (payload.model !== env.MODEL_NAME) throw new Error("MODEL_MISMATCH");
  let proposal;
  try { proposal = JSON.parse(payload.choices?.[0]?.message?.content); } catch { throw new Error("MODEL_INVALID_RESPONSE"); }
  const fields = ["summary", "risk_level", "proposed_action", "action_reason", "missing_information", "evidence"];
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal) || Object.keys(proposal).length !== fields.length ||
      !fields.every(key => Object.hasOwn(proposal, key)) || !["low", "medium", "high", "unknown"].includes(proposal.risk_level) ||
      !modelReview.ACTIONS.includes(proposal.proposed_action) ||
      ![proposal.summary, proposal.action_reason].every(value => typeof value === "string" && value.trim() && value.length <= 4000) ||
      ![proposal.missing_information, proposal.evidence].every(value => Array.isArray(value) && value.length <= 10 && value.every(item => typeof item === "string" && item.trim() && item.length <= 4000))) {
    throw new Error("MODEL_INVALID_RESPONSE");
  }
}

function createReviewService({ env = process.env, fetchImpl = globalThis.fetch, limit = 5 } = {}) {
  let active = false;
  let starts = [];
  const records = new Map();
  return {
    records,
    async run(input) {
      const started = Date.now();
      let normalized;
      try {
        normalized = modelReview.normalizeReviewInput(input);
        if (!["news", "combined"].includes(normalized.kind)) throw new Error("INVALID_REVIEW_INPUT");
      } catch { return failure("INVALID_REVIEW_INPUT", 422); }
      try { validateConfig(env); } catch (error) { return failure(error.message, 503); }
      starts = starts.filter(time => started - time < 60000);
      if (active) return failure("LOCAL_BUSY", 429);
      if (starts.length >= limit) return failure("LOCAL_RATE_LIMITED", 429);
      starts.push(started);
      active = true;
      try {
        const record = await modelReview.runReview({ ...normalized, allow_rule_fallback: false }, {
          ...env, MODEL_DISABLE_RULE_FALLBACK: "true", MODEL_FALLBACK_TO_RULES: "false"
        }, { fetchImpl: async (url, options) => {
          const body = JSON.parse(options.body);
          body.stream = false;
          body.max_tokens = 1600;
          // JSON Object mode guarantees syntax, so send the contract explicitly as well.
          body.messages[0].content += " Required JSON schema: " + JSON.stringify(modelReview.REVIEW_SCHEMA);
          let response;
          try {
            response = await fetchImpl(url, { ...options, body: JSON.stringify(body), redirect: "error" });
          } catch (error) {
            if (error.name === "AbortError" || error.name === "TimeoutError" || options.signal.aborted) throw new modelReview.ReviewError("MODEL_TIMEOUT", "timeout");
            throw error;
          }
          if (response.ok) {
            let payload;
            try { payload = await response.clone().json(); } catch {
              throw new modelReview.ReviewError(options.signal.aborted ? "MODEL_TIMEOUT" : "MODEL_INVALID_RESPONSE", "invalid provider response");
            }
            try { validateProviderPayload(payload, env); } catch (error) { throw new modelReview.ReviewError(error.message, "invalid model response"); }
          }
          return response;
        } });
        // Keep the existing review contract, but never expose credentials or the workspace endpoint.
        delete record.model_response.endpoint;
        record.model_response.duration_ms = Date.now() - started;
        const safe = JSON.parse(JSON.stringify(record).replaceAll(JSON.stringify(env.MODEL_API_KEY.trim()).slice(1, -1), "[REDACTED]")
          .replaceAll(JSON.stringify(env.MODEL_API_URL.trim()).slice(1, -1), "[REDACTED_ENDPOINT]"));
        if (records.size >= 100) records.delete(records.keys().next().value);
        records.set(safe.run_id, safe);
        return { status: 200, body: safe };
      } catch (error) {
        const status = error.details?.status;
        let code = Object.hasOwn(messages, error.code) ? error.code : "MODEL_UNAVAILABLE";
        if (status === 401 || status === 403) code = "MODEL_AUTH_FAILED";
        if (status === 429) code = "MODEL_RATE_LIMITED";
        if (["MODEL_PROVIDER_INVALID_JSON", "MODEL_EMPTY_RESPONSE", "MODEL_UNSAFE_ACTION"].includes(error.code)) code = "MODEL_INVALID_RESPONSE";
        const result = failure(code, code === "MODEL_TIMEOUT" ? 504 : code === "MODEL_RATE_LIMITED" ? 503 : 502, error.runId || null);
        if (error.reviewRecord) {
          if (records.size >= 100) records.delete(records.keys().next().value);
          records.set(error.runId, { ...result.body, audit: error.reviewRecord.audit, gateway: error.reviewRecord.gateway });
        }
        return result;
      } finally { active = false; }
    }
  };
}

module.exports = { createReviewService, failure, validateConfig };
