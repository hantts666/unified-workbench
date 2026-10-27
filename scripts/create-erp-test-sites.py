"""Create separate fictional ERP test sites in an existing bench; never change live sites."""
import argparse,json,os,subprocess
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--finance-root',required=True)
parser.add_argument('--private-output',required=True)
args=parser.parse_args()
root=Path(args.finance_root).resolve()
compose=['bash',str(root/'infra/compose/finance-compose.sh')]
sites=['unified-a.localhost','unified-b.localhost']
private=Path(args.private_output).resolve();private.mkdir(parents=True,exist_ok=True,mode=0o700)
values=dict(line.split('=',1) for line in (root/'.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
environment=dict(os.environ);environment['DB_ROOT_PASSWORD']=values['DB_PASSWORD'];environment['ADMIN_PASSWORD']=values['ERP_ADMIN_PASSWORD']
container=subprocess.check_output(compose+['ps','-q','backend'],cwd=root,text=True).strip()
assert container and '\n' not in container
bootstrap=Path(__file__).with_name('bootstrap-erp-test.py')
subprocess.run(['sudo','docker','cp',str(bootstrap),container+':/tmp/unified-bootstrap-test.py'],check=True,cwd=root)
credentials=[]
for site in sites:
    site_config=f'/home/frappe/frappe-bench/sites/{site}/site_config.json'
    exists=subprocess.run(['sudo','docker','exec',container,'test','-f',site_config],cwd=root).returncode==0
    if not exists:
        print('Creating isolated test site:',site,flush=True)
        with (private/(site+'.setup.log')).open('w') as output:
            result=subprocess.run(compose+['exec','-T','-e','DB_ROOT_PASSWORD','-e','ADMIN_PASSWORD','backend','bash','-c','bench new-site "$1" --db-root-password "$DB_ROOT_PASSWORD" --admin-password "$ADMIN_PASSWORD" --mariadb-user-host-login-scope="%" --install-app erpnext','--',site],cwd=root,env=environment,stdout=output,stderr=subprocess.STDOUT)
        if result.returncode:raise SystemExit('Site setup failed; inspect the private setup log')
    with (private/(site+'.bootstrap.log')).open('w') as output:
        result=subprocess.run(compose+['exec','-T','backend','bench','--site',site,'console'],input="exec(open('/tmp/unified-bootstrap-test.py').read())\n",text=True,cwd=root,stdout=output,stderr=subprocess.STDOUT)
    if result.returncode:raise SystemExit('Site bootstrap failed; inspect the private bootstrap log')
    raw=subprocess.check_output(['sudo','docker','exec',container,'cat',f'/home/frappe/frappe-bench/sites/{site}/private/unified-credentials.json'],cwd=root)
    item=json.loads(raw);assert item['siteName']==site;credentials.append(item)
    print('Test site ready:',site,flush=True)
os.umask(0o077)
target=private/'erp-test.json';target.write_text(json.dumps(credentials,ensure_ascii=False),encoding='utf-8');target.chmod(0o600)
print(json.dumps({'result':'passed','separateTestSites':sites,'liveSitesModified':False}))
