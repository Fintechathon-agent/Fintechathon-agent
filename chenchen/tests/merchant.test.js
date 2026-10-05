"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { MerchantSession, demo, validate, forecast, costs } = require('../merchant/ledger');

test('ledger totals use net receipts and never add settled bills to opening cash', () => {
  const s = new MerchantSession().summary();
  assert.deepEqual(s.totals, {balance_cents:620000,receivable_cents:717680,payable_cents:1615000});
  assert.equal(s.forecast.days[0].expected_cents,757780);
  assert.equal(s.forecast.days[0].conservative_cents,400000);
  assert.equal(s.forecast.first_gap.date,'2026-10-10');
  assert.equal(s.forecast.first_gap.expected_cents,-362820);
  assert.deepEqual(s.forecast.excluded_overdue_receipts,['团购平台:GROUP-01']);
});
test('the payout equation keeps fees and refunds visible', () => {
  const b = new MerchantSession().detail('外卖平台:MT-001');
  assert.equal(b.amount_cents,320000); assert.equal(b.fee_cents,25600);
  assert.equal(b.refund_cents,20000); assert.equal(b.net_cents,274400);
});
test('duplicate imports are idempotent and conflicting duplicates are rejected atomically', () => {
  const original=demo(), duplicate=structuredClone(original);
  duplicate.bills.push(structuredClone(duplicate.bills[0]));
  assert.equal(validate(duplicate).duplicates,1);
  assert.deepEqual(validate(duplicate).ledger,validate(original).ledger);
  const s=new MerchantSession(original), before=s.summary();
  duplicate.bills.at(-1).amount_cents++;
  assert.throws(()=>s.replace(duplicate),{code:'DUPLICATE_CONFLICT'});
  assert.deepEqual(s.summary(),before);
});
test('cents, dates, status, currency and quantity validation reject invalid imports', () => {
  const mutators=[d=>d.balance_cents='620000',d=>d.currency='USD',d=>d.as_of='2026-02-30',
    d=>d.bills[0].amount_cents=0.5,d=>d.bills[0].refund_cents=999999,d=>d.bills[0].due_on='2026-10-10',
    d=>d.bills[0].booked_on='2027-01-01',d=>d.bills[0].status='unknown',d=>d.bills[6].quantity=1e300];
  for(const mutate of mutators){const d=demo();mutate(d);assert.throws(()=>validate(d));}
});
test('review requires bill viewing and explicit confirmation of the current revision', () => {
  const s=new MerchantSession();
  assert.throws(()=>s.insights(),{code:'REVIEW_REQUIRED'});
  assert.throws(()=>s.review(s.revision,true),{code:'REVIEW_REQUIRED'});
  s.detail('微信:WX-002');
  assert.throws(()=>s.review(s.revision,false),{code:'REVIEW_REQUIRED'});
  assert.throws(()=>s.review('older-revision',true),{code:'STALE_REVIEW'});
  s.review(s.revision,true);
  assert.ok(s.insights().notices.length>=3);
});
test('a replacement resets review and followups even after a previously confirmed import', () => {
  const s=new MerchantSession();s.detail('微信:WX-002');s.review(s.revision,true);s.follow('overdue');
  const old=s.revision, next=demo();next.balance_cents+=100;s.replace(next);
  assert.notEqual(s.revision,old);assert.equal(s.viewed.size,0);assert.equal(s.followups.size,0);
  assert.throws(()=>s.insights(),{code:'REVIEW_REQUIRED'});
});
test('same-item price and quantity effects sum to the actual purchase increase', () => {
  const c=costs(validate(demo()).ledger).find(c=>c.category==='咖啡豆');
  assert.equal(c.change_ratio,0.375);assert.equal(c.decomposition.previous_unit_cents,8000);
  assert.equal(c.decomposition.current_unit_cents,8800);
  assert.equal(c.decomposition.quantity_effect_cents,40000);
  assert.equal(c.decomposition.price_effect_cents,20000);
  assert.equal(c.decomposition.price_effect_cents+c.decomposition.quantity_effect_cents,c.delta_cents);
});
test('mixed items or absent baseline do not get invented unit-price explanations', () => {
  const d=demo();d.bills.find(b=>b.id==='BEAN-C').item='另一种豆';
  const cs=costs(validate(d).ledger);
  assert.equal(cs.find(c=>c.category==='咖啡豆').decomposition,null);
  assert.equal(cs.find(c=>c.category==='房租').change_ratio,null);
});
test('arrival delay exposes an earlier cash gap without moving supplier due dates', () => {
  const l=validate(demo()).ledger, f=forecast(l,3), base=forecast(l);
  assert.equal(f.first_gap.date,'2026-10-06');assert.equal(f.first_gap.expected_cents,-300000);
  assert.equal(f.days[1].outgoing_cents,base.days[1].outgoing_cents);
  assert.equal(f.days.at(-1).expected_cents,base.days.at(-1).expected_cents);
  assert.throws(()=>forecast(l,-3),{code:'INVALID_DELAY'});
});
test('overdue payments are reserved tomorrow and not subtracted repeatedly', () => {
  const d=demo();const rent=d.bills.find(b=>b.id==='RENT');rent.due_on=d.as_of;
  const f=forecast(validate(d).ledger);
  assert.equal(f.days[0].outgoing_cents,920000);assert.equal(f.days[1].outgoing_cents,0);
});
test('separate merchant sessions cannot see each other’s ledger or confirmation', () => {
  const a=new MerchantSession(),b=new MerchantSession();a.detail('微信:WX-002');a.review(a.revision,true);
  assert.equal(b.viewed.size,0);assert.equal(b.reviewed,false);
  const snapshot=a.summary();snapshot.ledger.balance_cents=1;
  assert.equal(a.ledger.balance_cents,620000);
});
test('empty ledger has a flat known-cash forecast without fabricated warnings', () => {
  const d=demo();d.bills=[];const s=new MerchantSession(d).summary();
  assert.equal(s.totals.receivable_cents,0);assert.equal(s.costs.length,0);
  assert.ok(s.forecast.days.every(d=>d.expected_cents===620000));assert.equal(s.forecast.first_gap,null);
});

test('negative opening cash is the first gap even when next-day receipts cover it', () => {
  const d=demo();d.balance_cents=-10000;
  d.bills=d.bills.filter(b=>b.id==='WX-002');
  const s=new MerchantSession(d), f=s.summary().forecast;
  assert.equal(f.first_gap.date,d.as_of);assert.equal(f.first_gap.opening,true);
  assert.equal(f.first_gap.expected_cents,-10000);assert.ok(f.days[0].expected_cents>0);
  s.detail('微信:WX-002');s.review(s.revision,true);
  const notice=s.insights().notices.find(n=>n.id==='cash-gap');
  assert.equal(notice.amount_cents,10000);assert.deepEqual(notice.evidence,[]);
  assert.match(notice.title,/当前余额已为负数/);
});

test('notice status moves through plain-language states and resets after replacement', () => {
  const s=new MerchantSession();s.detail('微信:WX-002');s.review(s.revision,true);
  assert.equal(s.insights().notices.find(n=>n.id==='overdue').status,'open');
  assert.deepEqual(s.setNoticeStatus('overdue','verified','已联系平台，等回款'),{id:'overdue',status:'verified'});
  assert.equal(s.insights().notices.find(n=>n.id==='overdue').status,'verified');
  assert.equal(s.insights().notices.find(n=>n.id==='overdue').note,'已联系平台，等回款');
  assert.deepEqual(s.setNoticeStatus('overdue','done'),{id:'overdue',status:'done'});
  assert.equal(s.insights().notices.find(n=>n.id==='overdue').status,'done');
  assert.equal(s.insights().notices.find(n=>n.id==='overdue').note,'已联系平台，等回款');
  assert.throws(()=>s.setNoticeStatus('overdue','unknown'),{code:'INVALID_NOTICE_STATUS'});
  assert.throws(()=>s.setNoticeStatus('overdue','done','x'.repeat(241)),{code:'INVALID_NOTICE_NOTE'});
  s.replace(demo());assert.equal(s.noticeStates.size,0);
});

test('single receipt delay scenario moves only the selected income bill', () => {
  const s=new MerchantSession(), l=s.ledger;
  const result=s.singleScenario('外卖平台:MT-001',3);
  assert.equal(result.moved_from,'2026-10-06');assert.equal(result.moved_to,'2026-10-09');
  assert.equal(result.baseline.first_gap.date,'2026-10-10');
  assert.equal(result.scenario.first_gap.date,'2026-10-07');
  const scenario=forecast(l,3,'外卖平台:MT-001');
  assert.equal(scenario.days[0].incoming_cents,357780);
  assert.equal(scenario.days[1].incoming_cents,0);
});
