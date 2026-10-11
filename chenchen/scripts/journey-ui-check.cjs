const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createPreviewServer } = require('./xinlan-preview.cjs');
(async () => {
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const out = process.env.JOURNEY_SCREENSHOTS || 'review/stage3';
  fs.mkdirSync(out, { recursive: true });
  let browser;
  const report = { scope: 'Frontend rehearsal only; no backend authentication claims', cases: [], errors: [] };
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    for (const width of [1440, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('request', request => { if (!request.url().startsWith(base)) report.errors.push('Unexpected network request: ' + request.url()); });
      async function route(hash) { await page.evaluate(hash => { location.hash = hash; }, hash); }
      async function enter(role) {
        await route('#entry');
        await page.locator('#demo-role').selectOption(role);
        await page.getByRole('button', { name: '进入演示', exact: true }).click();
        await page.locator('#leave').waitFor({ state: 'visible' });
      }
      async function shot(name) {
        await page.locator('h1').click();
        await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + ' overflow');
        await page.screenshot({ path: path.join(out, name + '-' + width + '.png'), fullPage: true });
      }
      await page.goto(base + '/xinlan/journey.html#console');
      await page.getByRole('heading', { name: '请先进入演示' }).waitFor();
      await route('#entry');
      await page.locator('#entry-form').waitFor();
      await shot('entry');
      await enter('personal');
      await route('#console');
      await page.getByRole('heading', { name: '当前演示身份不能查看此工作台' }).waitFor();
      await route('#personal');
      await page.locator('#scenario').selectOption('DEMO-002');
      await page.getByRole('button', { name: '创建模拟事件', exact: true }).click();
      await page.getByRole('heading', { name: /SIM-001/ }).waitFor();
      assert.equal(/\b(ALLOW|REVIEW|BLOCK)\b/.test(await page.locator('main').innerText()), false);
      await page.getByRole('button', { name: '我已阅读提醒' }).click();
      await page.getByRole('button', { name: '通知已读' }).waitFor();
      await enter('analyst');
      await page.getByRole('link', { name: /SIM-001/ }).click();
      const privateNote = '内部模拟依据 <img src=x onerror=alert(1)> 不向普通端披露';
      await page.locator('#note').fill(privateNote);
      await page.getByRole('button', { name: '提交模拟复核意见' }).click();
      await page.locator('.split-status').getByText('复核中', { exact: true }).waitFor();
      assert.equal(await page.locator('main img').count(), 0);
      await enter('supervisor');
      await page.getByRole('link', { name: /SIM-001/ }).click();
      await page.locator('#note').fill('已核对模拟记录，原始拦截保持不变');
      await page.getByRole('button', { name: '记录模拟复核结论' }).click();
      await page.locator('.split-status').getByText('复核已记录', { exact: true }).waitFor();
      assert.equal(await page.locator('#review-form').count(), 0);
      assert.equal(await page.locator('.badge.BLOCK').innerText(), 'BLOCK');
      await shot('review');
      await page.getByRole('link', { name: 'Audit Logs', exact: true }).click();
      await page.getByRole('heading', { name: 'Audit Logs', exact: true }).waitFor();
      assert.equal(await page.locator('.audit-item').count(), 4);
      assert.match(await page.locator('main').innerText(), /风控分析员/);
      assert.match(await page.locator('main').innerText(), /风控主管/);
      await shot('audit');
      await enter('personal');
      assert.match(await page.locator('main').innerText(), /有新动态/);
      await page.getByRole('link', { name: /SIM-001/ }).click();
      await page.locator('.split-status').getByText('复核已记录', { exact: true }).waitFor();
      assert.equal(await page.locator('.badge.BLOCK').innerText(), '操作已拦截');
      assert.equal((await page.locator('main').innerText()).includes(privateNote), false);
      await shot('personal');
      await enter('admin');
      await page.getByRole('heading', { name: '系统管理与金融业务权限分离' }).waitFor();
      await route('#console/SIM-001');
      await page.getByRole('heading', { name: '当前演示身份不能查看此工作台' }).waitFor();
      await page.locator('#leave').click();
      await route('#console');
      await page.getByRole('heading', { name: '请先进入演示' }).waitFor();
      await enter('personal');
      page.once('dialog', dialog => dialog.accept());
      await page.locator('#reset').click();
      await page.locator('#entry-form').waitFor();
      await enter('personal');
      assert.match(await page.locator('main').innerText(), /尚无事件/);
      await page.reload();
      await page.getByRole('heading', { name: '请先进入演示' }).waitFor();
      report.cases.push({ width, passed: true, checks: ['entry gate', 'personal route denial', 'create event', 'analyst opinion', 'supervisor conclusion', 'unchanged BLOCK', 'notification resync', 'audit chain', 'private note projection', 'safe text rendering', 'admin denial', 'logout', 'reset', 'reload', 'no overflow', 'no external requests'] });
      await context.close();
    }
    assert.deepEqual(report.errors, []);
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
