const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../versions/xinlan/journey.mjs');
test('rehearsal entry and role boundaries are not server authentication', async () => {
  const m = await load(), state = m.createJourney();
  assert.equal(m.canVisit(state, 'console'), false);
  assert.equal(m.enter(state, 'unknown'), false);
  for (const role of Object.keys(m.roles)) {
    m.enter(state, role);
    assert.equal(m.canVisit(state, 'console'), ['analyst', 'supervisor'].includes(role));
    assert.equal(m.canVisit(state, 'personal'), role === 'personal');
  }
  m.leave(state);
  assert.equal(m.workspace(state), null);
  assert.ok(m.submitScenario(state, 'DEMO-001').error);
});
test('all preset decisions survive review, conflicts and repeated submissions', async () => {
  const m = await load();
  for (const sample of m.scenarios) {
    const state = m.createJourney();
    m.enter(state, 'personal');
    const { event } = m.submitScenario(state, sample.id);
    assert.equal(event.decision, sample.decision);
    assert.equal(m.acknowledgeEvent(state, event.id), true);
    assert.equal(m.acknowledgeEvent(state, event.id), false);
    for (const role of ['personal', 'admin']) {
      m.enter(state, role);
      assert.ok(m.reviewEvent(state, event.id, 1, '拒绝越权修改记录').error);
    }
    if (sample.decision === 'ALLOW') {
      m.enter(state, 'supervisor');
      assert.ok(m.reviewEvent(state, event.id, 1, '无需复核的通过案例').error);
      continue;
    }
    m.enter(state, 'analyst');
    assert.ok(m.reviewEvent(state, event.id, 1, ' ').error);
    assert.ok(m.reviewEvent(state, event.id, 1, '已核对案例依据，提交主管核实').event);
    assert.equal(event.review, 'IN_REVIEW');
    assert.equal(event.read, false);
    const count = state.audit.length;
    assert.ok(m.reviewEvent(state, event.id, 1, '旧版本重复提交意见').error);
    assert.equal(state.audit.length, count);
    m.enter(state, 'supervisor');
    assert.ok(m.reviewEvent(state, event.id, 2, '已记录核实结论，原始判定不变').event);
    assert.equal(event.review, 'RESOLVED');
    assert.equal(event.decision, sample.decision);
    assert.equal(state.audit.at(-1).before, 'IN_REVIEW');
    assert.equal(state.audit.at(-1).after, 'RESOLVED');
    assert.ok(m.reviewEvent(state, event.id, 3, '再次提交同一复核结论').error);
  }
});
