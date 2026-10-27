"""Restore legacy fictional ERP sites into new, unserved rehearsal sites only."""
import argparse,json,os,subprocess
from pathlib import Path

p=argparse.ArgumentParser();p.add_argument('--finance-root',required=True);p.add_argument('--private-snapshot',required=True);a=p.parse_args()
root=Path(a.finance_root).resolve();private=Path(a.private_snapshot).resolve();snapshot=json.loads((private/'legacy.json').read_text())
os.umask(0o077)
compose=['bash',str(root/'infra/compose/finance-compose.sh')]
container=subprocess.check_output(compose+['ps','-q','backend'],cwd=root,text=True).strip();assert container and '\n' not in container
values=dict(line.split('=',1) for line in (root/'.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
env=dict(os.environ);env['DB_ROOT_PASSWORD']=values['DB_PASSWORD'];env['ADMIN_PASSWORD']=values['ERP_ADMIN_PASSWORD']
allowed={'demo-a.localhost':'unified-migration-a.localhost','demo-b.localhost':'unified-migration-b.localhost'}
mapping=[]
def run(command,stage,input=None):
    with (private/(stage+'.log')).open('w') as log:
        result=subprocess.run(command,cwd=root,env=env,text=True,input=input,stdout=log,stderr=subprocess.STDOUT)
    if result.returncode:raise SystemExit('Rehearsal failed at '+stage+'; inspect its private log')
for tenant in snapshot['tenants']:
    if not tenant['apiCredential']:continue
    source=tenant['siteName']
    if source not in allowed:raise SystemExit('Only the explicitly defined fictional source sites can be cloned')
    target=allowed[source];marker=private/(target+'.clone-state.json');backup='/tmp/unified-rehearsal-'+target
    state=json.loads(marker.read_text()) if marker.exists() else {}
    exists=subprocess.run(['sudo','docker','exec',container,'test','-f',f'/home/frappe/frappe-bench/sites/{target}/site_config.json'],cwd=root).returncode==0
    if exists and not state:raise SystemExit('Target exists without this rehearsal ownership record; refusing to restore')
    if state.get('status')!='ready':
        marker.write_text(json.dumps({'source':source,'target':target,'status':'preparing'}))
        run(['sudo','docker','exec',container,'mkdir','-p',backup],target+'-directory')
        print('Capturing isolated ERP snapshot:',source,flush=True)
        run(compose+['exec','-T','backend','bench','--site',source,'backup','--with-files','--backup-path-db',backup+'/database.sql.gz','--backup-path-files',backup+'/public.tar','--backup-path-private-files',backup+'/private.tar','--backup-path-conf',backup+'/site-config.json'],target+'-backup')
        if not exists:
            print('Creating migration replica:',target,flush=True)
            run(compose+['exec','-T','-e','DB_ROOT_PASSWORD','-e','ADMIN_PASSWORD','backend','bash','-c','bench new-site "$1" --db-root-password "$DB_ROOT_PASSWORD" --admin-password "$ADMIN_PASSWORD" --mariadb-user-host-login-scope="%"','--',target],target+'-create')
        print('Restoring only the new replica:',target,flush=True)
        run(compose+['exec','-T','-e','DB_ROOT_PASSWORD','backend','bash','-c','bench --site "$1" restore "$2/database.sql.gz" --db-root-password "$DB_ROOT_PASSWORD" --with-public-files "$2/public.tar" --with-private-files "$2/private.tar"','--',target,backup],target+'-restore')
        # Copy only the encryption key, preserving the replica's database identity and password.
        code="import json,pathlib;src=pathlib.Path('sites')/"+repr(source)+"/'site_config.json';dst=pathlib.Path('sites')/"+repr(target)+"/'site_config.json';s=json.loads(src.read_text());d=json.loads(dst.read_text());d['encryption_key']=s['encryption_key'];d['pause_scheduler']=1;d['mute_emails']=1;d['maintenance_mode']=0;dst.write_text(json.dumps(d,indent=2))"
        run(['sudo','docker','exec',container,'python','-c',code],target+'-key')
        run(compose+['exec','-T','backend','bench','--site',target,'disable-scheduler'],target+'-scheduler')
        marker.write_text(json.dumps({'source':source,'target':target,'status':'ready'}))
    mapping.append({'sourceTenantId':tenant['id'],'sourceSite':source,'targetSite':target})
    print('Migration replica ready:',target,flush=True)
(private/'erp-mapping.json').write_text(json.dumps(mapping),encoding='utf-8')
print(json.dumps({'result':'passed','isolatedRestores':len(mapping),'originalBusinessDataModified':False,'replicaSchedulersDisabled':True}))
