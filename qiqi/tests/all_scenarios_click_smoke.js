const fs = require('fs');
const { chromium } = require('playwright');

const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:8765/';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const scenarios = ['transfer', 'bill', 'wealth', 'card', 'subscription', 'cross_scene'];

async function openClean(page) {
  await page.request.post(new URL('/api/reset', baseUrl).toString());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.more-actions summary').click();
}

async function clickScenario(page, locator, expectedScenario) {
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/scenarios/run') && response.request().method() === 'POST'
  );
  await locator.click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`scenario request failed: ${response.status()}`);
  const payload = await response.json();
  if (payload.delegated && expectedScenario !== 'wealth') {
    throw new Error(`unexpected delegated response for ${expectedScenario}: ${payload.result?.intent?.question || 'no question'}`);
  }
  if (!payload.delegated && payload.result?.scenario !== expectedScenario) {
    throw new Error(`scenario response mismatch: expected ${expectedScenario}, got ${payload.result?.scenario || 'none'}`);
  }
  await page.locator('#banking-feedback.success').waitFor();
  if (payload.delegated) {
    await page.locator('#banking-result .assistant-line').waitFor();
  } else {
    await page.locator('#banking-result .banking-result').waitFor();
  }
  return (await page.locator('#banking-result').innerText()).trim();
}

async function main() {
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  const results = {};
  for (const key of scenarios) {
    await openClean(page);
    const chip = page.locator(`.scenario-chip[data-key="${key}"]`);
    if (await chip.count() !== 1) throw new Error(`scenario button missing: ${key}`);
    const resultText = await clickScenario(page, chip, key);
    if (!resultText) throw new Error(`scenario button produced no visible result: ${key}`);
    results[key] = resultText.split('\n').slice(0, 3).join(' / ');
  }

  await openClean(page);
  const quickBill = await clickScenario(page, page.locator('#quick-bill'), 'bill');
  if (!quickBill.includes('合计')) throw new Error('quick bill button has no result');
  const quickAnomaly = await clickScenario(page, page.locator('#quick-anomaly'), 'bill');
  if (!quickAnomaly.includes('异常')) throw new Error('quick anomaly button has no result');

  await page.locator('#quick-guide').click();
  await page.locator('#statement-guide:not(.hidden)').waitFor();
  for (const source of ['bank', 'wechat', 'alipay', 'file']) {
    await page.locator(`[data-source="${source}"]`).click();
    const guideText = await page.locator('#source-steps').innerText();
    if (!guideText.trim()) throw new Error(`statement source button has no guide: ${source}`);
  }
  await page.locator('#close-statement-guide').click();
  if (await page.locator('#statement-guide:not(.hidden)').count() !== 0) throw new Error('statement guide close button did not respond');

  await page.locator('#banking-question').fill('');
  const fallbackResult = await clickScenario(page, page.locator('#btn-banking-run'), 'bill');
  if (!fallbackResult.includes('账单分析')) throw new Error(`empty input fallback did not produce a result: ${fallbackResult}`);

  for (const tab of ['memory', 'trades', 'audit']) {
    await page.locator(`[data-tab="${tab}"]`).click();
    if (await page.locator(`#tab-${tab}`).evaluate((el) => el.classList.contains('hidden'))) throw new Error(`tab button did not activate: ${tab}`);
  }

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#btn-reset').click();
  await page.locator('#toast:not(.hidden)').waitFor();
  if (errors.length) throw new Error(errors.join(' | '));

  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth);
  if (overflow) throw new Error('all-scenarios page has horizontal overflow');
  console.log(JSON.stringify({ scenarios: results, quickActions: 3, sourceButtons: 4, tabs: 3, overflow }));
  await browser.close();
}

main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
