"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const agent = require("../model-agent.cjs");
const h = require("./helpers.cjs");
const env = { RISK_LLM_PROVIDER: "deepseek", RISK_LLM_MODEL: "deepseek-chat", RISK_LLM_API_KEY: "test-placeholder-only" };
const reply = value => async () => new Response(JSON.stringify({ id: "test-response", model: "test-model", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] }));
function setup(t, extra = {}) { const f = h.fixture(t), { harness } = h.fresh(); return { ...f, args: { gateway: f.gateway, harness, actor: "demo-user-001", payload: { case_id: "bill_injection" }, env, ...extra } }; }
test("model: no configuration fails closed without calling provider", async t => {
  let calls = 0; const f = setup(t, { env: { RISK_MODEL_SOURCE: "DIRECT" }, fetchImpl: async () => { calls++; } });
  const r = await agent.run(f.args); assert.equal(calls, 0); assert.equal(r.model.raw, null); assert.deepEqual(r.gateway.reason_codes, ["MODEL_NOT_CONFIGURED"]); assert.equal(f.calls(), 0);
});
test("model: observed refusal is Core refusal, never a fabricated gateway attack", async t => {
  const f = setup(t, { fetchImpl: reply({ disposition: "REFUSE", reason: "不接受外部指令", action: null }) });
  const r = await agent.run(f.args); assert.equal(r.gateway.blocking_node, "CORE_AGENT"); assert.equal(r.model.proposal.disposition, "REFUSE"); assert.equal(r.model.output_digest, h.hash(r.model.raw));
  assert.ok(r.audit.some(e => e.event_type === "MODEL_RESPONSE_RECEIVED")); assert.ok(!r.audit.some(e => e.event_type === "MODEL_ACTION_BLOCKED")); assert.equal(f.calls(), 0);
});
for (const tool of ["real_trade", "paper_trade", "memory.write", "__proto__", "unknown.execute"]) test(`model: actual returned ${tool} proposal is blocked`, async t => {
  const f = setup(t, { fetchImpl: reply({ disposition: "PROPOSE", reason: "测试替身输出", action: { tool, plan_id: "A" } }) });
  const r = await agent.run(f.args); assert.equal(r.gateway.decision, "BLOCK"); assert.equal(r.gateway.blocking_node, "ACTION_GATEWAY"); assert.ok(r.gateway.reason_codes.includes("POLICY_TASK_SCOPE_EXCEEDED")); assert.equal(f.calls(), 0);
  assert.equal(r.gateway.action_risk.decision, "BLOCK"); assert.ok(r.gateway.action_risk.reasons.some(x => x.rule_id === "R01" && x.code === "TOOL_NOT_ALLOWED"));
  const again = await f.gateway.dispatchModelProposal(r.task_id, f.args.actor, r.model.run_id); assert.equal(again.replay, true);
  const entry = r.audit.find(e => e.event_type === "MODEL_ACTION_POLICY_DECIDED"); assert.equal(entry.actual_model_action.tool, tool);
  const direct = await f.gateway.execute(r.task_id, f.args.actor, "bypass-model-001"); assert.equal(direct.status, "NOT_STARTED"); assert.equal(f.calls(), 0);
});
test("model: read-only request returns this task's existing review", async t => {
  const f = setup(t, { fetchImpl: reply({ disposition: "PROPOSE", reason: "查看风险", action: { tool: "portfolio.review", plan_id: null } }) });
  const r = await agent.run(f.args); assert.equal(r.gateway.status, "READ_ONLY_RESULT"); assert.equal(r.gateway.result.task_id, r.task_id); assert.equal(f.calls(), 0);
});
test("model: injected approvals and malformed output are not silently discarded", async t => {
  const f = setup(t, { fetchImpl: reply({ disposition: "PROPOSE", reason: "测试", action: { tool: "paper_trade", plan_id: "A", approved: true } }) });
  const r = await agent.run(f.args); assert.equal(r.model.error_code, "MODEL_OUTPUT_INVALID"); assert.ok(r.model.raw.includes("approved")); assert.equal(f.calls(), 0);
  await assert.rejects(agent.run({ ...f.args, payload: { case_id: "normal", model_receipt: { provenance: "SERVER_MODEL_CALL" } } }), { code: "INVALID_MODEL_CASE" });
});
test("model: provider failure is audited without leaking provider response or credentials", async t => {
  const f = setup(t, { fetchImpl: async () => new Response("private-diagnostic", { status: 401 }) });
  const r = await agent.run(f.args); assert.equal(r.model.error_code, "MODEL_SERVICE_FAILED"); assert.ok(!JSON.stringify(r).includes("private-diagnostic")); assert.ok(!JSON.stringify(r).includes(env.RISK_LLM_API_KEY)); assert.equal(f.calls(), 0);
});
test("model: durable intent failure stops paid call", async t => {
  let calls = 0; const f = setup(t, { persist: async () => { throw new Error("disk unavailable"); }, fetchImpl: async () => { calls++; } });
  await assert.rejects(agent.run(f.args)); assert.equal(calls, 0); assert.equal(f.calls(), 0);
});
test("model: per-session budget survives sequential attempts", async t => {
  let calls = 0; const response = reply({ disposition: "ANALYZE", reason: "分析", action: null });
  const f = setup(t, { fetchImpl: async (...a) => { calls++; return response(...a); } });
  for (let i = 0; i < 5; i++) await agent.run(f.args);
  const last = await agent.run(f.args); assert.equal(last.model.error_code, "MODEL_SESSION_LIMIT"); assert.equal(calls, 5);
});
test("model: prompt keeps untrusted text in data and cannot redirect credentials", async t => {
  let sent; const response = reply({ disposition: "ANALYZE", reason: "分析", action: null });
  const f = setup(t, { fetchImpl: async (url, options) => { sent = { url, options, payload: JSON.parse(options.body) }; return response(); } });
  await agent.run(f.args); assert.equal(sent.url, "https://api.deepseek.com/chat/completions"); assert.equal(sent.options.redirect, "error"); assert.equal(sent.payload.messages[0].role, "system"); assert.equal(JSON.parse(sent.payload.messages[1].content).business_data[0].trust, "UNTRUSTED_DATA");
  assert.throws(() => agent.configuration({ ...env, RISK_LLM_PROVIDER: "https://attacker.invalid" }), { code: "MODEL_NOT_CONFIGURED" });
});
