'use strict';
// Apply the UI refinement to the verified personal preview, without backend changes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(process.argv[2]);
const live = 'https://xinlan-qwen38-share.lixjanus526.workers.dev/investment-only/investment.html#ai-assistant';
const version = '20261021-minimal';
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const write = (name, value) => fs.writeFileSync(path.join(root, name), value.replace(/\r\n/g, '\n'));
assert(read('workspace.html').includes('focus-panel'), 'Expected the unmodified 57e0a6b preview; refusing a second application.');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    for (const name of ['landing.html', 'workspace.html', 'catalog.html', 'investment.html', 'risk-workbench.html', 'investment-only/investment.html']) {
      const page = await context.newPage();
      await page.setContent(read(name));
      await page.evaluate(({ name, live, version }) => {
        const remove = selector => document.querySelectorAll(selector).forEach(el => el.remove());
        const set = (selector, text) => { const el = document.querySelector(selector); if (el) el.textContent = text; };
        const sheet = document.createElement('link');
        sheet.rel = 'stylesheet';
        sheet.href = `${name.startsWith('investment-only/') ? '../' : ''}versions/workspace-refinement.css?v=${version}`;
        document.head.append(sheet);
        document.body.classList.add(name === 'landing.html' ? 'refined-home' : 'refined-workspace');
        if (name === 'risk-workbench.html') {
          document.body.style.background = 'var(--canvas)';
          document.body.style.color = 'var(--ink)';
        }
        if (name === 'landing.html') {
          document.querySelectorAll('script[src]').forEach(script => { script.src = script.getAttribute('src') + '?v=' + version; });
          document.querySelector('.landing-nav nav').innerHTML = `<a href="workspace.html#workspace">工作台</a><a href="workspace.html#banking">投资组合</a><a href="workspace.html#tasks">我的任务</a><a href="workspace.html#safety">安全与记录</a><a class="nav-enter" href="${live}">千问分析</a>`;
          document.querySelectorAll('.feature-card').forEach((card, index) => {
            const link = card.querySelector('.feature-link');
            link.href = index === 0 ? 'workspace.html#banking' : 'workspace.html#tasks';
            link.setAttribute('aria-label', index === 0 ? '进入投资组合工作窗口' : '进入我的任务与记录');
            const button = card.querySelector('.liquid-vessel');
            const visual = document.createElement('span');
            visual.className = button.className;
            visual.setAttribute('aria-hidden', 'true');
            visual.innerHTML = button.innerHTML;
            button.replaceWith(visual);
          });
          remove('.pour-hint');
          const lines = document.querySelectorAll('.section-heading .description-line');
          if (lines[1]) lines[1].textContent = '点击工作卡，直接进入对应窗口';
        }
        if (name === 'workspace.html') {
          remove('.focus-panel, .rail-caption, .rail-note p, .rail-note .source-badge, .workspace-hero .eyebrow, .workspace-hero > p, [data-panel=tasks] > .eyebrow, [data-panel=safety] > .eyebrow');
          set('#workspace-heading', '工作台');
          remove('.command-panel > .eyebrow, .command-panel > h2');
          set('label[for=task-intent]', '这次想了解什么？');
          set('#intent-help', '仅保留为本页草稿，不会发送模型。');
          const ai = document.createElement('a');
          ai.href = live; ai.className = 'live-model-link'; ai.textContent = '千问分析（需分享口令）';
          document.querySelector('.command-panel').append(ai);
          remove('.service-catalog, .service-note, .compact-hero > div');
          document.querySelector('.compact-hero').className = 'portfolio-source';
          set('#banking-heading', '投资组合');
          const bankingLink = document.querySelector('[data-view=banking]');
          bankingLink.lastChild.textContent = '投资组合';
          remove('#plans-panel > p:last-of-type, #input-panel > summary .small, .step-details > summary .small');
          const fallback = document.createElement('noscript');
          fallback.innerHTML = '<style>.refined-workspace [data-panel][hidden]{display:block!important}</style>';
          document.body.append(fallback);
          const script = document.querySelector('script[src*=workspace-investment]');
          script.src = `versions/workspace-investment.js?v=${version}`;
          set('[data-panel=tasks] > .muted', '查询本次任务或输入原任务编号。');
          set('#task-empty p', '完成健康检查后在此查看记录。');
          set('[data-panel=safety] .task-cards section:nth-child(1) p', '固定虚构数据，非实时行情。静态预览未连接组合后端。');
          set('[data-panel=safety] .task-cards section:nth-child(2) p', '风控交接只读；确认与执行待接入。');
          set('[data-panel=safety] .task-cards section:nth-child(3) p', '无可信回执不更新账本，不重复执行未知状态的任务。');
          document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== 'workspace'; });
          const top = document.querySelector('.workspace-top > span:first-child');
          top.textContent = '个人投资顾问';
          set('#service-state', '组合服务未连接');
        }
        if (name !== 'landing.html') {
          remove('.sidebar-caption, .sidebar-footnote, .hero-lede, .balance-card-bottom, .terminal-label');
          if (name === 'investment-only/investment.html') {
            remove('#overview .eyebrow, #analysis-anchor .empty-symbol, #analysis-anchor .terminal-label, .form-submit > div, #ai-assistant > .section-kicker');
            set('#ai-assistant > .small.muted', '分析基于未核验的自述，无实时行情，不执行交易。');
          }
        }
        const notice = document.querySelector('.preview-notice, .static-preview-notice');
        if (notice) {
          notice.removeAttribute('role'); notice.setAttribute('aria-label', '演示状态');
          notice.textContent = name.startsWith('investment-only/') ? '虚构持仓演示 · AI 预览未连接 · 不执行交易' : '静态演示 · 组合服务未连接 · 不执行交易';
        }
      }, { name, live, version });
      write(name, await page.content() + '\n');
      await page.close();
    }
    let js = read('versions/workspace.js');
    const start = js.indexOf('const reducedMotion =');
    const end = js.indexOf('$("#open-portfolio").onclick');
    assert(start >= 0 && end > start);
    js = js.slice(0, start) + `// Each navigation item opens one workspace; browser history preserves the selection.
export function navigate(view, focus = false, updateHistory = true) {
  if (!panels.some(panel => panel.dataset.panel === view)) view = 'workspace';
  panels.forEach(panel => { panel.hidden = panel.dataset.panel !== view; panel.classList.remove('is-active'); });
  document.querySelectorAll('[data-view]').forEach(link => {
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (updateHistory && location.hash !== '#' + view) history.pushState(null, '', '#' + view);
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (focus) document.getElementById(view + '-heading')?.focus({ preventScroll: true });
}
function route() {
  const key = location.hash.slice(1);
  navigate(key === 'portfolio-flow' ? 'banking' : key || 'workspace', false, false);
}
window.addEventListener('hashchange', route);
window.addEventListener('popstate', route);
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  const key = link?.getAttribute('href').slice(1);
  const view = key === 'portfolio-flow' ? 'banking' : key;
  if (!panels.some(panel => panel.dataset.panel === view)) return;
  event.preventDefault(); navigate(view, true);
});
route();
` + js.slice(end);
    write('versions/workspace.js', js);
    let investment = read('versions/workspace-investment.js');
    investment = investment.replace('from "./workspace.js"', `from "./workspace.js?v=${version}"`);
    investment = investment.replace("$('#service-state').textContent='ERROR · 服务暂不可用'", "$('#service-state').textContent='组合服务未连接'");
    write('versions/workspace-investment.js', investment);
    write('versions/archive.js', read('versions/archive.js').replace('if(p.full!==full){p.hint.innerHTML=', 'if(p.hint && p.full!==full){p.hint.innerHTML='));
    write('versions/landing.js', read('versions/landing.js').replace("from './archive.js'", `from './archive.js?v=${version}'`));
    write('versions/workspace-refinement.css', fs.readFileSync(path.join(__dirname, 'workspace-refinement.css'), 'utf8'));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
