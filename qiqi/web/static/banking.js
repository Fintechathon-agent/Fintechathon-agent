/* 银行 AI 智能体 · 六场景统一入口（2026-10-11）
   依赖 app.js 的全局工具：api / esc / money / num / toast / tierBadge。
   只负责场景板块自身，不触碰理财旗舰链路 UI。 */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const SCENARIO_ICON = {
    transfer: '💸', bill: '📊', wealth: '🏦',
    card: '💳', subscription: '🔁', cross_scene: '🎂',
  };

  /* ---------------- 场景卡片与概览 ---------------- */

  async function bootBanking() {
    try {
      const data = await api('/api/scenarios/boot');
      renderChips(data.scenarios);
      renderBankingTierMatrix(data.tier_matrix);
      renderQuickState(data);
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
      chip.addEventListener('click', () => {
        const key = chip.dataset.key;
        const meta = scenarios.find((s) => s.key === key);
        if (!meta) return;
        $('#banking-question').value = meta.examples[0] || '';
        $('#banking-question').focus();
      });
    });
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

  async function runBanking() {
    const input = $('#banking-question');
    const question = (input.value || '').trim();
    if (!question) { toast('请先输入一句话请求'); return; }
    const btn = $('#btn-banking-run');
    btn.disabled = true;
    try {
      const res = await api('/api/scenarios/run', { method: 'POST', body: { question } });
      if (res.delegated) {
        $('#banking-result').innerHTML = `
          <div class="assistant-line">🏦 这是理财请求，已交给右侧「组合体检」旗舰闭环处理。
          请到右侧输入框发起（例如「平安银行卖出 30%」）。</div>`;
      } else {
        renderScenarioResult(res.result);
      }
      renderBankingPending(res);
    } catch (err) {
      toast(`发起失败：${err.message}`);
    } finally {
      btn.disabled = false;
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
        ${body}
      </div>`;
    box.dataset.filled = '1';
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
      html = `
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
    const pending = (res && res.pending) || [];
    if (!pending.length) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <div class="card-head"><h2>六场景 · 待确认事项</h2><span class="tag">黄=确认 ｜ 红=强验证</span></div>
      ${pending.map((p) => `
        <div class="pend-row">
          <div class="pend-main">
            ${tierBadge(p.tier, p.tier === 'red' ? '红色权限' : '黄色权限')}
            <span class="pend-msg">${esc(p.message || '')}</span>
            <span class="muted">${esc(tShort(p.created_at))}</span>
          </div>
          <div class="pend-actions">
            ${p.tier === 'red' ? renderVerifyForm(p.id) : `
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
      renderBankingPending(res);
      if (res.breaker) renderBreaker(res.breaker);
      if (typeof reloadData === 'function') reloadData();
    } catch (err) {
      toast(`确认失败：${err.message}`);
    }
  }

  async function cancelPending(id) {
    try {
      const res = await api('/api/scenarios/cancel', { method: 'POST', body: { id } });
      toast(res.message || '已拒绝');
      renderBankingPending(res);
    } catch (err) {
      toast(`操作失败：${err.message}`);
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
    bootBanking();
  });
})();
