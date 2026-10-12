const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:8765/';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function run() {
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.request.post(new URL('/api/reset', baseUrl).toString());
  await page.reload({ waitUntil: 'networkidle' });

  await page.locator('#quick-bill').click();
  await page.locator('.banking-result').waitFor();
  const billResult = await page.locator('#banking-result').innerText();
  if (!billResult.includes('支出') || !billResult.includes('合计')) throw new Error('quick bill action did not render a result');

  await page.locator('.more-actions summary').click();
  await page.locator('.scenario-chip[data-key="subscription"]').click();
  await page.locator('.banking-result').waitFor();
  if (!(await page.locator('#banking-question').inputValue()).includes('订阅')) throw new Error('scenario card did not start its example');

  await page.locator('#quick-guide').click();
  await page.locator('#statement-guide:not(.hidden)').waitFor();
  if (!(await page.locator('#source-steps').innerText()).includes('手机银行')) throw new Error('statement guide did not open');
  await page.locator('[data-source="wechat"]').click();
  if (!(await page.locator('#source-steps').innerText()).includes('微信支付')) throw new Error('source picker did not respond');

  await page.locator('#bill-file').setInputFiles({
    name: '我的十月账单.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('日期,商户,金额,分类\n2026-10-01,咖啡店,28,餐饮\n2026-10-02,超市,120,日用\n', 'utf8'),
  });
  await page.locator('.local-bill-card').waitFor();
  const localResult = await page.locator('#local-bill-result').innerText();
  if (!localResult.includes('2 笔') || !localResult.includes('¥148.00')) throw new Error(`local bill summary is wrong: ${localResult}`);

  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth);
  const quickHeight = await page.locator('#quick-bill').evaluate((el) => el.getBoundingClientRect().height);
  if (overflow) throw new Error('simple user flow has horizontal overflow');
  if (quickHeight < 44) throw new Error('quick action target is under 44px');
  await page.screenshot({ path: path.join(__dirname, '..', 'artifacts', 'simple-user-flow-preview-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(__dirname, '..', 'artifacts', 'simple-user-flow-preview.png'), fullPage: false });
  console.log(JSON.stringify({ billResult: billResult.slice(0, 80), localResult, overflow, quickHeight }));
  await browser.close();
}

run().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
