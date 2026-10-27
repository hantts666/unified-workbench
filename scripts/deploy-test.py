"""Deploy an archived revision to the independent test stack; never reset data."""
import argparse,json,os,re,subprocess,time,urllib.parse,urllib.request
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',default='/data/projects/unified-workbench');p.add_argument('--skip-build',action='store_true');a=p.parse_args()
root=Path(a.root).resolve();source=(root/'source-current').resolve()
if source.parent!=root/'releases':raise SystemExit('Source must be a release beneath this project')
revision=(source/'.source-revision').read_text().strip()
if not re.fullmatch('[a-f0-9]{40}',revision):raise SystemExit('Invalid source revision')
os.umask(0o077)
config=dict(line.split('=',1) for line in (root/'.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
runtime={k:config[k] for k in ['INTERNAL_SERVICE_SECRET','MASTER_KEY','BOOTSTRAP_ACCOUNT','BOOTSTRAP_PASSWORD','COOKIE_SECURE','WEB_PORT']}
for kind in ['platform','finance']:
    password=urllib.parse.quote(config[kind.upper()+'_DB_APP_PASSWORD'],safe='')
    authority=f'{kind}_app'+':'+password+'@'+f'{kind}-postgres:5432'
    runtime[kind.upper()+'_DATABASE_URL']=urllib.parse.urlunsplit(('postgresql',authority,'/'+kind,'connection_limit=10',''))
runtime['APP_REVISION']=revision
(root/'.runtime.env').write_text('\n'.join(k+'='+v for k,v in runtime.items())+'\n');os.chmod(root/'.runtime.env',0o600)
compose=['sudo','docker','compose','--env-file',str(root/'.runtime.env'),'-f',str(source/'infra/compose/apps.yaml')]
def run(args):subprocess.run(args,check=True,cwd=source)
run(compose+['config','--quiet'])
if not a.skip_build:run(compose+['build','--pull'])
run(['sudo','docker','volume','create','unified-workbench_finance-uploads'])
uploads=root/'private/migration-20261027/uploads'
if uploads.is_dir():
    run(['sudo','docker','run','--rm','--network','none','-v','unified-workbench_finance-uploads:/target','-v',str(uploads)+':/source:ro','node:24-bookworm-slim','sh','-c','cp -an /source/. /target/ && chown -R 1000:1000 /target'])
run(compose+['up','-d','--wait','--wait-timeout','180'])
base='http://127.0.0.1:'+runtime['WEB_PORT']
for service in ['platform','finance']:
    with urllib.request.urlopen(base+'/api/'+service+'/health',timeout=30) as response:health=json.load(response)
    if health.get('revision')!=revision:raise SystemExit('Health revision mismatch: '+service)
previous=root/'app-current'
if previous.is_symlink():
    prior=previous.resolve();(root/'app-previous').unlink(missing_ok=True);(root/'app-previous').symlink_to(prior)
previous.unlink(missing_ok=True);previous.symlink_to(source)
report={'executedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'revision':revision,'result':'healthy','environment':'isolated-test','port':int(runtime['WEB_PORT']),'originalSystemModified':False}
(root/'test-deployment.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
