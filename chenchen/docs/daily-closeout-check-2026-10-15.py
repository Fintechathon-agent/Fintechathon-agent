from pathlib import Path
import json
base=Path(__file__).resolve().parent
e=json.loads((base/'daily-closeout-2026-10-15-evidence.json').read_text(encoding='utf-8'))
items=e['model_retry']['results']+e['decision_integrity']['results']
for item in items:
 w,h=item['workflow'],item['handoff']
 for sn,dn,obj in [('model-review.v1.schema.json','WorkflowRecord',w),('risk-handoff.v1.schema.json','HandoffPackage',h)]:
  schema=json.loads((base.parent/'contracts'/sn).read_text(encoding='utf-8-sig'))
  assert set(schema['$defs'][dn]['required']) <= set(obj)
 for key in ['request_id','task_id','run_id']: assert w[key]==h[key]
 assert w['audit']['audit_id']==h['audit_id']
 assert w['execution']['execution_allowed'] is False and h['execution_allowed'] is False
 assert 'session_id' not in w
print('PASS: 4 scenarios / 8 objects; required keys and trace equality; not full Schema validation')
