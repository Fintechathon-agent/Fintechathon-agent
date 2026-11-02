'use strict';
const {createHash}=require('node:crypto');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const SAMPLE='我有 10 万元人民币，其中现金 2 万、股票 A 6 万、基金 B 2 万，想看看是不是太集中。';
const numberWords={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
function amount(n,unit=''){const value=Number(n.replaceAll(',',''))*(unit==='万'?10000:unit==='千'?1000:1);if(!Number.isFinite(value)||value<0||value>1e9||Math.abs(value*100-Math.round(value*100))>1e-5)throw Error('金额必须是0至10亿元以内、最多两位小数的数字');return Math.round(value*100);}
function validateRows(rows){if(!Array.isArray(rows)||rows.length>100)throw Error('最多支持100项持仓');return rows.map((p,i)=>{if(!p||typeof p.name!=='string'||!p.name.trim()||p.name.length>80||!Number.isSafeInteger(p.amount_cents)||p.amount_cents<0||p.amount_cents>1e11)throw Error('第'+(i+1)+'项名称或金额无效');return {name:p.name.trim(),amount_cents:p.amount_cents,kind:p.kind==='cash'?'cash':'unresolved',instrument_id:null};});}
function parseCsv(text){
 // Reused tokenizer from holdings-intake/site/app.js; unmatched quotes now fail explicitly.
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i],next=text[i+1];if(c==='"'&&quoted&&next==='"'){cell+='"';i++;continue;}if(c==='"'){quoted=!quoted;continue;}if(c===','&&!quoted){row.push(cell.trim());cell='';continue;}if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&next==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';continue;}cell+=c;}
 if(quoted)throw Error('CSV引号未闭合');row.push(cell.trim());if(row.some(Boolean))rows.push(row);return rows;
}
function importCsv(text){
 const lines=parseCsv(text),header='snapshot_date,cash,instrument_id,name,asset_type,quantity,current_price,cost_basis',issues=[],rows=[],seen=new Set();
 if(lines.shift()?.join(',')!==header)throw Error('CSV字段需为：'+header);
 let cash=null,date=null;
 for(const [i,v]of lines.entries())try{
  if(v.length!==8||!/^\d{4}-\d{2}-\d{2}$/.test(v[0])||(!Number.isFinite(Date.parse(v[0]))||new Date(v[0]).toISOString().slice(0,10)!==v[0])||!v[2]||!v[3]||!v[4]||[v[1],v[5],v[6]].some(x=>x===''||!Number.isFinite(Number(x))||Number(x)<0))throw Error('日期、名称、数量或价格缺失/无效');
  if(seen.has(v[2]))throw Error('证券代码重复');
  const c=amount(v[1]);if(cash!==null&&(cash!==c||date!==v[0]))throw Error('现金或日期与前面的有效行不一致');
  const cents=Math.round(Number(v[5])*Number(v[6])*100);if(!Number.isSafeInteger(cents)||cents<0||cents>1e11)throw Error('持仓金额超出范围');
  cash=c;date=v[0];seen.add(v[2]);rows.push({name:v[3],amount_cents:cents,kind:'unresolved',instrument_id:null});
 }catch(e){issues.push('第'+(i+2)+'行：'+e.message);}
 if(cash!==null)rows.unshift({name:'现金',amount_cents:cash,kind:'cash',instrument_id:null});
 if(!rows.length)issues.push('尚无可用持仓行，请修正文件或直接输入金额。');
 return {rows,issues,as_of:date,currency:'CNY',declared_total_cents:null,source:'CSV_USER_PROVIDED',cash_known:cash!==null};
}
function intake({text='',previous=null,rows,csv,example=false}){
 if(typeof text!=='string'||text.length>4000)throw Error('输入文字不能超过4000字');
 if(example)text=SAMPLE;
 let parsed=previous?structuredClone(previous):{rows:[],currency:'CNY',declared_total_cents:null,source:'USER_PROVIDED',as_of:null,cash_known:false};parsed.issues=previous?[...previous.issues]:[];
 if(rows!==undefined&&previous?.source==='FIXED_EXAMPLE')parsed.source='EDITED_EXAMPLE';
 if(csv!==undefined){if(typeof csv!=='string'||csv.length>100000)throw Error('CSV文件过大');parsed=importCsv(csv);}
 else if(rows!==undefined){parsed.issues=[];delete parsed.block_calculation;parsed.rows=validateRows(rows);parsed.cash_known=parsed.rows.some(x=>x.kind==='cash');parsed.declared_total_cents=null;}
 else if(/美元|美金|港币|港元|欧元|USD|HKD|EUR|\$|€/.test(text)){parsed.issues.push('当前仅支持人民币金额；请先明确各项人民币金额，系统不会猜测汇率。');parsed.block_calculation=true;}
 else {
  const inheritedIssues=parsed.issues;parsed.issues=[];
  const found=[];const pattern=/(现金|股票\s*[A-Za-z\u4e00-\u9fff]{0,12}?|基金\s*[A-Za-z\u4e00-\u9fff]{0,12}?|存款|债券\s*[A-Za-z\u4e00-\u9fff]{0,12}?)\s*(?:为|有|是|改为|改成|调整为|[:：])?\s*(-?[\d,]+(?:\.\d+)?)\s*(万|千)?\s*(?:元|人民币)?/g;
  for(const m of text.matchAll(pattern))try{found.push({name:m[1].trim().replace(/\s+/g,' '),kind:/^(现金|存款)$/.test(m[1])?'cash':'unresolved',amount_cents:amount(m[2],m[3]),instrument_id:null});}catch(e){parsed.issues.push(m[1]+'：'+e.message);}
  for(const segment of text.split(/[，、；;\n]/)){
   if(/(?:[\d一二两三四五六七八九十])\s*(?:万|千|元)/.test(segment)&&!/(我有|总共|总额|总金额|合计|后|需要|要用)/.test(segment)&&!found.some(p=>segment.replaceAll(' ','').includes(p.name.replaceAll(' ',''))))parsed.issues.push('未识别这部分金额：'+segment.trim().slice(0,80)+'。请改写为“股票A6万”等格式，或用CSV导入；有效明细已保留。');
  }
  if(!found.length)parsed.issues=[...new Set([...inheritedIssues,...parsed.issues])];
  if(found.length){delete parsed.block_calculation;if(previous&&/改为|改成|调整为/.test(text)){for(const p of found){const i=parsed.rows.findIndex(x=>x.name.replaceAll(' ','')===p.name.replaceAll(' ',''));if(i<0)parsed.rows.push(p);else parsed.rows[i]=p;}parsed.declared_total_cents=null;}else {parsed.rows=found;parsed.declared_total_cents=null;parsed.source=example?'FIXED_EXAMPLE':'USER_PROVIDED';parsed.as_of=null;}parsed.cash_known=parsed.rows.some(x=>x.kind==='cash');}
  const total=/(?:我有|总共|总额|总金额|合计)\s*([\d,]+(?:\.\d+)?)\s*(万|千)?\s*元?/.exec(text);if(total)try{parsed.declared_total_cents=amount(total[1],total[2]);}catch(e){parsed.issues.push(e.message);}
 }
 const need=/(\d+|[一二两三四五六七八九十])\s*个?月后[\s\S]{0,20}?(?:需要|要用|用)[^\d]{0,8}([\d,]+(?:\.\d+)?)\s*(万|千)?/.exec(text);
 if(previous&&rows===undefined&&csv===undefined&&!need&&/后.*(?:需要|用钱|用款|要用)/.test(text))parsed.issues.push('这次用款时间或金额尚未识别。请用“3个月后需要3万元”这样的写法补充；此前条件保留，不当作本次已更新。');
 if(/现金.*(?:不能|不可|无法)随时/.test(text))parsed.cash_available=false;
 else if(/现金.*(?:可以|可|能)随时/.test(text))parsed.cash_available=true;
 if(need)try{parsed.cash_need={months:numberWords[need[1]]||Number(need[1]),amount_cents:amount(need[2],need[3])};}catch(e){parsed.issues.push(e.message);}
 const names=parsed.rows.map(x=>x.name.replaceAll(' ',''));if(new Set(names).size!==names.length){parsed.issues.push('有同名持仓，请合并或修改名称后再计算。');parsed.block_calculation=true;}
 parsed.source=example?'FIXED_EXAMPLE':parsed.source;
 parsed.focus=/集中/.test(text)?'concentration':parsed.focus||'allocation';
 parsed.intent=/什么是|解释|什么意思/.test(text)&&/集中度|这一项|这个发现/.test(text)?'EXPLAIN':/比较|另一个方案/.test(text)?'COMPARE':'HEALTH_CHECK';
 if(parsed.rows.length>100)throw Error('最多支持100项持仓');
 if(!parsed.rows.length&&parsed.intent!=='EXPLAIN')parsed.issues.push('请提供持仓名称和金额，例如“现金2万、股票A6万、基金B2万”。');
 return parsed;
}
function calculate(input){
 const total=input.rows.reduce((s,x)=>s+x.amount_cents,0),cash=input.rows.filter(x=>x.kind==='cash').reduce((s,x)=>s+x.amount_cents,0);
 const warnings=[...input.issues];if(input.declared_total_cents!==null&&input.declared_total_cents!==total)warnings.push('明细合计与声明总额不一致，占比仅按有效明细计算，请修改缺失或错误金额。');
 const output={currency:'CNY',total_cents:total,cash_cents:cash,cash_known:input.cash_known,rows:input.rows.map(p=>({...p,weight_pct:total&&!input.block_calculation?Math.round(p.amount_cents/total*10000)/100:null})),cash_need:input.cash_need||null,cash_available:input.cash_available??null,cash_gap_cents:input.cash_need&&input.cash_known?Math.max(0,input.cash_need.amount_cents-cash):null,calculation_available:total>0&&!input.block_calculation,warnings,unavailable_metrics:['行业集中度','相关性','收益','波动率','历史回撤'],source:input.source,data_as_of:input.as_of||'用户本次输入，估值日期未提供'};
 return {tool_name:'holdings.amount_allocation',version:'1.0.0',inputs_hash:hash(input),trace_id:'amount-'+hash(input).slice(0,20),calculated_at:new Date().toISOString(),formula:'weight_pct = holding_amount_cents / sum(valid_amount_cents) * 100; cash_gap = max(0, need - stated_cash)',output};
}
module.exports={SAMPLE,intake,calculate,parseCsv,importCsv,validateRows};
