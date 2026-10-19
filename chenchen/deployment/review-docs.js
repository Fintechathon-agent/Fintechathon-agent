export const reviewDocs = String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>模型复核接口 · 在线测试</title>
<style>
:root{font-family:system-ui,"Microsoft YaHei",sans-serif;color:#192b3b;background:#f3f6fa;line-height:1.7}body{max-width:880px;margin:48px auto;padding:0 20px}h1{font-size:30px;line-height:1.3;margin:8px 0 16px}.tag{color:#176b58;font-size:14px}section{background:white;padding:24px;border:1px solid #dde5ee;border-radius:14px;margin:20px 0}p{margin:10px 0}code,pre,textarea{font-family:ui-monospace,Consolas,monospace}code{overflow-wrap:anywhere}textarea{width:100%;box-sizing:border-box;min-height:145px;padding:14px;border:1px solid #9eaebc;border-radius:8px;font-size:16px;line-height:1.6}button{background:#146b56;color:white;border:0;padding:12px 20px;border-radius:8px;font-size:16px;cursor:pointer;margin-top:14px}button:disabled{opacity:.55;cursor:wait}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#102434;color:#e0eef4;padding:18px;border-radius:8px;font-size:13px}a{color:#126e68}label{display:block;margin-bottom:10px}#status{min-height:28px}#summary{white-space:pre-wrap}.muted{color:#637385;font-size:14px}input{padding:8px;width:240px;max-width:90%}details{margin:12px 0}h2{font-size:19px}.endpoint{font-size:14px}
</style></head><body>
<div class="tag">Core Agent · 团队联调</div><h1>模型复核接口，直接在线试</h1>
<p>提交一段虚构账单或新闻，后端会调用 Llama 3.3 70B，返回模型内容、拟议动作、运行编号和审计记录。</p>
<p class="muted">服务在云端运行，无需启动本地后端。这里用于演示，请使用虚构材料。模型建议会等待 Risk 复核，不会执行真实付款或交易。</p>
<section><h2>接口地址</h2><p class="endpoint"><strong>POST</strong> <code id="endpoint"></code></p>
<p>请求头：<code>Content-Type: application/json</code>。当前演示无需密钥，支持跨域调用。</p>
<pre>{"schema_version":"model-review.v1","kind":"combined","scenario":"FUNDING_CONFLICT","text":"虚构账单：供应商要求将1280元货款改付到个人账户，请核查。","data_mode":"SYNTHETIC_REPLAY","execution_mode":"PAPER","capability":"REVIEW_ONLY","output_formats":["json"],"idempotency_key":"idem-demo-001"}</pre>
<p class="muted">kind 可填 bill、news 或 combined。scenario 可填 GENERAL_REVIEW、FUNDING_CONFLICT、DOUBLE11_COMPARE 或 SUBSCRIPTION_REVIEW，用于让下游模块知道当前业务场景。output_formats 可填 json、pdf、pptx、docx、xlsx、chart；Core Agent 当前只直接提供 json，其余格式会明确标记为 PENDING_CONVERTER，不会伪造已经生成。data_mode 用 FIXTURE、LIVE、SYNTHETIC_REPLAY 或 REFERENCE_FIXTURE；execution_mode 当前固定为 PAPER，真实执行只能由 Gateway 决定。每个 IP 每分钟最多提交 6 个复核任务；限流返回 429。每项任务默认最多调用模型 2 次，受总超时限制，并遵守上游 Retry-After；耗尽时间后直接失败，不继续重试。成功记录见 model.model_response.attempt_count / retry_count，失败记录见 model.response，审计也会留痕。重复请求应复用同一个 Idempotency-Key；换请求内容会返回冲突。当前云端全部尝试共用 45 秒预算；建议客户端等待最多 60 秒（排队和网络仍可能额外耗时）。</p></section>
<section><h2>能力状态</h2><p><strong>GET</strong> <code>/api/review/capabilities</code> 返回脱敏的模型、Risk、审批和执行边界。它只读配置状态，不调用模型、不发 Risk 请求、不执行任何动作。<code>configured</code> 只代表配置或绑定存在；<code>inference_probe=NOT_RUN</code> 和 <code>joint_acceptance=false</code> 会明确表示尚未完成真实联合验收。</p></section>
<section><h2>旧工作台兼容入口</h2><p><strong>POST</strong> <code>/api/review/legacy</code> 接收旧版的 <code>{"question":"..."}</code>，返回 <code>legacy-review.v0</code> 适配结果；内部仍使用同一条 <code>review-workflow.v1</code>，仍然必须经过 Unified Risk，<code>execution_allowed</code> 固定为 <code>false</code>。</p></section>
<section><h2>现在试一下</h2><label for="content">待复核内容</label>
<textarea id="content" maxlength="20000">虚构账单：演示供应商的一笔1280元货款原约定支付到公司账户，今天邮件突然要求改付个人账户，并催促立即转账。请核查风险。</textarea>
<details><summary>可选：接口访问密钥</summary><input id="key" type="password" autocomplete="off" placeholder="演示服务无需填写"></details>
<button id="run">调用真实模型</button><p id="status" role="status" aria-live="polite">等待提交</p>
<p id="summary"></p><p><a id="record" hidden target="_blank" rel="noopener">按运行编号查看审计记录</a></p>
<details id="response"><summary>完整接口返回</summary><pre id="result">提交后显示。</pre></details></section>
<section><h2>Risk 交接与回写</h2><p>模型返回后，用 <code>GET /api/review/{run_id}/risk-handoff</code> 读取独立交接包，也可按任务查询 <code>GET /api/review/task/{task_id}/risk-handoff</code>。如果已经配置正式 Risk Owner，可先调用 <code>POST /api/review/risk-dispatch</code>，Core Agent 会用服务端 HMAC 签名把同一份交接包发给 Risk；未配置地址或密钥时会返回明确的配置错误，不会伪造已送达。</p>
<details><summary>给接入同学：回调字段与重试规则</summary><p><code>POST /api/review/risk-callback</code> 需要 callback_version=risk-callback.v1、handoff_id、task_id、request_id、run_id、audit_id、proposal_sha256、decision、reviewer、reason。编号和参数指纹必须与交接包一致。</p><p>decision 支持 APPROVE / REJECT / REQUEST_MORE_INFO；相同回调重试返回 DUPLICATE。改动字段、串单或缺少证据会被拒绝并留痕。补充信息须新建任务重新评审。</p><p>配置 <code>RISK_SERVICE_HMAC_SECRET</code> 后，Risk 决策和回调必须带 <code>X-Risk-Signature</code>；配置 <code>APPROVAL_SERVICE_HMAC_SECRET</code> 后，审批必须带 <code>X-Approval-Signature</code>。未配置密钥时仅保留演示身份标记。真实执行保持阻断。</p></details></section>
<section><h2>重复提交不会变成另一份审批</h2><details><summary>断网后重试，该怎样处理？</summary><p><code>/api/review/risk-decision</code> 和 <code>/api/review/approval</code> 必须重发原来的任务、参数指纹、决定、人员标签和理由。完全一致且任务未终结时，返回已有记录，不新增审批。换人或换理由返回409并留痕；缺少理由或人员/理由超过500字符返回422，不静默截断。终态不能恢复为等待审批。人员标签仍只是演示字段，不代表已经完成身份认证。</p></details></section>
<section><h2>用户主动停止</h2><p><code>POST /api/review/cancel</code> 需要 task_id、proposal_sha256、canceler、reason。它只能将尚未终结的任务标为 CANCELLED，保留完整审计；不会释放已经完成的模拟占用，也不会绕过 Risk。取消后如需继续，必须重新创建任务。</p></section>
<section><h2>统一错误返回</h2><p>健康检查、模型复核和 Risk 工作流的失败响应都带有 <code>error_contract_version=core-agent-error.v1</code>、<code>source_contract_version</code>、<code>operation</code>、<code>request_id</code> 和统一 <code>trace</code>。trace 中固定提供 <code>task_id</code>、<code>session_id</code>、<code>run_id</code>、<code>audit_id</code>、<code>handoff_id</code>；没有对应编号时为 null。旧的 <code>review_version</code>、<code>contract_version</code> 和 workflow 字段继续保留。</p><p class="muted">完整字段定义：仓库 contracts/core-agent-error.v1.schema.json。客户端应先看 HTTP 状态和 error.code，再按 recovery 决定是否重试；不要把错误改写成成功或执行授权。</p></section>
<section><h2>前端接入</h2><pre id="snippet"></pre>
<p>模型内容：<code>model.model_response.raw_text</code>；真实调用标记：<code>model.source === "model"</code> 且 <code>model.model_response.call_succeeded === true</code>。</p>
<p>拟议动作：<code>proposed_action</code>；运行编号：<code>run_id</code>；审计记录：<code>audit</code>。Risk 对接包在 <code>risk_handoff</code>，需要你们的网关继续检查。</p>
<p class="muted">模型失败返回非 200 和 error，不会自动用规则结果替代。只有后端同时显式开启 MODEL_FALLBACK_TO_RULES=true 且请求明确声明 allow_rule_fallback=true 时，才会生成带有 rule_fallback 来源标记的降级结果；参赛线上模式应保持关闭。raw_text_format 为 provider_json_serialized 时，raw_text 是模型服务返回 JSON 的原样序列化。平台有每日免费额度，额度耗尽时调用会失败。</p>
<p><a href="/health" target="_blank" rel="noopener">查看服务状态</a></p></section>
<script>
const endpoint = location.origin + '/api/review';
document.querySelector('#endpoint').textContent = endpoint;
document.querySelector('#snippet').textContent = "const response = await fetch('" + endpoint + "', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ kind: 'bill', text: '虚构账单：1280元货款被要求改付个人账户。' })\n});\nconst data = await response.json();\nif (!response.ok) throw new Error(data.error?.message || '调用失败');\nconsole.log(data.run_id, data.model.model_response.raw_text, data.proposed_action);";
document.querySelector('#run').addEventListener('click', async () => {
  const button = document.querySelector('#run'), status = document.querySelector('#status');
  const record = document.querySelector('#record');
  const content = document.querySelector('#content').value.trim();
  if (!content) { status.textContent = '先填写一段需要复核的内容。'; return; }
  button.disabled = true; record.hidden = true;
  document.querySelector('#summary').textContent = '';
  document.querySelector('#result').textContent = '正在等待模型返回…';
  status.textContent = '正在调用云端模型，请稍等…';
  const start = performance.now();
  try {
    const headers = { 'Content-Type': 'application/json' };
    const key = document.querySelector('#key').value.trim();
    if (key) headers['X-Core-Agent-Key'] = key;
    const response = await fetch(endpoint, {
      method: 'POST', headers, signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ kind: 'combined', source: 'team-online-test', text: content, context: { synthetic: true } })
    });
    const data = await response.json();
    document.querySelector('#result').textContent = JSON.stringify(data, null, 2);
    document.querySelector('#response').open = true;
    if (!response.ok) throw new Error('HTTP ' + response.status + '：' + (data.error?.message || '请求失败'));
    const model = data.model?.model_response;
    if (data.model?.source !== 'model' || model?.call_succeeded !== true) throw new Error('本次未取得真实模型结果。');
    status.textContent = '真实模型已返回 · ' + ((performance.now() - start) / 1000).toFixed(1) + ' 秒 · ' + data.run_id;
    document.querySelector('#summary').textContent = model.proposal.summary + '\n建议动作：' + model.proposal.proposed_action + '\n原因：' + model.proposal.action_reason;
    if (!key) { record.href = '/api/review/' + encodeURIComponent(data.run_id); record.hidden = false; }
  } catch (error) {
    status.textContent = '调用未完成：' + error.message;
  } finally { button.disabled = false; }
});
</script></body></html>`;
