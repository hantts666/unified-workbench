import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {Client} from '../scripts/lib/acceptance-actions.mjs';
import {databaseUrl,privateConfig} from '../scripts/lib/private-config.mjs';
import {authImplementationDigest} from '../scripts/lib/auth-evidence.mjs';
const base=process.env.DEPLOYED_TEST_BASE;
assert.ok(base&&!process.env.PLATFORM_TEST_SCHEMA,'Use the independent deployed environment, not a test schema');
const config=privateConfig();
process.env.PLATFORM_DATABASE_URL=databaseUrl('platform');
const {db}=await import('../apps/platform-api/src/db.ts');
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),checks=[];
const owner=new Client(base,(url,o)=>fetch(url,{...o,signal:AbortSignal.timeout(60000)}));
const prefix='qa-deployed-auth-'+randomUUID(),password=randomUUID()+'Temporary',nextPassword=randomUUID()+'Personal';
let user,browser;
const record=(id,description)=>{checks.push({id,description});console.log('PASS '+description);};
const api=async(c,path,method='GET',body,status=200)=>{const r=await c.request('/api/platform'+path,{method,body});assert.equal(r.status,status,r.data?.code);return r.data;};
try{
 for(const service of ['platform','finance']){
  const r=await fetch(base+'/api/'+service+'/health',{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);assert.equal((await r.json()).revision,revision);
 }
 await owner.login(config.BOOTSTRAP_ACCOUNT,config.BOOTSTRAP_PASSWORD);
 user=await api(owner,'/users','POST',{account:prefix,displayName:'发布验收账号',password},201);
 const available=await api(owner,'/admin/companies');assert.ok(available.some(c=>c.id==='demo-a'&&c.active),'Expected isolated demo ledger');
 await api(owner,'/users/'+user.id+'/companies','PUT',{companyIds:['demo-a']},204);
 const grant=await api(owner,'/users/'+user.id+'/assignments','POST',{roleId:'finance-reader',companyId:'demo-a'},201);
 const member=new Client(base);await member.login(prefix,password);
 await api(member,'/companies','GET',undefined,403);
 assert.equal((await member.request('/api/finance/companies/demo-a/documents')).status,403);
 record('AUTH02','deployed forced-change account cannot access platform business or finance API');
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(60000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/platform/account');await page.getByLabel('账号',{exact:true}).fill(prefix);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'进入工作台'}).click();
 await page.getByRole('heading',{name:'请先设置自己的密码'}).waitFor();
 await page.getByLabel('当前密码',{exact:true}).fill(password);await page.getByLabel('新密码',{exact:true}).fill(nextPassword);await page.getByLabel('确认新密码',{exact:true}).fill(nextPassword);await page.getByRole('button',{name:'保存新密码'}).click();
 await page.getByLabel('账号',{exact:true}).fill(prefix);await page.getByLabel('密码',{exact:true}).fill(nextPassword);await page.getByRole('button',{name:'进入工作台'}).click();
 await page.getByRole('heading',{name:'账号安全',exact:true}).waitFor();await page.getByText('当前设备',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 record('AUTH06','public browser completes mandatory password setup and opens account-security page with no errors');
 await member.login(prefix,nextPassword);assert.equal((await member.request('/api/finance/companies/demo-a/documents')).status,200);
 assert.equal((await owner.request('/api/finance/companies/demo-a/documents')).status,403);
 await api(owner,'/assignments/'+grant.id,'DELETE',undefined,204);
 assert.equal((await member.request('/api/finance/companies/demo-a/documents')).status,403);
 record('AUTH04','real deployed finance enforces independent authorization and immediate revocation');
 await api(owner,'/users/'+user.id+'/revoke-sessions','POST',undefined,204);
 await api(member,'/me','GET',undefined,401);
 await page.reload();await page.getByLabel('账号',{exact:true}).waitFor();
 record('AUTH03','administrator session revocation invalidates both API and public browser sessions');
 const old=await fetch('http://36.138.91.178:3100/api/health',{signal:AbortSignal.timeout(30000)});assert.equal(old.status,200);
 record('AUTH07','both deployed API revisions match the release and the original finance entry remains healthy');
 fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/auth-security-deployed.json',JSON.stringify({executedAt:new Date().toISOString(),result:'passed',deployedRevision:revision,implementationDigest:authImplementationDigest(),environment:'isolated deployed gateway and real finance service',checks,pageErrors:errors},null,2)+'\n');
}catch(error){console.error('Deployed auth acceptance failed: '+error.name+' '+error.message?.slice(0,200));process.exitCode=1;}
finally{
 await browser?.close();
 if(user){await db.roleAssignment.deleteMany({where:{userId:user.id}});await db.userCompany.deleteMany({where:{userId:user.id}});await db.user.delete({where:{id:user.id}});}
 await owner.request('/api/platform/auth/logout',{method:'POST'}).catch(()=>{});
 await db.$disconnect();
}
