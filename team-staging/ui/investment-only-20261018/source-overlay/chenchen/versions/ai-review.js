const form = document.querySelector('#ai-review-form');
const input = document.querySelector('#ai-review-text');
const submit = document.querySelector('#ai-review-submit');
const status = document.querySelector('#ai-review-status');
const result = document.querySelector('#ai-review-result');

const errors = {
  MODEL_NOT_CONFIGURED: 'AI 服务尚未配置，请检查本机服务端配置。',
  MODEL_CONFIG_INVALID: 'AI 服务配置不符合当前百炼接入要求，请检查后重启服务。',
  MODEL_AUTH_FAILED: 'AI 服务鉴权失败，请在本机检查密钥、地域和业务空间。',
  MODEL_RATE_LIMITED: '模型服务请求过于频繁，请稍后重试。',
  MODEL_TIMEOUT: 'AI 服务响应超时，请稍后重试。',
  MODEL_INVALID_RESPONSE: 'AI 返回的数据格式不正确，本次结果未采用，请重试。',
  MODEL_MISMATCH: '模型返回的身份与配置不一致，本次结果未采用。',
  LOCAL_RATE_LIMITED: '请求过于频繁，请一分钟后重试。',
  LOCAL_BUSY: '已有 AI 请求正在处理，请稍后重试。',
  LOCAL_ONLY: '真实 AI 解读仅限本机服务使用。',
  INVALID_REVIEW_INPUT: '请输入有效的待解读文本。',
  API_NOT_FOUND: '当前服务未加载 AI 接口，请重启本地后端后刷新。'
};

function showStatus(message, failed = false) {
  status.textContent = message;
  status.dataset.state = failed ? 'error' : 'ready';
  status.setAttribute('role', failed ? 'alert' : 'status');
}

input.addEventListener('input', () => {
  result.hidden = true;
  result.querySelectorAll('[data-ai-output]').forEach(node => { node.textContent = ''; });
  showStatus('文本已改变，请重新请求 AI 解读。');
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled || !input.value.trim()) return;
  submit.disabled = true;
  input.disabled = true;
  form.setAttribute('aria-busy', 'true');
  result.hidden = true;
  submit.textContent = '正在解读…';
  showStatus('正在请求真实模型，请稍候。');
  try {
    const response = await fetch('/api/review', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'news', source: 'xinlan-local-assistant', text: input.value.trim(), context: { execution_allowed: false } }),
      signal: AbortSignal.timeout(35000)
    });
    let data;
    try { data = await response.json(); } catch { throw new Error('MODEL_INVALID_RESPONSE'); }
    if (!response.ok) throw new Error(data.error?.code || 'MODEL_UNAVAILABLE');
    const model = data.model_response;
    const proposal = model?.proposal;
    if (data.source !== 'model' || data.status !== 'PROPOSED' || model?.call_succeeded !== true || model.model !== 'qwen3.8-flash' ||
        data.gateway?.execution_allowed !== false || typeof proposal?.summary !== 'string' || !proposal.summary.trim() ||
        typeof model.raw_text !== 'string' || !model.raw_text.trim() || !Array.isArray(proposal.evidence)) throw new Error('MODEL_INVALID_RESPONSE');
    const raw = JSON.parse(model.raw_text);
    if (raw.summary !== proposal.summary) throw new Error('MODEL_INVALID_RESPONSE');
    document.querySelector('#ai-review-summary').textContent = proposal.summary;
    document.querySelector('#ai-review-reason').textContent = proposal.action_reason;
    document.querySelector('#ai-review-evidence').textContent = proposal.evidence.join('；') || '模型未提供具体证据，请核实来源。';
    document.querySelector('#ai-review-missing').textContent = proposal.missing_information.join('；') || '模型未列出补充项，仍需本人核实。';
    const usage = model.usage;
    const tokens = Number.isFinite(usage?.total_tokens) ? usage.total_tokens + ' tokens' : '用量未返回';
    document.querySelector('#ai-review-meta').textContent = '真实模型回复 · ' + model.model + ' · ' + (model.duration_ms / 1000).toFixed(2) + ' 秒 · ' + tokens;
    document.querySelector('#ai-review-raw').textContent = model.raw_text;
    document.querySelector('#ai-review-trace').textContent = '运行编号：' + data.run_id + '\n审计编号：' + data.audit.audit_id;
    result.hidden = false;
    showStatus('AI 解读已返回。内容需本人核实，未执行任何交易。');
  } catch (error) {
    result.hidden = true;
    const timedOut = ['TimeoutError', 'AbortError'].includes(error.name);
    showStatus(timedOut ? errors.MODEL_TIMEOUT : errors[error.message] || 'AI 服务暂时不可用，请稍后重试。', true);
  } finally {
    submit.disabled = false;
    input.disabled = false;
    submit.textContent = '请求 AI 解读';
    form.removeAttribute('aria-busy');
  }
});
