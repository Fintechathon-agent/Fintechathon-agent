'use strict';
// Layout-only prototypes. No financial rules, account state, or API requests.
const directions = {
  A: {
    eyebrow: 'TWO ASSET VIEWS. ONE PORTFOLIO.', title: '从资产出发，<em>看清组合。</em>',
    copy: '股票与基金 / ETF，放在同一套证据下比较。每个入口最终回到你的完整组合。',
    summary: '资产分类，一眼可找。', change: '02 改为「基金 / ETF」，01 同步改为「股票」。现金在组合内单独展示。',
    cost: '保留双卡、共用橙色横梁与容器。后续要给同一工作台增加资产分类定位。',
    tradeoff: '资产范围清楚，但两个入口容易让人误以为是两个产品；计划确认藏得更深。',
    cards: [
      { label: '01 / STOCKS', title: '股票', copy: '从单只仓位到行业暴露，\n每个观察都有可追溯的依据。', tags: ['持仓结构', '风险依据'], entry: '查看股票入口', key: 'stocks' },
      { label: '02 / FUNDS & ETF', title: '基金 / ETF', copy: '看清持仓之间的关联，\n再比较不同调整路径。', tags: ['组合关联', '方案比较'], entry: '查看基金入口', key: 'funds' }
    ]
  },
  B: {
    eyebrow: 'EVIDENCE FIRST. YOUR DECISION.', title: '先看清风险，<em>再由你确认。</em>',
    copy: '每一个建议，都带着依据。每一次模拟执行，都从你确认完整计划开始。',
    summary: '风险到确认，顺着走。', change: '02 改为「计划确认与日志」，01 改为「组合风险报告」。审批由用户本人完成。',
    cost: '保留双卡天平和首页动线。后续需接正式风险结论、可信确认记录与模拟回执。',
    tradeoff: '更适合比赛叙事。计划确认页在 Contract 就绪前只能保持独立样例，不能伪装已接通。',
    cards: [
      { label: '01 / RISK & EVIDENCE', title: '组合风险报告', copy: '看见风险，也看见依据。\n把每一个方案放回同一口径。', tags: ['持仓诊断', '证据对照'], entry: '预览风险报告入口', key: 'risk' },
      { label: '02 / CONFIRM & TRACE', title: '计划确认与日志', copy: '核对整段计划，再明确确认。\n每一步状态，都有记录可查。', tags: ['完整计划', '状态追溯'], entry: '预览计划确认入口', key: 'confirm' }
    ]
  },
  C: {
    eyebrow: 'ONE PORTFOLIO. A CLEARER NEXT STEP.', title: '一个组合，<em>看清每一步。</em>',
    copy: '收拢所有入口，从一次组合健康检查开始。收益与风险在卡内并列呈现。',
    summary: '一个入口，集中注意。', change: '取消独立 02 卡。只留「组合健康检查」，收益 / 风险天平放进同一张卡。',
    cost: '需要重排功能区、天平坐标与硬币飞行路径。手机仍保留卡内左右并排天平。',
    tradeoff: '入口最集中，正式改动最大。收益和风险只是并列观察，不是可以相抵的两种分数。'
  }
};
const entries = {
  stocks: { title: '股票 · 同一组合里的资产视图', copy: '按工具返回的资产类型定位股票，不另造一套组合或分类。', steps: ['展示 A_SHARE 持仓及其数据来源。', '查看集中度、行业信息与相关证据。', '回到完整组合比较候选方案。'] },
  funds: { title: '基金 / ETF · 比较之前先看范围', copy: '当前数据类型为 ETF；场外基金的展示与执行能力，需要工具和架构 Owner 确认。', steps: ['展示工具返回的 ETF 持仓。', '区分行业已知部分与未知信息。', '首版模拟执行仅覆盖已确认候选池内的场内 ETF，不扩大范围。'] },
  risk: { title: '组合风险报告 · 先看证据', copy: '界面展示工具计算和风控规则的结果；尚未收到的评分、等级和证据不由前端补造。', steps: ['导入持仓并确认画像与约束。', '核对指标、数据日期和全部风险原因。', '区分只读比较与模拟执行资格。'] },
  confirm: { title: '计划确认 · 最终决定在你', copy: '审批就是你本人确认完整计划。这里不是人工审核后台，也不是点击即成交。', steps: ['查看完整动作、金额、费用、模式、停止条件和风险。', '仅对允许接受的复核逐项确认；阻止和必须修复的原因不可绕过。', '确认记录和模拟回执由可信服务提供，缺失时显示模拟 / 待确认。'] },
  portfolio: { title: '组合健康检查 · 一条完整路径', copy: '从导入到留痕，只保留一个产品入口。收益来自历史模拟，不能承诺未来表现。', steps: ['导入持仓，确认资料来源与偏好。', '查看风险依据并比较调整方案。', '确认当前完整计划，追踪实际返回的模拟结果与日志。'] }
};
const $ = selector => document.querySelector(selector);
let levels = [34, 34];
function vessel(index, label) {
  return `<button class="vessel" type="button" data-side="${index}" aria-label="体验${label}一侧的装饰液位"><span class="water" aria-hidden="true"></span></button>`;
}
function card(item, index) {
  return `<article class="feature-card"><div class="card-top"><span>${item.label}</span><span aria-hidden="true">↗</span></div><div class="visual"><span class="visual-number" aria-hidden="true">0${index + 1}</span>${vessel(index, item.title)}<span class="vessel-label" aria-hidden="true">TAP TO EXPLORE</span></div><h3>${item.title}</h3><p>${item.copy.replace('\n', '<br>')}</p><div class="tags">${item.tags.map(tag => `<span>${tag}</span>`).join('')}</div><button class="entry" data-entry="${item.key}" type="button">${item.entry}<span aria-hidden="true">↗</span></button></article>`;
}
function resetBalance() {
  levels = [34, 34];
  updateBalance();
  $('#interaction-note').textContent = '点按容器体验天平，装饰液位不代表金额、收益或风险等级。';
}
function updateBalance() {
  const layout = $('.balance-layout');
  layout.style.setProperty('--tilt', `${(levels[1] - levels[0]) * .045}deg`);
  document.querySelectorAll('.vessel').forEach((element, index) => element.style.setProperty('--level', `${levels[index]}%`));
}
function render(direction, updateHistory = false) {
  const key = Object.hasOwn(directions, direction) ? direction : 'B';
  const option = directions[key];
  document.body.dataset.direction = key;
  document.querySelectorAll('a[data-direction]').forEach(link => {
    if (link.dataset.direction === key) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  $('#preview-eyebrow').textContent = option.eyebrow;
  // Only authored constants are rendered as markup; URL text is never interpolated.
  $('#preview-title').innerHTML = option.title;
  $('#preview-copy').textContent = option.copy;
  $('#summary-letter').textContent = key;
  $('#summary-title').textContent = option.summary;
  $('#change-copy').textContent = option.change;
  $('#cost-copy').textContent = option.cost;
  $('#tradeoff-copy').textContent = option.tradeoff;
  $('#stage').innerHTML = option.cards
    ? `<div class="balance-layout"><div class="beam" aria-hidden="true"></div>${option.cards.map(card).join('')}</div>`
    : `<article class="feature-card single-card"><div class="single-copy"><div class="card-top"><span>01 / PORTFOLIO HEALTH CHECK</span></div><h3>组合健康检查</h3><p>从持仓出发，读懂风险。<br>比较可能，确认每一个下一步。</p><div class="tags"><span>持仓导入</span><span>风险与证据</span><span>计划确认</span></div><button class="entry" data-entry="portfolio" type="button">预览投资入口<span aria-hidden="true">↗</span></button></div><div class="single-visual"><div class="balance-layout"><div class="beam" aria-hidden="true"></div><div class="single-side">${vessel(0, '收益')}<strong>收益</strong><small>回看历史路径</small></div><div class="single-side">${vessel(1, '风险')}<strong>风险</strong><small>核对潜在代价</small></div></div><p>同屏看见两面 · 历史表现不代表未来</p></div></article>`;
  resetBalance();
  if (updateHistory) history.pushState(null, '', `?direction=${key}`);
  document.title = `方向 ${key} · Finance Lab 首页评审`;
}
document.querySelectorAll('a[data-direction]').forEach(link => link.addEventListener('click', event => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  render(link.dataset.direction, true);
}));
$('#stage').addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.side !== undefined) {
    const index = Number(target.dataset.side);
    levels[index] = Math.min(78, levels[index] + 11);
    updateBalance();
    $('#interaction-note').textContent = '已改变装饰液位；不产生风险判断或账户操作。可点「天平回正」恢复。';
  }
  if (target.dataset.entry) {
    const entry = entries[target.dataset.entry];
    $('#dialog-title').textContent = entry.title;
    $('#dialog-copy').textContent = entry.copy;
    $('#dialog-steps').replaceChildren(...entry.steps.map(text => {
      const item = document.createElement('li');
      item.textContent = text;
      return item;
    }));
    $('#entry-dialog').showModal();
  }
});
$('#reset').addEventListener('click', resetBalance);
window.addEventListener('popstate', () => render(new URLSearchParams(location.search).get('direction')));
render(new URLSearchParams(location.search).get('direction'));
