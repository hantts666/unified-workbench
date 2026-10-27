"""Generate a new private test configuration. Never overwrites existing secrets."""
import argparse,os,re,secrets
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--stack',default='unified-workbench');p.add_argument('--port',type=int,default=3200);p.add_argument('--bind',default='127.0.0.1');a=p.parse_args()
if not re.fullmatch('unified-[a-z0-9-]+',a.stack) or not 1024<a.port<65536:raise SystemExit('Invalid test configuration')
root=Path(a.root).resolve();os.umask(0o077);root.mkdir(parents=True,exist_ok=True)
config={key:secrets.token_hex(24) for key in ['PLATFORM_DB_OWNER_PASSWORD','PLATFORM_DB_APP_PASSWORD','FINANCE_DB_OWNER_PASSWORD','FINANCE_DB_APP_PASSWORD','INTERNAL_SERVICE_SECRET','BOOTSTRAP_PASSWORD']}
config.update(MASTER_KEY=secrets.token_hex(32),BOOTSTRAP_ACCOUNT='owner',COOKIE_SECURE='false',WEB_PORT=str(a.port),WEB_BIND=a.bind,STACK_NAME=a.stack)
with (root/'.env').open('x') as output:output.write('\n'.join(k+'='+v for k,v in config.items())+'\n')
print('Private environment created. Credentials were not printed.')
