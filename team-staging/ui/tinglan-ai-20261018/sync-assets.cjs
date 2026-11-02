'use strict';
const fs = require('node:fs');
const path = require('node:path');
const publicRoot = path.join(__dirname, 'public/investment-only');
for (const [source, target] of [['client.mjs', 'tinglan-client.mjs'], ['widget.mjs', 'tinglan-widget.mjs']]) {
  fs.copyFileSync(path.join(__dirname, 'frontend', source), path.join(publicRoot, 'versions', target));
}
const file = path.join(publicRoot, 'investment.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('<section class="panel" id="ai-assistant"');
const end = html.indexOf('</section>', start) + '</section>'.length;
if (start < 0 || end < start) throw new Error('Expected exactly one existing AI panel.');
fs.writeFileSync(file, html.slice(0, start) + fs.readFileSync(path.join(__dirname, 'frontend/panel.html'), 'utf8').trimEnd() + html.slice(end));
console.log('AI panel and client assets synchronized; other sections preserved.');
