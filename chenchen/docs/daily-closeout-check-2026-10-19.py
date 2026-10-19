"""Read-only offline contract and trace verification. Run from chenchen.

Requires Node >=22 and Python jsonschema==4.26.0; never calls a model or Risk.
"""
from pathlib import Path
import copy
import datetime
import hashlib
import json
import os
import subprocess
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

BASE = Path(__file__).resolve().parent
ROOT = BASE.parent
SOURCE = BASE / 'core-agent-public-evidence-2026-10-17.json'
NODE = os.environ.get('CORE_AGENT_NODE', 'node')
script = r'''
const path = require('node:path');
const base = process.cwd();
const { Harness } = require(path.join(base, 'core/harness'));
const tools = require(path.join(base, 'tools/financial-tools'));
const c = require(path.join(base, 'contracts/investment-contract'));
const { buildRiskHandoffPackage } = require(path.join(base, 'integrations/risk-handoff'));
const fs = require('node:fs');
const retained = JSON.parse(fs.readFileSync(path.join(base, 'docs/core-agent-public-evidence-2026-10-17.json')));
const request = c.createRequest({requestId:'req-daily-20261019-health',
  riskProfile:{investment_horizon_days:365,max_drawdown:0.1,liquidity_need:'medium'}, portfolio:tools.getDemoPortfolio()});
const harness = new Harness();
const response = harness.runHealthCheckContract(request);
const resumedRequest = structuredClone(request);
resumedRequest.request_id = 'req-daily-20261019-reuse';
resumedRequest.context.task_id = response.trace.task_id;
resumedRequest.context.session_id = response.trace.session_id;
const reused = harness.runHealthCheckContract(resumedRequest);
const broken = structuredClone(response);
broken.task_state.checkpoint.result_refs.DIAGNOSE = 'missing-result';
let semanticRejected = false;
try {c.assertHealthCheckResponseSemantics(broken);} catch(e) {semanticRejected = e.code==='INVALID_CONTRACT';}
const failingHarness = new Harness({toolset:{...tools,diagnosePortfolio:()=>{throw new Error('synthetic timeout');}}});
let failure;
try {failingHarness.runHealthCheckContract({...request,request_id:'req-daily-20261019-failure'});} catch(e) {failure=c.buildErrorResponse(e);}
process.stdout.write(JSON.stringify({request,response,reused_request:resumedRequest,reused,failure,broken,
  semantic_rejected:semanticRejected,handoff:buildRiskHandoffPackage(retained.final_record)}));
'''
generated = json.loads(subprocess.check_output([NODE, '-e', script], cwd=ROOT, text=True, encoding='utf-8'))
retained = json.loads(SOURCE.read_text(encoding='utf-8-sig'))
schemas = {}
registry = Registry()
for path in sorted((ROOT / 'contracts').glob('*.schema.json')):
    schema = json.loads(path.read_text(encoding='utf-8-sig'))
    Draft202012Validator.check_schema(schema)
    schemas[path.name] = schema
    registry = registry.with_resource(schema['$id'], Resource.from_contents(schema))

checks = []
def check(name, ok, **detail):
    checks.append({'name':name,'passed':bool(ok),**detail})

def errors(filename, definition, obj):
    schema = schemas[filename]
    target = {'$schema':schema['$schema'], '$ref':schema['$id'] + ('#/$defs/'+definition if definition else '')}
    validator = Draft202012Validator(target, registry=registry, format_checker=FormatChecker())
    return [{'path':'/'.join(map(str,e.absolute_path)), 'message':e.message} for e in validator.iter_errors(obj)]

cases = [
    ('new health request','investment-agent.v1.schema.json','HealthCheckRequest',generated['request']),
    ('new health response','investment-agent.v1.schema.json','HealthCheckResponse',generated['response']),
    ('new reused health response','investment-agent.v1.schema.json','HealthCheckResponse',generated['reused']),
    ('new failure shared envelope','core-agent-error.v1.schema.json',None,generated['failure']),
    ('retained model request','model-review.v1.schema.json','ReviewRequest',retained['synthetic_request']),
    ('retained workflow record','model-review.v1.schema.json','WorkflowRecord',retained['final_record']),
    ('exported retained Risk handoff','risk-handoff.v1.schema.json','HandoffPackage',generated['handoff']),
]
for name, filename, definition, obj in cases:
    found = errors(filename,definition,obj)
    check('full schema '+name, not found, errors=found)

r = generated['response']; reuse = generated['reused']; f = generated['failure']; w = retained['final_record']; h = generated['handoff']
check('health request/version trace', r['request_id']==generated['request']['request_id']==r['trace']['request_id'] and r['contract_version']==r['trace']['contract_version'])
for key in ['task_id','session_id']:
    check('health '+key+' binding', r['trace'][key]==r['task_state'][key]==r['audit_evidence'][key])
check('health audit handoff binding', r['risk_handoff']['evidence']['audit_id']==r['audit_evidence']['audit_id'])
check('health checkpoint result references', all(ref in r['tool_results'] for ref in r['task_state']['checkpoint']['result_refs'].values()))
check('health all four stages completed', len(r['task_state']['checkpoint']['completed'])==4)
check('reuse task/session/checkpoint', reuse['trace']['task_id']==r['trace']['task_id'] and reuse['trace']['session_id']==r['trace']['session_id'] and reuse['task_state']['checkpoint']==r['task_state']['checkpoint'])
check('reuse latest request binding', reuse['request_id']==reuse['trace']['request_id']==reuse['audit_evidence']['request_id']==generated['reused_request']['request_id'])
check('failure task/session/audit assigned', all(f['trace'][k] for k in ['task_id','session_id','audit_id']))
check('failure request remains bound', f['request_id']==f['trace']['request_id']=='req-daily-20261019-failure')
check('health and model execution remain blocked', r['risk_handoff']['execution_allowed'] is False and h['execution_allowed'] is False and w['execution']['execution_allowed'] is False)
for key in ['request_id','task_id','session_id','run_id','audit_id','handoff_id']:
    expected = w['audit']['audit_id'] if key=='audit_id' else w['risk_handoff']['handoff_id'] if key=='handoff_id' else w[key]
    check('model handoff six-ID '+key, h[key]==h['trace'][key]==expected)
check('model every retained audit trace', all(all(e['payload']['trace'][k]==h[k] for k in ['request_id','task_id','session_id','run_id','audit_id','handoff_id']) for e in w['audit']['events']))
check('model proposal hash binding', w['proposed_action']['proposal_sha256']==w['approval']['proposal_sha256']==h['evidence']['proposal_sha256'])
check('retained Risk still waiting after dispatch failure', w['status']=='PENDING_RISK' and w['risk_decision'] is None and w['risk_dispatch']['error_code']=='RISK_OWNER_NOT_CONFIGURED')
invalid = copy.deepcopy(generated['request']); del invalid['request_id']
check('schema rejects missing required request ID', bool(errors('investment-agent.v1.schema.json','HealthCheckRequest',invalid)))
invalid = copy.deepcopy(h); invalid['execution_allowed']=True
check('schema rejects execution authorization', bool(errors('risk-handoff.v1.schema.json','HandoffPackage',invalid)))
check('broken checkpoint is structurally valid', not errors('investment-agent.v1.schema.json','HealthCheckResponse',generated['broken']))
check('semantic validator rejects broken checkpoint', generated['semantic_rejected'])
optional_session = copy.deepcopy(w); optional_session.pop('session_id',None)
check('documented limitation session remains schema optional', not errors('model-review.v1.schema.json','WorkflowRecord',optional_session))

report = {'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'scope':'New offline synthetic health success/reuse/failure plus October 17 retained synthetic model evidence. Full Draft 2020-12 structural validation with local references and separate semantic trace checks. No public request, model call, Risk dispatch, actual trade or independent Owner acceptance.',
 'validator':'jsonschema 4.26.0 Draft202012Validator with FormatChecker; local referencing registry only',
 'retained_source':SOURCE.name,'retained_source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
 'schema_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT/'contracts').glob('*.schema.json'))},
 'positive_schema_cases':len(cases),'retained_audit_events':len(w['audit']['events']),
 'passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks),'checks':checks,
 'limitations':['WorkflowRecord.session_id optional; health task_state/artifacts/tool_results/audit_evidence lack a versioned model mapping.',
 'Health Session/Checkpoint remain process-local; same-process reuse is not restart recovery.',
 'Schema validates declared constraints only; semantic validators and trusted Owner callbacks remain necessary.']}
(BASE/'daily-closeout-2026-10-19-trace.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(BASE/'daily-closeout-2026-10-19-synthetic.json').write_text(json.dumps({k:v for k,v in generated.items() if k!='broken'},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
raise SystemExit(bool(report['failed']))
