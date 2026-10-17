const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:8765/';
const outputDir = path.join(os.tmpdir(), 'portfolio-sentinel-browser-smoke');
fs.mkdirSync(outputDir, { recursive: true });

async function check(viewport, name) {
  const commonChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const executablePath = process.env.PLAYWRIGHT_CHROME || (fs.existsSync(commonChrome) ? commonChrome : undefined);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#risk-workbench').waitFor();
  if ((await page.locator('#risk-score-value').innerText()) === '—') throw new Error(`${name}: embedded risk score did not load`);
  if (await page.locator('a[href^="https://"]').filter({ hasText: '风险' }).count()) throw new Error(`${name}: external risk workbench link remains`);
  await page.locator('#nl-question').fill('平安银行卖出 30%');
  await page.locator('#btn-review').click();
  await page.locator('#intent-area').getByText('意图：理财操作').waitFor();
  await page.locator('#agent-steps li').last().getByText('强验证与用户确认').waitFor();

  const input = page.locator('#nl-question');
  const inputBox = await input.boundingBox();
  if (!inputBox || inputBox.height < 44) throw new Error(`${name}: input target is under 44px`);
  const buttonBox = await page.locator('#btn-review').boundingBox();
  if (!buttonBox || buttonBox.height < 44) throw new Error(`${name}: primary button is under 44px`);

  if (name === 'mobile') {
    const agentTop = (await page.locator('.agent-card').boundingBox()).y;
    const assetsTop = (await page.locator('.col-main > .card').first().boundingBox()).y;
    if (agentTop >= assetsTop) throw new Error('mobile: natural-language entry is not first');
  }

  const hit = await page.evaluate(() => {
    const el = document.querySelector('#nl-question');
    const box = el.getBoundingClientRect();
    return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.id;
  });
  if (hit !== 'nl-question') throw new Error(`${name}: input is occluded by ${hit}`);

  const overflow = await page.evaluate(() => (
    document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth
  ));
  if (overflow) throw new Error(`${name}: page has horizontal overflow`);
  if (errors.length) throw new Error(`${name}: browser errors: ${errors.join(' | ')}`);

  const screenshot = path.join(outputDir, `${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  const result = {
    name,
    screenshot,
    inputHeight: inputBox.height,
    buttonHeight: buttonBox.height,
    planNodes: await page.locator('#agent-steps li').count(),
    scrollWidth: await page.evaluate(() => document.scrollingElement.scrollWidth),
    clientWidth: await page.evaluate(() => document.scrollingElement.clientWidth),
  };
  await browser.close();
  return result;
}

(async () => {
  const desktop = await check({ width: 1440, height: 1000 }, 'desktop');
  const mobile = await check({ width: 390, height: 844 }, 'mobile');
  console.log(JSON.stringify([desktop, mobile], null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
