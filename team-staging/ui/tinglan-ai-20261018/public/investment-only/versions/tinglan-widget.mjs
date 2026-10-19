import { buildInput, analyze, messages } from './tinglan-client.mjs';
const form = document.querySelector('#tinglan-form'), status = document.querySelector('#tinglan-status'), output = document.querySelector('#tinglan-result');
const button = form.querySelector('button[type=submit]');
let config = null, pending = null;
const show = (text, failed = false) => { status.textContent = text; status.setAttribute('role', failed ? 'alert' : 'status'); };
try {
  const response = await window.tinglanFetch(new URL('../tinglan-config.json', import.meta.url), { cache: 'no-store' });
  if (response.ok) config = await response.json();
} catch { /* An unavailable configuration must not trigger model traffic. */ }
if (!config?.endpoint) show('Demo 预览 · ' + messages.UNCONFIGURED);
else show('Live AI 待验证 · 提交后核验登录并调用 ' + config.model + '，当前尚未请求模型。');
button.disabled = false;
form.addEventListener('input', () => { output.hidden = true; pending = null; show('输入已改变，请重新提交分析。'); });
form.addEventListener('submit', async event => {
  event.preventDefault(); if (button.disabled) return;
  output.hidden = true;
  let body;
  try {
    const values = Object.fromEntries(new FormData(form)); values.consent = form.elements.consent.checked;
    pending ??= crypto.randomUUID(); body = buildInput(values, pending);
  } catch (error) { show(messages[error.message] || messages.INVALID_REVIEW_INPUT, true); return; }
  button.disabled = true; form.setAttribute('aria-busy', 'true');
  form.querySelectorAll('input,select,textarea').forEach(node => { node.disabled = true; });
  show('正在核验权限并请求 AI 分析，请稍候…');
  const started = performance.now();
  try {
    const result = await analyze(config, body, window.tinglanFetch);
    for (const key of ['summary','reason','evidence','missing','raw']) output.querySelector('[data-result=' + key + ']').textContent = result[key];
    output.querySelector('[data-result=meta]').textContent = 'Live AI 模型返回 · ' + result.model + ' · ' + ((performance.now() - started) / 1000).toFixed(2) + ' 秒 · ' + (result.tokens === null ? '用量未返回' : result.tokens + ' tokens');
    output.querySelector('[data-result=trace]').textContent = '运行编号：' + result.runId + '\n审计编号：' + result.auditId;
    output.hidden = false; show('AI 分析已返回，等待风险复核；未执行交易。');
  } catch (error) { show(messages[error.message] || messages.SERVICE_UNAVAILABLE, true); }
  finally { button.disabled = false; form.removeAttribute('aria-busy'); form.querySelectorAll('input,select,textarea').forEach(node => { node.disabled = false; }); }
});
