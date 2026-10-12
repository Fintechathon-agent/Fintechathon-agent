const fs = require('fs');
const { chromium } = require('playwright');

const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:8876/compare';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function check(viewport, extended = false) {
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  // Each viewport starts from a clean demo state; persisted fixture state must not
  // make the second viewport look like a product failure.
  await page.request.post(new URL('/api/reset', baseUrl).toString());
  await page.reload({ waitUntil: 'networkidle' });
  const safetyTest = page.locator('[data-query*="无需确认"]');
  await safetyTest.click();
  await page.locator('#task-form button').click();
  await page.locator('.result-card.blocked').waitFor();
  if ((await page.locator('.pending-item').count()) !== 0) throw new Error('blocked task entered pending queue');
  if (!(await page.locator('#plan-list').innerText()).includes('拦截')) throw new Error('blocked plan copy missing');
  const transferMemo = viewport.width >= 768 ? '桌面验收' : '移动验收';
  await page.locator('#task-input').fill(`给王芳转500元备注${transferMemo}`);
  await page.locator('#task-form button').click();
  await page.locator('.result-card:not(.empty)').waitFor();
  await page.getByText('演示固定数据').first().waitFor();
  await page.locator('.pending-item').waitFor();
  const inputBox = await page.locator('#task-input').boundingBox();
  const buttonBox = await page.locator('#task-form button').boundingBox();
  if (!inputBox || inputBox.height < 44) throw new Error('task input is under 44px');
  if (!buttonBox || buttonBox.height < 44) throw new Error('task button is under 44px');
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth);
  if (overflow) throw new Error('page has horizontal overflow');
  await page.locator('[data-cancel]').first().click();
  await page.locator('.pending-empty').last().waitFor();
  if (extended) {
    await page.locator('#task-input').fill('尾号6666的卡挂失');
    await page.locator('#task-form button').click();
    await page.locator('.pending-item').waitFor();
    const verify = page.locator('.verify-input').first();
    if (await verify.count() !== 1) throw new Error('red verification input missing');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.locator('.verify-input').first().fill('123');
      await page.locator('[data-confirm]').first().click();
      await page.waitForTimeout(100);
    }
    if ((await page.locator('.pending-item').count()) !== 1) throw new Error('failed red verification removed pending item');
    await page.locator('#breaker-reset').waitFor({ state: 'visible' });
    await page.locator('#breaker-reset').click();
    await page.locator('#breaker-reset').waitFor({ state: 'hidden' });
    await page.locator('.verify-input').first().fill('123456');
    await verify.fill('123456');
    await page.locator('[data-face]').first().check();
    await page.locator('[data-confirm]').first().click();
    await page.locator('.pending-empty').last().waitFor();
  }
  if (errors.length) throw new Error(errors.join(' | '));
  const result = { viewport, inputHeight: inputBox.height, buttonHeight: buttonBox.height, overflow };
  await browser.close();
  return result;
}

(async () => {
  console.log(JSON.stringify([
    await check({ width: 1440, height: 1000 }, true),
    await check({ width: 390, height: 844 }),
  ]));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
