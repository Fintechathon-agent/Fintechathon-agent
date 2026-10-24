'use strict';
// Three screenshot-specific repairs. Business requests and calculations stay unchanged.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const preview = path.resolve(process.argv[2]);
const moduleRoot = path.resolve(__dirname, '../../../team-staging/ui/tinglan-ai-20261018');
const version = '20261021-focus';
const write = (file, value) => fs.writeFileSync(file, value);
const theme = fs.readFileSync(path.join(moduleRoot, 'public/investment-only/versions/investment-theme.css'));
function themePage(root) {
  const file = path.join(root, 'investment.html');
  let html = fs.readFileSync(file, 'utf8');
  assert(!html.includes('versions/investment-theme.css'), 'Theme already applied.');
  html = html.replace('</head>', `<link rel="stylesheet" href="versions/investment-theme.css?v=${version}"></head>`)
    .replace('src="versions/investment.js"', `src="versions/investment.js?v=${version}"`);
  write(file, html);
  const themeFile = path.join(root, 'versions/investment-theme.css');
  if (themeFile !== path.join(moduleRoot, 'public/investment-only/versions/investment-theme.css')) fs.writeFileSync(themeFile, theme);
  const jsFile = path.join(root, 'versions/investment.js');
  let js = fs.readFileSync(jsFile, 'utf8');
  const from = "const palette=['#eee5d8','#b9ac9a','#8b8074','#655f58','#dad4cc'];";
  const to = "const palette=['#ff914a','#e9e4dd','#afa79f','#716a63','#c86e38'];";
  assert(js.includes(from), 'Expected the existing presentation palette.');
  write(jsFile, js.replace(from, to));
}
if (process.argv.includes('--runtime-only')) {
  themePage(preview);
} else {
  const file = path.join(preview, 'landing.html');
  let home = fs.readFileSync(file, 'utf8');
  const lists = home.match(/\s*<ul><li>[^<]*<\/li>(?:<li>[^<]*<\/li>)*<\/ul>/g);
  assert.equal(lists?.length, 2, 'Expected the two decorative feature-label lists.');
  home = home.replace(/\s*<ul><li>[^<]*<\/li>(?:<li>[^<]*<\/li>)*<\/ul>/g, '');
  const from = '<a class="story-action" href="#explore">';
  assert(home.includes(from), 'Expected the existing hero action.');
  write(file, home.replace(from, '<a class="story-action" href="workspace.html#workspace">'));
  themePage(path.join(preview, 'investment-only'));
  themePage(path.join(moduleRoot, 'public/investment-only'));
}
console.log(JSON.stringify({ applied: true, paidCalls: 0, backendChanged: false, themeBytes: theme.length }));
