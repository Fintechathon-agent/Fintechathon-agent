const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const yuan = (value) => Number(value || 0).toLocaleString('zh-CN', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const chats = [];
let current = null;
let request = null;
let composing = false;

function newChat() {
  current = { id: crypto.randomUUID(), title: '新对话', turns: [] };
  chats.unshift(current);
  render();
  closeSidebar();
  $('question').focus();
}

function notice(message = '') {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

function setBusy(busy) {
  $('send').disabled = busy;
  $('send').hidden = busy;
  $('stop').hidden = !busy;
}

async function api(path, body, signal) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('后端没有返回有效结果'); }
  if (!response.ok || data.error) {
    throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || `请求失败 (${response.status})`);
  }
  return data;
}

function planHtml(plan) {
  const nodes = plan?.nodes || [];
  if (!nodes.length) return '';
  return `<details class="details"><summary>查看后端任务步骤 (${nodes.length})</summary><ol>${nodes.map((node) =>
    `<li>${escapeHtml(node.label)} · ${escapeHtml(node.status)}</li>`).join('')}</ol></details>`;
}

function provenanceHtml(provenance) {
  if (!provenance) return '';
  return `<p class="scope-note">来源：${escapeHtml(provenance.source_label || provenance.source || '未标注')}；数据日期：${escapeHtml(provenance.as_of || '未提供')}。${escapeHtml(provenance.simulation_notice || '')}</p>`;
}

function billHtml(result) {
  const data = result.data || {};
  const categories = Object.entries(data.by_category || {});
  return `<p>${escapeHtml(result.message)}</p>
    ${categories.length ? `<div class="table-wrap"><table><thead><tr><th>类别</th><th>支出（元）</th></tr></thead><tbody>${categories.map(([name, amount]) =>
      `<tr><td>${escapeHtml(name)}</td><td>${yuan(amount)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${(data.anomalies || []).length ? `<details class="details"><summary>查看异常标记 (${data.anomalies.length})</summary><ul>${data.anomalies.map((item) =>
      `<li>${escapeHtml(item.detail)}</li>`).join('')}</ul></details>` : ''}`;
}

function transferHtml(result, pendingId) {
  const checks = result.data?.gate_checks || [];
  const action = result.status === 'pending_confirmation' && pendingId
    ? `<div class="action-row"><button class="confirm" data-confirm="${escapeHtml(pendingId)}">确认模拟转账</button><button class="quiet-button" data-cancel="${escapeHtml(pendingId)}">取消</button></div>` : '';
  return `<p>${escapeHtml(result.message)}</p>
    ${checks.length ? `<details class="details"><summary>查看收款人与资金检查</summary><ul>${checks.map((check) =>
      `<li>${escapeHtml(check.name)}：${escapeHtml(check.detail)}</li>`).join('')}</ul></details>` : ''}${action}`;
}

function investmentHtml(data) {
  const proposal = data.recommendation;
  const portfolio = data.portfolio;
  const joint = data.joint_profile === 'LOCAL_SYNTHETIC_JOINT';
  if (joint) return `<p>${escapeHtml(data.assistant_message || '同任务风控核对已完成。')}</p>
    <p class="tool-label">Finance → Risk → Core · 同任务只读核对</p>
    <p>任务号：<code>${escapeHtml(data.task_id)}</code><br>风控检查号：<code>${escapeHtml(data.risk_check_id)}</code><br>审计号：<code>${escapeHtml(data.audit_id)}</code></p>
    <p>程序风控：${escapeHtml(data.risk_advice?.decision || 'UNKNOWN')}；签名回写：${escapeHtml(data.risk_callback?.status || 'UNKNOWN')}；Core 任务：${escapeHtml(data.workflow_status || 'UNKNOWN')}。</p>
    ${proposal ? `<details class="details"><summary>查看 Core 合成模型提议</summary><p>${escapeHtml(proposal.reason || proposal.action || '')}</p></details>` : ''}
    <p class="scope-note">Finance 访客模拟账面现金 ¥${yuan((data.finance_account?.cash_minor || 0) / 100)}；现有占用未知，净可用额仍待核对。本次投资金额与保护用途也未确认，不能据此批准操作。模型为本机合成测试替身；没有真实模型调用、本人审批或资金执行。</p>`;
  return `<p>${escapeHtml(data.assistant_message || data.reasoning || '理财诊断已完成。')}</p>
    ${portfolio ? `<p>演示组合：${portfolio.position_count} 只持仓，总市值 ¥${yuan(portfolio.total_value)}；现金 ¥${yuan(portfolio.cash)}。</p>` : ''}
    ${data.risk_alert ? `<p class="error">${escapeHtml(data.risk_alert)}</p>` : ''}
    ${proposal ? `<p>规则候选：${escapeHtml(proposal.name || proposal.symbol)} ${escapeHtml(proposal.action || '')} ${escapeHtml(proposal.quantity ?? '')}；${escapeHtml(proposal.reason || '')}</p>` : ''}
    <p class="scope-note">${escapeHtml(data.data_tag || '演示数据')} · 模型状态：${escapeHtml(data.model_status || '未提供')} · 风控检查：${data.gate?.passed ? '通过' : '未通过或未知'}。本入口不提供理财执行授权。</p>`;
}

function answerHtml(turn) {
  if (turn.loading) return '<p class="phase">后端正在处理…</p>';
  if (turn.error) return `<p class="error">${escapeHtml(turn.error)}</p>`;
  if (turn.pendingInvestment) return `<p>Finance 演示账本当前账面现金 ¥${yuan(turn.pendingInvestment.cashMinor / 100)}。请核对这份虚构账面余额，再发起 Core／Risk 同任务只读分析。</p>
    <button class="confirm" data-review="${escapeHtml(turn.reviewKey)}">已核对演示账面余额，继续分析</button>
    <p class="scope-note">这一步仅确认账面现金，不是投资批准；现有占用与净可用额、投资金额和保护用途仍会保留为未知。</p>
    ${turn.reviewError ? `<p class="error">${escapeHtml(turn.reviewError)}</p>` : ''}`;
  if (turn.action) return `<p>${escapeHtml(turn.action.message || (turn.action.success ? '模拟操作已处理。' : '操作未完成。'))}</p>${turn.action.receipt ? `<details class="details"><summary>查看模拟回执</summary><pre>${escapeHtml(JSON.stringify(turn.action.receipt, null, 2))}</pre></details>` : ''}`;
  if (turn.investment) return investmentHtml(turn.investment) + planHtml(turn.investment.plan);
  const result = turn.scenario?.result;
  if (!result) return '<p class="error">后端没有返回场景结果。</p>';
  const pending = (turn.scenario.pending || []).find((item) => item.scenario === 'transfer' && item.message === result.message);
  let content = result.scenario === 'bill' ? billHtml(result)
    : result.scenario === 'transfer' ? transferHtml(result, turn.completed ? null : pending?.id)
      : `<p>${escapeHtml(result.message)}</p>`;
  return `<p class="tool-label">${escapeHtml(result.scenario_label || result.scenario)} · ${escapeHtml(result.tier_label || result.tier || '')} · ${escapeHtml(result.status)}</p>`
    + content + planHtml(result.plan) + provenanceHtml(result.provenance);
}

function render() {
  $('history').innerHTML = chats.map((chat) => `<button data-chat="${escapeHtml(chat.id)}" aria-current="${chat === current}">${escapeHtml(chat.title)}</button>`).join('');
  $('welcome').hidden = current.turns.length > 0;
  $('messages').innerHTML = current.turns.map((turn) => `<article class="turn"><div class="user">${escapeHtml(turn.question)}</div><div class="assistant-head"><span class="symbol">◈</span>Personal AI Fund Manager</div><div class="assistant-body">${answerHtml(turn)}</div></article>`).join('');
  $('scroll-area').scrollTop = $('scroll-area').scrollHeight;
}

async function send(question) {
  if (request || !question.trim()) return;
  notice();
  const turn = { question: question.trim(), loading: true };
  current.turns.push(turn);
  if (current.turns.length === 1) current.title = turn.question.slice(0, 28);
  const chat = current;
  $('question').value = '';
  request = new AbortController();
  setBusy(true);
  render();
  try {
    const scenario = await api('/api/scenarios/run', { question: turn.question }, request.signal);
    if (scenario.delegated) {
      const account = await api('/api/account', undefined, request.signal);
      turn.reviewKey = crypto.randomUUID();
      turn.pendingInvestment = { cashMinor: account.cash_minor };
    } else {
      turn.scenario = scenario;
    }
  } catch (error) {
    turn.error = error.name === 'AbortError'
      ? '已停止等待。后端可能已经处理请求；请先核对当前待确认事项，不要直接重复资金操作。'
      : `未完成：${error.message}`;
  } finally {
    turn.loading = false;
    request = null;
    setBusy(false);
    if (current === chat) render();
  }
}

async function reviewInvestment(button) {
  const turn = current.turns.find((item) => item.reviewKey === button.dataset.review);
  if (!turn?.pendingInvestment || request) return;
  request = new AbortController();
  setBusy(true);
  turn.loading = true;
  render();
  try {
    turn.investment = await api('/api/personal-fund/review', {
      question: turn.question,
      idempotency_key: `personal-${turn.requestKey ||= crypto.randomUUID().replaceAll('-', '')}`,
      confirmed_cash_minor: turn.pendingInvestment.cashMinor,
    }, request.signal);
    turn.pendingInvestment = null;
    turn.reviewError = null;
  } catch (error) {
    turn.reviewError = error.name === 'AbortError'
      ? '已停止等待；后端状态可能未知。请勿重复提交资金操作。'
      : `联合核对未完成：${error.message}`;
  } finally {
    turn.loading = false;
    request = null;
    setBusy(false);
    render();
  }
}

async function act(button, path, message) {
  const turn = current.turns.find((item) => item.scenario && (item.scenario.pending || []).some((pending) => pending.id === button.dataset.confirm || pending.id === button.dataset.cancel));
  if (!turn || turn.completed) return;
  const id = button.dataset.confirm || button.dataset.cancel;
  if (button.dataset.confirm && !window.confirm('仅确认这笔虚构数据的模拟转账。不会发生真实资金转移。是否继续？')) return;
  button.disabled = true;
  try {
    const result = await api(path, { id });
    turn.completed = true;
    current.turns.push({ question: message, action: result });
    render();
  } catch (error) {
    notice(`操作未完成：${error.message}`);
    button.disabled = false;
  }
}

function closeSidebar() {
  document.body.classList.remove('show-history');
  $('shade').hidden = true;
  $('menu').setAttribute('aria-expanded', 'false');
}

$('composer').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!composing) send($('question').value);
});
$('question').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !composing) {
    event.preventDefault();
    $('composer').requestSubmit();
  }
});
$('question').addEventListener('compositionstart', () => { composing = true; });
$('question').addEventListener('compositionend', () => { composing = false; });
$('stop').onclick = () => request?.abort();
$('new-chat').onclick = newChat;
$('history').onclick = (event) => {
  const button = event.target.closest('[data-chat]');
  const chat = chats.find((item) => item.id === button?.dataset.chat);
  if (chat) { current = chat; render(); closeSidebar(); }
};
$('examples').onclick = (event) => {
  const button = event.target.closest('[data-example]');
  if (button) send(button.textContent.replace(/^(账单分析|模拟转账|理财诊断)/, '').trim());
};
$('messages').onclick = (event) => {
  const button = event.target.closest('[data-review], [data-confirm], [data-cancel]');
  if (button?.dataset.review) reviewInvestment(button);
  if (button?.dataset.confirm) act(button, '/api/scenarios/confirm', '确认模拟转账');
  if (button?.dataset.cancel) act(button, '/api/scenarios/cancel', '取消模拟转账');
};
$('menu').onclick = () => {
  document.body.classList.add('show-history');
  $('shade').hidden = false;
  $('menu').setAttribute('aria-expanded', 'true');
};
$('close-sidebar').onclick = closeSidebar;
$('shade').onclick = closeSidebar;
$('to-bottom').onclick = () => { $('scroll-area').scrollTop = $('scroll-area').scrollHeight; };

newChat();
api('/api/scenarios/boot').catch((error) => notice(`后端连接失败：${error.message}`));
api('/api/personal-fund/status').then((status) => {
  const details = $('saved-section').querySelector('p');
  details.textContent = status.core_risk === 'LOCAL_SYNTHETIC_JOINT'
    ? 'Finance 访客账本、Risk 规则和 Core 任务已接入本机同任务演示。模型及存储使用测试替身；审批和资金执行关闭。'
    : 'Finance 访客账本可用；Core/Risk 联合服务未接通，理财同任务请求会明确停止。';
}).catch(() => {});
