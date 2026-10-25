/* ============================================================
   Finance Lab · 金融 AI 安全任务台交互逻辑（无第三方依赖，断网可演示）
   ============================================================ */

const $ = (sel) => document.querySelector(sel);

const S = {
  boot: null,
  review: null,      // /api/review 的返回
  decision: null,    // 最近一次裁决结果
  tab: 'audit',
  auditLimit: 12,    // 审计时间线默认展示条数
  stepTimer: null,
  reviewRevision: 0,
  readOnlyConversation: false,
  riskConversationConfigured: false,
  conversationRequestKey: null,
  conversationFingerprint: null,
};

const SECTOR_COLORS = ['#0d3b2e', '#2f7d63', '#5fa88c', '#9dc0b3', '#c9a24d', '#8c6b4f', '#7c9bb5'];
const OBS_LABELS = {
  sector_concentration: '行业集中度',
  loss_warning: '亏损预警',
  forbidden_sector: '禁止行业',
  risk_score_high: '风险评分偏高',
  risk_warning: '风险信号',
  general: '一般观察',
};
const OUTCOME_LABELS = { profit: '盈利', loss: '亏损', pending: '待验证', rejected: '被拒绝' };
const DETAIL_LABELS = {
  portfolio_value: '组合市值', position_count: '持仓数', action: '动作', symbol: '标的',
  quantity: '数量', result: '结果', reason: '原因', method: '验证方式', channel: '通道',
  sms_code_ok: '短信验证', face_ok: '人脸识别', note: '说明', tier: '权限', removed_files: '清理文件',
  price: '参考价', message: '回执', receipt: '模拟回执',
  intent: '意图', failure_count: '连续失败', breaker_locked: '熔断状态',
};

/* ---------------- 工具 ---------------- */

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: '响应解析失败' }));
  if (!res.ok || data.error) {
    const detail = typeof data.error === 'string' ? data.error : data.error?.message;
    const error = new Error(detail || `HTTP ${res.status}`);
    error.payload = data;
    throw error;
  }
  return data;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const money = (v) => Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v) => Number(v || 0).toLocaleString('zh-CN');
const pct = (v) => `${v >= 0 ? '+' : ''}${Number(v || 0).toFixed(2)}%`;
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'muted');
const wan = (v) => `¥${(Number(v || 0) / 10000).toFixed(1)}万`;
const tShort = (iso) => String(iso || '').slice(11, 19);
const dShort = (iso) => String(iso || '').slice(0, 10);

function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function confBar(v, width = 46) {
  const p = Math.round(Number(v || 0) * 100);
  return `<span class="conf">置信度 <span class="bar" style="width:${width}px"><i style="width:${p}%"></i></span> ${p}%</span>`;
}

function actionBadge(action) {
  const map = { '买入': 'badge-buy', '卖出': 'badge-sell', '持有': 'badge-hold', '调仓': 'badge-rebalance' };
  return `<span class="badge ${map[action] || 'badge-hold'}">${esc(action || '—')}</span>`;
}

function tierBadge(tier, label) {
  const map = { green: 'badge-tier-green', yellow: 'badge-tier-yellow', red: 'badge-tier-red' };
  return `<span class="badge ${map[tier] || 'badge-tier-green'}">${esc(label || tier)}</span>`;
}

function renderIntent(intent, message = '') {
  const box = $('#intent-area');
  if (!intent || !intent.name) { box.innerHTML = ''; return; }
  const slots = Object.entries(intent.slots || {}).map(([k, v]) => (
    `<span class="chip chip-dim">${esc(k)}：${esc(v)}</span>`
  )).join('');
  const missing = (intent.missing || []).map((v) => (
    `<span class="chip gold">待确认：${esc(v)}</span>`
  )).join('');
  box.innerHTML = `
    <div class="intent-row">
      <span class="chip ${intent.blocked ? 'red' : 'green'}">意图：${esc(intent.label)}</span>
      ${slots}${missing}
    </div>
    ${message ? `<div class="assistant-line">${esc(message)}</div>` : ''}`;
}

function renderPlan(plan) {
  const box = $('#agent-steps');
  const nodes = plan?.nodes || [];
  if (!nodes.length) {
    box.innerHTML = '<li><span class="dot"></span>本轮未进入工具执行</li>';
    return;
  }
  const classOf = (status) => ({
    done: 'done', running: 'doing', waiting: 'doing', blocked: 'blocked',
    failed: 'blocked', skipped: 'skip', pending: '',
  }[status] || '');
  box.innerHTML = nodes.map((node, index) => `
    <li class="${classOf(node.status)}" data-step="${index + 1}" title="工具：${esc(node.tool)}">
      <span class="dot"></span>${esc(node.label)}
    </li>`).join('');
}

function renderBreaker(state) {
  const banner = $('#breaker-banner');
  if (!state) { banner.className = 'hidden'; return; }
  const count = Number(state.consecutive_failures || 0);
  if (!state.locked && count === 0) { banner.className = 'hidden'; return; }
  banner.className = `breaker-banner${state.locked ? '' : ' warn'}`;
  banner.innerHTML = `
    <span class="bb-title">${state.locked ? '执行链路已熔断' : `安全事件 ${count}/${state.threshold}`}</span>
    <span class="bb-detail">${state.locked ? '查询与诊断仍可使用；资金操作暂停，需人工确认后恢复。' : '连续干净运行会清零；达到阈值后锁定资金操作。'}</span>
    ${state.locked ? '<button class="btn btn-outline btn-sm" id="btn-breaker-reset">人工确认恢复</button>' : ''}`;
  const reset = $('#btn-breaker-reset');
  if (reset) reset.onclick = async () => {
    if (!confirm('确认已检查异常原因，并恢复资金执行链路？')) return;
    try {
      const result = await api('/api/breaker/reset', { method: 'POST' });
      renderBreaker(result.breaker);
      toast(result.message || '执行链路已恢复');
      await loadTab('audit');
    } catch (err) {
      toast(`恢复失败：${err.message}`);
    }
  };
}

/* ---------------- 顶栏 / 左列 ---------------- */

function renderHeader(boot) {
  const u = boot.user;
  $('#user-chip').innerHTML = `
    <div class="avatar">${esc((u.name || '用')[0])}</div>
    <div><b>${esc(u.name)}</b> · <span>${esc(u.risk_tolerance)} / ${esc(u.investment_horizon)}</span></div>`;
  const eng = boot.meta.engine;
  $('#engine-pill').textContent = `决策引擎：${eng.label}`;
  $('#engine-pill').title = eng.note || '';
  $('#disclaimer').textContent = boot.meta.disclaimer;
}

function renderRiskWorkbench(payload = {}) {
  const health = payload.health || {};
  const risk = payload.risk_report || health.risk_report || {};
  const score = Number(risk.risk_score);
  const scoreKnown = Number.isFinite(score);
  const scoreTone = !scoreKnown ? '' : score >= 70 ? 'is-high' : score >= 40 ? 'is-medium' : '';
  const scoreLabel = !scoreKnown ? '等待数据' : score >= 70 ? '高风险，建议先处理警告' : score >= 40 ? '中等风险，建议关注集中度' : '风险处于可控区间';
  const scoreValue = $('#risk-score-value');
  const scoreCaption = $('#risk-score-caption');
  const scoreBar = $('#risk-score-bar');
  if (!scoreValue) return;

  scoreValue.textContent = scoreKnown ? `${score.toFixed(0)} / 100` : '—';
  scoreValue.className = `risk-score-value ${scoreTone}`.trim();
  scoreCaption.textContent = scoreLabel;
  scoreBar.style.width = `${scoreKnown ? Math.max(0, Math.min(100, score)) : 0}%`;
  scoreBar.className = scoreTone;

  const varValue = Number(risk.var_95);
  const drawdownValue = Number(risk.max_drawdown);
  const correlations = risk.avg_correlation;
  const sectorEntries = Object.entries(risk.sector_concentration || {})
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  const topSector = sectorEntries[0];
  $('#risk-var').textContent = Number.isFinite(varValue) ? `${varValue.toFixed(2)}%` : '—';
  $('#risk-drawdown').textContent = Number.isFinite(drawdownValue) ? `${drawdownValue.toFixed(2)}%` : '—';
  $('#risk-concentration').textContent = topSector ? `${esc(topSector[0])} ${(Number(topSector[1]) * 100).toFixed(1)}%` : '—';
  $('#risk-correlation').textContent = correlations === null || correlations === undefined || !Number.isFinite(Number(correlations))
    ? '暂不可用' : Number(correlations).toFixed(2);

  const warnings = [...new Set([...(risk.warnings || []), ...(health.risk_warnings || [])])];
  $('#risk-warning-list').innerHTML = warnings.length
    ? warnings.slice(0, 4).map((warning) => `<div class="risk-warning ${warning.includes('违规') || warning.includes('超限') ? 'is-blocked' : ''}">⚠ ${esc(warning)}</div>`).join('')
    : '<div class="risk-warning is-clear">✓ 当前没有需要立即处理的风险提示</div>';

  const nextActions = payload.next_actions || health.next_actions || [];
  $('#risk-next-actions').innerHTML = nextActions.length
    ? nextActions.slice(0, 3).map((action) => `<div class="risk-next-action">${esc(action)}</div>`).join('')
    : '<div class="risk-next-action">先发起一次投资体检，获取针对当前组合的建议。</div>';

  const status = $('#risk-workbench-status');
  status.textContent = scoreKnown ? (score >= 70 ? '需要关注' : score >= 40 ? '持续观察' : '风险可控') : '等待评估';
  status.className = `tag ${score >= 70 ? 'tag-danger' : score >= 40 ? 'tag-warn' : 'tag-live'}`;
  $('#risk-generated-at').textContent = risk.generated_at ? `评估时间：${String(risk.generated_at).slice(0, 16).replace('T', ' ')}` : '评估时间：—';
}

function renderStats(boot) {
  const pf = boot.portfolio, h = boot.health;
  const tiles = [
    {
      k: '总资产', v: `¥ ${money(pf.total_assets)}`,
      s: `持仓市值 ¥${money(pf.total_value)} + 现金 ¥${money(pf.cash)}`,
    },
    {
      k: '当日涨跌', v: `${pct(pf.daily_return)}`, c: cls(pf.daily_return),
      s: '按持仓市值加权（演示行情）',
    },
    {
      k: '累计收益率', v: `${pct(pf.total_return)}`, c: cls(pf.total_return),
      s: '持仓成本口径',
    },
    {
      k: '持仓结构', v: `${h.winning_positions} 盈 ${h.losing_positions} 亏`,
      s: `盈利最多 ${esc(h.top_gain.name)} ${pct(h.top_gain.return_pct)} ｜ 亏损最多 ${esc(h.top_loss.name)} ${pct(h.top_loss.return_pct)}`,
    },
  ];
  $('#stat-tiles').innerHTML = tiles.map((t) => `
    <div class="stat">
      <div class="k">${t.k}</div>
      <div class="v ${t.c || ''}">${t.v}</div>
      <div class="s">${t.s}</div>
    </div>`).join('');

  const warns = (h.risk_warnings || []).map((w) => `<span class="chip gold">⚠ ${esc(w)}</span>`).join('');
  $('#health-line').innerHTML = `
    <div>${esc(h.reasoning || '')}</div>
    ${warns ? `<div class="warns">${warns}</div>` : ''}`;

  $('#assets-date').textContent = `${pf.date} · ${boot.meta.data_tag}`;
  renderRiskWorkbench({ health: h, risk_report: h.risk_report });
}

function renderPositions(pf) {
  const rows = pf.positions.map((p) => `
    <tr>
      <td><div class="name">${esc(p.name)}</div><div class="sym">${esc(p.symbol)} · ${esc(p.asset_type)}</div></td>
      <td><span class="sector-chip">${esc(p.sector || '未分类')}</span></td>
      <td class="num">${num(p.quantity)}</td>
      <td class="num">${money(p.avg_cost)}</td>
      <td class="num">${money(p.current_price)}</td>
      <td class="num">${money(p.market_value)}</td>
      <td class="num ${cls(p.gain_loss)}">${p.gain_loss >= 0 ? '+' : ''}${money(p.gain_loss)}</td>
      <td class="num ${cls(p.return_pct)}">${pct(p.return_pct)}</td>
    </tr>`).join('');
  $('#position-table tbody').innerHTML = rows || '<tr><td colspan="8" class="muted">暂无持仓</td></tr>';
}

function renderSector(pf) {
  const alloc = pf.sector_allocation || [];
  const r = 54, cx = 70, cy = 70, C = 2 * Math.PI * r;
  let off = 0;
  const segs = alloc.map((a, i) => {
    const len = C * a.pct;
    const seg = `<circle r="${r}" cx="${cx}" cy="${cy}" fill="none"
      stroke="${SECTOR_COLORS[i % SECTOR_COLORS.length]}" stroke-width="19"
      stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}"
      stroke-dashoffset="${(-off).toFixed(2)}"></circle>`;
    off += len;
    return seg;
  }).join('');
  $('#sector-donut').innerHTML = `
    <svg class="donut" viewBox="0 0 140 140" role="img" aria-label="行业分布">
      <g transform="rotate(-90 70 70)">${segs}</g>
      <text class="donut-k" x="70" y="64" text-anchor="middle">持仓市值</text>
      <text class="donut-v" x="70" y="82" text-anchor="middle">${wan(pf.total_value)}</text>
    </svg>`;

  const cashPct = pf.total_assets ? (pf.cash / pf.total_assets * 100) : 0;
  const rows = alloc.map((a, i) => `
    <div class="legend-row ${a.pct > 0.3 ? 'hot' : ''}">
      <span class="legend-dot" style="background:${SECTOR_COLORS[i % SECTOR_COLORS.length]}"></span>
      <span>${esc(a.sector)}${a.pct > 0.3 ? ' ⚠' : ''}</span>
      <span class="legend-bar"><i style="width:${(a.pct * 100).toFixed(1)}%;background:${SECTOR_COLORS[i % SECTOR_COLORS.length]}"></i></span>
      <span class="legend-val">${(a.pct * 100).toFixed(1)}% · ${wan(a.value)}</span>
    </div>`).join('');
  $('#sector-legend').innerHTML = rows +
    `<div class="muted" style="font-size:11.5px;margin-top:2px">现金 ¥${money(pf.cash)} 未计入持仓分布（占总资产 ${cashPct.toFixed(1)}%）</div>`;
}

function renderBrief(brief) {
  $('#brief-time').textContent = brief.generated_at;
  $('#brief-box').innerHTML = `
    <ol>${brief.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
    <div class="dis">${esc(brief.disclaimer)}</div>`;
}

function renderNews(news) {
  $('#news-list').innerHTML = news.length ? news.map((n) => {
    const kind = n.sentiment > 0.05 ? 'pos' : n.sentiment < -0.05 ? 'neg' : 'neu';
    const word = n.sentiment > 0.05 ? '偏正面' : n.sentiment < -0.05 ? '偏负面' : '中性';
    return `
      <div class="news-item">
        <div class="nt">${esc(n.title)}</div>
        <div class="nm">
          <span>${esc(n.name)}</span>
          <span class="senti ${kind}">${word} ${Number(n.sentiment).toFixed(2)}</span>
          <span>${esc(n.source)}</span>
        </div>
      </div>`;
  }).join('') : '<div class="muted">暂无资讯</div>';
}

function renderTierMatrix(rows) {
  $('#tier-matrix').innerHTML = rows.map((t) => `
    <div class="tier-row">
      <div class="lv lv-${t.tier}">${esc(t.label)}</div>
      <div class="txt"><b>${esc(t.items)}</b><span>${esc(t.policy)}</span></div>
    </div>`).join('');
}

/* ---------------- 待确认事项 ---------------- */

function renderApprovals(list) {
  const card = $('#card-approvals');
  if (S.readOnlyConversation) {
    card.classList.add('hidden');
    $('#approvals-list').replaceChildren();
    return;
  }
  $('#approvals-count').textContent = `${list.length} 项`;
  if (!list.length) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  $('#approvals-list').innerHTML = list.map((a) => `
    <div class="appr">
      <div class="t">${esc(a.action)} ${esc(a.name || a.symbol)} <span class="mono">${esc(a.symbol)}</span>
        · ${num(a.quantity)} 股 @ ${money(a.price)}</div>
      <div class="d">${esc(a.reason || '')}</div>
      <div class="d">${tierBadge(a.tier, a.tier_label)} ${confBar(a.confidence)}</div>
      <div class="acts">
        <button class="btn btn-danger btn-sm" data-confirm="${esc(a.id)}">确认执行</button>
        <button class="btn btn-outline btn-sm" data-reject="${esc(a.id)}">拒绝</button>
      </div>
    </div>`).join('');

  $('#approvals-list').querySelectorAll('[data-confirm]').forEach((b) => {
    b.onclick = () => {
      const a = list.find((x) => x.id === b.dataset.confirm);
      if (a) openConfirm(a);
    };
  });
  $('#approvals-list').querySelectorAll('[data-reject]').forEach((b) => {
    b.onclick = () => rejectApproval(b.dataset.reject);
  });
}

/* ---------------- 组合体检 ---------------- */

function resetSteps() {
  clearInterval(S.stepTimer);
  S.stepTimer = null;
  document.querySelectorAll('#agent-steps li').forEach((li) => li.className = '');
}

function markStep(n, c) {
  const li = document.querySelector(`#agent-steps li[data-step="${n}"]`);
  if (li) li.className = c;
}

function animateSteps() {
  resetSteps();
  let i = 1;
  markStep(1, 'doing');
  S.stepTimer = setInterval(() => {
    markStep(i, 'done');
    i += 1;
    if (i >= 7) { clearInterval(S.stepTimer); S.stepTimer = null; markStep(7, 'doing'); return; }
    markStep(i, 'doing');
  }, 380);
}

async function runReview() {
  if ($('#btn-review').disabled) return;
  const revision = ++S.reviewRevision;
  const btn = $('#btn-review');
  btn.disabled = true;
  S.readOnlyConversation = $('#daily-finance-enable').checked || S.riskConversationConfigured;
  if (S.readOnlyConversation) renderApprovals([]);
  $('#agent-status').textContent = '体检中…';
  $('#rec-area').innerHTML = '<div class="muted" style="margin-top:14px">Agent 正在分析，请稍候…</div>';
  resetSteps();
  $('#agent-steps').innerHTML = '<li class="doing"><span class="dot"></span>正在解析意图并生成 DAG…</li>';

  try {
    const q = ($('#nl-question').value || '').trim();
    const body = { question: q || '请检查我的持仓健康状况' };
    if ($('#daily-finance-enable').checked) {
      body.daily_finance_yuan = dailyFinanceInput();
    }
    // Keep a request key for an unchanged draft, including transport retries.
    // Only in-memory state is used; no financial data is persisted in storage.
    const fingerprint = JSON.stringify(body);
    if (S.conversationFingerprint !== fingerprint || !S.conversationRequestKey) {
      S.conversationFingerprint = fingerprint;
      S.conversationRequestKey = 'conversation-' + crypto.randomUUID();
    }
    body.idempotency_key = S.conversationRequestKey;
    const data = await api('/api/review', { method: 'POST', body });
    if (revision !== S.reviewRevision) return;
    clearInterval(S.stepTimer);
    S.stepTimer = null;
    S.review = data;
    S.decision = null;
    S.readOnlyConversation = data.conversation_mode === 'READ_ONLY_CONVERSATION' || Boolean(data.risk_advice);

    renderIntent(data.intent, data.assistant_message);
    renderPlan(data.plan);
    if (data.breaker) renderBreaker(data.breaker);
    renderRecommendation(data);

    if (S.readOnlyConversation) {
      renderApprovals([]);
      $('#agent-status').textContent = conversationStatus(data);
      return;
    }

    if (data.circuit_locked) {
      $('#agent-status').textContent = '熔断锁定';
      await reloadData();
      return;
    }

    const tier = data.recommendation?.tier || 'green';
    if (data.queued) {
      markStep(9, 'doing');
    } else {
      markStep(9, tier === 'green' ? 'skip' : 'done');
    }

    renderApprovals((await api('/api/approvals')).approvals);
    await reloadData();
    // 状态措辞：等待审批 ≠ 完成；规则决策必须标注来源（演示模式透明度）
    const sourceNote = data.decision_source === 'rules' ? ' · 规则决策（演示）' : '';
    $('#agent-status').textContent = data.queued
      ? '等待审批'
      : data.recommendation
        ? `已完成${sourceNote} · ${(data.elapsed_ms / 1000).toFixed(1)}s`
        : '等待补充';
  } catch (err) {
    if (revision !== S.reviewRevision) return;
    clearInterval(S.stepTimer);
    S.stepTimer = null;
    markStep(6, 'skip');
    $('#agent-status').textContent = '失败';
    $('#rec-area').innerHTML = `<div class="alert bad">体检失败：${esc(err.message)}</div>`;
    if (err.payload?.risk_advice) {
      S.readOnlyConversation = true;
      renderRiskAdvice(err.payload);
      renderApprovals([]);
      $('#agent-status').textContent = err.payload.risk_callback?.status === 'UNKNOWN'
        ? conversationStatus(err.payload) : '模型或交接失败 · 未执行';
    }
  } finally {
    btn.disabled = false;
    if ($('#agent-status').textContent === '体检中…') $('#agent-status').textContent = '待发起';
  }
}

function dailyFinanceInput() {
  const read = (id) => $(id).value.trim() || null;
  return {
    cash_yuan: read('#daily-cash'), amount_yuan: read('#daily-amount'),
    fees_yuan: read('#daily-fees'), holds_yuan: read('#daily-holds'),
    floor_yuan: read('#daily-floor'), purpose_yuan: read('#daily-purpose'),
    due_yuan: read('#daily-due'), due_date: read('#daily-due-date'),
    purpose_label: read('#daily-purpose-label'),
    facts_confirmed: $('#daily-facts-confirmed').checked,
    purpose_confirmed: $('#daily-purpose-confirmed').checked,
  };
}

function invalidateConversation() {
  S.reviewRevision += 1;
  S.conversationRequestKey = null;
  S.conversationFingerprint = null;
  if (S.review?.risk_advice || S.readOnlyConversation) {
    S.review = null;
    $('#rec-area').innerHTML = '<p class="alert">输入已修改，旧结论不再适用，请重新发起核对。</p>';
    $('#agent-status').textContent = '输入已修改 · 待重新核对';
    renderApprovals([]);
  }
}

function minorMoney(value) {
  if (!Number.isSafeInteger(value)) return '尚未知';
  const amount = BigInt(value), absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}¥${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function readableAction(value) {
  if (typeof value === 'string') return value;
  return value?.message_zh || value?.message || value?.title || value?.action || '';
}

function conversationStatus(data) {
  if (data.risk_callback?.status === 'UNKNOWN') return '回写结果待核查 · 未执行';
  if (data.risk_advice?.decision === 'ERROR') return '检查异常 · 未执行';
  if (data.risk_advice?.decision === 'BLOCK') return '已阻止 · 未执行';
  if (data.risk_advice?.decision === 'REVIEW') return '需要补充或复核 · 未执行';
  if (data.execution_state === 'awaiting_approval') return '等待审批 · 未执行';
  if (data.execution_state === 'awaiting_risk') return '等待风险交接 · 未执行';
  return data.model_status === 'live' ? '仅完成分析 · 未执行' : '模型说明未返回 · 未执行';
}

function renderRiskAdvice(data) {
  const advice = data.risk_advice || {}, metrics = advice.metrics || {};
  const failureMessage = typeof data.error === 'string' ? data.error : data.error?.message;
  const failureCode = typeof data.error === 'object' ? data.error?.code : data.error_code;
  const failure = data.error
    ? `<div class="alert bad" role="alert">模型或交接失败，未执行：${esc(failureMessage || '服务返回异常，请核查本次任务。')}${failureCode ? `（${esc(failureCode)}）` : ''}</div>`
    : '';
  const labels = { ALLOW: '通过资金检查', REVIEW: '需要补充或复核', BLOCK: '当前安排不可继续', ERROR: '检查异常，保持暂停' };
  const states = { awaiting_approval: '等待审批，未执行', awaiting_risk: '等待风险处理，未执行', blocked: '已阻止，未执行', not_executed: '未执行' };
  const callback = { RECORDED: 'Core 已记录', DUPLICATE: '原记录已存在', NOT_SENT: '尚未发送', UNKNOWN: '接收结果待核查' };
  const fields = [
    ['free_before_minor', '本次安排前可分配资金'], ['action_total_minor', '本次金额与费用合计'],
    ['projected_free_after_minor', '安排后预计可分配资金'], ['shortfall_minor', '预计资金缺口'],
    ['holds_before_minor', '其他任务已占用'], ['protected_before_minor', '已确认用途预留'],
  ];
  const reasons = Array.isArray(advice.reasons) ? advice.reasons : [];
  const actions = Array.isArray(advice.next_actions) ? advice.next_actions : [];
  const purposes = Array.isArray(advice.protected_purposes) ? advice.protected_purposes : [];
  const purposeConfirmed = advice.input_confirmation?.purposes_confirmed === true;
  const executionNote = data.risk_callback?.status === 'UNKNOWN'
    ? 'Core 风险回写结果未知，请先核查原任务；暂不重发或执行。'
    : (states[data.execution_state] || '本次仅作核对，未执行');
  const raw = data.model_raw ?? data.model?.model_response?.raw_text ?? data.model?.model_response?.raw_response ?? null;
  $('#card-gate').classList.add('hidden');
  $('#card-whatif').classList.add('hidden');
  $('#rec-area').innerHTML = `<section class="conversation-result" aria-label="本次资金安排核对结果">
    ${failure}
    <h3>${esc(labels[advice.decision] || '检查结果待核实')}</h3>
    <p>${esc(advice.summary || data.assistant_message || '请查看具体原因并补充资料。')}</p>
    <p class="sim-note">${esc(advice.notice_zh || '虚构数据核对。程序结论与模型说明分开；未授权或执行任何投资、付款。')}</p>
    <h4>程序核对的金额</h4><dl>${fields.filter(([key]) => key in metrics).map(([key, label]) => `<dt>${esc(label)}</dt><dd>${esc(minorMoney(metrics[key]))}</dd>`).join('')}</dl>
    ${purposes.length ? `<h4>${purposeConfirmed ? '这笔钱为什么需要保留' : '待确认的资金用途'}</h4><ul>${purposes.map(purpose => `<li>${esc(purpose.label || purpose.name || purpose.purpose_label || '用途')}（${purposeConfirmed ? '用户已确认' : '尚待用户确认'}）：预留 ${esc(minorMoney(purpose.reserved_now_minor))}，待付 ${esc(minorMoney(purpose.remaining_due_minor))}${purpose.due_at || purpose.due_date ? `，到期 ${esc(purpose.due_at || purpose.due_date)}` : ''}</li>`).join('')}</ul>` : ''}
    ${reasons.length ? `<h4>判断原因</h4><ul>${reasons.map(reason => `<li>${esc(readableAction(reason))}${reason.recovery?.message_zh ? `；${esc(reason.recovery.message_zh)}` : ''}</li>`).join('')}</ul>` : ''}
    ${actions.length ? `<h4>接下来可以做什么</h4><ul>${actions.map(action => `<li>${esc(readableAction(action))}</li>`).join('')}</ul>` : ''}
    <p class="alert">${esc(executionNote)}。资金检查通过也不代表用户已授权。</p>
    <details><summary>模型说明（${data.model_status === 'live' && data.decision_source === 'model' ? '真实返回' : '未取得有效返回'}）</summary>
      <p>模型只解释程序结论，不能更改保护用途、审批或执行权限。</p>
      <pre>${esc(raw === null ? '本次没有可展示的模型原文，未切换为模拟成功。' : typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2))}</pre>
    </details>
    <details><summary>查看本次任务与审计关联</summary><dl>
      <dt>运行编号</dt><dd>${esc(data.run_id || '尚未取得')}</dd>
      <dt>任务编号</dt><dd>${esc(data.task_id || '尚未取得')}</dd>
      <dt>审计编号</dt><dd>${esc(data.audit_id || '尚未取得')}</dd>
      <dt>风险回写</dt><dd>${esc(callback[data.risk_callback?.status] || '尚未完成')}</dd>
      <dt>风险原因代码</dt><dd>${esc(reasons.map(reason => reason.code).filter(Boolean).join('、') || '无')}</dd>
    </dl></details>
  </section>`;
}

function renderRecommendation(data) {
  if (data.risk_advice || data.engine === 'risk-conversation') { renderRiskAdvice(data); return; }
  const r = data.recommendation;
  const area = $('#rec-area');
  renderRiskWorkbench(data);
  renderGate(data.gate);
  renderWhatIf(data.whatif);

  if (!r) {
    const tone = data.intent?.blocked ? ' bad' : '';
    area.innerHTML = `<div class="alert${tone}">${esc(data.assistant_message || data.risk_alert || '本轮未进入建议生成。')}</div>`;
    return;
  }

  const decided = S.decision && S.decision.id === data.approval_id;
  const desc = r.action === '持有'
    ? `<b>${esc(r.action)}</b>`
    : `<b>${esc(r.action)}</b> ${esc(r.name)} <span class="mono">${esc(r.symbol)}</span> · ${num(r.quantity)} 股 @ ${money(r.price)} 元`;
  const amountLine = r.action === '持有' ? '' : `<div>参考金额 <b>¥${money(r.amount)}</b></div>`;

  const alertBox = data.risk_alert ? `<div class="alert">${esc(data.risk_alert)}</div>` : '';
  const nextActions = (data.next_actions || []).length
    ? `<div class="rec-section"><h4>下一步建议</h4><ul>${data.next_actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>`
    : '';
  const evidence = (r.evidence || []).length
    ? `<div class="rec-section"><h4>判断依据（数字来自工具层，LLM 不改写数值）</h4><ul>${r.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`
    : '';

  let actionsHtml = '';
  let doneHtml = '';
  const blocked = r.tier === 'blocked';

  if (blocked) {
    doneHtml = '<div class="rec-done" style="background:#fdf1f1;color:#b42318">⛔ 该建议未通过风控闸门，不会执行，也不进入确认队列</div>';
  } else if (decided && S.decision.executed) {
    doneHtml = `<div class="rec-done">✓ 已确认执行 · 纸交易回执：${esc(S.decision.message || '')}</div>`;
  } else if (decided && !S.decision.executed && S.decision.rejected) {
    doneHtml = '<div class="rec-done" style="background:#fdf1f1;color:#b42318">✕ 该建议已被用户拒绝，未执行任何操作</div>';
  } else if (r.tier === 'red' && data.queued) {
    actionsHtml = `
      <div class="rec-actions">
        <button class="btn btn-danger" id="btn-confirm">确认执行（${esc(r.tier_label)}）</button>
        <button class="btn btn-outline" id="btn-reject">拒绝</button>
      </div>`;
  } else if (r.tier === 'green') {
    const note = r.lot_note
      ? esc(r.lot_note)
      : '绿色权限：查询、诊断与推演类操作自动执行，本次无需确认。';
    actionsHtml = `<div class="rec-actions muted">${note}</div>`;
  }

  area.innerHTML = `
    <div class="rec">
      <div class="rec-top">
        ${actionBadge(r.action)} ${tierBadge(r.tier, r.tier_label)}
        <div class="rec-title">${desc}</div>
      </div>
      <div class="rec-meta">
        <span class="conf-big">置信度
          <span class="bar"><i style="width:${Math.round(r.confidence * 100)}%"></i></span>
          <b>${(r.confidence * 100).toFixed(0)}%</b>
        </span>
        ${amountLine}
        <div>决策引擎 <b>${esc(data.engine)}</b></div>
        <div>会话 <span class="mono">${esc(data.session_id)}</span></div>
      </div>
      <div class="rec-section"><h4>理由</h4><p>${esc(r.reason)}</p></div>
      ${evidence}
      <div class="rec-two">
        <div class="rec-section"><h4>风险影响</h4><p>${esc(r.risk_impact || '—')}</p></div>
        <div class="rec-section"><h4>备选方案</h4><p>${esc(r.alternative || '—')}</p></div>
      </div>
      ${nextActions}
      ${doneHtml}
      ${actionsHtml}
    </div>
    ${alertBox}`;

  const cb = $('#btn-confirm');
  if (cb) cb.onclick = () => openConfirm(approvalFromReview(data));
  const rb = $('#btn-reject');
  if (rb) rb.onclick = () => rejectApproval(data.approval_id);
}

function approvalFromReview(data) {
  const r = data.recommendation;
  return {
    id: data.approval_id, action: r.action, symbol: r.symbol, name: r.name,
    quantity: r.quantity, price: r.price, amount: r.amount, reason: r.reason,
    evidence: r.evidence, risk_impact: r.risk_impact, alternative: r.alternative,
    tier: r.tier, tier_label: r.tier_label, confidence: r.confidence,
  };
}

/* ---------------- 风控闸门 ---------------- */

function renderGate(gate) {
  const card = $('#card-gate');
  if (!gate) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  const passed = gate.passed;
  $('#gate-verdict').textContent = passed
    ? `通过 · ${gate.checks.length} 项检查`
    : `拦截 · ${gate.block_count} 项未通过`;
  $('#gate-verdict').className = passed ? 'tag tag-live' : 'tag tag-danger';

  $('#gate-checks').innerHTML = `
    ${!passed ? `<div class="alert bad">
      ⛔ 本建议已被风控拦截，不会进入执行链路${gate.fail_closed ? '（检查过程异常，按保守原则拦截）' : ''}：
      <ul style="margin:6px 0 0">${gate.blocked_reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    </div>` : ''}
    ${gate.checks.map((c) => `
      <div class="gate-row ${c.passed ? '' : 'bad'}">
        <span class="gate-ic">${c.passed ? '✓' : (c.severity === 'warn' ? '!' : '✕')}</span>
        <div>
          <b>${esc(c.name)}</b>
          <span>${esc(c.detail || '')}</span>
        </div>
      </div>`).join('')}`;
}

/* ---------------- 情景推演 ---------------- */

function renderWhatIf(whatif) {
  const card = $('#card-whatif');
  if (!whatif) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  if (!whatif.executable) {
    $('#whatif-verdict').innerHTML = `<div class="alert">该情景无法执行：${esc(whatif.infeasible_reason || '—')}</div>`;
    $('#whatif-deltas').innerHTML = '';
    $('#whatif-note').textContent = whatif.caveats?.length ? `说明：${whatif.caveats.join('；')}` : '';
    return;
  }

  const net = whatif.net_risk_delta;
  const tone = whatif.net_positive ? 'up' : 'down';
  $('#whatif-verdict').innerHTML = `
    <div class="whatif-scenario">${esc(whatif.scenario)}</div>
    <div class="whatif-verdict-line">
      <span class="badge ${whatif.net_positive ? 'badge-tier-green' : 'badge-tier-yellow'}">
        改善 ${whatif.improved_count} · 恶化 ${whatif.worsened_count} · 持平 ${whatif.unchanged_count}
      </span>
      <span class="${cls(-net)}">风险评分变化 ${net >= 0 ? '+' : ''}${net} 分</span>
    </div>
    <div class="whatif-text">${esc(whatif.verdict)}</div>`;

  $('#whatif-deltas').innerHTML = whatif.deltas.map((d) => {
    const flat = Math.abs(d.delta) < 1e-9;
    const dir = flat ? 'flat' : (d.improved ? 'good' : 'bad');
    return `
      <div class="delta-row ${d.counted ? '' : 'ref'}">
        <div class="delta-k">${esc(d.metric)}${d.counted ? '' : ' <span class="muted">（参考）</span>'}</div>
        <div class="delta-v">
          <span class="mono">${fmtVal(d.before, d.unit)}</span>
          <span class="arrow">→</span>
          <span class="mono">${fmtVal(d.after, d.unit)}</span>
          <span class="delta-tag ${dir}">${flat ? '持平' : `${d.delta > 0 ? '↑' : '↓'}${fmtVal(Math.abs(d.delta), d.unit)}`}</span>
        </div>
      </div>`;
  }).join('');

  $('#whatif-note').innerHTML = (whatif.caveats || []).length
    ? `说明：${whatif.caveats.map(esc).join('；')}`
    : '';
}

function fmtVal(v, unit) {
  if (unit === '元') return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  if (unit === '%' || unit === '分') return `${Number(v).toFixed(1)}${unit}`;
  return `${Number(v)}${unit || ''}`;
}

/* ---------------- 审计 / 记忆 / 纸交易 ---------------- */

function detailChips(entry) {
  const skip = new Set(['timestamp', 'action', 'label', 'user_id', 'session_id', 'result', 'nodes', 'breaker', 'slots', 'missing']);
  const chips = [];
  Object.entries(entry).forEach(([k, v]) => {
    if (skip.has(k) || v === '' || v === null || v === undefined) return;
    let text = k === 'receipt' && v.message ? v.message
      : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (k === 'portfolio_value' || k === 'price') text = `¥${money(text)}`;
    if (k === 'quantity') text = `${num(text)} 股`;
    if (k === 'result' && typeof v === 'boolean') text = v ? '通过' : '未通过';
    const label = DETAIL_LABELS[k] || k;
    const tone = (k === 'tier' || (k === 'method' && text.includes('强验证'))) ? 'red' : '';
    chips.push(`<span class="chip ${tone}">${esc(label)}：${esc(text)}</span>`);
  });
  return chips.join('');
}

function renderAudit(entries) {
  const box = $('#tab-audit');
  if (!entries.length) { box.innerHTML = '<div class="muted">暂无审计记录，先发起一次组合体检。</div>'; return; }

  // 默认只渲染最近若干条：完整审计链会持续增长，全部铺开会把页面撑得过长
  const shown = entries.slice(0, S.auditLimit);
  const groups = {};
  shown.forEach((e) => { (groups[dShort(e.timestamp)] ||= []).push(e); });

  const more = entries.length > shown.length
    ? `<button class="btn btn-outline btn-sm" id="btn-more-audit">展开更早的 ${entries.length - shown.length} 条</button>`
    : '';

  box.innerHTML = Object.entries(groups).map(([day, list]) => `
    <div class="tl-group">
      <div class="tl-date">${esc(day)}</div>
      ${list.map((e, i) => `
        <div class="tl-item">
          <div class="tl-rail">
            <span class="tl-dot ${e.result === 'failure' ? 'failure' : e.result === 'pending' ? 'pending' : ''}"></span>
            ${i < list.length - 1 ? '<span class="tl-line"></span>' : ''}
          </div>
          <div class="tl-body">
            <div class="tl-head">
              <b>${esc(e.label)}</b>
              <time>${esc(tShort(e.timestamp))}</time>
              <span class="chip ${e.result === 'failure' ? 'red' : 'green'}">${e.result === 'failure' ? '失败' : e.result === 'pending' ? '待处理' : '成功'}</span>
            </div>
            <div class="tl-chips">${detailChips(e)}</div>
            <details class="raw"><summary>原始记录</summary><pre>${esc(JSON.stringify(e, null, 2))}</pre></details>
          </div>
        </div>`).join('')}
    </div>`).join('') + more;

  const btn = $('#btn-more-audit');
  if (btn) btn.onclick = () => { S.auditLimit += 40; renderAudit(entries); };
}

function memEntry(e) {
  const badges = [];
  if (e.outcome) badges.push(`<span class="chip">${esc(OUTCOME_LABELS[e.outcome] || e.outcome)}</span>`);
  if (e.observation_type) badges.push(`<span class="chip">${esc(OBS_LABELS[e.observation_type] || e.observation_type)}</span>`);
  if (e.version) badges.push(`<span class="chip">v${esc(e.version)}</span>`);
  if (e.success_count) badges.push(`<span class="chip green">成功 ${esc(e.success_count)} 次</span>`);
  if (e.failure_count) badges.push(`<span class="chip red">失败 ${esc(e.failure_count)} 次</span>`);
  if (e.superseded_by) badges.push('<span class="chip">已被替代</span>');
  if (e.reinforce_count > 1) badges.push(`<span class="chip">强化 ${esc(e.reinforce_count)} 次</span>`);
  (e.tags || []).slice(0, 4).forEach((t) => badges.push(`<span class="chip">#${esc(t)}</span>`));
  const fb = e.user_feedback ? `<div class="mem-fb">用户反馈：${esc(e.user_feedback)}</div>` : '';
  return `
    <div class="mem-entry ${e.superseded_by ? 'dead' : ''}">
      <div class="content">${esc(e.content)}</div>
      ${fb}
      <div class="mem-meta">
        ${confBar(e.confidence)}
        ${badges.join('')}
        <span class="chip">${esc(dShort(e.updated_at))} 更新</span>
      </div>
    </div>`;
}

function renderMemory(mem) {
  const box = $('#tab-memory');
  const layers = mem.layers.map((L) => `
    <div class="mem-layer">
      <h4>${esc(L.name)} <span class="cnt">${L.count} 条有效</span></h4>
      <div class="desc">${esc(L.desc)}</div>
      ${L.entries.length ? L.entries.map(memEntry).join('') : '<div class="mem-empty">暂无记录</div>'}
    </div>`).join('');
  const recs = mem.recommendations.length ? `
    <div class="mem-layer" style="grid-column:1/-1">
      <h4>建议历史 <span class="cnt">${mem.recommendations.length} 条</span></h4>
      <div class="desc">每次体检的建议与用户反馈都会写入经验层，影响下次判断</div>
      <table class="tbl compact"><thead><tr>
        <th>时间</th><th>建议</th><th>标的</th><th class="num">数量</th><th class="num">价格</th><th>反馈</th>
      </tr></thead><tbody>
      ${mem.recommendations.map((r) => `
        <tr>
          <td>${esc(String(r.timestamp || '').slice(5, 16).replace('T', ' '))}</td>
          <td>${esc(r.action)}</td><td>${esc(r.symbol)}</td>
          <td class="num">${num(r.quantity)}</td><td class="num">${money(r.price)}</td>
          <td>${r.approved === true ? '<span class="chip green">已确认</span>' : r.approved === false ? '<span class="chip red">已拒绝</span>' : '<span class="chip">待确认</span>'}</td>
        </tr>`).join('')}
      </tbody></table>
    </div>` : '';
  box.innerHTML = `
    ${mem.summary ? `<div class="mem-summary">记忆摘要：${esc(mem.summary)}</div>` : ''}
    <div class="mem-grid">${layers}${recs}</div>`;
}

function renderTrades(trades) {
  const box = $('#tab-trades');
  if (!trades.length) {
    box.innerHTML = '<div class="muted">暂无纸交易记录。确认执行一条建议后，这里会出现模拟成交回执。</div>';
    return;
  }
  box.innerHTML = `
    <div class="table-wrap"><table class="tbl compact">
      <thead><tr>
        <th>成交时间</th><th>动作</th><th>标的</th><th class="num">数量</th>
        <th class="num">成交价</th><th class="num">金额</th><th class="num">手续费</th><th>状态</th>
      </tr></thead><tbody>
      ${trades.map((t) => `
        <tr>
          <td>${esc(String(t.timestamp || '').slice(5, 19).replace('T', ' '))}</td>
          <td>${actionBadge(t.action)}</td>
          <td class="mono">${esc(t.symbol)}</td>
          <td class="num">${num(t.quantity)}</td>
          <td class="num">${money(t.price)}</td>
          <td class="num">${money(t.amount)}</td>
          <td class="num">${money(t.commission)}</td>
          <td><span class="chip green">${t.status === 'filled' ? '已成交（模拟）' : esc(t.status)}</span></td>
        </tr>`).join('')}
      </tbody></table></div>
    <div class="sim-note">纸交易：不连接真实账户、不产生真实资金动作，仅用于演示执行链路与审计留痕。</div>`;
}

async function loadTab(name) {
  S.tab = name;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  ['audit', 'memory', 'trades'].forEach((k) => $(`#tab-${k}`).classList.toggle('hidden', k !== name));
  if (name === 'audit') renderAudit((await api('/api/audit')).entries);
  if (name === 'memory') renderMemory(await api('/api/memory'));
  if (name === 'trades') renderTrades((await api('/api/trades')).trades);
}

async function reloadData() {
  const boot = await api('/api/bootstrap');
  S.boot = boot;
  renderStats(boot);
  renderPositions(boot.portfolio);
  renderSector(boot.portfolio);
  renderBrief(boot.brief);
  renderNews(boot.news);
  renderApprovals(boot.approvals);
  renderBreaker(boot.breaker);
  await loadTab(S.tab);
}

/* ---------------- 确认 / 强验证 ---------------- */

function closeModal() { $('#modal-root').innerHTML = ''; }

function openConfirm(a) {
  if (S.readOnlyConversation) return toast('本次仅核对资金安排，尚未接入可信执行授权。');
  const isRed = a.tier === 'red';
  $('#modal-root').innerHTML = `
    <div class="modal-mask" id="mask">
      <div class="modal" role="dialog" aria-modal="true">
        <h3>操作详情确认</h3>
        <div class="sub">请确认以下即将执行的操作。${isRed ? '资金操作属于<strong>红色权限</strong>，需通过多因子强验证。' : '该操作需您的明确确认。'}</div>
        <div class="kv-grid">
          <div><div class="k">操作对象</div><div class="v">${esc(a.name || a.symbol)} <span class="mono">${esc(a.symbol)}</span></div></div>
          <div><div class="k">操作方向</div><div class="v">${esc(a.action)}</div></div>
          <div><div class="k">数量</div><div class="v">${num(a.quantity)} 股</div></div>
          <div><div class="k">参考价</div><div class="v">¥${money(a.price)}</div></div>
          <div><div class="k">参考金额</div><div class="v">¥${money(a.amount)}</div></div>
          <div><div class="k">权限级别</div><div class="v">${tierBadge(a.tier, a.tier_label)}</div></div>
        </div>
        <div class="block"><h4>理由</h4><p>${esc(a.reason || '—')}</p></div>
        ${(a.evidence || []).length ? `<div class="block"><h4>判断依据</h4><ul>${a.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
        <div class="block"><h4>执行后果 / 风险影响</h4><p>${esc(a.risk_impact || '—')}</p></div>
        <div class="block"><h4>备选方案</h4><p>${esc(a.alternative || '—')}</p></div>
        <label class="check"><input type="checkbox" id="ack">
          <span>我已阅读并理解上述操作详情与后果。演示环境：不会发生真实资金交易。</span></label>
        <div class="foot">
          <button class="btn btn-ghost" id="btn-cancel">取消</button>
          <button class="btn btn-danger" id="btn-next" disabled>${isRed ? '下一步：强验证' : '确认执行'}</button>
        </div>
      </div>
    </div>`;

  const ack = $('#ack'), next = $('#btn-next');
  ack.onchange = () => { next.disabled = !ack.checked; };
  $('#btn-cancel').onclick = closeModal;
  $('#mask').onclick = (e) => { if (e.target.id === 'mask') closeModal(); };
  next.onclick = () => { if (isRed) renderVerifyStep(a); else submitDecision(a, { approved: true }); };
}

function renderVerifyStep(a) {
  $('#modal-root').innerHTML = `
    <div class="modal-mask" id="mask">
      <div class="modal" role="dialog" aria-modal="true">
        <h3>红色权限 · 强验证</h3>
        <div class="sub">多因子验证（短信验证码 + 人脸识别）。演示环境为 Mock，不发送真实短信。</div>
        <div class="verify-step">
          <div class="verify-box">
            <h4>① 短信验证码</h4>
            <p>已向尾号 8823 的手机号发送验证码（演示：任意 6 位数字即可通过）</p>
            <div class="verify-row">
              <input id="sms" maxlength="6" inputmode="numeric" placeholder="6 位验证码">
              <button class="btn btn-outline btn-sm" id="btn-sms">获取验证码</button>
            </div>
          </div>
          <div class="verify-box">
            <h4>② 人脸识别</h4>
            <p>点击开始后请正对摄像头（演示：模拟 1.2 秒识别过程）</p>
            <div class="face-btn">
              <div class="face-ring" id="face-ring">◎</div>
              <button class="btn btn-outline btn-sm" id="btn-face">开始人脸识别</button>
              <span class="muted" id="face-state">未开始</span>
            </div>
          </div>
        </div>
        <div class="foot">
          <button class="btn btn-ghost" id="btn-back">返回</button>
          <button class="btn btn-danger" id="btn-submit" disabled>提交执行</button>
        </div>
      </div>
    </div>`;

  let faceOk = false;
  const sms = $('#sms'), submit = $('#btn-submit');
  const refresh = () => {
    submit.disabled = !(faceOk && /^\d{6}$/.test(sms.value.trim()));
  };

  sms.oninput = refresh;
  $('#btn-sms').onclick = () => toast('演示环境：未发送真实短信，输入任意 6 位数字即可。', 3600);
  $('#btn-face').onclick = () => {
    const ring = $('#face-ring');
    ring.className = 'face-ring busy';
    ring.textContent = '◌';
    $('#face-state').textContent = '识别中…';
    $('#btn-face').disabled = true;
    setTimeout(() => {
      faceOk = true;
      ring.className = 'face-ring ok';
      ring.textContent = '✓';
      $('#face-state').textContent = '识别通过（Mock）';
      refresh();
    }, 1200);
  };
  $('#btn-back').onclick = () => openConfirm(a);
  submit.onclick = () => submitDecision(a, {
    approved: true,
    verification: { sms_code: sms.value.trim(), face_verified: faceOk },
  });
}

async function submitDecision(a, payload) {
  const btn = $('#btn-submit') || $('#btn-next');
  if (btn) btn.disabled = true;
  try {
    const res = await api('/api/decide', {
      method: 'POST',
      body: { id: a.id, approved: !!payload.approved, comment: payload.comment || '', verification: payload.verification },
    });
    if (!res.success) {
      toast(res.message || '操作未完成');
      if (res.message && res.message.includes('强验证')) { renderVerifyStep(a); }
      return;
    }
    S.decision = { id: a.id, executed: !!res.executed, message: res.message || '', rejected: false };
    closeModal();
    toast(res.message || '已处理');
    if (S.review) renderRecommendation(S.review);
    await reloadData();
    $('#agent-status').textContent = res.executed ? '已执行（纸交易）' : '已确认（未执行）';
    for (let i = 1; i <= 9; i += 1) markStep(i, 'done');
  } catch (err) {
    toast(`提交失败：${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function rejectApproval(id) {
  try {
    const res = await api('/api/decide', { method: 'POST', body: { id, approved: false, comment: '用户拒绝该建议' } });
    S.decision = { id, executed: false, rejected: true, message: res.message || '' };
    toast('已拒绝该建议，Agent 会记录原因并给出替代方向');
    if (S.review) renderRecommendation(S.review);
    await reloadData();
    markStep(9, 'done');
    $('#agent-status').textContent = '已拒绝';
  } catch (err) {
    toast(`操作失败：${err.message}`);
  }
}

/* ---------------- 启动 ---------------- */

async function init() {
  try {
    const boot = await api('/api/bootstrap');
    S.boot = boot;
    renderHeader(boot);
    renderStats(boot);
    renderPositions(boot.portfolio);
    renderSector(boot.portfolio);
    renderBrief(boot.brief);
    renderNews(boot.news);
    renderTierMatrix(boot.tier_matrix);
    renderApprovals(boot.approvals);
    renderBreaker(boot.breaker);
    await loadTab('audit');
  } catch (err) {
    toast(`初始化失败：${err.message}`, 6000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  api('/api/risk-conversation/status').then(status => {
    S.riskConversationConfigured = status.configured === true;
    if (S.riskConversationConfigured) {
      S.readOnlyConversation = true;
      renderApprovals([]);
    }
    $('#risk-conversation-status').textContent = status.configured
      ? '资金核对服务已配置；提交后按程序规则检查，模型调用失败会如实显示。'
      : '资金核对服务尚未配置；加入资金数据后会明确暂停，不会切回旧服务。';
  }).catch(() => { $('#risk-conversation-status').textContent = '暂时无法读取接入状态；提交失败时不会自动切换为离线成功。'; });
  $('#daily-finance-enable').addEventListener('change', () => {
    $('#daily-finance-fields').disabled = !$('#daily-finance-enable').checked;
    $('#daily-facts-confirmed').checked = false;
    $('#daily-purpose-confirmed').checked = false;
    invalidateConversation();
  });
  $('#daily-finance-form').addEventListener('input', event => {
    if (!['daily-facts-confirmed', 'daily-purpose-confirmed', 'daily-finance-enable'].includes(event.target.id)) {
      $('#daily-facts-confirmed').checked = false;
      $('#daily-purpose-confirmed').checked = false;
    }
    invalidateConversation();
  });
  $('#nl-question').addEventListener('input', invalidateConversation);
  $('#daily-finance-example').onclick = () => {
    const values = { cash: '10000', amount: '8000', fees: '0', holds: '0', floor: '1000', purpose: '3000', due: '3000', 'purpose-label': '房租' };
    Object.entries(values).forEach(([key, value]) => { $('#daily-' + key).value = value; });
    const due = new Date(); due.setDate(due.getDate() + 30);
    $('#daily-due-date').value = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
    $('#daily-facts-confirmed').checked = false;
    $('#daily-purpose-confirmed').checked = false;
    invalidateConversation();
  };
  $('#btn-review').onclick = runReview;
  $('#nl-question').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) runReview();
  });
  $('#tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t) loadTab(t.dataset.tab).catch((err) => toast(`加载失败：${err.message}`));
  });
  $('#btn-reset').onclick = async () => {
    if (!confirm('将清空审批请求与纸交易记录（长期记忆保留），并恢复初始演示组合。继续？')) return;
    try {
      const res = await api('/api/reset', { method: 'POST' });
      toast(res.message || '已重置');
      S.review = null;
      S.decision = null;
      $('#rec-area').innerHTML = '';
      $('#card-whatif').classList.add('hidden');
      resetSteps();
      $('#agent-status').textContent = '待发起';
      await reloadData();
    } catch (err) {
      toast(`重置失败：${err.message}`);
    }
  };
});
