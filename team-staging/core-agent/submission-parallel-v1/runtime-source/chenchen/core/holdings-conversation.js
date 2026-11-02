'use strict';
const tools=require('../tools/holdings-readonly');
// Amount-only conversation deliberately does not enter historical-price simulation.
function handle(body){
 if(!body||!['intake','calculate'].includes(body.operation)||!body.task_id||!body.session_id)throw Error('INVALID_HOLDINGS_REQUEST');
 const result=body.operation==='intake'?{input:tools.intake(body.input)}:{tool:tools.calculate(body.input)};
 return {contract_version:'holdings-conversation.v1',task_id:body.task_id,session_id:body.session_id,input_version:body.input_version,...result,execution_allowed:false};
}
module.exports={handle};
