"""Initialize independent test databases from an archived source revision."""
import argparse,os,re,subprocess,urllib.parse
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',default='/data/projects/unified-workbench');a=p.parse_args()
root=Path(a.root).resolve();source=(root/'source-current').resolve();revision=(source/'.source-revision').read_text().strip()
if source.parent!=root/'releases' or not re.fullmatch('[a-f0-9]{40}',revision):raise SystemExit('Invalid release')
config=dict(line.split('=',1) for line in (root/'.env').read_text().splitlines() if '=' in line and not line.startswith('#'));stack=config.get('STACK_NAME','unified-workbench')
if not re.fullmatch('unified-[a-z0-9-]+',stack):raise SystemExit('Invalid stack')
def run(args,**kwargs):return subprocess.run(args,check=True,cwd=source,**kwargs)
compose=['sudo','docker','compose','--env-file',str(root/'.env')]
run(compose+['-f','infra/compose/data.yaml','up','-d','--wait'])
run(compose+['-f','infra/compose/finance-support.yaml','up','-d','--wait'])
image='unified-workbench/schema-tools:'+revision
run(['sudo','docker','build','--target','dependencies','-f','infra/docker/Dockerfile','-t',image,'.'])
for kind in ['platform','finance']:
    password=urllib.parse.quote(config[kind.upper()+'_DB_OWNER_PASSWORD'],safe='');authority=kind+'_owner'+':'+password+'@'+kind+'-postgres:5432'
    key=kind.upper()+'_DATABASE_URL';env=dict(os.environ);env[key]=urllib.parse.urlunsplit(('postgresql',authority,'/'+kind,'',''))
    # sudo --preserve-env explicitly passes the one migration connection only.
    command=['sudo','--preserve-env='+key,'docker','run','--rm','--network',stack+'_'+kind+'-data','-e',key,image,'node','node_modules/prisma/build/index.js','migrate','deploy','--schema','prisma/'+kind+'/schema.prisma']
    log=root/(kind+'-migration.log');os.umask(0o077)
    with log.open('w') as output:run(command,env=env,stdout=output,stderr=subprocess.STDOUT)
    print(kind+' migrations applied')
