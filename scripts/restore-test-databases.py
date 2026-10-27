"""Restore snapshots into ephemeral, disconnected PostgreSQL containers only."""
import argparse,hashlib,json,os,secrets,subprocess,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--backup',required=True);p.add_argument('--report',required=True);a=p.parse_args();backup=Path(a.backup).resolve();manifest=json.loads((backup/'manifest.json').read_text());checks=[]
def docker(*args,**kwargs):return subprocess.run(['sudo','docker',*args],check=True,**kwargs)
for name,digest in manifest['files'].items():
    file=(backup/name).resolve()
    if not file.is_relative_to(backup) or hashlib.sha256(file.read_bytes()).hexdigest()!=digest:raise SystemExit('Backup integrity check failed')
checks.append('all private backup files match manifest SHA-256');attachments=[]
for kind,tables in manifest['databases'].items():
    if kind not in ['platform','finance']:raise SystemExit('Invalid database backup')
    container='unified-restore-'+kind+'-'+secrets.token_hex(4);created=False
    try:
        docker('run','-d','--rm','--name',container,'--network','none','--tmpfs','/var/lib/postgresql:rw,size=256m','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB='+kind,'postgres:18.6',stdout=subprocess.DEVNULL);created=True
        for i in range(60):
            result=subprocess.run(['sudo','docker','exec',container,'pg_isready','-U','postgres','-d',kind],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            if result.returncode==0:break
            time.sleep(1)
        else:raise SystemExit('Restore PostgreSQL did not become ready')
        with (backup/(kind+'.dump')).open('rb') as stream:docker('exec','-i',container,'pg_restore','-U','postgres','-d',kind,'--no-owner','--no-acl','--exit-on-error',stdin=stream)
        for table,expected in tables.items():
            if not table.isalnum():raise SystemExit('Invalid table')
            sql='SELECT count(*),md5(coalesce(string_agg(to_jsonb(t)::text,\'\' ORDER BY to_jsonb(t)::text),\'\')) FROM public."'+table+'" t;'
            value=docker('exec',container,'psql','-U','postgres','-d',kind,'-Atc',sql,capture_output=True,text=True).stdout.strip().split('|')
            assert {'count':int(value[0]),'digest':value[1]}==expected,'Restored table mismatch'
        checks.append(kind+' restored in disconnected container: every row count and full-table digest matches')
        if kind=='finance':
            sql='SELECT coalesce(json_agg(json_build_object(\'path\',"storagePath",\'hash\',"contentHash")),\'[]\') FROM "Document";'
            attachments=json.loads(docker('exec',container,'psql','-U','postgres','-d',kind,'-Atc',sql,capture_output=True,text=True).stdout)
    finally:
        if created:docker('stop',container,stdout=subprocess.DEVNULL)
# Extract into a separate private directory, never the live upload volume.
restored=backup/'restored-uploads';restored.mkdir(exist_ok=True)
docker('run','--rm','--network','none','-v',str(backup)+':/backup:ro','-v',str(restored)+':/restored','node:24-bookworm-slim','tar','-xf','/backup/uploads.tar','-C','/restored')
subprocess.run(['sudo','chown','-R',f'{os.getuid()}:{os.getgid()}',str(restored)],check=True)
for attachment in attachments:
    relative=Path(attachment['path']).relative_to('/app/uploads');file=(restored/relative).resolve()
    assert file.is_relative_to(restored) and file.is_file(),'Restored attachment missing'
    assert hashlib.sha256(file.read_bytes()).hexdigest()==attachment['hash'],'Restored attachment hash mismatch'
checks.append('every restored attachment matches the SHA-256 in the restored finance database; source volume untouched')
if 'redisKeys' in manifest:
    container='unified-restore-redis-'+secrets.token_hex(4);created=False
    try:
        docker('run','-d','--rm','--name',container,'--network','none','-v',str(backup)+':/snapshot:ro','redis:8.6-alpine','redis-server','--save','','--appendonly','no','--dir','/snapshot','--dbfilename','redis.rdb',stdout=subprocess.DEVNULL);created=True
        for i in range(30):
            probe=subprocess.run(['sudo','docker','exec',container,'redis-cli','DBSIZE'],capture_output=True,text=True)
            if probe.returncode==0 and probe.stdout.strip().isdigit():break
            time.sleep(1)
        assert int(probe.stdout.strip())==manifest['redisKeys'],'Restored Redis key count mismatch'
        checks.append('Redis snapshot restored in a disconnected container with matching key count')
    finally:
        if created:docker('stop',container,stdout=subprocess.DEVNULL)
report={'executedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'result':'passed','checks':checks,'tables':sum(len(t) for t in manifest['databases'].values())}
Path(a.report).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
