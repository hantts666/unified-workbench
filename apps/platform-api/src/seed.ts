import fs from 'node:fs';
import {db} from './db.js';
import {passwordHash} from './security.js';
import {trustedApplications} from '../../../packages/contracts/applications.js';
export async function seedDefinitions(){
  const manifest=JSON.parse(fs.readFileSync(new URL('../../../contracts/permissions.json',import.meta.url),'utf8'));
  const permissions=[...manifest.permissions,{code:'sample:overview:view',scope:'company'}];
  const roles=[...manifest.roles,{code:'finance-manager',applicationCode:'finance',permissionCodes:manifest.permissions.filter((p:any)=>p.code.startsWith('finance:')).map((p:any)=>p.code)},{code:'sample-viewer',applicationCode:'sample',permissionCodes:['sample:overview:view']}];
  for(const item of Object.values(trustedApplications))await db.application.upsert({where:{code:item.code},create:{id:item.code,code:item.code,name:item.name,activeRule:item.activeRule,entryKey:item.entryKey},update:{}});
  for(const item of permissions)await db.permission.upsert({where:{code:item.code},create:{id:item.code,applicationId:item.code.split(':')[0],code:item.code,scopeType:item.scope},update:{}});
  for(const role of roles){
    const application=trustedApplications[role.applicationCode as keyof typeof trustedApplications];
    if(await db.role.findUnique({where:{applicationId_code:{applicationId:application.code,code:role.code}}}))continue;
    await db.role.create({data:{id:role.code,applicationId:application.code,code:role.code,name:role.code,scopeType:application.scopeType,permissions:{create:role.permissionCodes.map((code:string)=>({permissionId:code}))}}});
  }
}
export async function seedBootstrap(){
  await seedDefinitions();
  const account=process.env.BOOTSTRAP_ACCOUNT?.trim().toLowerCase(),password=process.env.BOOTSTRAP_PASSWORD;
  if(!account||!password)return;
  if(password.length<12)throw new Error('Bootstrap password does not meet policy');
  if(await db.user.findUnique({where:{account}}))return;
  await db.user.create({data:{id:'bootstrap-owner',account,displayName:'平台管理员',passwordHash:await passwordHash(password),assignments:{create:{roleId:'platform-admin',applicationId:'platform',scopeType:'instance'}}}});
}
