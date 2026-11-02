export const labels = {income:'收入', expense:'生活', subscription:'订阅', investment:'投资', coupon:'优惠', note:'待整理'};
export const states = {recorded:'已记录 · 自述', plan:'计划 · 未执行', review:'待核对', request:'待查优惠'};
export const day = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const money = (cents, currency='CNY') => cents == null ? '待补充' : new Intl.NumberFormat('zh-CN',{style:'currency',currency}).format(cents/100);
export const isLife = r => ['expense','subscription'].includes(r.kind);
export const cents = text => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(text).trim())) throw Error('金额须为非负数，最多两位小数。');
  const [whole,fraction=''] = String(text).trim().split('.');
  const value = Number(whole)*100 + Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(value) || value > 100000000000) throw Error('金额超出支持范围。');
  return value;
};
export function emptyBook() { return {version:1, records:[], budgets:{}, hideLife:false}; }
export function mergeRecords(book, incoming) {
  const next = structuredClone(book);
  for (const original of incoming) {
    const row = structuredClone(original);
    const same = next.records.some(r => r.kind===row.kind && r.title===row.title && r.occurred_on===row.occurred_on && r.amount_cents===row.amount_cents && r.currency===row.currency && r.status!=='review');
    if(same && !['coupon','note'].includes(row.kind)) {
      row.status='review'; row.confidence='needs_review';
      row.notes.push('发现同日、同类、同金额记录；可能是重复描述，核对后再计入。');
    }
    next.records.push(row);
  }
  return next;
}
export function summarize(book, month=day().slice(0,7)) {
  const rows=book.records.filter(r=>r.occurred_on.startsWith(month));
  const totals={};
  for(const row of rows) {
    if(row.amount_cents==null || !['recorded','plan'].includes(row.status)) continue;
    const t=totals[row.currency] ||= {income:0,expense:0,investment:0,proceeds:0,planned:0};
    if(row.status==='plan') { if(row.direction==='out') t.planned+=row.amount_cents; continue; }
    if(row.kind==='income') t.income+=row.amount_cents;
    if(isLife(row)) t.expense+=row.amount_cents;
    if(row.kind==='investment') t[row.direction==='in'?'proceeds':'investment']+=row.amount_cents;
  }
  const cny=totals.CNY || {income:0,expense:0,investment:0,proceeds:0,planned:0};
  const budget=book.budgets[month];
  const net=cny.income+cny.proceeds-cny.expense-cny.investment;
  const available=budget ? budget.opening+net-budget.essentials-budget.buffer-cny.planned : null;
  const alerts=[];
  if(!budget) alerts.push({tone:'info',text:'补充月初现金、剩余必要开支和应急预留后，才能估算计划是否挤占生活费。'});
  if(available!=null) alerts.push({tone:available<0?'risk':'info',text:available<0 ? `按已记录人民币收支，计划后预留缺口 ${money(-available)}。可以先减少可选开支，或暂缓新增投资。` : `按已记录人民币收支，扣除计划与预留后剩余 ${money(available)}。漏记支出会让这个估算偏高。`});
  if(Object.keys(totals).some(k=>k!=='CNY')) alerts.push({tone:'warn',text:'外币收支单列，尚未折算进人民币预算。核对实际人民币扣款后，再判断生活费是否足够。'});
  if(rows.some(r=>r.status==='review')) alerts.push({tone:'warn',text:'待核对事项暂未计入收支；补齐信息后，预算结果可能改变。'});
  if(rows.some(r=>r.kind==='investment' && r.status==='plan')) alerts.push({tone:'info',text:'投资计划尚未执行，也未改变真实持仓。交易需进入原有风险审核与确认流程。'});
  return {month, rows, totals, net, available, alerts};
}
export function memories(book, today=day()) {
  // Temporal ranking is for attention, never a permission or truth score.
  const eligible=book.records.filter(r=>r.status!=='review' && (r.kind==='investment' || r.attention==='high'));
  return eligible.map(r=>{
    const days=Math.max(0,(Date.parse(today)-Date.parse(r.occurred_on))/86400000);
    const recent=30*Math.exp(-days/30);
    const important=r.attention==='high'?60:20;
    const latest=eligible.filter(x=>x.kind===r.kind && x.title===r.title).sort((a,b)=>b.occurred_on.localeCompare(a.occurred_on)||b.recorded_at.localeCompare(a.recorded_at))[0];
    return {...r, weight:Math.round(important+recent), latest:latest.id===r.id};
  }).sort((a,b)=>b.weight-a.weight||b.occurred_on.localeCompare(a.occurred_on));
}
export function toCSV(rows) {
  const cell = v => { let s=String(v??''); if (/^[\s]*[=+\-@]/.test(s)) s="'"+s; return '"'+s.replaceAll('"','""')+'"'; };
  const grid=[['发生日期','归档时间','分类','事项','金额','币种','状态','方向','来源','说明'],...rows.map(r=>[r.occurred_on,r.recorded_at,labels[r.kind],r.title,r.amount_cents==null?'':(r.amount_cents/100).toFixed(2),r.currency,states[r.status],r.direction==='in'?'流入':'流出','用户自述，未对账',r.notes.join('；')])];
  return '\uFEFF'+grid.map(row=>row.map(cell).join(',')).join('\r\n');
}
