(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
  const money = (value) => Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const shortTime = (value) => String(value || '').replace('T', ' ').slice(0, 16);
  const state = { pending: [], scheduled: [], breaker: null, lastResult: null, running: false, auditRows: [] };

  const FACT_COPY = {
    source: '来源 = 演示固定数据。它只用于展示流程，不代表已读取你的真实银行账户。',
    asof: '截至 = 2026-10-11。账单、余额和订阅样本都固定在这个时间点，便于答辩复现。',
    gate: '金额决定 = Python 确定性闸门。模型只识别意图，金额、权限和是否进入队列由规则判断。',
    action: '真实动作 = 未发生。页面不会发短信、扣款、挂失真实卡片或调用外部下单。',
    next: '下一步 = 绿色直接看结果；黄色点“确认执行”；红色填写验证码并勾选人脸 Mock。',
  };

  const AUDIT_DEMOS = [
    { label: '演示样本 · 意图解析', status: 'ready', detail: '自然语言先被路由到银行闭集场景，未识别的理财请求会分流到主工作台。' },
    { label: '演示样本 · 权限闸门', status: 'checked', detail: '金额、动作和是否可逆由确定性规则判断，模型不能自行抬高权限。' },
    { label: '演示样本 · 待确认创建', status: 'waiting', detail: '黄色和红色动作会留下可回放记录，并进入待确认队列等待下一步。' },
    { label: '演示样本 · 安全拦截', status: 'blocked', detail: '绕过确认、验证或风控的请求不会创建执行节点，也不会进入待办。' },
    { label: '演示样本 · 熔断恢复', status: 'recoverable', detail: '红色验证连续失败会锁定执行链，只有人工恢复按钮可以解除。' },
  ];

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
    const node = $('#v2-toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 3200);
  }

  function tierClass(tier) {
    if (tier === 'yellow') return 'yellow';
    if (tier === 'red') return 'red';
    if (tier === 'blocked') return 'blocked';
    return 'green';
  }

  function tierText(tier, label) {
    return label || ({ green: '绿色权限 · 自动执行', yellow: '黄色权限 · 确认后执行', red: '红色权限 · 强验证后执行', blocked: '风控拦截 · 不可执行' }[tier] || '绿色权限');
  }

  function setStage(stage) {
    const order = ['input', 'gate', 'human'];
    const index = order.indexOf(stage === 'receipt' ? 'human' : stage);
    $$('.stage').forEach((node, position) => {
      node.classList.remove('active', 'done', 'danger');
      if (stage === 'blocked' && position >= 1 && position === 1) node.classList.add('danger');
      else if (stage === 'receipt' && position === index) node.classList.add('done');
      else if (position < index) node.classList.add('done');
      else if (position === index) node.classList.add('active');
    });
  }

  function updateStatus(data) {
    if (!data) return;
    state.pending = data.pending || state.pending || [];
    state.breaker = data.breaker || state.breaker;
    $('#v2-pending-count').textContent = state.pending.length;
    $('#v2-queue-badge').textContent = state.pending.length;
    if (typeof data.balance !== 'undefined') $('#v2-balance').textContent = `¥${money(data.balance)}`;
    const provenance = data.provenance || {};
    if (provenance.source || provenance.as_of) $('#v2-source').textContent = `source: ${provenance.source || 'demo_fixture'} · as_of: ${provenance.as_of || '—'}`;
    renderBreaker(state.breaker);
  }

  function renderBreaker(breaker) {
    if (!breaker) return;
    state.breaker = breaker;
    const locked = Boolean(breaker.locked);
    const label = $('#engine-label');
    const pill = $('#engine-pill');
    const line = $('#v2-breaker-line');
    const reset = $('#v2-breaker-reset');
    label.textContent = locked ? `执行链已熔断 · ${breaker.consecutive_failures || 0} 次` : '规则引擎正常';
    pill.classList.toggle('action-pill', locked);
    line.classList.toggle('locked', locked);
    line.innerHTML = `<i class="${locked ? 'outline-dot' : 'live-dot'}"></i><span>${locked ? '执行链路已锁定，请人工恢复' : '执行链路正常'}</span>`;
    reset.classList.toggle('hidden', !locked);
    $('#v2-audit-live').classList.toggle('locked', locked);
    $('#v2-audit-live').innerHTML = `<i class="${locked ? 'outline-dot' : 'live-dot'}"></i>${locked ? ' BREAKER LOCKED' : ' LIVE TRACE'}`;
  }

  function renderResult(result, provenance) {
    const box = $('#v2-result');
    if (!result) {
      box.innerHTML = `<div class="result-error">没有读到可执行结果，请换一句描述再试。</div>`;
      return;
    }
    const tier = result.tier || 'green';
    const special = result.scenario === 'unsafe' ? 'blocked' : result.scenario === 'out_of_scope' ? 'yellow' : tier;
    const source = provenance?.source_label || '演示固定数据';
    const asOf = provenance?.as_of || '2026-10-11';
    const notice = provenance?.simulation_notice || '演示模拟：不会发生真实资金转移。';
    if (result.scenario === 'unsafe') {
      box.innerHTML = `<div class="result-card blocked"><div class="result-title"><span class="tier-label blocked">已拦截</span><span>没有创建执行节点</span></div><div class="result-message">${esc(result.message || '请求已被安全策略拦截。')}</div><div class="result-provenance">${esc(source)} · 截至 ${esc(asOf)} · ${esc(notice)}</div></div>`;
      $('#v2-guard-copy').textContent = '安全策略优先于自然语言：绕过确认或验证的请求不会进入待确认队列。';
      return;
    }
    box.innerHTML = `<div class="result-card ${tierClass(special)}"><div class="result-title"><span>${esc(result.scenario_label || result.scenario || '任务结果')}</span><span class="tier-label ${tierClass(tier)}">${esc(tierText(tier, result.tier_label))}</span></div><div class="result-message">${esc(result.message || '')}</div><div class="result-provenance">${esc(source)} · 截至 ${esc(asOf)} · ${esc(notice)}</div>${renderDetail(result)}</div>`;
    $('#v2-guard-copy').textContent = tier === 'green' ? '这是查询类结果，规则引擎已直接返回；不需要你重复确认。' : tier === 'red' ? '这是不可逆的高风险动作，必须完成强验证；失败会触发熔断。' : '这是会产生后果的动作，先进入待确认队列；你确认后才会继续。';
  }

  function renderDetail(result) {
    const data = result.data || {};
    if (result.scenario === 'bill') return `<div class="result-detail"><div><small>支出笔数</small><b>${esc(data.transaction_count || 0)} 笔</b></div><div><small>本月合计</small><b>¥${money(data.total_spend)}</b></div></div>`;
    if (result.scenario === 'transfer') { const req = data.request || {}; return `<div class="result-detail"><div><small>收款人</small><b>${esc(req.payee || '—')}</b></div><div><small>金额</small><b>¥${money(req.amount)}</b></div></div>`; }
    if (result.scenario === 'card') { const card = data.card || {}; return `<div class="result-detail"><div><small>目标卡片</small><b>尾号 ${esc(card.last4 || '—')}</b></div><div><small>操作</small><b>挂失并冻结</b></div></div>`; }
    if (result.scenario === 'subscription') { const target = data.target || {}; return `<div class="result-detail"><div><small>订阅状态</small><b>${esc(target.merchant || '已识别清单')}</b></div><div><small>下一步</small><b>${result.status === 'pending_confirmation' ? '确认取消' : '查看清单'}</b></div></div>`; }
    if (result.scenario === 'cross_scene') { const plan = data.plan || {}; return `<div class="result-detail"><div><small>计划步骤</small><b>${esc(plan.steps?.length || 0)} 步</b></div><div><small>下一步</small><b>确认预算计划</b></div></div>`; }
    return '';
  }

  function renderTrack(result) {
    const list = $('#v2-track-list');
    const status = $('#v2-track-status');
    if (!result) { list.innerHTML = '<div class="track-empty">发起任务后，每个节点会在这里留下状态。</div>'; status.textContent = '等待任务'; status.className = 'track-status'; return; }
    const nodes = result.plan?.nodes || [];
    const blocked = result.scenario === 'unsafe' || result.status === 'blocked';
    if (!nodes.length) { list.innerHTML = `<div class="track-empty">${blocked ? '请求已拦截，没有创建执行节点。' : '这是查询结果，没有待执行的资金动作。'}</div>`; status.textContent = blocked ? '已拦截' : '已返回'; status.className = `track-status ${blocked ? 'blocked' : 'done'}`; setStage(blocked ? 'blocked' : 'receipt'); return; }
    list.innerHTML = nodes.map((node) => {
      const nodeStatus = node.status || 'pending';
      const cls = ['blocked', 'failed'].includes(nodeStatus) ? 'blocked' : ['waiting', 'pending', 'scheduled', 'running'].includes(nodeStatus) ? 'waiting' : 'done';
      return `<div class="track-node ${cls}"><span class="node-dot"></span><span class="node-label">${esc(node.label || node.tool || '任务步骤')}</span><span class="node-tool">${esc(nodeStatus)}</span></div>`;
    }).join('');
    const pending = ['pending_confirmation', 'scheduled', 'needs_clarification'].includes(result.status);
    status.textContent = result.status === 'scheduled' ? '等待预约到期' : result.status === 'needs_clarification' ? '等待补充信息' : pending ? '等待确认' : result.status === 'blocked' ? '已拦截' : '已完成';
    status.className = `track-status ${pending ? 'pending' : result.status === 'blocked' ? 'blocked' : 'done'}`;
    setStage(result.status === 'blocked' ? 'blocked' : pending ? 'human' : 'receipt');
  }

  function renderQueue(items) {
    items = [...items, ...state.scheduled.filter((task) => task.status === 'waiting_due').map((task) => ({ ...task.item, scheduled_at: task.scheduled_at }))];
    const list = $('#v2-queue-list');
    $('#v2-pending-count').textContent = items.length;
    $('#v2-queue-badge').textContent = items.length;
    if (!items.length) { list.innerHTML = '<div class="queue-empty">暂无需要你点头的操作。</div>'; return; }
    list.innerHTML = items.map((item) => {
      const scheduled = Boolean(item.scheduled_at);
      const red = item.tier === 'red' && !scheduled;
      const verification = red ? `<input class="verify-input" maxlength="6" inputmode="numeric" placeholder="6 位验证码" aria-label="6 位验证码" data-sms /><label class="face-label"><input type="checkbox" data-face /> 人脸 Mock</label>` : '';
      return `<div class="pending-card ${red ? 'red' : ''}" data-pending-id="${esc(item.id)}"><div class="pending-head"><span class="tier-label ${red ? 'red' : 'yellow'}">${red ? '红色强验证' : '黄色确认'}</span><strong>${scheduled ? '预约等待中' : red ? '强验证后执行' : '确认后执行'}</strong></div><div class="pending-meta">${esc(item.message || '')}<br /><span>${scheduled ? '预约时间' : '有效至'} ${esc(shortTime(item.scheduled_at || item.expires_at))} · 演示模拟</span></div><div class="pending-actions">${verification}${scheduled ? '' : `<button class="small-button confirm" type="button" data-action="confirm">${red ? '验证并执行' : '确认执行'}</button>`}<button class="small-button" type="button" data-action="cancel">拒绝</button></div></div>`;
    }).join('');
    $$('.pending-card [data-action="confirm"]', list).forEach((button) => button.addEventListener('click', () => confirmPending(button.closest('.pending-card'))));
    $$('.pending-card [data-action="cancel"]', list).forEach((button) => button.addEventListener('click', () => cancelPending(button.closest('.pending-card'))));
  }

  async function confirmPending(card) {
    if (!card) return;
    const id = card.dataset.pendingId;
    const sms = $('[data-sms]', card);
    const face = $('[data-face]', card);
    try {
      const response = await api('/api/scenarios/confirm', { method: 'POST', body: { id, verification: { sms_code: sms?.value || '', face_verified: Boolean(face?.checked) } } });
      if (Array.isArray(response.pending)) state.pending = response.pending;
      if (Array.isArray(response.scheduled)) state.scheduled = response.scheduled;
      if (response.success) {
        updateStatus(response);
        toast(response.message || '已完成确认');
        setStage('receipt');
      } else toast(response.message || '验证没有通过');
      if (response.breaker) renderBreaker(response.breaker);
      renderQueue(state.pending);
      await refreshAudit();
    } catch (error) { toast(`确认失败：${error.message}`); await refreshAudit(); }
  }

  async function cancelPending(card) {
    if (!card) return;
    try {
      const response = await api('/api/scenarios/cancel', { method: 'POST', body: { id: card.dataset.pendingId } });
      state.pending = response.pending || [];
      state.scheduled = response.scheduled || state.scheduled;
      renderQueue(state.pending);
      setStage(state.pending.length ? 'human' : 'receipt');
      toast(response.message || '已拒绝该操作');
      await refreshAudit();
    } catch (error) { toast(`拒绝失败：${error.message}`); }
  }

  function renderAudit(entries) {
    const list = $('#v2-audit-list');
    const actual = (entries || []).slice(0, 8).map((entry) => ({
      ...entry,
      detail: entry.detail || `服务端已记录 ${entry.label || entry.action || entry.event || '审计事件'}，可继续回到任务入口复现。`,
      demo: false,
    }));
    const demoRows = AUDIT_DEMOS.map((entry) => ({ ...entry, demo: true, timestamp: '' }));
    const rows = demoRows.concat(actual).slice(0, 13);
    state.auditRows = rows;
    if (!rows.length) { list.innerHTML = '<div class="queue-empty">还没有可回放事件，先发起一条任务。</div>'; return; }
    list.innerHTML = rows.map((entry, index) => `<button class="audit-row ${entry.demo ? 'demo-audit' : ''}" type="button" data-audit-index="${index}"><div><strong>${esc(entry.label || entry.action || entry.event || '审计事件')}</strong><small>${esc(entry.status || entry.outcome || 'recorded')} · ${esc(entry.user_id || (entry.demo ? '演示样本' : 'demo_user'))}</small></div><time>${esc(shortTime(entry.timestamp || entry.created_at || (entry.demo ? '点击查看' : '')))}</time></button>`).join('');
    $$('.audit-row', list).forEach((row) => row.addEventListener('click', () => showAuditDetail(Number(row.dataset.auditIndex))));
  }

  function showAuditDetail(index) {
    const entry = state.auditRows[index];
    if (!entry) return;
    const detail = $('#v2-audit-detail');
    detail.innerHTML = `<strong>${esc(entry.label || entry.action || entry.event || '审计事件')}</strong><span>${esc(entry.detail || '事件已记录，可回到上方任务入口继续复现。')}</span>`;
    toast(entry.demo ? '已打开演示审计说明' : '已打开服务端审计详情');
  }

  function showFactDetail(key) {
    const detail = $('#v2-fact-detail');
    if (!detail || !FACT_COPY[key]) return;
    detail.textContent = FACT_COPY[key];
    $$('.fact-cell').forEach((cell) => cell.classList.toggle('selected', cell.dataset.fact === key));
  }

  function bindDemoActions() {
    $$('[data-demo-task]').forEach((button) => button.addEventListener('click', () => runTask(button.dataset.demoTask)));
    $$('.fact-cell').forEach((button) => button.addEventListener('click', () => showFactDetail(button.dataset.fact)));
  }

  async function refreshAudit() {
    try { const data = await api('/api/audit'); renderAudit(data.entries || []); } catch (error) { toast(`审计回放读取失败：${error.message}`); }
  }

  async function runTask(question) {
    if (state.running) return;
    const input = $('#v2-task-input');
    const task = String(question || input.value || '').trim() || '这个月账单分析';
    input.value = task;
    state.running = true;
    const submit = $('#v2-task-form button');
    submit.disabled = true;
    submit.textContent = '正在过闸门…';
    $('#v2-track-status').textContent = '处理中';
    setStage('gate');
    try {
      const response = await api('/api/scenarios/run', { method: 'POST', body: { question: task } });
      if (response.delegated) {
        $('#v2-result').innerHTML = `<div class="result-card green"><div class="result-title"><span>理财深度路径</span><span class="tier-label green">已分流</span></div><div class="result-message">${esc(response.message || '理财请求已转交深度分析闭环。')} 组合诊断与模拟方案请回到主工作台完成。</div><div class="result-provenance">理财请求不会在此页面伪装成银行执行结果。</div></div>`;
        renderTrack(null); setStage('receipt'); toast('理财请求已分流到主工作台深度路径');
      } else {
        state.lastResult = response.result;
        renderResult(response.result, response.provenance);
        renderTrack(response.result);
        state.pending = response.pending || [];
        state.scheduled = response.scheduled || state.scheduled;
        renderQueue(state.pending);
        if (response.breaker) renderBreaker(response.breaker);
        toast(response.deduplicated ? '相同待确认任务已合并' : (response.result?.message || '任务已完成'));
      }
      const auditPromise = refreshAudit();
      state.running = false;
      submit.disabled = false;
      submit.innerHTML = '生成安全计划 <span>↗</span>';
      await auditPromise;
    } catch (error) {
      $('#v2-result').innerHTML = `<div class="result-error">任务没有提交：${esc(error.message)}</div>`;
      setStage('input'); toast(`发起失败：${error.message}`);
    } finally {
      state.running = false; submit.disabled = false; submit.innerHTML = '生成安全计划 <span>↗</span>';
    }
  }

  async function resetBreaker() {
    const button = $('#v2-breaker-reset');
    button.disabled = true;
    try { const response = await api('/api/breaker/reset', { method: 'POST' }); renderBreaker(response.breaker); toast(response.message || '熔断已解除，执行链路恢复。'); await refreshAudit(); }
    catch (error) { toast(`恢复失败：${error.message}`); }
    finally { button.disabled = false; }
  }

  async function resetDemo() {
    if (!window.confirm('重置当前演示队列、审计状态和纸交易数据？')) return;
    try {
      await api('/api/reset', { method: 'POST' });
      if (state.breaker?.locked) await api('/api/breaker/reset', { method: 'POST' });
      $('#v2-result').innerHTML = '<div class="empty-result"><span>+</span><p>演示已重置</p><small>可以重新从账单、转账或挂失开始。</small></div>';
      state.lastResult = null; state.pending = []; renderQueue([]); renderTrack(null); setStage('input'); await boot(); toast('演示状态已重置');
    } catch (error) { toast(`重置失败：${error.message}`); }
  }

  async function seedDemo(silent) {
    const button = $('#v2-seed');
    if (button) button.disabled = true;
    try {
      const response = await api('/api/scenarios/seed-demo', { method: 'POST' });
      state.pending = response.pending || [];
        state.scheduled = response.scheduled || state.scheduled;
      renderQueue(state.pending);
      await refreshAudit();
      if (!silent) toast(response.message || '演示数据已预置');
    } catch (error) {
      if (!silent) toast(`预置失败：${error.message}`);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function boot() {
    try {
      const [overview, pendingData, audit] = await Promise.all([
        api('/api/scenarios/boot'), api('/api/scenarios/pending'), api('/api/audit'),
      ]);
      state.pending = pendingData.pending || [];
      state.scheduled = pendingData.scheduled || overview.scheduled || [];
      updateStatus(overview);
      renderQueue(state.pending);
      renderAudit(audit.entries || []);
      if (!state.pending.length && overview.demo_seeded === false) await seedDemo(true);
    } catch (error) { toast(`初始化失败：${error.message}`); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#v2-task-form').addEventListener('submit', (event) => { event.preventDefault(); runTask(); });
    $$('.command-chip').forEach((button) => button.addEventListener('click', () => runTask(button.dataset.preset)));
    $('#v2-breaker-reset').addEventListener('click', resetBreaker);
    $('#v2-reset').addEventListener('click', resetDemo);
    $('#v2-seed')?.addEventListener('click', () => seedDemo());
    bindDemoActions();
    showFactDetail('source');
    setStage('input');
    boot();
  });
})();
