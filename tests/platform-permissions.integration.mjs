import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {databaseUrl,privateConfig} from '../scripts/lib/private-config.mjs';
import {Client} from '../scripts/lib/acceptance-actions.mjs';
const config=privateConfig();process.env.PLATFORM_DATABASE_URL=databaseUrl('platform');process.env.INTERNAL_SERVICE_SECRET=config.INTERNAL_SERVICE_SECRET;process.env.COOKIE_SECURE='false';
const {db}=await import('../apps/platform-api/src/db.ts');
const {passwordHash}=await import('../apps/platform-api/src/security.ts');
const {seedDefinitions}=await import('../apps/platform-api/src/seed.ts');
const {createPlatformApp}=await import('../apps/platform-api/src/main.ts');
const prefix='qa-'+randomUUID(),password=randomUUID()+'test',userIds=[],companyIds=[],roleIds=[],checks=[];
let app,admin,member,financeActive=true;
try{
  await seedDefinitions();financeActive=(await db.application.findUnique({where:{id:'finance'}})).active;
  admin=await db.user.create({data:{account:prefix+'-admin',displayName:'虚构平台管理员',passwordHash:await passwordHash(password)}});userIds.push(admin.id);
  member=await db.user.create({data:{account:prefix+'-member',displayName:'虚构只读用户',passwordHash:await passwordHash(password)}});userIds.push(member.id);
  const adminAssignment=await db.roleAssignment.create({data:{userId:admin.id,roleId:'platform-admin',applicationId:'platform',scopeType:'instance'}});
  app=await createPlatformApp();await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const tunneledFetch=(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(30000)});
  const owner=new Client(base,tunneledFetch),reader=new Client(base,tunneledFetch);await owner.login(admin.account,password);await reader.login(member.account,password);
  console.log('T05 authenticated test accounts');
  const api=async(client,path,method='GET',body)=>{const result=await client.request('/api/platform'+path,{method,body});return result;};
  const introspect=async(client,companyId,permissionCode='finance:document:view',applicationCode='finance',credential=config.INTERNAL_SERVICE_SECRET)=>{
    const response=await fetch(base+'/internal/auth/introspect',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credential},body:JSON.stringify({sessionToken:client.cookie.slice('platform_session='.length),companyId,permissionCode,applicationCode})});return {status:response.status,data:await response.json()};
  };
  assert.equal((await api(reader,'/users')).status,403);assert.equal((await api(owner,'/users')).status,200);checks.push('platform endpoints require their own permission');
  for(const suffix of ['A','B']){const result=await api(owner,'/admin/companies','POST',{name:prefix+' '+suffix,abbreviation:suffix});assert.equal(result.status,201);companyIds.push(result.data.id);}
  assert.equal((await api(owner,`/users/${member.id}/companies`,'PUT',{companyIds:[companyIds[0]]})).status,204);
  assert.deepEqual((await api(reader,'/companies')).data.map(company=>company.id),[companyIds[0]]);
  assert.deepEqual((await api(reader,'/applications')).data,[]);checks.push('company membership alone does not authorize applications');
  const assignment=await api(owner,`/users/${member.id}/assignments`,'POST',{roleId:'finance-reader',companyId:companyIds[0]});assert.equal(assignment.status,201);
  assert.ok((await api(reader,'/applications')).data.some(application=>application.code==='finance'));
  assert.equal((await introspect(reader,companyIds[0])).data.allowed,true);
  assert.equal((await introspect(reader,companyIds[0],'finance:voucher:submit')).data.allowed,false);
  assert.equal((await introspect(reader,companyIds[1])).data.allowed,false);checks.push('application, company and operation grants are independently enforced');
  assert.equal((await introspect(reader,companyIds[0],'finance:document:view','finance','invalid-service-secret')).status,401);
  assert.equal((await introspect(reader,companyIds[0],'platform:user:manage','platform')).status,403);checks.push('internal service credential is scoped to finance');
  assert.equal((await api(owner,`/users/${admin.id}/companies`,'PUT',{companyIds:[companyIds[0]]})).status,204);
  assert.equal((await introspect(owner,companyIds[0])).data.allowed,false);checks.push('platform administrator does not inherit finance privileges');
  assert.equal((await api(owner,'/roles','POST',{applicationId:'finance',code:prefix,name:'无效混合角色',permissionCodes:['finance:document:view','platform:user:manage']})).status,400);
  await assert.rejects(()=>db.rolePermission.create({data:{roleId:'finance-reader',permissionId:'platform:user:manage',applicationId:'finance',scopeType:'company'}}));checks.push('API and database reject cross-application role permissions');
  assert.equal((await api(owner,`/users/${member.id}/assignments`,'POST',{roleId:'finance-reader',companyId:companyIds[0]})).status,409);
  assert.equal((await api(owner,`/users/${member.id}/assignments`,'POST',{roleId:'finance-reader',companyId:companyIds[1]})).status,400);
  assert.equal((await api(owner,`/users/${member.id}/assignments`,'POST',{roleId:'finance-reader'})).status,400);checks.push('duplicate and unscoped grants are rejected');
  assert.equal((await api(owner,`/assignments/${assignment.data.id}`,'DELETE')).status,204);
  assert.equal((await introspect(reader,companyIds[0])).data.allowed,false);checks.push('revocation is effective on the next request');
  const role=await api(owner,'/roles','POST',{applicationId:'finance',code:prefix,name:'虚构可变角色',permissionCodes:['finance:document:view']});assert.equal(role.status,201);roleIds.push(role.data.id);
  assert.equal((await api(owner,`/users/${member.id}/assignments`,'POST',{roleId:role.data.id,companyId:companyIds[0]})).status,201);
  assert.equal((await api(owner,`/roles/${role.data.id}`,'PATCH',{permissionCodes:[]})).status,200);assert.equal((await introspect(reader,companyIds[0])).data.allowed,false);
  assert.equal((await api(owner,`/roles/${role.data.id}`,'PATCH',{permissionCodes:['finance:document:view']})).status,200);assert.equal((await introspect(reader,companyIds[0])).data.allowed,true);checks.push('role changes immediately update effective permissions');
  assert.equal((await api(owner,'/admin/applications/finance','PATCH',{active:false})).status,200);assert.equal((await introspect(reader,companyIds[0])).data.allowed,false);assert.deepEqual((await api(reader,'/applications')).data,[]);
  assert.equal((await api(owner,'/admin/applications/finance','PATCH',{active:true})).status,200);checks.push('disabled applications disappear and reject authorization');
  assert.equal((await api(owner,`/admin/companies/${companyIds[0]}`,'PATCH',{active:false})).status,200);assert.equal((await introspect(reader,companyIds[0])).data.allowed,false);
  assert.equal((await api(owner,`/admin/companies/${companyIds[0]}`,'PATCH',{active:true})).status,200);checks.push('disabled company prevents finance access');
  assert.equal((await api(owner,`/users/${member.id}/companies`,'PUT',{companyIds:[]})).status,204);assert.equal((await introspect(reader,companyIds[0])).data.allowed,false);
  assert.equal((await api(owner,`/users/${member.id}/companies`,'PUT',{companyIds:[companyIds[0]]})).status,204);checks.push('membership revocation prevents residual role access');
  assert.equal((await api(owner,`/users/${member.id}`,'PATCH',{active:false})).status,200);assert.equal((await introspect(reader,companyIds[0])).data.active,false);
  assert.equal((await api(owner,`/users/${member.id}`,'PATCH',{active:true})).status,200);assert.equal((await reader.request('/api/platform/me')).status,401);checks.push('reactivation does not revive a revoked session');
  assert.equal((await api(owner,'/admin/applications','POST',{code:'evil',name:'Invalid',entry:'https://attacker.invalid'})).status,400);checks.push('application entries are deployment-owned');
  const adminCount=await db.roleAssignment.count({where:{roleId:'platform-admin',user:{active:true}}});
  if(adminCount===1){assert.equal((await api(owner,`/assignments/${adminAssignment.id}`,'DELETE')).status,409);checks.push('last administrator cannot revoke their own recovery path');}
  const audit=await api(owner,'/audit');assert.equal(audit.status,200);assert.equal(JSON.stringify(audit.data).includes(password),false);checks.push('administration audit excludes credentials');
  fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/T05-permissions.json',JSON.stringify({executedAt:new Date().toISOString(),result:'passed',database:'real PostgreSQL test container',transport:'real HTTP',authorizationCacheSeconds:0,checks},null,2)+'\n');console.log(`T05 authorization passed (${checks.length} checks)`);
}catch(error){console.error('T05 authorization failed after',checks.length,'checks:',error.code??error.name,error.message?.slice(0,160));process.exitCode=1;}
finally{
  await app?.close();
  if(userIds.length){await db.roleAssignment.deleteMany({where:{userId:{in:userIds}}});await db.userCompany.deleteMany({where:{userId:{in:userIds}}});await db.session.deleteMany({where:{userId:{in:userIds}}});await db.platformAudit.deleteMany({where:{actorId:{in:userIds}}});await db.user.deleteMany({where:{id:{in:userIds}}});}
  if(companyIds.length)await db.company.deleteMany({where:{id:{in:companyIds}}});
  if(roleIds.length)await db.role.deleteMany({where:{id:{in:roleIds}}});
  await db.application.updateMany({where:{id:'finance'},data:{active:financeActive}});await db.$disconnect();
}
