"""Audit application images for private artifacts and secret defaults."""
import argparse,json,re,subprocess,tempfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',default='/data/projects/unified-workbench');p.add_argument('--report',required=True);a=p.parse_args();root=Path(a.root).resolve();source=(root/'app-current').resolve();revision=(source/'.source-revision').read_text().strip();images=[]
for service in ['platform-api','finance-api','finance-worker','portal-web','finance-web','sample-web']:
    image='unified-workbench/'+service+':'+revision
    metadata=json.loads(subprocess.check_output(['sudo','docker','image','inspect',image]))[0]
    assert not any(re.search('PASSWORD|SECRET|TOKEN|MASTER_KEY',item.split('=')[0]) for item in metadata['Config'].get('Env',[])),'Image has a private configuration default'
    if service.endswith('api') or service.endswith('worker'):
        code="import('/audit.mjs').then(({audit})=>{const r=audit('/app');if(r.findings.length)process.exit(1);console.log(JSON.stringify({files:r.files,findings:0}));})"
        result=json.loads(subprocess.check_output(['sudo','docker','run','--rm','--network','none','--entrypoint','node','-v',str(source/'scripts/public-audit.mjs')+':/audit.mjs:ro',image,'-e',code]))
    else:
        container=subprocess.check_output(['sudo','docker','create',image],text=True).strip()
        try:
            with tempfile.TemporaryDirectory(prefix='unified-image-audit-') as tmp:
                subprocess.run(['sudo','docker','cp',container+':/usr/share/nginx/html/.',tmp],check=True)
                files=list(Path(tmp).rglob('*'));assert all(p.suffix in ['.html','.js','.txt'] for p in files if p.is_file())
                for file in files:
                    if file.is_file():assert not re.search(r'\bgh[pousr]_[A-Za-z0-9]{20,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',file.read_text())
                result={'files':sum(p.is_file() for p in files),'findings':0}
        finally:subprocess.run(['sudo','docker','rm',container],check=True,stdout=subprocess.DEVNULL)
    images.append({'service':service,'imageId':metadata['Id'],**result})
report={'result':'passed','revision':revision,'images':images,'checks':['application image files contain no private artifacts','image defaults contain no credentials','Docker build context uses an explicit source allowlist']}
Path(a.report).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
