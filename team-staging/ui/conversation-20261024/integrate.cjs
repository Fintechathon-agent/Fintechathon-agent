'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const source = path.resolve(process.argv[2]);
const target = path.resolve(process.argv[3]);
const baseline = 'a3587d43d194eff650da01d5a89bbddc4d615b3d';
const read = file => fs.readFileSync(path.join(source, file), 'utf8');
const write = (file, text) => {
  const normalized = text.replace(/\r\n/g, '\n');
  fs.writeFileSync(path.join(target, file), ['workspace.html', 'versions/workspace-investment.js'].includes(file) ? normalized.replace(/\n/g, '\r\n') : normalized);
};
const old = file => cp.execFileSync('git', ['show', `${baseline}:${file}`], { cwd: target, encoding: 'utf8' });
const arrow = '<svg class="arrow-ne" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 9 9 3M4.5 3H9v4.5"/></svg>';
const icon = type => `<svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${type}"/></svg>`;
const logo = '<img class="conversation-logo" src="versions/team-logo-transparent.png?v=fba7a4e1b36b" alt="Finance Lab 团队标识" width="64" height="64">';
let html = read('workspace.html');
html = html.replace('<body>', '<body class="conversation-product">')
  .replace('<link rel="stylesheet" href="versions/conversation.css">', '<link rel="stylesheet" href="versions/glass.css"><link rel="stylesheet" href="versions/conversation.css?v=20261024"><link rel="stylesheet" href="versions/conversation-brand.css?v=20261024">')
  .replace('href="workspace.html"><span class="brand-mark">K</span>', `href="landing.html">${logo}`)
  .replace('<span class="welcome-mark" aria-hidden="true">K</span>', `<span class="welcome-mark">${logo}</span>`)
  .replace('<span class="nav-mark" aria-hidden="true">◷</span>', icon('M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'))
  .replaceAll('<span class="nav-mark" aria-hidden="true">▤</span>', icon('M5 4h14v16H5zM8 8h8M8 12h8M8 16h5'))
  .replace('<span class="nav-mark" aria-hidden="true">↗</span>', arrow)
  .replace('<span class="nav-mark" aria-hidden="true">◇</span>', icon('m12 3 9 9-9 9-9-9z'))
  .replace('<span aria-hidden="true">＋</span>', icon('M12 5v14M5 12h14'))
  .replace('>☰</button>', `>${icon('M4 6h16M4 12h16M4 18h16')}</button>`)
  .replaceAll('<span>↗</span>', arrow).replace('<span aria-hidden="true">↑</span>', icon('m6 12 6-6 6 6M12 6v14'))
  .replace('<div class="workspace-body">', '<div id="service-notice" class="service-notice" role="status" hidden></div><div class="workspace-body">')
  .replace('<span id="chat-title">新对话</span>', '<a class="home-return" href="landing.html">首页</a><span class="topbar-divider" aria-hidden="true">/</span><span id="chat-title">新对话</span>')
  .replace('<span>我的工作空间<small>本机保存 · 由你掌握</small></span>', '<span>我的工作空间<small>资料与隐私说明</small></span>')
  .replace('<div class="about-links">', '<div class="about-links">')
  .replace(/<div class="about-links">[\s\S]*?<\/div><\/dialog>/, '<div class="about-links"><a href="landing.html">返回品牌首页</a><a href="workspace.html#banking">查看投资组合</a></div></dialog>')
  .replace('团队模型服务', '百炼模型服务')
  .replace('src="versions/conversation.js"', 'src="versions/conversation.js?v=20261024"')
  .replace('</body>', '<script type="module" src="versions/conversation-brand.mjs?v=20261024"></script></body>');
write('conversation.html', html);
write('versions/conversation.css', read('versions/conversation.css'));
let js = read('versions/conversation.js');
js = js.replace('const uuid = () => crypto.randomUUID();', `const uuid = () => crypto.randomUUID();
const isLocal = ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
const config = await fetch(new URL('../conversation-config.json', import.meta.url)).then(r => r.ok ? r.json() : {}).catch(() => ({}));
let apiBase = isLocal ? '/api/assistant/' : null;
if (!isLocal && typeof config.endpoint === 'string') {
  const candidate = new URL(config.endpoint, location.href);
  if (candidate.origin === location.origin && candidate.protocol === 'https:' && candidate.pathname === '/api/assistant/' && !candidate.search && !candidate.hash) apiBase = candidate.href;
}
const exportUrl = scope => apiBase ? apiBase + 'export' + (scope === 'investment' ? '?scope=investment' : '') : '#';
const brandMark = '<img class="mini-logo" src="versions/team-logo-transparent.png?v=fba7a4e1b36b" alt="" width="24" height="24">';`);
js = js.replace('  const controller = new AbortController()', "  if (!apiBase) throw new Error('线上对话服务尚未启用，当前内容没有发送。');\n  const controller = new AbortController()")
  .replace('fetch(`/api/assistant/${path}`', 'fetch(apiBase + path')
  .replace('需要使用本地服务打开工作空间。连接恢复后可以重试。', '对话服务暂时无法连接，草稿已保留。')
  .replaceAll('保存在本机', '已保存到本机服务')
  .replaceAll('<span class="mini-k" aria-hidden="true">K</span>', '${brandMark}')
  .replaceAll(' ↗', ` ${arrow}`).replaceAll(' ↓', ` ${icon('M12 4v16m-6-6 6 6 6-6')}`)
  .replace("${a.href==='/api/assistant/export?scope=investment'?a.href:'/api/assistant/export'}", "${exportUrl(a.href?.includes('scope=investment')?'investment':null)}")
  .replace('/api/assistant/export${panel===\'investment\'?\'?scope=investment\':\'\'}', "${exportUrl(panel==='investment'?'investment':null)}")
  .replace('来自团队模型的分析 · 未执行资金操作', '来自百炼模型的分析 · 未执行资金操作');
js = js.replace("try{state=(await api('state')).state;render();$('save-state').textContent='对话和账本已保存到本机服务';}catch(error){showError(error.message);}", `if (!apiBase) {
  $('service-notice').hidden=false;
  $('service-notice').textContent='线上对话服务尚未启用。当前可查看页面，草稿不会发送。';
  $('save-state').textContent='服务待启用 · 未发送';
  $('send').disabled=true;
  $('new-chat').disabled=true;
} else {
  try{state=(await api('state')).state;render();$('save-state').textContent='对话和账本已保存到本机服务';}catch(error){showError(error.message);}
}`);
write('versions/conversation.js', js);
write('conversation-config.json', JSON.stringify({ endpoint: null, mode: 'LOCAL_ONLY_PENDING_HTTPS_DEPLOYMENT' }, null, 2) + '\n');
let landing = old('landing.html');
landing = landing.replace('<a href="workspace.html#tasks">我的任务</a>', '<a href="conversation.html">生活与投资</a><a href="workspace.html#tasks">我的任务</a>')
  .replace('02 / TASK EVIDENCE', '02 / LIFE &amp; INVESTMENT').replace('TASK / RECORD 0062', 'JOURNAL / RECORD 0062')
  .replace('<h3>我的任务与记录</h3>', '<h3>生活与投资</h3>')
  .replace('href="workspace.html#tasks" aria-label="进入我的任务与记录">查看任务与记录', 'href="conversation.html" aria-label="进入生活与投资对话窗口">开启生活与投资对话')
  .replace('workspace-refinement.css?v=20261021-align', 'workspace-refinement.css?v=20261024-conversation');
write('landing.html', landing);
let workspace = old('workspace.html');
workspace = workspace.replace('<nav class="workspace-nav" aria-label="主导航">', '<nav class="workspace-nav" aria-label="主导航"><a href="conversation.html"><span>+</span>生活与投资</a>')
  .replace('versions/workspace-investment.js?v=20261021-minimal', 'versions/workspace-investment.js?v=20261024-clean')
  .replace(/<details class="compact-detail"><summary>替换组合 JSON<\/summary>([\s\S]*?)<\/details>/, '<div hidden aria-hidden="true">$1</div>')
  .replace(/<details class="panel"><summary>任务状态与工具证据<\/summary>([\s\S]*?)<\/details>/, '<div hidden aria-hidden="true">$1</div>')
  .replace(/<p class="notice">后续流程在“我的任务”中查看。[\s\S]*?<\/p><a class="button secondary" href="#tasks">查看风险、审批与记录<\/a>/, '')
  .replace(/<details><summary>原始响应与任务关联<\/summary><pre id="task-raw"><\/pre><\/details>/, '<pre id="task-raw" hidden></pre>');
write('workspace.html', workspace);
let investment = old('versions/workspace-investment.js');
investment = investment.replace("$('#load-error').textContent='ERROR · 数据读取失败：'+error.message", "$('#load-error').textContent='组合资料暂时无法读取，请稍后重试。'")
  .replace('requestFailed(error); toast(error.message);', "requestFailed(new Error('本次检查暂时未完成，请稍后重试。')); toast('本次检查暂时未完成，请稍后重试。');");
write('versions/workspace-investment.js', investment);
write('versions/workspace-refinement.css', old('versions/workspace-refinement.css') + '\n/* Keep the new conversation entrance reachable in the existing toolbar. */\n.refined-home .landing-nav nav { min-width:0; overflow-x:auto; white-space:nowrap; }\n.refined-home .landing-nav nav a { flex-shrink:0; }\n');
console.log('Conversation UI integrated; existing pool fix preserved.');
