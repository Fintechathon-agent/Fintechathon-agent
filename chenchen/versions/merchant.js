import { $, esc, money, pct, api, toast, downloadLink, chart, today, tip } from './common.js';
import { dateStatus, merchantOverview, priorityBills } from './presentation.mjs';
let state, reminders, refreshSequence = 0;
const key = b => b.channel + ':' + b.id;
const delay = () => Number($('#delay').value);
const noticeStatuses = { open:'待处理', verified:'已核实', done:'已处理' };
const sourceButtons = refs => refs.map(r => '<button class="subtle evidence" data-key="'+esc(r)+'">'+esc(r)+'</button>').join(' · ');
function previewBill(b) {
  return '<article class="bill-preview"><div class="bill-top"><span>'+esc(b.id)+'</span><span>'+esc(b.due_on)+'</span></div><div class="bill-amount '+(b.kind==='income'?'positive':'danger')+'">'+(b.kind==='income'?'+':'−')+money(b.amount_cents-b.fee_cents-b.refund_cents)+'</div><p class="bill-meta">'+esc(b.category)+' · '+(b.status==='settled'?'已结算':b.kind==='income'?'待到账':'待付款')+'</p><button class="secondary evidence" data-key="'+esc(key(b))+'">看账单'+(state.viewed.includes(key(b))?' ✓':'')+'</button></article>';
}
function showBills() {
  if (!state) return;
  const query = $('#search').value.trim().toLowerCase();
  const bills = priorityBills(state.ledger.bills).filter(b => (!$('#channel').value || b.channel === $('#channel').value) &&
    (!$('#bill-status').value || b.status === $('#bill-status').value) &&
    (!query || [b.id,b.category,b.description].join(' ').toLowerCase().includes(query)));
  $('#bill-count').textContent = '显示 '+bills.length+' / '+state.ledger.bills.length+' 笔 · 已查看来源 '+state.viewed.length+' 笔';
  $('#quick-bills').innerHTML = bills.length ? bills.slice(0,3).map(previewBill).join('') : '<p class="empty">没有符合条件的账单。</p>';
  $('#bills').innerHTML = bills.length ? '<table><thead><tr><th>账单 / 渠道</th><th>类别</th><th class="num">账单原额</th><th class="num">扣费 / 退款</th><th class="num">净收 / 付款</th><th>预计日期 / 状态</th><th>来源</th></tr></thead><tbody>'+bills.map(b=>'<tr><td>'+esc(b.id)+'<small>'+esc(b.channel)+'</small></td><td>'+esc(b.category)+'<small>'+esc(b.booked_on)+' 记账</small></td><td class="num">'+money(b.amount_cents)+'</td><td class="num">'+money(b.fee_cents+b.refund_cents)+'</td><td class="num">'+(b.kind==='income'?'+':'−')+money(b.amount_cents-b.fee_cents-b.refund_cents)+'</td><td>'+esc(b.due_on)+'<small>'+ (b.status==='settled'?'已结算':b.kind==='income'?'待到账':'待付款')+'</small></td><td><button class="subtle evidence" data-key="'+esc(key(b))+'">看账单'+(state.viewed.includes(key(b))?' ✓':'')+'</button></td></tr>').join('')+'</tbody></table>' : '<p class="empty">没有符合条件的账单。尝试清空筛选条件。</p>';
}
function render() {
  const l = state.ledger, f = state.forecast, overview = merchantOverview(state);
  $('#shop-date').textContent = l.shop + ' · 截至 ' + l.as_of;
  $('#totals').innerHTML = [[tip('还在路上的钱','tip-receivable','预计会到账，但现在还不能拿来付款。'),money(state.totals.receivable_cents),'不是可用余额'],[tip('已知待付款','tip-payable','已经记下、以后需要付出去的钱。'),money(state.totals.payable_cents),'全部未结算支出'],[tip('最近待付款','tip-next-payment','当前账单里日期最近的一笔待付款。'),overview.nextPayment ? overview.nextPayment.due_on.slice(5) : '暂无',overview.nextPayment ? overview.nextPayment.category+' · '+money(overview.nextPayment.amount_cents) : '未录入不代表无支出']].map(([t,v,d])=>'<article class="metric"><small>'+t+'</small><strong>'+esc(v)+'</strong><small>'+esc(d)+'</small></article>').join('');
  $('#merchant-status').innerHTML = '<span class="cash-label">'+tip('已核对余额','tip-balance-live','已经到账，并且你已经对照过银行或现金记录的钱。')+'</span><div class="cash-value">'+money(state.totals.balance_cents)+'</div><p class="cash-sub">已到账且已核对；待到账收入不计入可用余额</p>';
  const firstGap = overview.gap, conservativeGap = overview.conservativeGap;
  $('#scenario-label').textContent = overview.scenario + ' · 测算';
  $('#cash-callout-title').textContent = firstGap ? (firstGap.opening ? '基准日余额已为负' : '首个缺口 · '+firstGap.date.slice(5)) : '14 天内未见已知缺口';
  $('#cash-callout-copy').textContent = firstGap ? '预计余额 '+money(firstGap.expected_cents)+' · 未包含未来销售' : '只含已知账单，不代表没有未知支出。';
  $('#gap-summary').textContent = conservativeGap ? '待收款全部暂未到账时，'+conservativeGap.date+' 余额为负。' : '保守情景下未见负余额；仍需核对新增账单。';
  const rising = state.costs.filter(c => c.change_ratio !== null && c.change_ratio > 0).sort((a,b)=>b.change_ratio-a.change_ratio)[0];
  $('#cost-summary').textContent = rising ? rising.category+' 本期 '+money(rising.current_cents)+'，较上期上升 '+pct(rising.change_ratio)+'；不等于单价上涨。' : '目前没有可比的上涨采购。';
  const scenarioBill = $('#scenario-bill').value;
  const scenarioBills = l.bills.filter(b => b.kind === 'income' && b.status === 'pending' && b.due_on > l.as_of);
  $('#scenario-bill').innerHTML = scenarioBills.length ? scenarioBills.map(b=>'<option value="'+esc(key(b))+'">'+esc(b.channel+' · '+b.id+' · '+money(b.amount_cents-b.fee_cents-b.refund_cents))+'</option>').join('') : '<option value="">没有可试算的未到账收入</option>';
  if (scenarioBills.some(b => key(b) === scenarioBill)) $('#scenario-bill').value = scenarioBill;
  const channel = $('#channel').value;
  $('#channel').innerHTML = '<option value="">全部渠道</option>'+[...new Set(l.bills.map(b=>b.channel))].map(c=>'<option>'+esc(c)+'</option>').join('');
  if ([...$('#channel').options].some(o=>o.value===channel)) $('#channel').value=channel;
  showBills(); renderReview();
  $('#cash-chart').innerHTML = chart([{name:'预计余额（元）',values:[l.balance_cents,...f.days.map(d=>d.expected_cents)].map(v=>v/100)},{name:'暂未到账时余额（元）',values:[l.balance_cents,...f.days.map(d=>d.conservative_cents)].map(v=>v/100)}],[l.as_of,...f.days.map(d=>d.date)]);
  $('#calendar').innerHTML = '<table><thead><tr><th>日期</th><th class="num">预计到账</th><th class="num">到期付款</th><th class="num">预计余额</th><th>相关账单</th></tr></thead><tbody>'+f.days.map(d=>'<tr><td>'+d.date+'</td><td class="num">'+money(d.incoming_cents)+'</td><td class="num">'+money(d.outgoing_cents)+'</td><td class="num '+(d.expected_cents<0?'danger':'')+'">'+money(d.expected_cents)+'</td><td>'+sourceButtons(d.evidence)+'</td></tr>').join('')+'</tbody></table>';
  $('#cost-period').textContent = state.costs.length ? '本期 '+state.costs[0].current_window.join(' 至 ')+'；对比 '+state.costs[0].previous_window.join(' 至 ')+'。' : '没有可比较的采购记录。';
  const orderedCosts = [...state.costs].sort((a,b)=>Number(b.change_ratio!==null)-Number(a.change_ratio!==null)||(b.change_ratio||0)-(a.change_ratio||0));
  const costCards = orderedCosts.map(c=>{
    const change = c.change_ratio === null ? '暂无对比' : (c.change_ratio>=0?'+':'')+pct(c.change_ratio);
    return '<article class="cost-card"><div class="cost-top"><strong>'+esc(c.category)+'</strong><span class="cost-change '+(c.change_ratio>0?'up':c.change_ratio<0?'down':'')+'">'+change+'</span></div><p>本期 '+money(c.current_cents)+' · 上期 '+money(c.previous_cents)+'</p><details><summary>查看变化解释</summary><p>'+(c.decomposition ? '同品单价 '+money(c.decomposition.previous_unit_cents)+' → '+money(c.decomposition.current_unit_cents)+' / '+esc(c.decomposition.unit)+'；数量影响 '+money(c.decomposition.quantity_effect_cents)+'，单价影响 '+money(c.decomposition.price_effect_cents)+'。':'缺少可比数量或上期记录，暂不判断涨价原因。')+'</p><div class="small">'+sourceButtons(c.evidence)+'</div></details></article>';
  });
  $('#costs').innerHTML = costCards.length ? '<div class="cost-grid">'+costCards.slice(0,2).join('')+'</div>'+(costCards.length>2?'<details><summary>其他 '+(costCards.length-2)+' 项支出</summary><div class="cost-grid">'+costCards.slice(2).join('')+'</div></details>':'') : '<p class="empty">暂无采购支出。</p>';
}
function renderReview() {
  if(!state)return;
  const overview = merchantOverview(state), dated = dateStatus(state.ledger.as_of, today());
  $('#ledger-health').innerHTML = '<span>'+esc(dated.label)+'</span><span>来源已查看 '+state.viewed.length+' / '+state.ledger.bills.length+' 笔</span><span>'+overview.unconfirmed.length+' 笔到期未确认收入</span>';
  $('#review').textContent = state.reviewed ? '本版口径已确认 ✓' : '已看懂，生成提醒 →';
  $('#review-status').textContent = state.reviewed ? '本版账单已确认；导入新账单后需要重新核对。' : '已查看 '+state.viewed.length+' 笔来源。请核对当前余额与未结算款的区别。';
  $('#review').disabled = state.reviewed || !state.viewed.length || !$('#confirm').checked;
  $('#confirm').disabled = state.reviewed;
  $('#export-review').disabled = !state.reviewed;
}
async function loadInsights() {
  if (!state.reviewed) { reminders=null; $('#insights').className='empty'; $('#insights').textContent='提醒尚未生成。先打开账单，再确认你已看懂金额口径。'; $('#digest').textContent=''; return; }
  const requestedDelay = delay(), revision = state.revision;
  reminders=null; $('#insights').className='empty'; $('#insights').textContent='正在更新本情景的提醒…'; $('#digest').textContent='';
  let next;
  try { next = await api('/api/merchant/insights?delay='+requestedDelay); }
  catch(error) {
    if(state.revision===revision&&delay()===requestedDelay)$('#insights').textContent='本情景的提醒读取失败，请刷新重试。';
    throw error;
  }
  if (!state.reviewed || state.revision !== revision || next.revision !== revision || delay() !== requestedDelay) return;
  reminders = next;
  $('#insights').className='';
  const sorted = [...reminders.notices].sort((a,b)=>Number(a.status==='done')-Number(b.status==='done')||Number(a.status==='verified')-Number(b.status==='verified')||Number(b.following)-Number(a.following));
  $('#insights').innerHTML = sorted.map(n=>'<article class="insight"><div class="row"><h3>'+esc(n.title)+'</h3><div class="notice-actions"><select class="notice-status" data-id="'+esc(n.id)+'" aria-label="'+esc(n.title)+'处理状态">'+Object.entries(noticeStatuses).map(([value,label])=>'<option value="'+value+'"'+(n.status===value?' selected':'')+'>'+label+'</option>').join('')+'</select><button class="secondary follow" data-id="'+esc(n.id)+'">'+(n.following?'已关注 ✓':'下次关注')+'</button></div></div><p><strong>'+money(n.amount_cents)+'</strong></p><details><summary>查看原因与相关账单</summary><p>'+esc(n.explanation)+'</p><div class="small">'+sourceButtons(n.evidence)+'</div></details></article>').join('') || '<p>已知账单未触发当前规则的提醒。未知支出和未来销售仍需你补充。</p>';
  $('#digest').textContent=reminders.digest;
}
async function runSingleScenario() {
  const bill = $('#scenario-bill').value, days = Number($('#scenario-delay').value);
  if (!bill) return toast('没有可试算的未到账收入。');
  $('#scenario-run').disabled = true; $('#scenario-result').hidden = false; $('#scenario-result').textContent = '正在试算…';
  try {
    const result = await api('/api/merchant/scenario?bill='+encodeURIComponent(bill)+'&delay='+days);
    const gap = value => value.first_gap ? value.first_gap.date+' · '+money(value.first_gap.expected_cents) : '未来 14 天未出现负余额';
    $('#scenario-result').innerHTML = '<strong>'+esc(result.bill.channel+' · '+result.bill.id)+' 晚 '+result.delay_days+' 天到账</strong><p>预计到账日：'+esc(result.moved_from)+' → '+esc(result.moved_to)+'</p><p>原本情景：'+esc(gap(result.baseline))+'；单笔延迟后：'+esc(gap(result.scenario))+'</p><small>这只是单笔收入的假设，不会修改账单，也不会自动改变付款日期。</small>';
  } catch (error) { $('#scenario-result').textContent = error.message; }
  finally { $('#scenario-run').disabled = false; }
}
async function refresh() {
  const sequence=++refreshSequence, next=await api('/api/merchant/ledger?delay='+delay());
  if(sequence!==refreshSequence)return;
  state=next; render(); await loadInsights();
}
document.addEventListener('click', async event=>{
  try {
    const evidence=event.target.closest('.evidence'), follow=event.target.closest('.follow');
    if(evidence) {
      const id=evidence.dataset.key, b=await api('/api/merchant/bill?id='+encodeURIComponent(id));
      if(!state.viewed.includes(id)) state.viewed.push(id);
      $('#bill-title').textContent=b.id+' · '+b.category;
      const rows=[['原始来源',b.source],['渠道',b.channel],['说明',b.description],['记账日期',b.booked_on],['预计到账 / 到期日',b.due_on],['账单原额',money(b.amount_cents)],['平台扣费',money(b.fee_cents)],['退款',money(b.refund_cents)],[b.kind==='income'?'预计净收':'应付款',money(b.net_cents)],['余额口径',b.balance_effect]];
      $('#bill-detail').innerHTML='<dl>'+rows.map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl><p class="notice small">来源为导入账单的引用信息。请另行对照实际凭证；演示数据不代表真实平台费率或结算周期。</p>';
      if(!$('#bill-dialog').open)$('#bill-dialog').showModal(); showBills(); renderReview();
    }
    if(follow) { await api('/api/merchant/follow',{id:follow.dataset.id,delay:delay()}); await loadInsights(); }
  } catch(e) { toast(e.message); }
});
document.addEventListener('change', async event=>{
  const select = event.target.closest('.notice-status');
  if (!select) return;
  try { await api('/api/merchant/notice',{id:select.dataset.id,status:select.value}); await loadInsights(); toast('提醒状态已更新。'); }
  catch (error) { toast(error.message); }
});
$('#close-dialog').onclick=()=>$('#bill-dialog').close();
$('#confirm').onchange=renderReview;
$('#review').onclick=async()=>{ try { await api('/api/merchant/review',{revision:state.revision,confirmed:$('#confirm').checked}); await refresh(); toast('账单口径已确认，提醒已生成。'); }catch(e){toast(e.message);} };
$('#channel').onchange=showBills; $('#bill-status').onchange=showBills; $('#search').oninput=showBills;
$('#delay').onchange=async()=>{
  const before = state?.forecast.delay_days ?? 0;
  $('#delay').disabled=true;
  try { await refresh(); } catch(e) { $('#delay').value=String(state?.forecast.delay_days ?? before); toast('测算或提醒读取失败，请刷新重试：'+e.message); }
  finally { $('#delay').disabled=false; }
};
$('#scenario-run').onclick=runSingleScenario;
$('#export-ledger').onclick=()=>downloadLink('/api/merchant/export?type=ledger');
$('#template').onclick=()=>downloadLink('/api/merchant/export?type=demo');
$('#export-review').onclick=()=>downloadLink('/api/merchant/export?type=review&delay='+delay());
$('#import').onclick=async()=>{ const file=$('#import-file').files[0]; if(!file)return toast('请先选择一份 JSON 账单。'); if(file.size>950000)return toast('演示导入文件请小于 950 KB。'); try { const result=await api('/api/merchant/import',JSON.parse(await file.text())); $('#confirm').checked=false; await refresh(); toast('导入成功，去重 '+result.duplicates+' 笔。请重新核对账单。'); }catch(e){toast('导入未完成：'+e.message);} };
$('#reset').onclick=async()=>{try{await api('/api/merchant/reset',{});$('#confirm').checked=false;await refresh();toast('已恢复虚构演示账单。');}catch(e){toast(e.message);}};
refresh().catch(e=>toast(e.message));
