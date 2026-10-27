"""Restore the two ERP test snapshots to dedicated recovery sites, with no application traffic."""
import argparse,json,os,subprocess,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--backup',required=True);p.add_argument('--finance-root',default='/data/projects/finance-workbench');p.add_argument('--report',required=True);a=p.parse_args()
backup=Path(a.backup).resolve();legacy=Path(a.finance_root).resolve();os.umask(0o077)
config=dict(line.split('=',1) for line in (legacy/'.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
env=dict(os.environ,DB_ROOT_PASSWORD=config['DB_PASSWORD'],ADMIN_PASSWORD=config['ERP_ADMIN_PASSWORD']);compose=['bash',str(legacy/'infra/compose/finance-compose.sh')]
checks=[]
def run(command,stage):
    with (backup/(stage+'.log')).open('w') as log:subprocess.run(command,cwd=legacy,env=env,check=True,stdout=log,stderr=subprocess.STDOUT)
for suffix in ['a','b']:
    target='unified-recovery-'+suffix+'.localhost';source='unified-migration-'+suffix+'.localhost';remote='/tmp/unified-recovery-'+suffix
    marker=backup/(target+'.json');state=json.loads(marker.read_text()) if marker.exists() else {}
    exists=subprocess.run(['sudo','docker','exec','finance-backend-1','test','-f','/home/frappe/frappe-bench/sites/'+target+'/site_config.json'],stdout=subprocess.DEVNULL).returncode==0
    if exists and not state:raise SystemExit('Recovery site already exists without this backup ownership marker')
    if state.get('restored')!=True:
        marker.write_text(json.dumps({'site':target,'restored':False}))
        run(['sudo','docker','exec','finance-backend-1','mkdir','-p',remote],suffix+'-mkdir')
        run(['sudo','docker','cp',str(backup/('erp-'+suffix))+'/.','finance-backend-1:'+remote],suffix+'-copy')
        if not exists:run(compose+['exec','-T','-e','DB_ROOT_PASSWORD','-e','ADMIN_PASSWORD','backend','bash','-c','bench new-site "$1" --db-root-password "$DB_ROOT_PASSWORD" --admin-password "$ADMIN_PASSWORD" --mariadb-user-host-login-scope="%"','--',target],suffix+'-create')
        run(compose+['exec','-T','-e','DB_ROOT_PASSWORD','backend','bash','-c','bench --site "$1" restore "$2/database.sql.gz" --db-root-password "$DB_ROOT_PASSWORD" --with-public-files "$2/public.tar" --with-private-files "$2/private.tar"','--',target,remote],suffix+'-restore')
        code="import json,pathlib;s=json.loads(pathlib.Path("+repr(remote+'/site-config.json')+").read_text());p=pathlib.Path('sites')/"+repr(target)+"/'site_config.json';d=json.loads(p.read_text());d.update(encryption_key=s['encryption_key'],pause_scheduler=1,mute_emails=1,maintenance_mode=0);p.write_text(json.dumps(d))"
        run(['sudo','docker','exec','finance-backend-1','python','-c',code],suffix+'-key')
        run(compose+['exec','-T','backend','bench','--site',target,'disable-scheduler'],suffix+'-scheduler')
        marker.write_text(json.dumps({'site':target,'restored':True}))
    # Compare voucher and GL records through each site's own connection, without cross-database SQL.
    code="""import frappe,json,hashlib
def summary(site):
 frappe.init(site=site,sites_path='sites');frappe.connect()
 result={}
 for table in ['Journal Entry','Journal Entry Account','GL Entry','Account','Project']:
  rows=frappe.get_all(table,fields=['*'],order_by='name',limit_page_length=0)
  result[table]={'count':len(rows),'digest':hashlib.sha256(json.dumps(rows,sort_keys=True,default=str).encode()).hexdigest()}
 frappe.destroy();return result
before=summary(SOURCE);after=summary(TARGET)
assert before==after,'ERP restored records differ'
print(json.dumps({'result':'passed','tables':len(before)}))
""".replace('SOURCE',repr(source)).replace('TARGET',repr(target))
    run(['sudo','docker','exec','finance-backend-1','/home/frappe/frappe-bench/env/bin/python','-c',code],suffix+'-verify')
    checks.append('ERP replica '+suffix+' restored: vouchers, entries, general ledger, accounts and projects match')
report={'executedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'result':'passed','checks':checks,'originalSitesModified':False}
Path(a.report).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
