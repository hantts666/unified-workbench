"""Read a consistent legacy PostgreSQL snapshot and copy attachments to a private directory."""
import argparse,json,os,subprocess,hashlib
from pathlib import Path
from datetime import datetime,timezone

p=argparse.ArgumentParser();p.add_argument('--finance-root',required=True);p.add_argument('--private-output',required=True);a=p.parse_args()
root=Path(a.finance_root).resolve();target=Path(a.private_output).resolve()
if target.exists() and (target/'legacy.json').exists():raise SystemExit('Snapshot already exists; use a new private directory to capture another snapshot')
os.umask(0o077);target.mkdir(parents=True,exist_ok=True,mode=0o700)
compose=['bash',str(root/'infra/compose/finance-compose.sh')]
container=subprocess.check_output(compose+['ps','-q','postgres'],cwd=root,text=True).strip();api_container=subprocess.check_output(compose+['ps','-q','api'],cwd=root,text=True).strip()
assert container and api_container and '\n' not in container+api_container
tables={'users':'User','tenants':'Tenant','memberships':'Membership','documents':'Document','projects':'Project','transactions':'BankTransaction','audits':'Audit','processorConfigs':'ProcessorConfig'}
parts=[]
for key,table in tables.items():parts.append(f"'{key}',(SELECT coalesce(json_agg(t),'[]'::json) FROM \"{table}\" t)")
query='SELECT json_build_object('+','.join(parts)+");"
raw=subprocess.check_output(['sudo','docker','exec',container,'psql','-U','finance','-d','finance','-Atc',query],cwd=root)
snapshot=json.loads(raw);snapshot['capturedAt']=datetime.now(timezone.utc).isoformat();snapshot['formatVersion']=1
content=json.dumps(snapshot,ensure_ascii=False,separators=(',',':')).encode('utf-8');(target/'legacy.json').write_bytes(content)
values=dict(line.split('=',1) for line in (root/'.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
(target/'source-master.key').write_text(values['MASTER_KEY'],encoding='utf-8')
subprocess.run(['sudo','docker','cp',api_container+':/app/uploads',str(target/'uploads')],cwd=root,check=True,stdout=subprocess.DEVNULL)
subprocess.run(['sudo','chown','-R',f'{os.getuid()}:{os.getgid()}',str(target/'uploads')],check=True)
missing=0;invalid=0
for doc in snapshot['documents']:
    source=Path(doc['storagePath']);expected=target/'uploads'/doc['tenantId']/source.name
    if source.parent.as_posix()!=f"/app/uploads/{doc['tenantId']}":invalid+=1;continue
    if not expected.is_file():missing+=1;continue
    if hashlib.sha256(expected.read_bytes()).hexdigest()!=doc['contentHash']:invalid+=1
summary={'capturedAt':snapshot['capturedAt'],'snapshotDigest':hashlib.sha256(content).hexdigest(),'counts':{key:len(snapshot[key]) for key in tables},'missingAttachments':missing,'invalidAttachments':invalid,'sourceModified':False}
(target/'export-report.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps(summary))
if missing or invalid:raise SystemExit('Snapshot attachments require investigation before migration')
