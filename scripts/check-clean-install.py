"""Exercise the fresh private stack through its actual gateway, with generated credentials."""
import argparse,json,time,urllib.request,urllib.error,http.cookiejar
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--report',required=True);a=p.parse_args();root=Path(a.root).resolve()
config=dict(line.split('=',1) for line in (root/'.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
if not config.get('STACK_NAME','').startswith('unified-clean-'):raise SystemExit('Only a dedicated clean installation can run this test')
base='http://127.0.0.1:'+config['WEB_PORT'];client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()));checks=[]
def request(path,method='GET',body=None):
    headers={'Origin':base,'Content-Type':'application/json'};req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
    try:r=client.open(req,timeout=30)
    except urllib.error.HTTPError as error:r=error
    raw=r.read();return r.status,json.loads(raw) if raw else None
status,login=request('/api/platform/auth/login','POST',{'account':config['BOOTSTRAP_ACCOUNT'],'password':config['BOOTSTRAP_PASSWORD']});assert status==200
assert len(request('/api/platform/users')[1])==1
assert request('/api/platform/admin/companies')[1]==[]
checks.append('fresh volumes contain only the newly seeded owner and no legacy companies')
status,company=request('/api/platform/admin/companies','POST',{'name':'全新安装验收公司','abbreviation':'CLEAN'});assert status==201
assert request('/api/platform/users/'+login['id']+'/companies','PUT',{'companyIds':[company['id']]})[0]==204
for role in ['finance-reader','sample-viewer']:assert request('/api/platform/users/'+login['id']+'/assignments','POST',{'roleId':role,'companyId':company['id']})[0]==201
checks.append('initial owner can create a company, membership and scoped application grants through HTTP')
status,context=request('/api/finance/companies/'+company['id']+'/context');assert status==200 and context['provisionStatus']=='UNPROVISIONED'
assert request('/api/finance/companies/'+company['id']+'/manual-document','POST',{})[0]==403
checks.append('fresh finance service resolves authorized company and rejects writes for read-only role')
for path in ['/login','/finance/documents','/micro/finance/','/micro/sample/']:
    with client.open(base+path,timeout=30) as response:assert response.status==200 and b'<html' in response.read()
checks.append('portal refresh and both separately built child entries are served by the new gateway')
revision=((root/'app-current').resolve()/'.source-revision').read_text().strip()
for service in ['platform','finance']:assert request('/api/'+service+'/health')[1]['revision']==revision
checks.append('both API health revisions match the freshly deployed release')
report={'executedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'result':'passed','revision':revision,'newVolumes':True,'checks':checks}
Path(a.report).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
