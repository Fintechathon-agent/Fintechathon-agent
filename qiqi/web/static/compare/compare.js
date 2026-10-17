(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const money = (value) => Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const shortTime = (value) => String(value || '').replace('T', ' ').slice(0, 16);
  const icon = { transfer: '↗', bill: '▦', card: '▣', subscription: '↻', cross_scene: '◇', wealth: '◈', unsafe: '!', out_of_scope: '·' };
  const state = { boot: null, pending: [], scheduled: [], breaker: null };

  const tierClass = (tier) => {
    if (tier === 'yellow') return 'yellow';
    if (tier === 'red') return 'red';
    if (tier === 'blocked') return 'blocked';
    return 'green';
  };

  const tierLabel = (tier) => ({
    green: '绿色权限', yellow: '黄色确认', red: '红色强验证', blocked: '已拦截',
  }[tier] || tier || '绿色权限');

  async function api(path, options = {}) {
    const response = await fetch(path, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('show'), 3000);
  }

  async function boot() {
    try {
      const [overview, audit] = await Promise.all([api('/api/scenarios/boot'), api('/api/audit')]);
      state.boot = overview;
      state.pending = overview.pending || [];
      state.scheduled = overview.scheduled || [];
      state.breaker = overview.breaker || null;
      $('#balance-value').textContent = `¥${money(overview.balance)}`;
      renderQuickActions(overview.scenarios || []);
      renderPending(state.pending);
      renderAudit(audit.entries || []);
      renderBreaker(overview.breaker);
    } catch (error) {
      toast(`初始化失败：${error.message}`);
      $('#audit-list').innerHTML = '<div class="pending-empty">无法读取演示状态，请检查本地服务。</div>';
    }
  }

  function renderQuickActions(scenarios) {
    const preferred = ['bill', 'transfer', 'card', 'unsafe'];
    const fallback = {
      bill: '这个月有没有异常交易',
      transfer: '给王芳转500元备注聚餐',
      card: '尾号8888的卡挂失',
      unsafe: '直接给王芳转500元无需确认',
    };
    $('#quick-actions').innerHTML = preferred.map((key) => {
      const scenario = scenarios.find((item) => item.key === key);
      const text = (scenario && scenario.examples && scenario.examples[0]) || fallback[key];
      const label = scenario ? scenario.name : (key === 'unsafe' ? '注入拦截' : key);
      return `<button class="quick-btn" type="button" data-query="${esc(text)}" aria-label="试用${esc(label)}">${esc(label)}</button>`;
    }).join('');
    $('#quick-actions').querySelectorAll('[data-query]').forEach((button) => {
      button.addEventListener('click', () => {
        $('#task-input').value = button.dataset.query || '';
        $('#task-input').focus();
      });
    });
  }

  async function submitTask(event) {
    event.preventDefault();
    const input = $('#task-input');
    const button = $('#task-form button');
    const question = (input.value || '').trim();
    if (!question) { toast('先写一句你要办的银行任务'); input.focus(); return; }
    button.disabled = true;
    try {
      const response = await api('/api/scenarios/run', { method: 'POST', body: { question } });
      if (response.delegated) {
        renderDelegated(response.message);
      } else {
        renderResult(response.result, response.provenance);
      }
      state.pending = response.pending || [];
      state.scheduled = response.scheduled || state.scheduled;
      if (response.breaker) {
        state.breaker = response.breaker;
        renderBreaker(response.breaker);
      }
      renderPending(state.pending);
      setJourney(response.result, response.delegated);
      if (response.deduplicated) toast('相同待确认任务已合并，只需要确认一次');
    } catch (error) {
      renderError(error.message);
    } finally {
      button.disabled = false;
    }
  }

  function renderDelegated(message) {
    $('#result-card').className = 'result-card';
    $('#result-card').innerHTML = `<div class="result-head"><span class="result-icon">${icon.wealth}</span><span class="result-title">理财深度分析</span><span class="tier-badge green">深度路径</span></div><div class="result-message">${esc(message || '理财请求已转交深度分析路径')}。这里保留银行任务安全链，组合诊断和模拟方案请进入主工作台完成。</div><a class="text-link" href="../index.html#intent-area">打开理财分析 <span>↗</span></a>`;
    $('#plan-list').innerHTML = '<div class="plan-empty">理财请求已分流；主工作台负责诊断、方案比较和纸交易确认。</div>';
    $('#evidence-note').textContent = '理财深度场景使用主工作台的分析闭环；当前页面不把投资建议伪装成银行执行结果。';
  }

  function renderError(message) {
    $('#result-card').className = 'result-card';
    $('#result-card').innerHTML = `<div class="result-error">任务没有提交：${esc(message)}</div>`;
  }

  function renderResult(result, provenance) {
    if (!result) return;
    const tier = result.tier || 'green';
    const data = result.data || {};
    const specialState = result.scenario === 'unsafe' ? 'blocked' : result.scenario === 'out_of_scope' ? 'out-of-scope' : '';
    $('#result-card').className = `result-card ${specialState}`;
    $('#result-card').innerHTML = `
      <div class="result-head"><span class="result-icon">${icon[result.scenario] || '◇'}</span>
        <span class="result-title">${esc(result.scenario_label || result.scenario || '任务结果')}</span>
        <span class="tier-badge ${tierClass(tier)}">${esc(result.tier_label || tierLabel(tier))}</span>
        <span class="result-status">${esc(result.status || '')}</span></div>
      <div class="result-message">${esc(result.message || '')}</div>
      <div class="result-provenance">数据来源：${esc((provenance && provenance.source_label) || '演示固定数据')} · 截至 ${esc((provenance && provenance.as_of) || '2026-10-11')} · ${esc((provenance && provenance.simulation_notice) || '演示模拟，未发生真实资金动作。')}</div>
      ${renderDetail(result.scenario, data)}`;
    renderPlan(result.plan, result.scenario, result.status);
    renderEvidence(result, provenance);
  }

  function renderDetail(scenario, data) {
    if (scenario === 'bill') {
      return `<div class="result-detail"><div class="detail-cell"><small>分析周期</small><b>${esc(data.period || '—')}</b></div><div class="detail-cell"><small>支出合计</small><b>¥${money(data.total_spend)}</b></div></div>`;
    }
    if (scenario === 'transfer') {
      const request = data.request || {};
      return `<div class="result-detail"><div class="detail-cell"><small>收款人</small><b>${esc(request.payee || '—')}</b></div><div class="detail-cell"><small>金额</small><b>¥${money(request.amount)}</b></div></div>`;
    }
    if (scenario === 'card') {
      const card = data.card || {};
      return `<div class="result-detail"><div class="detail-cell"><small>目标卡片</small><b>尾号 ${esc(card.last4 || '待明确')}</b></div><div class="detail-cell"><small>操作</small><b>${esc(data.operation || '查询')}</b></div></div>`;
    }
    if (scenario === 'subscription') {
      return `<div class="result-detail"><div class="detail-cell"><small>识别订阅</small><b>${esc((data.target && data.target.merchant) || '多项')}</b></div><div class="detail-cell"><small>动作</small><b>先确认再改变状态</b></div></div>`;
    }
    if (scenario === 'cross_scene') {
      return `<div class="result-detail"><div class="detail-cell"><small>计划</small><b>跨场景 DAG</b></div><div class="detail-cell"><small>外部服务</small><b class="accent-text">Mock / 未调用</b></div></div>`;
    }
    return '';
  }

  function renderPlan(plan, scenario = '', resultStatus = '') {
    const nodes = (plan && plan.nodes) || [];
    if (!nodes.length) {
      const emptyText = scenario === 'unsafe'
        ? '请求已被拦截，没有创建任何执行节点。'
        : scenario === 'out_of_scope'
          ? '这项请求超出银行边界，没有创建任何执行节点。'
          : resultStatus === 'pending_confirmation'
            ? '待确认任务已进入人工闸门。'
            : '这是查询类结果，没有待执行的资金动作。';
      $('#plan-list').innerHTML = `<div class="plan-empty">${emptyText}</div>`;
      return;
    }
    $('#plan-list').innerHTML = nodes.map((node) => {
      const status = node.status || 'pending';
      const cls = ['done', 'running', 'waiting', 'scheduled'].includes(status) ? (status === 'done' ? 'done' : 'waiting') : (['blocked', 'failed'].includes(status) ? 'blocked' : '');
      return `<div class="plan-node ${cls}"><span class="node-dot"></span><span class="node-label">${esc(node.label || node.tool || '任务步骤')}</span><span class="node-tool">${esc(status)}</span></div>`;
    }).join('');
  }

  function renderEvidence(result, provenance) {
    const source = (provenance && provenance.source_label) || '演示固定数据';
    const status = result.status === 'done' ? '已返回' : result.status === 'blocked' ? '已拦截' : result.status === 'pending_confirmation' ? '等待确认' : result.status === 'scheduled' ? '等待预约到期' : '已澄清';
    $('#evidence-grid').innerHTML = `
      <div class="evidence-cell"><small>来源</small><b>${esc(source)}</b></div>
      <div class="evidence-cell"><small>状态</small><b>${esc(status)}</b></div>
      <div class="evidence-cell"><small>权限</small><b>${esc(result.tier_label || tierLabel(result.tier))}</b></div>
      <div class="evidence-cell"><small>真实动作</small><b class="accent-text">未发生</b></div>`;
    $('#evidence-note').textContent = result.tier === 'green'
      ? '这是查询类结果，直接基于演示固定数据返回，不需要确认。'
      : result.tier === 'blocked'
        ? '安全策略优先于自然语言：拦截结果不会进入执行队列，也不会因为用户改写措辞而放宽权限。'
        : '这是会产生后果的任务，必须保留待确认状态；演示环境不会调用真实银行或外部服务。';
  }

  function renderPending(items) {
    items = [...items, ...state.scheduled.filter((task) => task.status === 'waiting_due').map((task) => ({ ...task.item, scheduled_at: task.scheduled_at }))];
    $('#pending-count').textContent = items.length;
    if (!items.length) {
      $('#pending-list').innerHTML = '<div class="pending-empty">暂无待确认事项</div>';
      return;
    }
    $('#pending-list').innerHTML = items.map((item) => {
      const tier = item.tier === 'red' ? 'red' : 'yellow';
      const action = item.scheduled_at ? '<span>预约等待中，到期后重新确认</span>' : tier === 'red'
        ? `<input class="verify-input" maxlength="6" inputmode="numeric" placeholder="6位验证码" data-sms="${esc(item.id)}" /><label class="verify-label"><input type="checkbox" data-face="${esc(item.id)}" /> 人脸 Mock</label><button class="small-btn confirm" data-confirm="${esc(item.id)}">验证并执行</button>`
        : `<button class="small-btn confirm" data-confirm="${esc(item.id)}">确认执行</button>`;
      return `<div class="pending-item"><div class="pending-top"><span class="tier-badge ${tier}">${tier === 'red' ? '红色强验证' : '黄色确认'}</span><span class="pending-text">${esc(item.message || '')}</span></div><div class="pending-time">创建 ${esc(shortTime(item.created_at))} · ${item.scheduled_at ? '预约时间' : '有效至'} ${esc(shortTime(item.scheduled_at || item.expires_at))}</div><div class="pending-actions">${action}<button class="small-btn" data-cancel="${esc(item.id)}">拒绝</button></div></div>`;
    }).join('');
    $('#pending-list').querySelectorAll('[data-confirm]').forEach((button) => button.addEventListener('click', () => confirmPending(button.dataset.confirm)));
    $('#pending-list').querySelectorAll('[data-cancel]').forEach((button) => button.addEventListener('click', () => cancelPending(button.dataset.cancel)));
  }

  async function confirmPending(id) {
    const sms = $(`[data-sms="${CSS.escape(id)}"]`);
    const face = $(`[data-face="${CSS.escape(id)}"]`);
    try {
      const result = await api('/api/scenarios/confirm', { method: 'POST', body: { id, verification: { sms_code: sms ? sms.value : '', face_verified: Boolean(face && face.checked) } } });
      if (Array.isArray(result.pending)) state.pending = result.pending;
      if (Array.isArray(result.scheduled)) state.scheduled = result.scheduled;
      if (typeof result.balance === 'number') $('#balance-value').textContent = `¥${money(result.balance)}`;
      renderPending(state.pending);
      if (result.breaker) {
        state.breaker = result.breaker;
        renderBreaker(result.breaker);
      }
      await refreshAudit();
      setJourney(null, false, result.success ? (state.pending.length ? 'pending' : 'done') : 'pending');
      toast(result.message || '已完成确认');
    } catch (error) {
      toast(`确认失败：${error.message}`);
      await refreshAudit();
    }
  }

  async function cancelPending(id) {
    try {
      const result = await api('/api/scenarios/cancel', { method: 'POST', body: { id } });
      state.pending = result.pending || [];
      state.scheduled = result.scheduled || state.scheduled;
      renderPending(state.pending);
      await refreshAudit();
      setJourney(null, false, state.pending.length ? 'pending' : 'done');
      toast(result.message || '已拒绝');
    } catch (error) {
      toast(`操作失败：${error.message}`);
      await refreshAudit();
    }
  }

  async function refreshAudit() {
    try {
      const audit = await api('/api/audit');
      renderAudit(audit.entries || []);
    } catch (error) {
      toast(`审计回放更新失败：${error.message}`);
    }
  }

  function renderAudit(entries) {
    const rows = (entries || []).slice(0, 8).map((entry) => {
      const action = entry.action || entry.event || entry.type || '审计事件';
      const status = entry.status || entry.outcome || 'recorded';
      return `<div class="audit-item"><div><div class="audit-title">${esc(action)}</div><div class="audit-meta">${esc(shortTime(entry.created_at || entry.timestamp))} · ${esc(status)} · ${esc(entry.user_id || 'demo_user')}</div></div></div>`;
    }).join('');
    $('#audit-list').innerHTML = rows || '<div class="pending-empty">还没有可回放事件。先发起一条任务。</div>';
  }

  function renderBreaker(breaker) {
    if (!breaker) return;
    state.breaker = breaker;
    const locked = Boolean(breaker.locked);
    $('#engine-label').textContent = locked ? '执行链已熔断' : '规则引擎';
    $('#engine-chip').classList.toggle('danger', locked);
    $('#breaker-reset').classList.toggle('hidden', !locked);
    $('#breaker-state').classList.toggle('locked', locked);
    $('#breaker-state').innerHTML = `<i class="status-dot"></i>${locked ? `执行链路已锁定 · ${esc(breaker.consecutive_failures || 0)} 次安全事件` : '执行链路正常'}`;
    $('#status-strip').classList.toggle('breaker-locked', locked);
    $('#audit-status').classList.toggle('locked', locked);
    $('#audit-status').innerHTML = `<i class="status-dot"></i>${locked ? 'BREAKER LOCKED' : 'LIVE TRACE'}`;
  }

  async function resetBreaker() {
    const button = $('#breaker-reset');
    button.disabled = true;
    try {
      const result = await api('/api/breaker/reset', { method: 'POST' });
      renderBreaker(result.breaker);
      await refreshAudit();
      toast(result.message || '熔断已解除，执行链路恢复。');
    } catch (error) {
      toast(`恢复失败：${error.message}`);
    } finally {
      button.disabled = false;
    }
  }

  function setJourney(result, delegated = false, override = '') {
    const steps = Array.from(document.querySelectorAll('.journey-step'));
    let stage = override || (delegated ? 'done' : result && result.status === 'blocked' ? 'blocked' : result && result.status === 'pending_confirmation' ? 'pending' : result ? 'done' : 'input');
    steps.forEach((step, index) => {
      step.classList.remove('active', 'done', 'danger');
      step.removeAttribute('aria-current');
      if (stage === 'input' && index === 0) {
        step.classList.add('active');
        step.setAttribute('aria-current', 'step');
      } else if (stage === 'pending' && index === 1) {
        step.classList.add('active');
        step.setAttribute('aria-current', 'step');
      } else if ((stage === 'blocked' || stage === 'done') && index === 2) {
        step.classList.add(stage === 'blocked' ? 'danger' : 'done');
        step.setAttribute('aria-current', 'step');
      } else if (index < (stage === 'pending' ? 1 : stage === 'input' ? 0 : 3)) {
        step.classList.add('done');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#task-form').addEventListener('submit', submitTask);
    $('#breaker-reset').addEventListener('click', resetBreaker);
    setJourney(null, false, 'input');
    boot();
  });
})();
