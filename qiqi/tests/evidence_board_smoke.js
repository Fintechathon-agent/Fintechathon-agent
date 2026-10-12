const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:8876/evidence';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function check(viewport, screenshot = false) {
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  if ((await page.locator('.matrix-card').count()) !== 12) throw new Error('expected 12 evidence cards');
  if ((await page.locator('.stat-card').count()) !== 4) throw new Error('expected 4 verification stats');
  if (!(await page.locator('#chain-title').innerText()).includes('安全地走完')) throw new Error('proof chain heading missing');

  await page.locator('[data-filter="gap"]').click();
  if (await page.locator('.matrix-card:not(.is-hidden)').count() !== 2) throw new Error('gap filter count mismatch');
  await page.locator('[data-filter="partial"]').click();
  if (await page.locator('.matrix-card:not(.is-hidden)').count() !== 4) throw new Error('partial filter count mismatch');
  await page.locator('[data-filter="all"]').click();

  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth);
  if (overflow) throw new Error('page has horizontal overflow');
  const primary = await page.locator('.primary-action').boundingBox();
  if (!primary || primary.height < 44) throw new Error('primary action is under 44px');
  if (errors.length) throw new Error(errors.join(' | '));

  if (screenshot) {
    const outDir = path.resolve('artifacts');
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, 'evidence-board-preview.png'), fullPage: true });
  }
  const result = { viewport, cards: 12, overflow, primaryHeight: primary.height };
  await browser.close();
  return result;
}

(async () => {
  console.log(JSON.stringify([
    await check({ width: 1440, height: 1000 }, true),
    await check({ width: 390, height: 844 }),
  ]));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
