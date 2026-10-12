const fs = require('fs');
const { chromium } = require('playwright');

const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:8876/';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  const title = await page.title();
  const heading = await page.locator('.brand-text h1').innerText();
  const body = await page.locator('body').innerText();
  if (!title.includes('金融 AI 安全任务台')) throw new Error(`new title missing: ${title}`);
  if (heading !== '金融 AI 安全任务台') throw new Error(`new heading missing: ${heading}`);
  if (body.includes('持仓哨兵') || body.includes('Personal AI Fund Manager')) throw new Error('legacy product branding is visible');
  if (await page.locator('a[href="/evidence"]').count() !== 1) throw new Error('evidence board link missing');
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth);
  if (overflow) throw new Error('main workbench has horizontal overflow');
  console.log(JSON.stringify({ title, heading, overflow, evidenceLink: true }));
  await browser.close();
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
