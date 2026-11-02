import {labels,states,day,money,isLife,cents,emptyBook,mergeRecords,summarize,memories,toCSV} from './journal-model.mjs';
const $=id=>document.getElementById(id), KEY='finance-lab.journal.v1';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let book=emptyBook(), storageBroken=false, busy=false;
const turns=[];
function report(message){$('error').textContent=message;$('error').hidden=!message;}
function read(){
  const raw=localStorage.getItem(KEY);
  if(!raw)return emptyBook();
  const b=JSON.parse(raw);
  if(b.version!==1||!Array.isArray(b.records)||!b.budgets)throw Error('保存格式无法识别');
  return b;
}
try{book=read();}catch{storageBroken=true;report('本地记录暂时无法读取。为避免覆盖，保存已暂停；请先保留浏览器数据。');}
function commit(next){
  if(storageBroken)throw Error('本地记录无法读取，保存已暂停。');
  localStorage.setItem(KEY,JSON.stringify(next)); // storage failure must never look like success
  book=next;render();
}
function amount(row){return row.kind==='coupon'?'待查询':book.hideLife&&isLife(row)?'••••':money(row.amount_cents,row.currency);}
function controls(row){return `<div class="record-actions"><button class="quiet" data-edit="${escape(row.id)}">${row.status==='review'?'核对':'修改'}</button><button class="quiet" data-delete="${escape(row.id)}">删除</button></div>`;}
function recordHTML(row,actions=true){return `<article class="record"><div><small>${escape(row.occurred_on)} · ${escape(labels[row.kind])}</small><h3>${escape(row.title)}</h3><span class="tag ${escape(row.status)}">${escape(states[row.status])}</span>${row.attention==='high'?'<span class="tag">优先关注</span>':''}${row.notes.length?`<p class="fine">${escape(row.notes.join(' '))}</p>`:''}</div><strong class="record-amount">${escape(amount(row))}</strong>${actions?controls(row):''}</article>`;}
function visibleRows(){const month=$('ledger-month').value,filter=$('filter').value;return book.records.filter(r=>(!month||r.occurred_on.startsWith(month))&&(filter==='all'||(filter==='review'?r.status==='review':r.kind===filter))).sort((a,b)=>b.occurred_on.localeCompare(a.occurred_on)||b.recorded_at.localeCompare(a.recorded_at));}
function renderMessages(){
  const host=$('messages');host.querySelectorAll('[data-turn]').forEach(n=>n.remove());
  for(const turn of turns){
    const user=document.createElement('div');user.className='user-message';user.dataset.turn='user';
    user.textContent=book.hideLife?'这段原话已隐藏，关闭“隐藏生活金额”可查看。':turn.text;host.append(user);
    const rows=turn.ids.map(id=>book.records.find(r=>r.id===id)).filter(Boolean);
    const reply=document.createElement('article');reply.className='assistant-message';reply.dataset.turn='assistant';
    const counts=['recorded','plan','request','review'].map(state=>[state,rows.filter(r=>r.status===state).length]).filter(([,n])=>n);
    const response=counts.map(([state,n])=>`${{recorded:'已归档',plan:'待执行计划',request:'待查优惠',review:'待核对'}[state]} ${n} 项`).join('，');
    reply.innerHTML=`<span class="speaker">Finance Lab</span><p>${escape(turn.empathy)}</p><p>${escape(response||'没有新增收支。你可以补充具体事项和实际金额。')}</p>${turn.warnings.map(w=>`<p class="fine">${escape(w)}</p>`).join('')}${rows.length?`<details class="result-details"><summary>查看归档明细 · ${rows.length} 项</summary>${rows.map(r=>recordHTML(r)).join('')}</details>`:''}`;
    if(turn===turns.at(-1)){
      const alert=summarize(book).alerts.find(a=>a.tone==='risk');
      if(alert){const notice=document.createElement('p');notice.className='alert risk';notice.textContent=book.hideLife?'本月预留可能不足。具体金额已隐藏，可以在预算区域查看。':alert.text;reply.append(notice);}
    }
    host.append(reply);
  }
}
function render(){
  $('hide-life').checked=book.hideLife;$('record-count').textContent=book.records.length;
  const s=summarize(book);$('summary-month').textContent=s.month;
  const t=s.totals.CNY||{income:0,expense:0,investment:0,planned:0,proceeds:0};
  $('summary').innerHTML=[['人民币收入',money(t.income)],['生活与订阅',book.hideLife?'••••':money(t.expense)],['投资流出',money(t.investment)],['待执行流出计划',money(t.planned)]].map(([label,value])=>`<div class="summary-item"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`).join('');
  if(t.proceeds)$('summary').innerHTML+=`<div class="summary-item"><span>投资流入</span><strong>${escape(money(t.proceeds))}</strong></div>`;
  for(const [currency,total]of Object.entries(s.totals)){if(currency==='CNY')continue;$('summary').innerHTML+=`<div class="summary-item"><span>${escape(currency)} 收入 / 生活支出</span><strong>${escape(book.hideLife?'••••':money(total.income,currency)+' / '+money(total.expense,currency))}</strong></div>`;}
  $('risk').innerHTML=s.alerts.map(a=>`<p class="alert ${a.tone}">${escape(book.hideLife&&/[¥￥$]/.test(a.text)?'预算金额已隐藏；关闭隐藏后查看具体预留和缺口。':a.text)}</p>`).join('');
  $('budget-form').hidden=book.hideLife;
  $('ledger').innerHTML=visibleRows().map(r=>recordHTML(r)).join('')||'<p class="empty">这里还没有记录。聊聊今天的一笔开销，就可以开始。</p>';
  $('export').disabled=visibleRows().length===0;
  const memo=memories(book);
  $('memory').innerHTML=memo.map(r=>`<article class="memory-row"><div class="section-bar"><strong>${escape(r.title)}</strong><span class="weight">关注 ${r.weight}</span></div><p>${escape(r.occurred_on)} · ${escape(amount(r))} · ${escape(states[r.status])}</p><p class="fine">${r.latest?'最近一条同类记录':'历史记录，仍保留时间依据'} · 用户自述 · ${r.confidence==='user_checked'?'已手动核对':'规则提取，未与账户核验'}</p>${controls(r)}</article>`).join('')||'<p class="empty">暂时没有需要优先关注的事项。投资计划和大额开支会出现在这里。</p>';
  renderMessages();
}
function tab(name,focus=false){for(const button of document.querySelectorAll('[data-tab]')){const active=button.dataset.tab===name;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;$('view-'+button.dataset.tab).hidden=!active;if(active&&focus)button.focus();}}
document.querySelectorAll('[data-tab]').forEach(button=>{
  button.addEventListener('click',()=>tab(button.dataset.tab));
  button.addEventListener('keydown',e=>{const names=['chat','ledger','memory'];let i=names.indexOf(button.dataset.tab);if(!['ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;e.preventDefault();i=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;tab(names[i],true);});
});
$('ledger-month').value=day().slice(0,7);$('ledger-month').addEventListener('change',render);$('filter').addEventListener('change',render);
$('hide-life').addEventListener('change',()=>{try{const next=read();next.hideLife=$('hide-life').checked;commit(next);}catch(e){report(e.message);}});
$('sample-mixed').addEventListener('click',()=>{$('message').value='今天工资到账 12000 元，打算拿工资的 30% 投纳斯达克。订阅 GPT Pro 花了 200 美元，中午猪脚饭实付 18 元。今天真的有点烦，天气也不好。';$('message').focus();$('compose-hint').textContent='示例内容 · 发送后会记入此浏览器';});
$('sample-coupon').addEventListener('click',()=>{$('message').value='今天午饭实付 18 元，帮我找一下美团猪脚饭优惠券。';$('message').focus();$('compose-hint').textContent='示例内容 · 发送后会记入此浏览器';});
$('message').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('composer').requestSubmit();}});
$('composer').addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;const text=$('message').value.trim();if(!text)return;
  busy=true;$('send').disabled=true;$('send').textContent='整理中…';report('');
  try{
    const response=await fetch('/api/journal/parse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:AbortSignal.timeout(15000)});
    const result=await response.json();if(!response.ok||result.version!=='journal.v1')throw Error(result.error||'整理服务暂时不可用，请稍后重试。');
    const next=mergeRecords(read(),result.records);commit(next);
    turns.push({text,empathy:result.empathetic,ids:result.records.map(r=>r.id),warnings:result.unclassified.concat(result.blocked_execution?['自动执行或跳过确认的要求不会被执行。']:[])});
    $('message').value='';$('compose-hint').textContent='Enter 发送 · Shift + Enter 换行';renderMessages();$('messages').scrollTop=$('messages').scrollHeight;
  }catch(e){report(e.name==='TimeoutError'?'整理超时，内容已保留，可以重试。':e.message);}
  finally{busy=false;$('send').disabled=false;$('send').innerHTML='帮我整理 <span aria-hidden="true">↑</span>';$('message').focus();}
});
document.addEventListener('click',e=>{
  const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');
  if(edit){const row=book.records.find(r=>r.id===edit.dataset.edit);if(!row)return;const f=$('edit-form').elements;
    Object.entries({id:row.id,title:row.title,date:row.occurred_on,kind:row.kind,amount:row.amount_cents==null?'':(row.amount_cents/100).toFixed(2),currency:row.currency,status:row.status,direction:row.direction}).forEach(([k,v])=>f.namedItem(k).value=v);
    $('edit-error').textContent='';$('edit-dialog').showModal();
  }
  if(del&&confirm('删除这条记录及其记忆摘要？此浏览器中的删除不可撤回。')){try{const next=read();next.records=next.records.filter(r=>r.id!==del.dataset.delete);commit(next);}catch(err){report(err.message);}}
});
$('close-edit').addEventListener('click',()=>$('edit-dialog').close());
$('edit-form').addEventListener('submit',e=>{
  e.preventDefault();try{
    const form=new FormData(e.target), next=read(),row=next.records.find(r=>r.id===form.get('id'));if(!row)throw Error('这条记录已被删除。');
    const value=form.get('amount').trim(),status=form.get('status'),kind=form.get('kind'),date=form.get('date');
    if(!value&&['recorded','plan'].includes(status))throw Error('请补充金额，或保留为“待核对”。');
    if(kind==='coupon'&&status!=='request')throw Error('优惠需求请保留为“待查优惠”；实际购买需另记一笔生活支出。');
    if(kind!=='coupon'&&status==='request')throw Error('只有优惠需求使用“待查优惠”。');
    if(status==='recorded'&&date>day())throw Error('未来日期请记录为计划。');
    const direction=form.get('direction');
    if((kind==='income'&&direction!=='in')||(isLife({kind})&&direction!=='out'))throw Error('收入应为流入，生活与订阅应为流出。');
    Object.assign(row,{title:form.get('title').trim(),occurred_on:date,kind,status,currency:form.get('currency'),amount_cents:value?cents(value):null,direction,confidence:'user_checked',updated_at:new Date().toISOString(),ratio:null,ratio_base:null,notes:['已由你手动核对；仅更新自述账本。']});
    row.attention=kind==='investment'||(row.amount_cents||0)>=(row.currency==='CNY'?100000:20000)?'high':'normal';
    row.category=labels[kind];commit(next);$('edit-dialog').close();
  }catch(err){$('edit-error').textContent=err.message;}
});
$('budget-form').addEventListener('submit',e=>{
  e.preventDefault();try{const form=new FormData(e.target),next=read();next.budgets[day().slice(0,7)]={opening:cents(form.get('opening')),essentials:cents(form.get('essentials')),buffer:cents(form.get('buffer'))};commit(next);$('budget-feedback').textContent='已更新本月预留。';}catch(err){$('budget-feedback').textContent=err.message;}
});
$('export').addEventListener('click',()=>{
  const rows=visibleRows().filter(r=>!book.hideLife||!isLife(r));
  const blob=new Blob([toCSV(rows)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`随手记-${$('ledger-month').value||'全部'}${book.hideLife?'-不含生活明细':''}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
addEventListener('storage',e=>{if(e.key===KEY){try{book=read();render();}catch{storageBroken=true;report('另一个页面的记录更新无法读取，保存已暂停。');}}});
const currentBudget=book.budgets[day().slice(0,7)];if(currentBudget)for(const [key,value]of Object.entries(currentBudget))$('budget-form').elements.namedItem(key).value=(value/100).toFixed(2);
render();
