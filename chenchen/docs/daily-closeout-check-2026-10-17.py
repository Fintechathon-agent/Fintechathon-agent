from pathlib import Path
import json, hashlib, datetime
base = Path(__file__).resolve().parent
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
e = read(base / 'core-agent-public-evidence-2026-10-17.json')
w = e['final_record']
schema = read(base.parent / 'contracts/model-review.v1.schema.json')
checks = []
def check(name, condition):
    checks.append({'name': name, 'passed': bool(condition)})
check('ReviewRequest required keys', set(schema['$defs']['ReviewRequest']['required']) <= set(e['synthetic_request']))
check('WorkflowRecord required keys', set(schema['$defs']['WorkflowRecord']['required']) <= set(w))
check('workflow and schema versions', w['workflow_version']=='review-workflow.v1' and w['schema_version']=='model-review.v1')
check('nonempty session identifier', bool(w['session_id']))
for k in ['request_id', 'task_id', 'run_id']:
    check('audit matches '+k, w['audit'][k]==w[k])
for i, event in enumerate(w['audit']['events']):
    p = event['payload']['trace']
    check('event '+str(i+1)+' six identifiers match', all(p[k]==w[k] for k in ['request_id','task_id','session_id','run_id']) and p['audit_id']==w['audit']['audit_id'] and p['handoff_id']==w['risk_handoff']['handoff_id'] and event['task_id']==w['task_id'])
check('handoff task and run binding', all(w['risk_handoff'][k]==w[k] for k in ['task_id','run_id']))
check('handoff audit binding', w['risk_handoff']['evidence']['audit_id']==w['audit']['audit_id'])
check('proposal hash binding', w['proposed_action']['proposal_sha256']==w['risk_handoff']['evidence']['proposal_sha256']==w['approval']['proposal_sha256'])
check('Risk remains pending', w['status']=='PENDING_RISK' and w['risk_decision'] is None)
check('execution denied at both boundaries', w['execution']['execution_allowed'] is False and w['risk_handoff']['execution_allowed'] is False)
check('dispatch failure retained', w['risk_dispatch']['status']=='FAILED' and w['risk_dispatch']['error_code']=='RISK_OWNER_NOT_CONFIGURED')
check('public retained checks', len(e['checks'])==8 and all(c['passed'] for c in e['checks']))
result = {'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'scope':'Offline retained synthetic evidence required-key and cross-object trace checks; NOT full JSON Schema validation, NOT a new public request or Risk joint acceptance', 'source_sha256':hashlib.sha256((base/'core-agent-public-evidence-2026-10-17.json').read_bytes()).hexdigest(), 'checks':checks,'passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks),'audit_event_count':len(w['audit']['events']), 'schema_optional_session': 'session_id' not in schema['$defs']['WorkflowRecord']['required'], 'unmapped_health_fields':[k for k in ['task_state','artifacts','tool_results','audit_evidence'] if k not in schema['$defs']['WorkflowRecord']['properties']]}
(base/'daily-closeout-2026-10-17-trace.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result, ensure_ascii=False, indent=2))
assert result['failed']==0
