'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../tools/financial-tools');

test('allocation chart matches the validated snapshot including cash exactly once', async () => {
  const { allocationView } = await import('../versions/ui-model.mjs');
  const snapshot = tools.validatePortfolio(tools.getDemoPortfolio()).output.snapshot;
  const rows = allocationView(snapshot);
  assert.equal(rows.length, snapshot.positions.length + 1);
  assert.equal(rows.reduce((sum, item) => sum + item.value, 0), snapshot.total_value);
  assert.ok(Math.abs(rows.at(-1).end - 100) < 1e-9);
  assert.equal(rows.at(-1).value, snapshot.cash);
  assert.equal(rows[0].start, 0);
  for (let i = 1; i < rows.length; i++) assert.equal(rows[i].start, rows[i - 1].end);
});

test('chart bounds contain negative-only, positive-only, flat and empty data', async () => {
  const { chartDomain } = await import('../versions/ui-model.mjs');
  for (const values of [[-900,-600,-100], [500,700,2000], [0,0], [100,100], [-1e8,1e8], []]) {
    const { low, high } = chartDomain(values);
    assert.ok(Number.isFinite(low) && Number.isFinite(high));
    assert.ok(high > low);
    for (const value of values) assert.ok(low <= value && high >= value);
  }
});

test('request and JSON failures produce actionable Chinese feedback', async () => {
  const { userError } = await import('../versions/ui-model.mjs');
  assert.match(userError(new SyntaxError('Unexpected token')), /JSON 格式/);
  assert.match(userError(new TypeError('Failed to fetch')), /无法连接/);
  assert.match(userError({ name:'TimeoutError' }), /超时/);
  assert.equal(userError(new Error('余额不合法')), '余额不合法');
});
