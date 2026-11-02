import {groundPlanAmounts,amountCents} from './shared.mjs';
const key=s=>s.normalize('NFKC').replace(/\s+/gu,'').toLowerCase();
// A model-proposed save is not authorization. Verify a positive confirmation and
// bind any repeated date/amount to the already reviewed current version.
export function validateBaselineConfirmation(text,state){
 const s=text.normalize('NFKC').replace(/\s+/gu,'');
 const fail=()=>{throw Object.assign(Error('BASELINE_CONFIRMATION_REQUIRED'),{code:'BASELINE_CONFIRMATION_REQUIRED'});};
 if(!state.review||!state.metadata?.as_of||!state.actual?.length)fail();
 if(!/^(?:请)?(?:确认|保存|保留)/.test(s)||!/(?:基准|记录)/.test(s)||/不要|不确认|暂不|是否|能否|如何|怎么|如果|假设|模拟|取消|[“”「」"]/.test(s))fail();
 const dates=[...s.matchAll(/(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})日?/g)].map(m=>m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0'));
 if(dates.some(date=>date!==state.metadata.as_of))fail();
 if(/\d[\d,.]*(?:元|万|千)/.test(s)){
  const grounded=groundPlanAmounts(text,{operation:'set_holdings',changes:state.actual.map(r=>({...r,amount:'0',unit:'元'}))},state);
  if(grounded.operation==='clarify'||grounded.changes.some(r=>amountCents(r.amount,r.unit)!==state.actual.find(x=>key(x.name)===key(r.name))?.amount_cents))fail();
 }
 return {version:state.version,content_hash:state.review_hash,as_of:state.metadata.as_of};
}
