/* 银行 AI 智能体 · 六场景统一入口（2026-10-11）
   依赖 app.js 的全局工具：api / esc / money / num / toast / tierBadge。
   理财请求由统一入口委派给现有理财审查，不复制执行逻辑。 */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const SCENARIO_ICON = {
    transfer: '💸', bill: '📊', wealth: '🏦',
    card: '💳', subscription: '🔁', cross_scene: '🎂',
  };
  let activeSource = 'bank';
  let currentBillFile = null;
  const SOURCE_GUIDES = {
    bank: {
      name: '手机银行',
      steps: ['打开你平时使用的银行 App。', '进入「账单」「交易明细」或「流水」。', '选择要看的月份，找到「导出」「下载」或「分享账单」。', '回到这里，点「选择账单文件」，选刚才导出的 CSV / TXT。'],
      tip: '不同银行的按钮名字会有一点不同，看到“账单”或“交易明细”就对了。',
    },
    wechat: {
      name: '微信支付',
      steps: ['打开微信，进入「我」→「服务」→「钱包」。', '打开「账单」，先筛选要看的月份。', '在账单页找到「下载账单」或「导出」并保存文件。', '回到这里，点「选择账单文件」，选刚才的 CSV / TXT。'],
      tip: '微信可能会要求验证身份；只下载账单，不需要把密码告诉任何人。',
    },
    alipay: {
      name: '支付宝',
      steps: ['打开支付宝，进入「我的」→「账单」。', '选择月份，确认看的是「支出」记录。', '在账单页找到「下载」「导出」或「账单下载」。', '回到这里，点「选择账单文件」，选刚才的 CSV / TXT。'],
      tip: '如果导出的是 Excel，请先另存为 CSV，再上传到这里。',
    },
    file: {
      name: '本地文件',
      steps: ['找到你已经导出的账单文件。', '只支持 UTF-8 CSV 或 TXT；如果是 Excel，请先另存为 CSV。', '点击下面的「选择账单文件」。', '文件会发送到本次演示后端进行账单分析。请只使用虚构资料。'],
      tip: '文件须包含金额和日期列，最多 2000 笔、256 KiB；超过限制会明确报错。',
    },
  };

  /* ---------------- 场景卡片与概览 ---------------- */

  async function bootBanking() {
    try {
      const data = await api('/api/scenarios/boot');
      renderChips(data.scenarios);
      renderBankingTierMatrix(data.tier_matrix);
      renderBankingPending(data);
    } catch (err) {
      $('#banking-result').innerHTML = `<div class="assistant-line">场景入口加载失败：${esc(err.message)}</div>`;
    }
  }

  function renderChips(scenarios) {
    const box = $('#scenario-chips');
    if (!scenarios) return;
    box.innerHTML = scenarios.map((s) => `
      <button class="scenario-chip" data-key="${esc(s.key)}" title="${esc(s.desc)}">
        <span class="scenario-icon">${SCENARIO_ICON[s.key] || '🏦'}</span>
        <span class="scenario-name">${esc(s.name)}</span>
        <span class="scenario-desc">${esc(s.desc)}</span>
        <span class="scenario-tier">${esc(s.tier_note)}</span>
      </button>`).join('');
    box.querySelectorAll('.scenario-chip').forEach((chip) => {
      chip.addEventListener('click', async () => {
        const key = chip.dataset.key;
        const meta = scenarios.find((s) => s.key === key);
        if (!meta) return;
        $('#banking-question').value = meta.examples[0] || '';
        box.querySelectorAll('.scenario-chip').forEach((item) => item.classList.remove('is-running'));
        chip.classList.add('is-running');
        await runBanking(meta.examples[0] || '');
      });
    });
  }

  function feedback(message, kind = 'info') {
    const box = $('#banking-feedback');
    if (!box) return;
    box.className = `banking-feedback ${kind}`;
    box.textContent = message || '';
  }

  function renderSourceGuide(source = activeSource) {
    activeSource = SOURCE_GUIDES[source] ? source : 'bank';
    const guide = SOURCE_GUIDES[activeSource];
    const steps = $('#source-steps');
    if (!steps) return;
    document.querySelectorAll('.source-option').forEach((button) => {
      button.classList.toggle('active', button.dataset.source === activeSource);
    });
    steps.innerHTML = `
      <div class="source-title">${esc(guide.name)}怎么找到账单</div>
      <ol>${guide.steps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>
      <div class="source-tip">${esc(guide.tip)}</div>`;
    const choose = $('#choose-bill-file');
    if (choose) choose.textContent = activeSource === 'file' ? '选择 CSV / TXT 文件' : '我已经导出了，选择文件';
  }

  function openStatementGuide() {
    const guide = $('#statement-guide');
    if (!guide) return;
    guide.classList.remove('hidden');
    renderSourceGuide(activeSource);
    guide.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    feedback('先选账单来源，我会一步一步带你找到流水。');
  }

  function closeStatementGuide() {
    const guide = $('#statement-guide');
    if (guide) guide.classList.add('hidden');
  }

  async function handleBillFile(file) {
    if (!file) return;
    try {
      if (!/\.(csv|txt)$/i.test(file.name)) throw new Error('只支持 UTF-8 CSV/TXT 文件');
      if (file.size > 256 * 1024) throw new Error('账单超过 256 KiB，请拆分后重试');
      const text = await file.text();
      currentBillFile = { name: file.name, text };
      const box = $('#local-bill-result');
      if (box) box.textContent = `已选择 ${file.name}，正在用本次文件生成账单报告。`;
      await runBanking('分析这份账单');
    } catch (err) {
      currentBillFile = null;
      feedback(`读取失败：${err.message}`, 'error');
    }
  }

  function renderBankingTierMatrix(rows) {
    const pending = document.createElement('div');
    pending.id = 'banking-tier-matrix';
    pending.className = 'banking-tier-matrix';
    pending.innerHTML = (rows || []).map((r) => `
      <div class="btm-row">
        <span class="badge ${r.tier === 'green' ? 'badge-tier-green' : r.tier === 'yellow' ? 'badge-tier-yellow' : 'badge-tier-red'}">${esc(r.label)}</span>
        <span class="btm-items">${esc(r.items)}</span>
      </div>`).join('');
    const chipsBox = $('#scenario-chips');
    if (chipsBox && chipsBox.parentNode) chipsBox.parentNode.appendChild(pending);
  }

  function renderQuickState(data) {
    const box = $('#banking-result');
    if (box.dataset.filled) return;
    const cards = (data.cards || []).map((c) => `
      <div class="quick-item">
        <b>尾号 ${esc(c.last4)}</b> ${esc(c.bank)} ${esc(c.card_type)}
        <span class="chip ${c.status === 'normal' ? 'green' : 'gold'}">${esc(c.status)}</span>
        ${c.credit_limit ? `<span class="muted">额度 ¥${num(c.credit_limit)}</span>` : ''}
      </div>`).join('');
    const subs = (data.subscriptions || []).filter((s) => s.status === 'active')
      .map((s) => `
      <div class="quick-item">
        <b>${esc(s.merchant)}</b> ¥${money(s.amount)}/月
        <span class="muted">下次 ${esc(dShort(s.next_charge_at))}</span>
        ${s.due_soon ? '<span class="chip gold">7天内续费</span>' : ''}
      </div>`).join('');
    box.innerHTML = `
      <div class="quick-grid">
        <div class="quick-col">
          <div class="quick-title">💳 我的卡片</div>${cards || '<span class="muted">无</span>'}
        </div>
        <div class="quick-col">
          <div class="quick-title">🔁 订阅与代扣（自动识别）</div>${subs || '<span class="muted">无</span>'}
        </div>
        <div class="quick-col">
          <div class="quick-title">👥 常用收款人</div>
          ${(data.contacts || []).map((c) => `<div class="quick-item">${esc(c.name)} <span class="muted">${esc(c.phone)}</span></div>`).join('')}
          <div class="quick-title" style="margin-top:10px">💰 账户余额</div>
          <div class="quick-item"><b>¥${money(data.balance)}</b> <span class="muted">今日已转 ¥${money(data.daily_cumulative)}</span></div>
        </div>
      </div>`;
    box.dataset.filled = '1';
  }

  /* ---------------- 发起请求 ---------------- */

  async function runBanking(questionOverride = '') {
    const input = $('#banking-question');
    // 作为 click 监听器直接传入时，浏览器会把 PointerEvent 传进来；
    // 事件对象不是用户问题，必须回退到输入框或默认账单入口。
    const explicitQuestion = typeof questionOverride === 'string' ? questionOverride : '';
    const question = String(explicitQuestion || input.value || '').trim() || '这个月账单分析';
    if (input && !input.value.trim()) input.value = question;
    const btn = $('#btn-banking-run');
    feedback('正在整理信息，请稍等……');
    const resultBox = $('#banking-result');
    if (resultBox) {
      resultBox.dataset.filled = '1';
      resultBox.innerHTML = '<div class="banking-loading"><span class="loading-dot"></span>正在帮你整理，不需要再点一次。</div>';
    }
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = '正在处理…';
    try {
      const body = { question };
      if (currentBillFile && /账单|流水|支出|消费|扣款|明细/.test(question)) body.bill_file = currentBillFile;
      const res = await api('/api/scenarios/run', { method: 'POST', body });
      if (res.delegated) {
        const reviewInput = $('#nl-question');
        const reviewButton = $('#btn-review');
        if (!reviewInput || !reviewButton || reviewButton.disabled) {
          throw new Error('理财分析当前不可用，请稍后重试');
        }
        reviewInput.value = question;
        $('#banking-result').innerHTML = `
          <div class="assistant-line">🏦 已从统一入口发起理财分析。请在理财分析区查看任务计划、风险检查与审批状态。</div>`;
        reviewButton.click();
      } else {
        renderScenarioResult(res.result);
        if (res.deduplicated) toast('相同待确认请求已合并，仍需完成一次确认');
      }
      if (!res.delegated) renderBankingPending(res);
      feedback(res.delegated ? '理财分析已发起，结果与审批状态显示在理财分析区。' : '这一步已经完成，下面是结果。', res.delegated ? 'info' : 'success');
      const target = res.delegated ? $('.agent-card') : resultBox;
      if (target) window.requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (err) {
      toast(`发起失败：${err.message}`);
      feedback(`没有完成：${err.message}`, 'error');
      if (resultBox) resultBox.innerHTML = '<div class="local-bill-error">这次没有完成，请再点一次“开始处理”。</div>';
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  function renderScenarioResult(result) {
    if (!result) return;
    const box = $('#banking-result');
    const icon = SCENARIO_ICON[result.scenario] || '🏦';
    let body = '';

    if (result.scenario === 'unsafe' || result.scenario === 'out_of_scope') {
      body = `<div class="assistant-line ${result.scenario === 'unsafe' ? 'danger-line' : ''}">${esc(result.message)}</div>`;
    } else {
      body = renderPlanSteps(result.plan) + renderScenarioData(result);
    }

    box.innerHTML = `
      <div class="banking-result">
        <div class="br-head">
          <span class="br-icon">${icon}</span>
          <b>${esc(result.scenario_label || '')}</b>
          ${tierBadge(result.tier, result.tier_label)}
          <span class="chip chip-dim">状态：${esc(result.status)}</span>
        </div>
        <div class="assistant-line">${esc(result.message || '')}</div>
        ${renderProvenance(result.provenance)}
        ${body}
      </div>`;
    box.dataset.filled = '1';
  }

  function renderProvenance(meta) {
    if (!meta) return '';
    const source = meta.source_label || meta.source || '未知';
    const asOf = meta.as_of ? ` · 截至 ${esc(meta.as_of)}` : '';
    return `<div class="muted result-provenance" aria-label="数据来源与演示边界">数据来源：${esc(source)}${asOf} · ${esc(meta.simulation_notice || '')}</div>`;
  }

  function renderPlanSteps(plan) {
    const nodes = (plan && plan.nodes) || [];
    if (!nodes.length) return '';
    const classOf = (status) => ({
      done: 'done', running: 'doing', waiting: 'doing', blocked: 'blocked',
      failed: 'blocked', skipped: 'skip', scheduled: 'sched', pending: '',
    }[status] || '');
    return `
      <div class="dag-strip">${nodes.map((node) => `
        <span class="dag-node ${classOf(node.status)}" title="工具：${esc(node.tool)}">
          ${esc(node.label)}
        </span>`).join('<span class="dag-arrow">→</span>')}
      </div>`;
  }

  function renderScenarioData(result) {
    const d = result.data || {};
    let html = '';
    if (result.scenario === 'bill' && d.by_category) {
      const total = Number(d.total_spend || 0) || 1;
      const bars = Object.entries(d.by_category).map(([cat, val]) => {
        const w = Math.max(3, Math.round(val / total * 100));
        return `<div class="cat-row"><span class="cat-name">${esc(cat)}</span>
          <span class="cat-bar"><i style="width:${w}%"></i></span>
          <span class="cat-val">¥${money(val)}</span></div>`;
      }).join('');
      const anomalies = (d.anomalies || []).map((a) => `
        <div class="anom-row ${a.severity === 'warning' ? 'anom-warn' : ''}">
          <span class="chip ${a.severity === 'warning' ? 'gold' : 'chip-dim'}">${esc(a.rule)}</span>
          <span>${esc(a.detail)}</span>
        </div>`).join('');
      const source = d.source_record;
      html = `
        ${source ? `<div class="small muted">来源：${esc(source.filename)} · 批次 ${esc(source.batch_id)} · 原始 ${esc(source.row_count)} 行 · 任务 ${esc(d.trace_id)}</div>` : '<div class="small muted">来源：固定虚构演示账本</div>'}
        <div class="sub-title">📊 ${esc(d.period)} 支出 ${esc(d.transaction_count)} 笔 · 合计 ¥${money(d.total_spend)}</div>
        <div class="cat-list">${bars}</div>
        ${d.insights && d.insights.length ? `<div class="sub-title">💡 洞察</div><ul class="plain-list">${d.insights.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
        ${anomalies ? `<div class="sub-title">⚠️ 异常交易标记</div>${anomalies}` : ''}`;
    }
    if (result.scenario === 'subscription') {
      const subs = (d.subscriptions || []).map((s) => `
        <tr>
          <td>${esc(s.merchant)}</td>
          <td class="num">¥${money(s.amount)}</td>
          <td>${esc({ monthly: '月付', yearly: '年付', weekly: '周付' }[s.cadence] || s.cadence)}</td>
          <td>${esc(dShort(s.next_charge_at))}</td>
          <td>${s.status === 'active' ? '<span class="chip green">生效中</span>' : '<span class="chip chip-dim">已取消</span>'}</td>
          <td>${s.due_soon ? '<span class="chip gold">即将续费</span>' : ''}</td>
        </tr>`).join('');
      const reminders = (d.renewal_reminders || []).map((r) => `
        <div class="anom-row anom-warn"><span class="chip gold">续费提醒</span>
        <span>${esc(r.merchant)} ¥${money(r.amount)} 将于 ${esc(dShort(r.next_charge_at))} 扣费</span></div>`).join('');
      html = `
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>商户</th><th class="num">金额</th><th>周期</th><th>下次扣费</th><th>状态</th><th></th></tr></thead>
          <tbody>${subs}</tbody>
        </table></div>
        ${reminders ? `<div class="sub-title">⏰ 7 天内续费提醒</div>${reminders}` : ''}`;
    }
    if (result.scenario === 'transfer' && d.balance_query) {
      html = `
        <div class="sub-title">💰 账户余额</div>
        <div class="quick-grid">
          <div class="quick-col">
            <div class="quick-item">可用余额：<b>¥${money(d.balance)}</b></div>
            <div class="quick-item">今日已累计转账：¥${money(d.daily_cumulative)}</div>
          </div>
        </div>
        <div class="muted">绿色权限：查询类操作确认意图后自动执行，无需二次确认。</div>`;
    }
    if (result.scenario === 'transfer' && !d.balance_query) {
      const req = d.request || {};
      const checks = (d.gate_checks || []).map((c) => `
        <div class="gate-row ${c.passed ? '' : 'gate-fail'}">
          <span class="gate-dot ${c.passed ? 'ok' : 'no'}"></span>
          <span class="gate-name">${esc(c.name)}</span>
          <span class="gate-detail">${esc(c.detail)}</span>
        </div>`).join('');
      const aa = (d.aa_items || []).map((a) => `
        <div class="quick-item"><b>${esc(a.label)}</b> ¥${money(a.amount)} <span class="chip gold">待确认</span></div>`).join('');
      html = `
        <div class="sub-title">💸 转账请求</div>
        <div class="quick-grid">
          <div class="quick-col">
            <div class="quick-item">收款人：<b>${esc(req.payee)}</b> ${req.matched_contact ? `<span class="muted">（通讯录：${esc(req.matched_contact.name)}）</span>` : ''}</div>
            <div class="quick-item">金额：<b>¥${money(req.amount)}</b></div>
          </div>
          <div class="quick-col">
            <div class="quick-item">备注：${esc(req.memo || '—')}</div>
            <div class="quick-item">今日已累计：¥${money(d.daily_cumulative)}</div>
          </div>
        </div>
        ${aa ? `<div class="sub-title">🧾 AA 拆分收款</div>${aa}` : ''}
        <div class="sub-title">🛡️ 确定性闸门</div>${checks}`;
    }
    if (result.scenario === 'card') {
      const card = d.card || {};
      const checks = (d.gate_checks || []).map((c) => `
        <div class="gate-row ${c.passed ? '' : 'gate-fail'}">
          <span class="gate-dot ${c.passed ? 'ok' : 'no'}"></span>
          <span class="gate-name">${esc(c.name)}</span>
          <span class="gate-detail">${esc(c.detail)}</span>
        </div>`).join('');
      if (!card.last4 && Array.isArray(d.cards) && d.cards.length) {
        const rows = d.cards.map((c) => `
          <tr>
            <td>尾号 ${esc(c.last4)}</td>
            <td>${esc(c.bank)} ${esc(c.card_type)}</td>
            <td>${c.status === 'normal' ? '<span class="chip green">正常</span>' : '<span class="chip gold">' + esc(c.status) + '</span>'}</td>
            <td class="num">${c.credit_limit ? '¥' + num(c.credit_limit) : '—'}</td>
            <td class="num">¥${num(c.daily_txn_limit)}</td>
          </tr>`).join('');
        html = `
          <div class="sub-title">💳 名下卡片（${d.cards.length} 张）</div>
          <div class="table-wrap"><table class="tbl">
            <thead><tr><th>卡号</th><th>卡片</th><th>状态</th><th class="num">额度</th><th class="num">单日限额</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>`;
      } else if (card.last4) {
        html = `
          <div class="sub-title">💳 尾号 ${esc(card.last4)}（${esc(card.bank)} ${esc(card.card_type)}）</div>
          <div class="quick-grid">
            <div class="quick-col">
              <div class="quick-item">状态：<span class="chip ${card.status === 'normal' ? 'green' : 'gold'}">${esc(card.status)}</span></div>
              <div class="quick-item">额度：${card.credit_limit ? `¥${num(card.credit_limit)}` : '—'}</div>
            </div>
            <div class="quick-col"><div class="quick-item">单日交易限额：¥${num(card.daily_txn_limit)}</div></div>
          </div>
          <div class="sub-title">🛡️ 确定性闸门</div>${checks}`;
      }
    }
    if (result.scenario === 'cross_scene' && d.plan) {
      const steps = (d.plan.steps || []).map((s) => `
        <div class="cs-step">
          <span class="chip ${s.status === 'done' ? 'green' : s.status === 'scheduled' ? 'chip-dim' : 'gold'}">${esc(s.status)}</span>
          <b>${esc(s.label)}</b>
          <div class="muted">${esc(s.detail || '')}</div>
        </div>`).join('');
      const scheduled = (d.plan.scheduled || []).map((s) => `
        <div class="quick-item"><b>📅 ${esc(dShort(s.at))}</b> ${esc(s.action)} ${s.mock ? '<span class="chip chip-dim">Mock</span>' : ''}</div>`).join('');
      const caveats = (d.plan.caveats || []).map((c) => `<li>${esc(c)}</li>`).join('');
      html = `
        <div class="sub-title">🎂 ${esc(d.plan.summary || '')}</div>
        <div class="cs-steps">${steps}</div>
        ${scheduled ? `<div class="sub-title">📅 计划任务</div>${scheduled}` : ''}
        ${caveats ? `<div class="sub-title">ℹ️ 诚实口径</div><ul class="plain-list">${caveats}</ul>` : ''}`;
    }
    return html;
  }

  /* ---------------- 待确认（黄/红）与强验证 ---------------- */

  function renderBankingPending(res) {
    const box = $('#banking-pending');
    const pending = [...((res && res.pending) || []), ...((res && res.scheduled) || [])
      .filter((task) => task.status === 'waiting_due').map((task) => ({ ...task.item, scheduled_at: task.scheduled_at }))];
    if (!pending.length) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <div class="card-head"><h2>六场景 · 待确认事项</h2><span class="tag">黄=确认 ｜ 红=强验证</span></div>
      ${pending.map((p) => `
        <div class="pend-row">
          <div class="pend-main">
            ${tierBadge(p.tier, p.tier === 'red' ? '红色权限' : '黄色权限')}
            <span class="pend-msg">${esc(p.message || '')}</span>
            <span class="muted">${esc(tShort(p.created_at))} · ${p.scheduled_at ? '预约时间' : '有效至'} ${esc(tShort(p.scheduled_at || p.expires_at))}</span>
          </div>
          <div class="pend-actions">
            ${p.scheduled_at ? '<span class="muted">预约等待中，到期后重新确认</span>' : p.tier === 'red' ? renderVerifyForm(p.id) : `
              <button class="btn btn-sm" data-confirm="${esc(p.id)}">确认执行</button>`}
            <button class="btn btn-sm btn-ghost" data-reject="${esc(p.id)}">拒绝</button>
          </div>
        </div>`).join('')}`;
    box.querySelectorAll('[data-confirm]').forEach((btn) => {
      btn.onclick = () => confirmPending(btn.dataset.confirm, null);
    });
    box.querySelectorAll('[data-reject]').forEach((btn) => {
      btn.onclick = () => cancelPending(btn.dataset.reject);
    });
    box.querySelectorAll('[data-verify]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.verify;
        const sms = box.querySelector(`[data-sms="${CSS.escape(id)}"]`).value.trim();
        const face = box.querySelector(`[data-face="${CSS.escape(id)}"]`).checked;
        confirmPending(id, { sms_code: sms, face_verified: face });
      };
    });
  }

  function renderVerifyForm(id) {
    return `
      <span class="verify-box">
        <input type="text" maxlength="6" placeholder="6位短信码" data-sms="${esc(id)}" class="sms-input" />
        <label class="face-check"><input type="checkbox" data-face="${esc(id)}" /> 人脸识别</label>
        <button class="btn btn-sm" data-verify="${esc(id)}">强验证并执行</button>
      </span>`;
  }

  async function confirmPending(id, verification) {
    try {
      const res = await api('/api/scenarios/confirm', {
        method: 'POST', body: { id, verification },
      });
      toast(res.message || '已确认');
      feedback(res.message || (res.success ? '已确认，操作完成。' : '尚未执行，请核对提示。'), res.success ? 'success' : 'error');
      renderBankingPending(res);
      if (res.breaker) renderBreaker(res.breaker);
      if (typeof reloadData === 'function') reloadData();
    } catch (err) {
      toast(`确认失败：${err.message}`);
      feedback(`确认没有完成：${err.message}`, 'error');
    }
  }

  async function cancelPending(id) {
    try {
      const res = await api('/api/scenarios/cancel', { method: 'POST', body: { id } });
      toast(res.message || '已拒绝');
      feedback(res.message || '已取消这项操作。', 'success');
      renderBankingPending(res);
    } catch (err) {
      toast(`操作失败：${err.message}`);
      feedback(`操作没有完成：${err.message}`, 'error');
    }
  }

  /* ---------------- 挂载 ---------------- */

  function dShort(iso) { return String(iso || '').slice(0, 10); }
  function tShort(iso) { return String(iso || '').slice(11, 19); }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = $('#btn-banking-run');
    if (btn) btn.addEventListener('click', runBanking);
    const input = $('#banking-question');
    if (input) input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runBanking();
    });
    const quickBill = $('#quick-bill');
    if (quickBill) quickBill.addEventListener('click', () => runBanking('这个月账单分析'));
    const quickAnomaly = $('#quick-anomaly');
    if (quickAnomaly) quickAnomaly.addEventListener('click', () => runBanking('帮我看看有没有异常交易'));
    const quickGuide = $('#quick-guide');
    if (quickGuide) quickGuide.addEventListener('click', openStatementGuide);
    const closeGuide = $('#close-statement-guide');
    if (closeGuide) closeGuide.addEventListener('click', closeStatementGuide);
    document.querySelectorAll('.source-option').forEach((button) => {
      button.addEventListener('click', () => renderSourceGuide(button.dataset.source));
    });
    const chooseFile = $('#choose-bill-file');
    const fileInput = $('#bill-file');
    if (chooseFile && fileInput) {
      chooseFile.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => handleBillFile(fileInput.files[0]));
    }
    renderSourceGuide('bank');
    bootBanking();
  });
})();
