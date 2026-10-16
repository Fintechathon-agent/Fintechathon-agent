"use strict";

const { ReviewError } = require("./model-review");

const OWNER_FIELDS = Object.freeze({
  risk: { actor: "reviewer", url: "RISK_SERVICE_URL", secret: ["RISK_SERVICE_HMAC_SECRET", "RISK_HMAC_SECRET"], signature: "X-Risk-Signature" },
  approval: { actor: "approver", url: "APPROVAL_SERVICE_URL", secret: ["APPROVAL_SERVICE_HMAC_SECRET", "APPROVAL_HMAC_SECRET"], signature: "X-Approval-Signature" }
});
const ADAPTER_VERSION = "owner-bridge.v1";
const MAX_RESPONSE_CHARS = 4000;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function webCrypto() {
  if (globalThis.crypto?.subtle) return globalThis.crypto;
  return require("node:crypto").webcrypto;
}

async function hmacHex(value, secret) {
  const crypto = webCrypto();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(typeof value === "string" ? value : canonicalJson(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function signatureFor(value, secret) {
  return "sha256=" + await hmacHex(value, secret);
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  return headers[name.toLowerCase()] || headers[name] || null;
}

function envValue(env, key) {
  const value = env?.[key];
  return typeof value === "string" ? value.trim() : value ? String(value).trim() : "";
}

function ownerSecret(owner, env) {
  return (OWNER_FIELDS[owner]?.secret || []).map(key => envValue(env, key)).find(Boolean) || "";
}

function ownerUrl(owner, env) {
  return envValue(env, OWNER_FIELDS[owner]?.url);
}

function bridgeError(code, message, { statusCode = 503, retryable = false, stage = "OWNER_INTEGRATION", recovery = "检查对应 Owner 的地址、签名密钥和联调状态。", details = null } = {}) {
  return new ReviewError(code, message, { statusCode, retryable, stage, recovery, details });
}

async function verifyOwnerRequest({ owner, body, headers, env }) {
  const definition = OWNER_FIELDS[owner];
  if (!definition) throw bridgeError("UNKNOWN_OWNER", "未定义的 Owner 类型。", { statusCode: 500 });
  const secret = ownerSecret(owner, env);
  const actor = typeof body?.[definition.actor] === "string" ? body[definition.actor].trim() : null;
  if (!secret) {
    if (envValue(env, "REQUIRE_TRUSTED_ACTORS").toLowerCase() === "true") {
      throw bridgeError("OWNER_AUTH_NOT_CONFIGURED", `${owner} 的可信身份验证尚未配置。`, { recovery: "配置对应 HMAC secret 后再启用 REQUIRE_TRUSTED_ACTORS。" });
    }
    return { owner, actor, mode: "DEMO_UNVERIFIED", verified: false, signature_header: definition.signature };
  }
  const supplied = headerValue(headers, definition.signature) || "";
  if (!supplied) throw bridgeError("OWNER_AUTH_REQUIRED", `${owner} 回写缺少签名。`, { statusCode: 401, stage: "AUTHENTICATION", recovery: `使用 ${definition.signature} 携带 sha256 HMAC 签名后重试。` });
  const expected = await signatureFor(body, secret);
  if (supplied.trim().toLowerCase() !== expected) {
    throw bridgeError("OWNER_AUTH_INVALID", `${owner} 回写签名无效。`, { statusCode: 401, stage: "AUTHENTICATION", recovery: "重新读取当前 Handoff，使用相同请求正文生成签名。" });
  }
  return { owner, actor, mode: "HMAC_SHA256", verified: true, signature_header: definition.signature };
}

function buildRiskDispatchEnvelope(handoff) {
  return {
    adapter_version: ADAPTER_VERSION,
    contract_version: "risk-handoff.v1",
    operation: "RISK_HANDOFF",
    sent_at: new Date().toISOString(),
    trace: clone(handoff.trace),
    handoff: clone(handoff)
  };
}

async function postSignedJson({ owner, url, secret, body, fetchImpl = globalThis.fetch, timeoutMs = 12000, allowInsecure = false }) {
  if (!url || !secret) throw bridgeError(`${owner.toUpperCase()}_OWNER_NOT_CONFIGURED`, `${owner} 服务地址或签名密钥尚未配置。`, { recovery: `配置 ${owner.toUpperCase()}_SERVICE_URL 和对应 HMAC secret 后再联调。` });
  let parsed;
  try { parsed = new URL(url); } catch { throw bridgeError("OWNER_URL_INVALID", `${owner} 服务地址不是有效 URL。`, { statusCode: 500, recovery: "使用完整的 HTTPS 服务地址。" }); }
  if (parsed.protocol !== "https:" && !allowInsecure) throw bridgeError("OWNER_URL_INSECURE", `${owner} 服务地址必须使用 HTTPS。`, { statusCode: 500, recovery: "使用 HTTPS 地址；仅在本地替身测试时显式开启 ALLOW_INSECURE_OWNER_URL=true。" });
  if (typeof fetchImpl !== "function") throw bridgeError("OWNER_HTTP_UNAVAILABLE", "当前运行环境没有可用的 HTTP 客户端。", { statusCode: 503 });
  const bodyText = canonicalJson(body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 12000));
  let response;
  try {
    response = await fetchImpl(parsed.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Core-Agent-Adapter": ADAPTER_VERSION,
        "X-Core-Agent-Contract": "risk-handoff.v1",
        "X-Core-Agent-Signature": await signatureFor(bodyText, secret),
        "X-Core-Agent-Trace": body.trace?.task_id || "unknown"
      },
      body: bodyText,
      signal: controller.signal
    });
  } catch (error) {
    throw bridgeError("OWNER_SERVICE_UNAVAILABLE", `${owner} 服务暂时不可达。`, { retryable: true, details: { cause: error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR" } });
  } finally {
    clearTimeout(timer);
  }
  const responseText = (await response.text()).slice(0, MAX_RESPONSE_CHARS);
  let responseBody = null;
  try { responseBody = responseText ? JSON.parse(responseText) : null; } catch { responseBody = { raw_text: responseText }; }
  if (!response.ok) {
    throw bridgeError("OWNER_SERVICE_REJECTED", `${owner} 服务拒绝了 Risk Handoff。`, { statusCode: 502, retryable: response.status >= 500, details: { upstream_status: response.status, response: responseBody } });
  }
  return { accepted: true, upstream_status: response.status, response: responseBody };
}

async function dispatchRiskHandoff(handoff, env, options = {}) {
  const envelope = buildRiskDispatchEnvelope(handoff);
  return postSignedJson({
    owner: "risk",
    url: ownerUrl("risk", env),
    secret: ownerSecret("risk", env),
    body: envelope,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs || envValue(env, "RISK_SERVICE_TIMEOUT_MS") || 12000,
    allowInsecure: envValue(env, "ALLOW_INSECURE_OWNER_URL").toLowerCase() === "true"
  });
}

module.exports = { ADAPTER_VERSION, OWNER_FIELDS, canonicalize, canonicalJson, hmacHex, signatureFor, verifyOwnerRequest, buildRiskDispatchEnvelope, dispatchRiskHandoff, bridgeError };
