'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-proxy-server'] });
  const report = [];
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    for (const route of ['workspace', 'banking', 'tasks', 'safety']) {
      await page.goto((process.env.PREVIEW_URL || 'http://127.0.0.1:4187') + '/workspace.html#' + route);
      await page.locator(`[data-view=${route}][aria-current=page]`).waitFor();
      const result = await new AxeBuilder({ page }).analyze();
      report.push({ route, violations: result.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(node => node.target) })) });
    }
    assert(report.every(result => result.violations.length === 0));
    console.log('All four workspaces passed axe accessibility checks.');
  } finally {
    fs.writeFileSync(path.join(__dirname, 'evidence/accessibility.json'), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
