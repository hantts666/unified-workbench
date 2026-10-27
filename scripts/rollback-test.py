"""Roll back compatible test application images, preserving every database and volume."""
import argparse,hashlib,json,os,re,subprocess,urllib.request
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',default='/data/projects/unified-workbench');p.add_argument('--revision',required=True);a=p.parse_args();root=Path(a.root).resolve()
if not re.fullmatch('[a-f0-9]{40}',a.revision):raise SystemExit('Full release revision required')
target=root/'releases'/a.revision;current=(root/'app-current').resolve()
if not target.is_dir() or (target/'.source-revision').read_text().strip()!=a.revision:raise SystemExit('Target release is unavailable')
def migration_digest(directory):return hashlib.sha256(b''.join(str(p.relative_to(directory)).encode()+p.read_bytes() for p in sorted((directory/'prisma').rglob('*')) if p.is_file())).hexdigest()
if migration_digest(target)!=migration_digest(current):raise SystemExit('Database schema differs; automatic rollback refused')
config=dict(line.split('=',1) for line in (root/'.runtime.env').read_text().splitlines() if '=' in line and not line.startswith('#'));config['APP_REVISION']=a.revision
private=root/'.rollback.env';os.umask(0o077);private.write_text('\n'.join(k+'='+v for k,v in config.items())+'\n')
subprocess.run(['sudo','docker','compose','--env-file',str(private),'-f',str(target/'infra/compose/apps.yaml'),'up','-d','--no-build','--wait','--wait-timeout','180'],check=True)
for service in ['platform','finance']:
    with urllib.request.urlopen('http://127.0.0.1:'+config['WEB_PORT']+'/api/'+service+'/health',timeout=30) as response:assert json.load(response)['revision']==a.revision
(root/'app-previous').unlink(missing_ok=True);(root/'app-previous').symlink_to(current);(root/'app-current').unlink();(root/'app-current').symlink_to(target)
(root/'.runtime.env').write_bytes(private.read_bytes());private.unlink()
print(json.dumps({'result':'passed','revision':a.revision,'databaseRestorePerformed':False,'uploadVolumeReplaced':False}))
