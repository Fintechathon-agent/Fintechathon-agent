const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.TEST_URL || 'http://127.0.0.1:18965';
const output = process.env.SAFETY_OUTPUT || path.join(__dirname, '..', 'artifacts', 'safety-fixes-2026-10-16');
const views = [
  { name: 'main', url: '/', input: '#banking-question', submit: '#btn-banking-run', rows: '#banking-pending .pend-row', confirm: '[data-confirm], [data-verify]', cancel: '[data-reject]' },
  { name: 'v2', url: '/static/v2/index.html', input: '#v2-task-input', submit: '#v2-task-form button[type="submit"]', rows: '#v2-queue-list .pending-card', confirm: '[data-action="confirm"]', cancel: '[data-action="cancel"]' },
  { name: 'compare', url: '/compare', input: '#task-input', submit: '#task-form button', rows: '#pending-list .pending-item', confirm: '[data-confirm]', cancel: '[data-cancel]' },
];
async function api(page, endpoint, data) {
  const response = data === undefined ? await page.request.get(base + endpoint) : await page.request.post(base + endpoint, { data });
  assert.equal(response.status(), 200);
  return response.json();
}
async function clickResponse(page, selector, endpoint) {
  const pending = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'POST');
  await selector.click();
  const response = await pending;
  assert.equal(response.status(), 200);
  return response.json();
}
async function run(page, view, text) {
  await page.locator(view.input).fill(text);
  return clickResponse(page, page.locator(view.submit), '/api/scenarios/run');
}
async function prepare(page, view) {
  await api(page, '/api/reset', {});
  await api(page, '/api/breaker/reset', {});
  await page.goto(base + view.url, { waitUntil: 'networkidle' });
  if (view.name === 'main') await page.locator('.more-actions summary').click();
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const results = [];
  try {
    for (const view of views) {
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        const page = await browser.newPage({ viewport });
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await prepare(page, view);
        await run(page, view, '给王芳转600元');
        await run(page, view, '给李明转600元');
        let first = page.locator(view.rows).filter({ hasText: '王芳' });
        let result = await clickResponse(page, first.locator(view.confirm), '/api/scenarios/confirm');
        assert.equal(result.success, true);
        let second = page.locator(view.rows).filter({ hasText: '李明' });
        result = await clickResponse(page, second.locator(view.confirm), '/api/scenarios/confirm');
        assert.equal(result.success, false);
        assert.equal(result.tier_changed, true);
        await second.locator('[data-sms]').waitFor();
        await second.locator('[data-sms]').fill('123456');
        await second.locator('[data-face]').check();
        result = await clickResponse(page, second.locator(view.confirm), '/api/scenarios/confirm');
        assert.equal(result.success, true);
        let balance = await api(page, '/api/scenarios/boot');
        assert.equal(balance.balance, 24480.5);
        assert.equal(balance.daily_cumulative, 1200);
        if (view.name === 'v2') assert.match(await page.locator('#v2-balance').innerText(), /24,480.50/);
        if (view.name === 'compare') assert.match(await page.locator('#balance-value').innerText(), /24,480.50/);

        result = await run(page, view, '明天上午10点给王芳转500元');
        assert.equal(result.result.status, 'scheduled');
        let scheduled = page.locator(view.rows);
        await scheduled.first().waitFor();
        assert.equal(await scheduled.count(), 1);
        assert.equal(await scheduled.locator(view.confirm).count(), 0);
        assert.match(await scheduled.innerText(), /预约/);
        await page.reload({ waitUntil: 'networkidle' });
        if (view.name === 'main') await page.locator('.more-actions summary').click();
        scheduled = page.locator(view.rows);
        await scheduled.first().waitFor();
        assert.equal(await scheduled.locator(view.confirm).count(), 0);
        result = await clickResponse(page, scheduled.locator(view.cancel), '/api/scenarios/cancel');
        assert.equal(result.success, true);

        result = await run(page, view, '聚餐100元AA，3个人');
        assert.equal(result.pending.length, 3);
        await page.locator(view.rows).nth(2).waitFor();
        result = await clickResponse(page, page.locator(view.rows).first().locator(view.confirm), '/api/scenarios/confirm');
        assert.equal(result.success, true);
        assert.equal(result.collection.status, 'issued');
        balance = await api(page, '/api/scenarios/boot');
        assert.equal(balance.balance, 24480.5);
        assert.equal(balance.daily_cumulative, 1200);
        assert.deepEqual(errors, []);
        const screenshot = path.join(output, `${view.name}-${viewport.width}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        results.push({ view: view.name, width: viewport.width, upgradedMfa: true, schedulePersistedAndCancelled: true, aaDidNotDebit: true, errors, screenshot });
        console.log('PASS', view.name, viewport.width);
        await page.close();
      }
    }
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
