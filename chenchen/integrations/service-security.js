"use strict";

const modelReview = require("./model-review");

function value(env, key) {
  return typeof env?.[key] === "string" ? env[key].trim() : "";
}

function strictActorsRequired(env) {
  return value(env, "REQUIRE_TRUSTED_ACTORS").toLowerCase() === "true";
}

function riskReviewerRequired(env) {
  return value(env, "REQUIRE_RISK_REVIEWER").toLowerCase() === "true";
}

function header(headers, name) {
  return typeof headers?.get === "function" ? headers.get(name) : headers?.[name.toLowerCase()] || headers?.[name];
}

function verifyCoreRequest(headers, env = {}) {
  const expected = value(env, "CORE_AGENT_API_KEY");
  if (!expected && (strictActorsRequired(env) || riskReviewerRequired(env))) {
    throw new modelReview.ReviewError("CORE_AUTH_NOT_CONFIGURED", "严格模式的机器访问身份尚未配置。", {
      statusCode: 503, stage: "AUTHENTICATION", recovery: "在双方服务端配置相同的 CORE_AGENT_API_KEY；不要放入浏览器。"
    });
  }
  const bailian = ["bailian", "aliyun_bailian"].includes(value(env, "MODEL_PROVIDER").toLowerCase());
  if ((!expected && !bailian) || (expected && header(headers, "X-Core-Agent-Key") === expected)) return;
  throw new modelReview.ReviewError("AUTHENTICATION_REQUIRED", "API authentication is required", {
    statusCode: 401, stage: "AUTHENTICATION", recovery: "Use the server-side X-Core-Agent-Key through your backend proxy."
  });
}

function riskCallbackReadiness(env = {}) {
  const apiKeyConfigured = Boolean(value(env, "CORE_AGENT_API_KEY"));
  const signatureConfigured = Boolean(value(env, "RISK_SERVICE_HMAC_SECRET") || value(env, "RISK_HMAC_SECRET"));
  const reviewer = value(env, "RISK_REVIEWER_ID");
  const reviewerConfigured = Boolean(reviewer && reviewer.length <= 500);
  const strict = strictActorsRequired(env);
  const fixedReviewerRequired = riskReviewerRequired(env);
  const blockers = [
    ...(!apiKeyConfigured ? ["CORE_AGENT_API_KEY_MISSING"] : []),
    ...(!signatureConfigured ? ["RISK_SIGNATURE_MISSING"] : []),
    ...(!reviewerConfigured ? ["RISK_REVIEWER_MISSING_OR_INVALID"] : []),
    ...(!strict ? ["STRICT_ACTORS_DISABLED"] : []),
    ...(!fixedReviewerRequired ? ["FIXED_RISK_REVIEWER_ENFORCEMENT_DISABLED"] : [])
  ];
  return {
    scope: "CORE_CONFIGURATION_ONLY", api_key_configured: apiKeyConfigured,
    signature_configured: signatureConfigured, reviewer_configured: reviewerConfigured,
    strict_actors_required: strict, fixed_risk_reviewer_required: fixedReviewerRequired,
    callback_ready: blockers.length === 0, blockers,
    peer_configuration_verified: false, inference_probe: "NOT_RUN", joint_acceptance: false,
    execution_allowed: false
  };
}

function capabilityStatus(env = {}) {
  const config = modelReview.resolveModelConfig(env);
  const workersAi = config.style === "workers_ai";
  const modelConfigured = workersAi ? typeof env.AI?.run === "function" : Boolean(config.apiKey && config.model && !config.configurationIssue);
  const ready = riskCallbackReadiness(env);
  const riskUrlConfigured = Boolean(value(env, "RISK_SERVICE_URL"));
  const approvalSecretConfigured = Boolean(value(env, "APPROVAL_SERVICE_HMAC_SECRET") || value(env, "APPROVAL_HMAC_SECRET"));
  return {
    capability_version: "core-agent-capabilities.v1", service: "core-agent", contract_version: modelReview.REVIEW_VERSION,
    authentication: { api_key_configured: ready.api_key_configured, strict_actors_required: ready.strict_actors_required,
      fixed_risk_reviewer_required: ready.fixed_risk_reviewer_required },
    model: {
      provider: String(config.provider || "").toLowerCase(), name: config.model || null,
      configured: modelConfigured, inference_probe: "NOT_RUN",
      response_id_sources: ["body.id", "body.response_id", "header.x-request-id", "header.x-correlation-id"], paid_calls_this_check: 0
    },
    risk: {
      handoff_contract: "risk-handoff.v1", dispatch_url_configured: riskUrlConfigured,
      dispatch_signature_configured: ready.signature_configured, dispatch_ready: riskUrlConfigured && ready.signature_configured,
      callback_signature_configured: ready.signature_configured, reviewer_configured: ready.reviewer_configured,
      callback_ready: ready.callback_ready, callback_blockers: ready.blockers
    },
    approval: {
      decision_endpoint: "/api/review/approval", signature_configured: approvalSecretConfigured,
      trusted_identity_ready: approvalSecretConfigured,
      demo_actor_labels_allowed: !approvalSecretConfigured && !ready.strict_actors_required
    },
    execution: { mode: "PAPER", allowed: false, gateway_connected: false },
    acceptance: { synthetic_local: true, real_model: false, formal_risk_callback: false, joint_acceptance: false }
  };
}

module.exports = { verifyCoreRequest, strictActorsRequired, riskReviewerRequired, riskCallbackReadiness, capabilityStatus };
