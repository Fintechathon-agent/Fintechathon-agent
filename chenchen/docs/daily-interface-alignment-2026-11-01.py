"""Read-only cross-repository Core Contract definition comparison.
Usage: python chenchen/docs/daily-interface-alignment-2026-11-01.py TEAM_ROOT PERSONAL_ROOT
Output: same dated JSON report under each root/chenchen/docs.
"""
import sys, json, hashlib, datetime, subprocess
from pathlib import Path
left, right = map(Path, sys.argv[1:3])
names = ['investment-agent.v1.schema.json','model-review.v1.schema.json','risk-handoff.v1.schema.json','core-agent-error.v1.schema.json']
checks=[]
for name in names:
    blobs=[(root/'chenchen/contracts'/name).read_bytes() for root in [left,right]]
    hashes=[hashlib.sha256(blob).hexdigest() for blob in blobs]
    schemas=[json.loads(blob.decode('utf-8-sig')) for blob in blobs]
    checks.append({'schema':name,'schema_id':schemas[0]['$id'],'team_sha256':hashes[0],'personal_sha256':hashes[1], 'passed': hashes[0]==hashes[1]})
report={'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'command':'python chenchen/docs/daily-interface-alignment-2026-11-01.py TEAM_ROOT PERSONAL_ROOT', 'baselines':{label:subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip() for label,root in [('team',left),('personal',right)]}, 'passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks),'checks':checks,'scope':'Exact schema definition comparison only; not Owner acceptance, runtime interoperability, or live Risk review.'}
for root in [left,right]:
    (root/'chenchen/docs/daily-closeout-2026-11-01-interface-alignment.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
raise SystemExit(bool(report['failed']))
