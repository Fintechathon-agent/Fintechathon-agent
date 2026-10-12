'use strict';
// Presentation-only routes. API requests are delegated to the unchanged risk service.
const fs = require('node:fs');
const path = require('node:path');
function assetsFrom(uiRoot) {
  const directory = path.join(uiRoot, 'versions');
  const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png' };
  const assets = {};
  for (const file of fs.readdirSync(directory)) {
    if (!mime[path.extname(file)] || file.startsWith('merchant')) continue;
    assets['/versions/' + file] = { body: fs.readFileSync(path.join(directory, file), file.endsWith('.png') ? undefined : 'utf8'), type: mime[path.extname(file)] };
  }
  const pages = { '/':'landing', '/investment':'investment', '/catalog':'home', '/risk':'risk', '/404':'not-found' };
  for (const [route, name] of Object.entries(pages)) {
    let body = assets['/versions/' + name + '.html'].body;
    body = body.replace(/<a href="\/merchant"[^>]*>[\s\S]*?<\/a>/g, '');
    if (name === 'landing') {
      body = body.replace('<nav aria-label="主导航">', '<nav aria-label="主导航"><a href="/risk">风控与计划确认</a>');
      body = body.replace('02 / BUSINESS FINANCE', '02 / RISK & CONFIRMATION').replace('向店主经营一侧注入液体','查看风控与计划确认').replace('CASH / RECORD 0062','RISK / RECORD 0062');
      body = body.replace('<h3>店主财务助手</h3><p>理清应收应付，提前看见现金缺口。<br>核对账单来源，再做下一步经营判断。</p>', '<h3>风控与计划确认</h3><p>沿用投资报告的任务与证据，逐项查看风险。<br>由你确认完整计划，再查询模拟回执与审计。</p>');
      body = body.replace('<ul><li>账单来源核对</li><li>现金日历</li><li>晚到账情景试算</li></ul>', '<ul><li>规则与风险依据</li><li>用户完整计划确认</li><li>模拟回执与审计</li></ul>');
      body = body.replace('href="/merchant">探索经营工作台', 'href="/risk#confirmation">查看确认与日志');
    }
    if (name === 'home') body = body.replace(/<article class="product-choice merchant-choice">[\s\S]*?<\/article>/, '<article class="product-choice merchant-choice"><h2>风控与计划确认</h2><p>队友风控服务接入入口：核对风险依据、确认完整计划、查看模拟回执及审计。</p><a class="button choice-button" href="/risk#confirmation">查看确认与日志</a></article>');
    if (name === 'investment') {
      body = body.replace('</head>', '<link rel="stylesheet" href="/versions/risk.css"><script src="/versions/risk-handoff.js"></script></head>');
      body = body.replace('</nav><div class="sidebar-caption section-label">', '<a href="/risk"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3 4 6v6c0 4 8 9 8 9s8-5 8-9V6z"/></svg><span>风控与计划确认</span><span class="nav-number">02</span></a></nav><div class="sidebar-caption section-label">');
      body = body.replace('<section class="snapshot-card"', '<section id="risk-handoff" class="risk-handoff" hidden><div><p class="section-kicker">NEXT / RISK & CONFIRMATION</p><h2>报告已就绪，继续核对风险。</h2><p>沿用本次持仓与证据，由你本人确认完整模拟计划。</p></div><a id="risk-handoff-link" class="button" href="/risk">查看风险与确认</a></section><section class="snapshot-card"');
    }
    body = body.replaceAll('↗', '<svg class="arrow-ne" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 9 9 3M4.5 3H9v4.5"/></svg>').replaceAll('→', ' / ');
    assets[route] = { body, type: mime['.html'] };
  }
  assets['/risk/'] = assets['/risk'];
  assets['/index.html'] = assets['/'];
  for (const [name, route] of Object.entries({ landing:'/', investment:'/investment', catalog:'/catalog', risk:'/risk' })) assets['/'+name+'.html'] = assets[route];
  return assets;
}
module.exports = { assetsFrom };
