'use strict';
// Verify the standalone review without starting or changing any business service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const AxeBuilder = require('@axe-core/playwright').default;
const { createServer } = require('../../review/home-directions/serve.cjs');
const root = path.resolve(__dirname, '../..');
const screenshots = path.join(root, 'screenshots');
const report = { scope: 'Isolated home directions only; no backend integration', cases: [] };
(async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base + '/api/demo/portfolio')).status, 404);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
    for (const width of [1440, 1024, 375, 320]) {
      for (const direction of ['A', 'B', 'C']) {
        const context = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
        const page = await context.newPage();
        const errors = [];
        const requests = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        page.on('request', request => requests.push(request.url()));
        await page.goto(base + '/?direction=' + direction);
        assert.equal(await page.locator('body').getAttribute('data-direction'), direction);
        assert.equal(await page.locator('[aria-current="page"]').count(), 1);
        assert.equal(await page.locator('.feature-card').count(), direction === 'C' ? 1 : 2);
        assert.equal(await page.locator('a[href*="merchant"]').count(), 0);
        assert.equal(await page.locator('.vessel').count(), 2);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}/${direction}: overflow`);
        const vessels = await page.locator('.vessel').evaluateAll(elements => elements.map(element => {
          const rect = element.getBoundingClientRect();
          return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
        }));
        assert(Math.abs(vessels[0].y - vessels[1].y) < 2, 'Vessels remain side by side');
        assert(vessels[0].right < vessels[1].x, 'Vessels never overlap');
        const entries = page.locator('[data-entry]');
        for (let index = 0; index < await entries.count(); index++) {
          const entry = entries.nth(index);
          await entry.click();
          assert(await page.locator('#entry-dialog').evaluate(element => element.open));
          assert.equal(await page.locator('#dialog-steps li').count(), 3);
          await page.keyboard.press('Escape');
          assert.equal(await page.locator('#entry-dialog').evaluate(element => element.open), false);
          assert(await entry.evaluate(element => element === document.activeElement), 'Focus returns after closing');
        }
        await page.locator('.vessel').first().click();
        assert.equal(await page.locator('.vessel').first().evaluate(element => element.style.getPropertyValue('--level')), '45%');
        assert.notEqual(await page.locator('.balance-layout').evaluate(element => element.style.getPropertyValue('--tilt')), '0deg');
        for (let i = 0; i < 7; i++) await page.locator('.vessel').first().evaluate(element => element.click());
        assert.equal(await page.locator('.vessel').first().evaluate(element => element.style.getPropertyValue('--level')), '78%');
        await page.locator('#reset').click();
        assert.equal(await page.locator('.balance-layout').evaluate(element => element.style.getPropertyValue('--tilt')), '0deg');
        assert.deepEqual(await page.locator('.vessel').evaluateAll(elements => elements.map(element => element.style.getPropertyValue('--level'))), ['34%', '34%']);
        const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        assert.deepEqual(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], `${width}/${direction}: accessibility`);
        await page.locator('summary').click();
        assert(await page.locator('details').evaluate(element => element.open));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.locator('summary').click();
        await page.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
        await page.waitForTimeout(650);
        if (width !== 320) await page.screenshot({ path: path.join(screenshots, `home-direction-${direction.toLowerCase()}-${width}.png`), fullPage: true });
        assert.deepEqual(errors, []);
        assert(requests.every(url => url.startsWith(base) && !url.includes('/api/')), 'No API or external requests');
        report.cases.push({ width, direction, result: 'passed', accessibilityViolations: 0 });
        await context.close();
        console.log(`PASS ${width}px / direction ${direction}`);
      }
    }
    const page = await browser.newPage();
    await page.goto(base + '/?direction=B');
    await page.locator('a[data-direction="A"]').click();
    await page.locator('a[data-direction="C"]').click();
    await page.goBack();
    assert.equal(await page.locator('body').getAttribute('data-direction'), 'A');
    await page.reload();
    assert.equal(await page.locator('body').getAttribute('data-direction'), 'A');
    await page.goto(base + '/?direction=' + encodeURIComponent('<script>window.injected=true</script>'));
    assert.equal(await page.locator('body').getAttribute('data-direction'), 'B');
    assert.equal(await page.evaluate(() => window.injected), undefined);
    await page.goto(base + '/?direction=toString');
    assert.equal(await page.locator('body').getAttribute('data-direction'), 'B');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.vessel').first().evaluate(element => getComputedStyle(element).transitionDuration), '0s');
    await page.locator('a[data-direction="C"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('body').getAttribute('data-direction'), 'C');
    report.additional = ['Back and reload', 'Unknown URL value is not rendered', 'Reduced motion', 'Keyboard navigation', 'HTTP read-only isolation'];
    const proposal = fs.readFileSync(path.join(root, 'docs/contract-proposals/2026-10-08-ui-needs.md'), 'utf8');
    const examples = [...proposal.matchAll(/```json\s*([\s\S]*?)```/g)];
    assert.equal(examples.length, 3);
    for (const example of examples) assert.equal(JSON.parse(example[1]).proposal_only, true);
    report.jsonExamples = examples.length;
    fs.writeFileSync(path.join(root, 'review/home-directions/verification.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('PASS navigation, isolation, reduced motion and proposal JSON');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
