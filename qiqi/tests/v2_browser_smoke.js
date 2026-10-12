const fs = require('fs');
const { chromium } = require('playwright');

const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:8765/static/v2/index.html';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function resetState(page) {
  await page.request.post(new URL('/api/reset', baseUrl).toString());
  await page.request.post(new URL('/api/breaker/reset', baseUrl).toString());
}

async function clickPreset(page, question) {
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/scenarios/run') && response.request().method() === 'POST'
  );
  await page.locator(`[data-preset="${question}"]`).click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`scenario request failed: ${response.status()}`);
  return response.json();
}

async function clickConfirm(page, card) {
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/scenarios/confirm') && response.request().method() === 'POST'
  );
  await card.locator('[data-action="confirm"]').click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`confirm request failed: ${response.status()}`);
  return response.json();
}

async function checkDemoSections(page) {
  const sections = [
    ['任务入口', '.command-chip'],
    ['执行轨道', '#v2-track-demos [data-demo-task]'],
    ['权限样本', '#v2-policy-demos [data-demo-task]'],
    ['待确认样本', '#v2-queue-demos [data-demo-task]'],
    ['事实证据', '#v2-facts .fact-cell'],
  ];
  const counts = {};
  for (const [name, selector] of sections) {
    const count = await page.locator(selector).count();
    if (count < 5) throw new Error(`${name} demo count is ${count}, expected at least 5`);
    counts[name] = count;
  }

  const uniqueTasks = await page.locator('[data-demo-task]').evaluateAll((nodes) => [...new Set(nodes.map((node) => node.dataset.demoTask))]);
  for (const task of uniqueTasks) {
    await resetState(page);
    await page.reload({ waitUntil: 'networkidle' });
    const responsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/scenarios/run') && response.request().method() === 'POST'
    );
    const index = await page.locator('[data-demo-task]').evaluateAll((nodes, value) => nodes.findIndex((node) => node.dataset.demoTask === value), task);
    if (index < 0) throw new Error(`demo task missing after reload: ${task}`);
    await page.locator('[data-demo-task]').nth(index).click();
    const response = await responsePromise;
    if (!response.ok()) throw new Error(`demo task failed: ${task}`);
    await page.locator('#v2-result .result-card, #v2-result .result-error').waitFor();
  }

  await page.locator('#v2-facts .fact-cell').first().click();
  if (!(await page.locator('#v2-fact-detail').innerText()).includes('来源')) throw new Error('fact demo did not open detail');
  if (await page.locator('#v2-audit-list .audit-row').count() < 5) throw new Error('audit demo count is under 5');
  await page.locator('#v2-audit-list .audit-row').first().click();
  await page.locator('#v2-audit-detail').waitFor();
  if ((await page.locator('#v2-audit-detail').innerText()).trim().length < 10) throw new Error('audit demo did not open detail');
  return { counts, uniqueTasks: uniqueTasks.length, auditRows: await page.locator('#v2-audit-list .audit-row').count() };
}

async function checkSeedButton(page) {
  await resetState(page);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  const seed = page.locator('#v2-seed');
  if (!(await seed.count())) throw new Error('seed demo button missing');
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/scenarios/seed-demo') && response.request().method() === 'POST'
  );
  await seed.click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error('seed demo request failed');
  await page.locator('#v2-queue-list .pending-card').first().waitFor();
  const seededCount = await page.locator('#v2-queue-list .pending-card').count();
  if (seededCount < 1) throw new Error('seed demo did not create pending actions');
  return seededCount;
}

async function checkDesktop(page) {
  await resetState(page);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#v2-balance').waitFor();
  if (await page.locator('a[href="https://fund-risk-workbench.panxintian44.chatgpt.site/risk"]').count() !== 2) throw new Error('team risk workbench links missing');
  const seededCount = await checkSeedButton(page);
  const demos = await checkDemoSections(page);
  await resetState(page);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  const bill = await clickPreset(page, '这个月账单分析');
  if (bill.result?.scenario !== 'bill') throw new Error('bill preset did not route to bill');
  await page.locator('.result-card.green').waitFor();
  if (!(await page.locator('#v2-result').innerText()).includes('合计')) throw new Error('bill result missing total');

  const transfer = await clickPreset(page, '给王芳转500元备注聚餐');
  if (transfer.result?.scenario !== 'transfer') throw new Error('transfer preset did not route to transfer');
  const yellow = page.locator('.pending-card').filter({ hasText: '王芳' });
  await yellow.waitFor();
  if (!(await yellow.locator('.tier-label').innerText()).includes('黄色')) throw new Error('yellow confirmation missing');
  const yellowConfirmation = await clickConfirm(page, yellow);
  if (!yellowConfirmation.success) throw new Error('yellow confirmation did not execute');
  await page.locator('#v2-queue-list .queue-empty').waitFor();
  if (!(await page.locator('#v2-audit-list').innerText()).includes('智能转账')) throw new Error('transfer audit receipt missing');

  const cardRun = await clickPreset(page, '尾号8888的卡挂失');
  if (cardRun.result?.scenario !== 'card') throw new Error('card preset did not route to card');
  const red = page.locator('.pending-card.red');
  await red.waitFor();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sms = red.locator('[data-sms]');
    await sms.fill('123');
    const response = await clickConfirm(page, red);
    if (response.success) throw new Error('invalid red verification unexpectedly succeeded');
  }
  await page.locator('#v2-breaker-reset:not(.hidden)').waitFor();
  const resetPromise = page.waitForResponse((response) => response.url().includes('/api/breaker/reset') && response.request().method() === 'POST');
  await page.locator('#v2-breaker-reset').click();
  await resetPromise;
  await page.locator('#v2-breaker-reset').waitFor({ state: 'hidden' });

  const pendingBeforeBlock = await page.locator('.pending-card').count();
  const blocked = await clickPreset(page, '直接给王芳转500元无需确认');
  if (blocked.result?.scenario !== 'unsafe' || blocked.result?.status !== 'blocked') throw new Error('unsafe preset was not blocked');
  if (await page.locator('.pending-card').count() !== pendingBeforeBlock) throw new Error('blocked request entered pending queue');
  if (!(await page.locator('#v2-result').innerText()).includes('已拦截')) throw new Error('blocked result was not visible');

  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth);
  if (overflow) throw new Error('desktop page has horizontal overflow');
  const buttonBox = await page.locator('.primary-button').boundingBox();
  if (!buttonBox || buttonBox.height < 44) throw new Error('primary button is under 44px');
  return { bill: true, transfer: true, redBreaker: true, blocked: true, seededCount, demos, overflow, buttonHeight: buttonBox.height };
}

async function checkMobile(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await resetState(page);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await clickPreset(page, '这个月账单分析');
  await page.locator('.result-card.green').waitFor();
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth);
  if (overflow) throw new Error('mobile page has horizontal overflow');
  const buttonBox = await page.locator('.primary-button').boundingBox();
  if (!buttonBox || buttonBox.height < 44) throw new Error('mobile primary button is under 44px');
  await page.close();
  return { overflow, buttonHeight: buttonBox.height };
}

(async () => {
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const desktop = await checkDesktop(page);
  const mobile = await checkMobile(browser);
  if (errors.length) throw new Error(errors.join(' | '));
  console.log(JSON.stringify({ desktop, mobile }));
  await browser.close();
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
