"""Consistent backup of the independent test stack. Private output only."""
import argparse,hashlib,json,os,subprocess,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',default='/data/projects/unified-workbench');p.add_argument('--output',required=True);a=p.parse_args()
root=Path(a.root).resolve();out=Path(a.output).resolve()
if not out.is_relative_to(root/'private') or out.exists():raise SystemExit('Choose a new private backup directory under this project')
os.umask(0o077);out.mkdir(parents=True)
def docker(*args,**kwargs):return subprocess.run(['sudo','docker',*args],check=True,**kwargs)
stopped=[];tables={'platform':['User','Session','Company','UserCompany','Application','Permission','Role','RolePermission','RoleAssignment','PlatformAudit'],'finance':['LedgerBinding','Document','Project','BankTransaction','Audit','ProcessorConfig']}
def summary(kind):
    records={}
    for table in tables[kind]:
        sql='SELECT count(*),md5(coalesce(string_agg(to_jsonb(t)::text,\'\' ORDER BY to_jsonb(t)::text),\'\')) FROM public."'+table+'" t;'
        value=docker('exec','unified-workbench-'+kind+'-postgres-1','psql','-U',kind+'_owner','-d',kind,'-Atc',sql,capture_output=True,text=True).stdout.strip().split('|')
        records[table]={'count':int(value[0]),'digest':value[1]}
    return records
try:
    for service in ['finance-api','finance-worker','platform-api']:
        docker('stop','--time','60','unified-workbench-'+service+'-1',stdout=subprocess.DEVNULL);stopped.append(service)
    report={'executedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'databases':{}}
    for kind in tables:
        report['databases'][kind]=summary(kind)
        with (out/(kind+'.dump')).open('wb') as stream:docker('exec','unified-workbench-'+kind+'-postgres-1','pg_dump','-U',kind+'_owner','-d',kind,'-Fc','--no-owner','--no-acl',stdout=stream)
    docker('run','--rm','--network','none','-v','unified-workbench_finance-uploads:/uploads:ro','-v',str(out)+':/backup','node:24-bookworm-slim','tar','-cf','/backup/uploads.tar','-C','/uploads','.')
    docker('exec','unified-workbench-finance-redis-1','redis-cli','SAVE',stdout=subprocess.DEVNULL)
    docker('cp','unified-workbench-finance-redis-1:/data/dump.rdb',str(out/'redis.rdb'),stdout=subprocess.DEVNULL)
    (out/'environment.env').write_bytes((root/'.env').read_bytes())
    (out/'app-revision').write_text(((root/'app-current').resolve()/'.source-revision').read_text())
    # ERP sites are isolated replicas; their schedulers are disabled. Source ERP sites are untouched.
    legacy=root.parent/'finance-workbench';compose=['bash',str(legacy/'infra/compose/finance-compose.sh')]
    for suffix in ['a','b']:
        site='unified-migration-'+suffix+'.localhost';target='/tmp/unified-backup-'+out.name+'-'+suffix
        docker('exec','finance-backend-1','mkdir','-p',target)
        with (out/('erp-'+suffix+'.log')).open('w') as log:
            subprocess.run(compose+['exec','-T','backend','bench','--site',site,'backup','--with-files','--backup-path-db',target+'/database.sql.gz','--backup-path-files',target+'/public.tar','--backup-path-private-files',target+'/private.tar','--backup-path-conf',target+'/site-config.json'],cwd=legacy,check=True,stdout=log,stderr=subprocess.STDOUT)
        docker('cp','finance-backend-1:'+target,str(out/('erp-'+suffix)),stdout=subprocess.DEVNULL)
    subprocess.run(['sudo','chown','-R',f'{os.getuid()}:{os.getgid()}',str(out)],check=True)
    report['files']={str(file.relative_to(out)):hashlib.sha256(file.read_bytes()).hexdigest() for file in out.rglob('*') if file.is_file() and file.suffix!='.log'}
    report['result']='passed';(out/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'result':'passed','databaseTables':sum(len(t) for t in tables.values()),'erpSites':2,'files':len(report['files'])}))
finally:
    for service in reversed(stopped):docker('start','unified-workbench-'+service+'-1',stdout=subprocess.DEVNULL)
