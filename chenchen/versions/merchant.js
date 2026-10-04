import { $, esc, money, pct, api, toast, downloadLink, chart } from './common.js';
let state, reminders, refreshSequence = 0;
const key = b => b.channel + ':' + b.id;
const delay = () => Number($('#delay').value);
const sourceButtons = refs => refs.map(r => '<button class="subtle evidence" data-key="'+esc(r)+'">'+esc(r)+'</button>').join(' · ');
function showBills() {
  if (!state) return;
  const query = $('#search').value.trim().toLowerCase();
  const bills = state.ledger.bills.filter(b => (!$('#channel').value || b.channel === $('#channel').value) &&
    (!$('#bill-status').value || b.status === $('#bill-status').value) &&
    (!query || [b.id,b.category,b.description].join(' ').toLowerCase().includes(query)));
  $('#bill-count').textContent = '显示 '+bills.length+' / '+state.ledger.bills.length+' 笔 · 已查看来源 '+state.viewed.length+' 笔';
  $('#bills').innerHTML = bills.length ? '<table><thead><tr><th>账单 / 渠道</th><th>类别</th><th class="num">账单原额</th><th class="num">扣费 / 退款</th><th class="num">净收 / 付款</th><th>预计日期 / 状态</th><th>来源</th></tr></thead><tbody>'+bills.map(b=>'<tr><td>'+esc(b.id)+'<small>'+esc(b.channel)+'</small></td><td>'+esc(b.category)+'<small>'+esc(b.booked_on)+' 记账</small></td><td class="num">'+money(b.amount_cents)+'</td><td class="num">'+money(b.fee_cents+b.refund_cents)+'</td><td class="num">'+(b.kind==='income'?'+':'−')+money(b.amount_cents-b.fee_cents-b.refund_cents)+'</td><td>'+esc(b.due_on)+'<small>'+ (b.status==='settled'?'已结算':b.kind==='income'?'待到账':'待付款')+'</small></td><td><button class="subtle evidence" data-key="'+esc(key(b))+'">看账单'+(state.viewed.includes(key(b))?' ✓':'')+'</button></td></tr>').join('')+'</tbody></table>' : '<p class="empty">没有符合条件的账单。尝试清空筛选条件。</p>';
}
function render() {
  const l = state.ledger;
  $('#shop-date').textContent = l.shop + ' · 截至 ' + l.as_of;
  $('#totals').innerHTML = [['已核对余额',state.totals.balance_cents,'当前已经拿到的钱'],['还在路上的钱',state.totals.receivable_cents,'包含逾期未确认款，不是可用余额'],['已知待付款',state.totals.payable_cents,'全部未结算支出，按账单日期核对']].map(([t,v,d])=>'<article class="metric"><small>'+t+'</small><strong>'+money(v)+'</strong><small>'+d+'</small></article>').join('');
  const channel = $('#channel').value;
  $('#channel').innerHTML = '<option value="">全部渠道</option>'+[...new Set(l.bills.map(b=>b.channel))].map(c=>'<option>'+esc(c)+'</option>').join('');
  if ([...$('#channel').options].some(o=>o.value===channel)) $('#channel').value=channel;
  showBills(); renderReview();
  const f = state.forecast;
  $('#cash-chart').innerHTML = chart([{name:'预计余额（元）',values:[l.balance_cents,...f.days.map(d=>d.expected_cents)].map(v=>v/100)},{name:'暂未到账时余额（元）',values:[l.balance_cents,...f.days.map(d=>d.conservative_cents)].map(v=>v/100)}],[l.as_of,...f.days.map(d=>d.date)]);
  $('#calendar').innerHTML = '<table><thead><tr><th>日期</th><th class="num">预计到账</th><th class="num">到期付款</th><th class="num">预计余额</th><th>相关账单</th></tr></thead><tbody>'+f.days.map(d=>'<tr><td>'+d.date+'</td><td class="num">'+money(d.incoming_cents)+'</td><td class="num">'+money(d.outgoing_cents)+'</td><td class="num '+(d.expected_cents<0?'danger':'')+'">'+money(d.expected_cents)+'</td><td>'+sourceButtons(d.evidence)+'</td></tr>').join('')+'</tbody></table>';
  $('#cost-period').textContent = state.costs.length ? '本期 '+state.costs[0].current_window.join(' 至 ')+'；对比 '+state.costs[0].previous_window.join(' 至 ')+'（均为 7 天）。' : '没有可比较的采购记录。';
  $('#costs').innerHTML = state.costs.map(c=>'<div class="cost-line"><div class="row"><strong>'+esc(c.category)+'</strong><span>'+money(c.current_cents)+' <small>'+ (c.change_ratio===null?'上期无记录':(c.change_ratio>=0?'+':'')+pct(c.change_ratio))+'</small></span></div><p class="small">上期 '+money(c.previous_cents)+' → 本期 '+money(c.current_cents)+(c.decomposition ? '<br>同品单价 '+money(c.decomposition.previous_unit_cents)+' → '+money(c.decomposition.current_unit_cents)+' / '+esc(c.decomposition.unit)+'<br>数量变化影响 '+money(c.decomposition.quantity_effect_cents)+'；单价变化影响 '+money(c.decomposition.price_effect_cents) : '<br>缺少可比数量或上期记录，暂不判断涨价原因。')+'</p><div class="small">'+sourceButtons(c.evidence)+'</div></div>').join('') || '<p class="empty">暂无采购支出。</p>';
}
function renderReview() {
  $('#review-status').textContent = state.reviewed ? '本版账单已确认；导入新账单后需要重新核对。' : '已查看 '+state.viewed.length+' 笔来源。请核对当前余额与未结算款的区别。';
  $('#review').disabled = state.reviewed || !state.viewed.length || !$('#confirm').checked;
  $('#confirm').disabled = state.reviewed;
  $('#export-review').disabled = !state.reviewed;
}
async function loadInsights() {
  if (!state.reviewed) { reminders=null; $('#insights').className='empty'; $('#insights').textContent='提醒尚未生成。先打开账单，再确认你已看懂金额口径。'; $('#digest').textContent=''; return; }
  const requestedDelay = delay(), revision = state.revision;
  const next = await api('/api/merchant/insights?delay='+requestedDelay);
  if (!state.reviewed || state.revision !== revision || next.revision !== revision || delay() !== requestedDelay) return;
  reminders = next;
  $('#insights').className='';
  const sorted = [...reminders.notices].sort((a,b)=>Number(b.following)-Number(a.following));
  $('#insights').innerHTML = sorted.map(n=>'<article class="insight"><div class="row"><h3>'+esc(n.title)+'</h3><button class="secondary follow" data-id="'+esc(n.id)+'">'+(n.following?'已关注 ✓':'下次关注')+'</button></div><p><strong>'+money(n.amount_cents)+'</strong> · '+esc(n.explanation)+'</p><details><summary>核对相关账单</summary><div class="small">'+sourceButtons(n.evidence)+'</div></details></article>').join('') || '<p>已知账单未触发当前规则的提醒。未知支出和未来销售仍需你补充。</p>';
  $('#digest').textContent=reminders.digest;
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
      $('#bill-dialog').showModal(); showBills(); renderReview();
    }
    if(follow) { await api('/api/merchant/follow',{id:follow.dataset.id,delay:delay()}); await loadInsights(); }
  } catch(e) { toast(e.message); }
});
$('#close-dialog').onclick=()=>$('#bill-dialog').close();
$('#confirm').onchange=renderReview;
$('#review').onclick=async()=>{ try { await api('/api/merchant/review',{revision:state.revision,confirmed:$('#confirm').checked}); await refresh(); toast('账单口径已确认，提醒已生成。'); }catch(e){toast(e.message);} };
$('#channel').onchange=showBills; $('#bill-status').onchange=showBills; $('#search').oninput=showBills;
$('#delay').onchange=()=>refresh().catch(e=>toast(e.message));
$('#export-ledger').onclick=()=>downloadLink('/api/merchant/export?type=ledger');
$('#template').onclick=()=>downloadLink('/api/merchant/export?type=demo');
$('#export-review').onclick=()=>downloadLink('/api/merchant/export?type=review&delay='+delay());
$('#import').onclick=async()=>{ const file=$('#import-file').files[0]; if(!file)return toast('请先选择一份 JSON 账单。'); if(file.size>950000)return toast('演示导入文件请小于 950 KB。'); try { const result=await api('/api/merchant/import',JSON.parse(await file.text())); $('#confirm').checked=false; await refresh(); toast('导入成功，去重 '+result.duplicates+' 笔。请重新核对账单。'); }catch(e){toast('导入未完成：'+e.message);} };
$('#reset').onclick=async()=>{try{await api('/api/merchant/reset',{});$('#confirm').checked=false;await refresh();toast('已恢复虚构演示账单。');}catch(e){toast(e.message);}};
refresh().catch(e=>toast(e.message));
