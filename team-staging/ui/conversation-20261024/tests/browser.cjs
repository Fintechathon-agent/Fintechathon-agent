'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const base = process.env.TEST_URL || 'http://127.0.0.1:8887';
const live = process.argv.includes('--live');
const online = process.argv.includes('--online');
const report = { base, realProviderRequested: live, widths: [], requests: [], errors: [] };
const evidence = path.join(root, 'evidence');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    ...(!online ? { args: ['--no-proxy-server'] } : process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}) });
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  let lastModelPayload;
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('response', async response => {
    if (response.url().includes('/api/assistant/')) report.requests.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  page.on('request', request => {
    if (request.url().endsWith('/api/assistant/message')) lastModelPayload = request.postDataJSON();
  });
  const send = async text => {
    await page.locator('#message').fill(text);
    const response = page.waitForResponse(r => r.url().endsWith('/api/assistant/message') && r.request().method() === 'POST', { timeout: 70000 });
    await page.locator('#send').click();
    const actual = await response;
    assert.equal(actual.status(), 200);
    const data = await actual.json();
    await page.waitForFunction(() => !document.getElementById('send').disabled);
    return data;
  };
  const state = () => page.evaluate(async () => (await (await fetch('/api/assistant/state')).json()).state);
  try {
    for (const width of [320, 375, 430, 700, 701, 840, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(base + '/landing.html?v=20261024-conversation', { waitUntil: 'networkidle' });
      assert.equal(await page.locator('.landing-nav a[href="conversation.html"]').count(), 1);
      assert.equal(await page.locator('.feature-card').nth(1).locator('h3').innerText(), '生活与投资');
      const cards = await page.locator('.feature-card').evaluateAll(els => els.map(el => {
        const number = el.querySelector('.archive-diagram>span:not(.liquid-vessel)').getBoundingClientRect();
        const pool = el.querySelector('.liquid-vessel').getBoundingClientRect();
        return { gap: pool.left - number.right };
      }));
      assert.ok(cards.every(x => x.gap >= 4), 'Previous pool separation must be preserved');
      const title = page.locator('.feature-card h3').nth(1);
      await title.scrollIntoViewIfNeeded();
      const box = await title.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForURL('**/conversation.html');
      if (!online) await page.waitForFunction(() => document.getElementById('save-state').textContent.includes('已保存'));
      else {
        await page.locator('#service-notice').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#send').isDisabled(), true);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no horizontal overflow`);
      const brand = await page.locator('.brand img').getAttribute('src');
      assert.ok(brand.includes('team-logo-transparent.png'));
      assert.equal(await page.locator('.archive-scene').count(), 1);
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--signal-orange').trim()), '#ff914a');
      if ([375, 840, 1440].includes(width)) await page.screenshot({ path: path.join(evidence, `${online ? 'online' : 'local'}-${width}.png`) });
      report.widths.push(width);
    }
    await page.goto(base + '/workspace.html#banking', { waitUntil: 'networkidle' });
    assert.equal(await page.getByText('替换组合 JSON', { exact: true }).count(), 0);
    assert.equal(await page.getByText('任务状态与工具证据', { exact: true }).count(), 0);
    assert.equal(await page.getByText('原始响应与任务关联', { exact: true }).count(), 0);
    assert.equal(await page.locator('#portfolio-json').isVisible(), false);
    assert.equal(await page.locator('#load-error').innerText(), '组合资料暂时无法读取，请稍后重试。');
    report.diagnosticsHidden = true;
    if (!online) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(base + '/conversation.html', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.getElementById('save-state').textContent.includes('已保存'));
      const first = await send('我只想记账。今天工资到账12000元，午饭实付18元。');
      assert.equal(first.state.records.length, 2);
      await send('午饭其实实付28元');
      assert.equal((await state()).records.find(r => r.kind === 'expense').amount_cents, 2800);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.getElementById('save-state').textContent.includes('已保存'));
      assert.equal((await state()).records.length, 2);
      await context.setOffline(true);
      await page.locator('#message').fill('这条是断网保留的草稿');
      await page.locator('#send').click();
      await page.locator('#error').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#message').inputValue(), '这条是断网保留的草稿');
      await context.setOffline(false);
      report.offlineDraftPreserved = true;
      await page.locator('#message').fill('');
      if (live) {
        const response = await send('请分析我的生活与长期投资安排。我每月必要开支6000元，有36000元应急金，无负债，打算每月1000元投资，持有五年以上，仍担心临时用钱。请说明风险与需要核对的信息，不推荐个股，不执行交易。');
        const answer = response.state.threads.find(t => t.id === response.thread_id).messages.at(-1);
        assert.equal(answer.engine, 'core-agent');
        assert.equal(answer.model.name, 'qwen3.8-flash');
        assert.equal(answer.model.execution_allowed, false);
        assert.ok(answer.text.length > 80);
        const duplicate = await page.evaluate(async body => {
          const r = await fetch('/api/assistant/message', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Finance-Request': '1' }, body: JSON.stringify(body) });
          return { status: r.status, body: await r.json() };
        }, lastModelPayload);
        assert.equal(duplicate.status, 200);
        assert.equal(duplicate.body.duplicate, true);
        const events = fs.readFileSync(path.join(root, 'runtime/provider-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
        const event = events.find(item => item.run_id === answer.model.run_id);
        assert.equal(event.http_status, 200);
        assert.equal(event.call_succeeded, true);
        assert.ok(answer.text.includes(event.proposal.action_reason));
        report.live = { ...event, browser_message_http_status: 200, answer: answer.text, duplicateDidNotRecallProvider: events.filter(e => e.run_id === event.run_id).length === 1 };
        assert.ok(report.live.duplicateDidNotRecallProvider);
        await page.screenshot({ path: path.join(evidence, 'live-browser.png') });
      }
      const cookie = (await context.cookies()).find(c => c.name === 'finance_session');
      assert.equal(cookie.httpOnly, true);
      const otherContext = await browser.newContext();
      const other = await otherContext.newPage();
      await other.goto(base + '/conversation.html', { waitUntil: 'networkidle' });
      assert.equal(await other.evaluate(async () => (await (await fetch('/api/assistant/state')).json()).state.records.length), 0);
      await otherContext.close();
      const foreign = await context.request.get(base + '/api/assistant/state', { headers: { Origin: 'https://untrusted.example' } });
      assert.equal(foreign.status(), 403);
      const missing = await context.request.get(base + '/.env.local');
      assert.equal(missing.status(), 404);
      const csv = await context.request.get(base + '/api/assistant/export');
      assert.equal(csv.status(), 200);
      assert.ok((await csv.text()).includes('工资'));
      report.persistenceAndIsolation = true;
    } else {
      assert.equal(report.requests.length, 0, 'Unconfigured static preview must not send financial data');
      const files = JSON.parse(fs.readFileSync(path.join(root, 'release-files.json'), 'utf8')).files.filter(e => !e.file.startsWith('.'));
      for (const file of files) {
        const response = await context.request.get(`${base}/${file.file}?v=20261024-conversation`);
        assert.equal(response.status(), 200);
        assert.equal(crypto.createHash('sha256').update(await response.body()).digest('hex'), file.sha256, `Published bytes: ${file.file}`);
      }
      report.publishedHashesVerified = files.length;
    }
    assert.deepEqual(report.errors, []);
    report.result = 'PASSED';
  } catch (error) {
    report.result = 'FAILED'; report.error = error.message; throw error;
  } finally {
    fs.writeFileSync(path.join(evidence, online ? 'online-browser.json' : live ? 'live-browser.json' : 'local-browser.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ result: report.result, widths: report.widths.length, live: !!report.live, error: report.error }));
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
