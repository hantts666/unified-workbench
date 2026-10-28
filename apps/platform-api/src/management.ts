import type {Router} from 'express';
import {z} from 'zod';
import {db} from './db.js';
import {requireSession} from './auth.js';
import {effectivePermissions,requirePermission} from './authorization.js';
import {passwordHash} from './security.js';
import {ApiFailure,route} from './http.js';
import {trustedApplications} from '../../../packages/contracts/applications.js';
import {protectUser,protectRole} from './admin-safety.js';
import {throttleKey} from './throttle.js';

const userFields={id:true,account:true,displayName:true,active:true,createdAt:true,authzVersion:true,mustChangePassword:true,lastLoginAt:true} as const;
const companyFields={id:true,name:true,abbreviation:true,taxId:true,active:true,version:true} as const;
const auditData=(actorId:string,action:string,resourceType:string,resourceId:string,detail:object={})=>({actorId,action,resourceType,resourceId,detail});
const permissionInput=z.array(z.string().min(1)).max(100);
const registryCode=z.enum(['platform','finance','sample']);
async function ensureAdministrator(tx:any){
  const administrators=await tx.$queryRaw`
    SELECT ra."userId" FROM "RoleAssignment" ra
    JOIN "User" u ON u.id=ra."userId" JOIN "Role" r ON r.id=ra."roleId"
    JOIN "RolePermission" rp ON rp."roleId"=r.id JOIN "Permission" p ON p.id=rp."permissionId"
    WHERE ra."applicationId"='platform' AND ra."scopeType"='instance' AND ra."companyId" IS NULL AND u.active AND r.active
      AND p.code IN ('platform:user:manage','platform:role:manage','platform:authorization:manage','platform:application:manage','platform:company:manage','platform:audit:view')
    GROUP BY ra."userId" HAVING COUNT(DISTINCT p.code)=6 LIMIT 1`;
  if(!administrators.length)throw new ApiFailure(409,'LAST_ADMIN','至少保留一个具备完整平台管理权限的有效管理员');
}
async function validateRolePermissions(applicationId:string,codes:string[]){
  const definition=trustedApplications[applicationId as keyof typeof trustedApplications];
  if(!definition)throw new ApiFailure(400,'INVALID_APPLICATION','应用未注册');
  const permissions=await db.permission.findMany({where:{code:{in:codes},applicationId,scopeType:definition.scopeType}});
  if(new Set(codes).size!==codes.length||permissions.length!==codes.length)throw new ApiFailure(400,'INVALID_PERMISSIONS','角色权限必须属于同一个应用及范围');
  return {definition,permissions};
}
export function registerManagement(router:Router){
  router.use(requireSession);
  router.get('/companies',route(async(req,res)=>res.json(await db.company.findMany({where:{active:true,members:{some:{userId:req.identity.user.id,active:true}}},select:{id:true,name:true,active:true,version:true},orderBy:{name:'asc'}}))));
  router.get('/permissions',route(async(req,res)=>{
    const input=z.object({applicationCode:z.string(),companyId:z.string()}).parse(req.query);
    res.json(await effectivePermissions(req.identity.user.id,input.applicationCode,input.companyId));
  }));
  router.get('/applications',route(async(req,res)=>{
    const companies=await db.userCompany.findMany({where:{userId:req.identity.user.id,active:true,company:{active:true}}});
    const applications=await db.application.findMany({where:{active:true,code:{not:'platform'}}});
    const result=[];
    for(const application of applications){
      const definition=trustedApplications[application.code as keyof typeof trustedApplications];
      if(!definition)continue;
      const companyIds=[];
      for(const member of companies){if((await effectivePermissions(req.identity.user.id,application.code,member.companyId)).length)companyIds.push(member.companyId);}
      if(companyIds.length)result.push({code:application.code,name:application.name,activeRule:definition.activeRule,entry:definition.entry,companyIds,version:application.version});
    }
    res.json(result);
  }));
  router.get('/users',requirePermission('platform:user:manage'),route(async(_req,res)=>res.json(await db.user.findMany({select:userFields,orderBy:{createdAt:'asc'},take:500}))));
  router.post('/users',requirePermission('platform:user:manage'),route(async(req,res)=>{
    const input=z.object({account:z.string().trim().min(1).max(200),displayName:z.string().trim().min(1).max(100),password:z.string().min(12).max(200)}).strict().parse(req.body);
    const result=await db.$transaction(async tx=>{
      const user=await tx.user.create({data:{account:input.account.toLowerCase(),displayName:input.displayName,passwordHash:await passwordHash(input.password),mustChangePassword:true},select:userFields});
      await tx.platformAudit.create({data:auditData(req.identity.user.id,'USER_CREATE','user',user.id)});return user;
    });res.status(201).json(result);
  }));
  router.patch('/users/:id',requirePermission('platform:user:manage'),route(async(req,res)=>{
    const input=z.object({displayName:z.string().trim().min(1).max(100).optional(),active:z.boolean().optional(),password:z.string().min(12).max(200).optional()}).strict().parse(req.body);
    if(input.password&&req.params.id===req.identity.user.id)throw new ApiFailure(400,'USE_PASSWORD_CHANGE','修改自己的密码请使用账号安全中的修改密码');
    const resetHash=input.password?await passwordHash(input.password):undefined;
    const updated=await db.$transaction(async tx=>{
      await protectUser(tx,req.identity.user.id,req.params.id);
      const user=await tx.user.update({where:{id:req.params.id},data:{displayName:input.displayName,active:input.active,...(resetHash?{passwordHash:resetHash,mustChangePassword:true}:{}),authzVersion:{increment:1}},select:userFields});
      if(input.active===false||input.password)await tx.session.updateMany({where:{userId:user.id,revokedAt:null},data:{revokedAt:new Date()}});
      if(input.password)await tx.authThrottle.deleteMany({where:{key:{in:[throttleKey('login-account',user.account),throttleKey('password-change',user.id)]}}});
      await ensureAdministrator(tx);await tx.platformAudit.create({data:auditData(req.identity.user.id,'USER_UPDATE','user',user.id,{fields:Object.keys(input)})});return user;
    },{isolationLevel:'Serializable'});res.json(updated);
  }));
  router.post('/users/:id/unlock',requirePermission('platform:user:manage'),route(async(req,res)=>{
    await db.$transaction(async tx=>{
      await protectUser(tx,req.identity.user.id,req.params.id);
      const user=await tx.user.findUniqueOrThrow({where:{id:req.params.id}});
      await tx.authThrottle.deleteMany({where:{key:{in:[throttleKey('login-account',user.account),throttleKey('password-change',user.id)]}}});
      await tx.platformAudit.create({data:auditData(req.identity.user.id,'USER_LOGIN_UNLOCK','user',user.id)});
    },{isolationLevel:'Serializable'});res.status(204).end();
  }));
  router.post('/users/:id/revoke-sessions',requirePermission('platform:user:manage'),route(async(req,res)=>{
    await db.$transaction(async tx=>{
      await protectUser(tx,req.identity.user.id,req.params.id);
      await tx.user.findUniqueOrThrow({where:{id:req.params.id}});
      await tx.session.updateMany({where:{userId:req.params.id,revokedAt:null},data:{revokedAt:new Date()}});
      await tx.platformAudit.create({data:auditData(req.identity.user.id,'USER_REVOKE_SESSIONS','user',req.params.id)});
    },{isolationLevel:'Serializable'});res.status(204).end();
  }));
  router.get('/admin/companies',requirePermission('platform:company:manage'),route(async(_req,res)=>res.json(await db.company.findMany({select:companyFields,orderBy:{name:'asc'},take:500}))));
  router.post('/admin/companies',requirePermission('platform:company:manage'),route(async(req,res)=>{
    const input=z.object({name:z.string().trim().min(1).max(200),abbreviation:z.string().trim().min(1).max(30),taxId:z.string().max(50).default('')}).strict().parse(req.body);
    const company=await db.$transaction(async tx=>{const result=await tx.company.create({data:input,select:companyFields});await tx.platformAudit.create({data:auditData(req.identity.user.id,'COMPANY_CREATE','company',result.id)});return result;});res.status(201).json(company);
  }));
  router.patch('/admin/companies/:id',requirePermission('platform:company:manage'),route(async(req,res)=>{
    const input=z.object({name:z.string().trim().min(1).max(200).optional(),abbreviation:z.string().trim().min(1).max(30).optional(),taxId:z.string().max(50).optional(),active:z.boolean().optional()}).strict().parse(req.body);
    const company=await db.$transaction(async tx=>{const result=await tx.company.update({where:{id:req.params.id},data:{...input,version:{increment:1}},select:companyFields});await tx.platformAudit.create({data:auditData(req.identity.user.id,'COMPANY_UPDATE','company',result.id,{fields:Object.keys(input)})});return result;});res.json(company);
  }));
  router.get('/admin/applications',requirePermission('platform:application:manage'),route(async(_req,res)=>res.json(await db.application.findMany({orderBy:{code:'asc'}}))));
  router.post('/admin/applications',requirePermission('platform:application:manage'),route(async(req,res)=>{
    const input=z.object({code:registryCode,name:z.string().min(1).max(100)}).strict().parse(req.body),definition=trustedApplications[input.code];
    const app=await db.$transaction(async tx=>{const result=await tx.application.create({data:{id:input.code,code:input.code,name:input.name,activeRule:definition.activeRule,entryKey:definition.entryKey}});await tx.platformAudit.create({data:auditData(req.identity.user.id,'APPLICATION_CREATE','application',result.id)});return result;});res.status(201).json(app);
  }));
  router.patch('/admin/applications/:id',requirePermission('platform:application:manage'),route(async(req,res)=>{
    const input=z.object({name:z.string().min(1).max(100).optional(),active:z.boolean().optional()}).strict().parse(req.body);
    if(req.params.id==='platform'&&input.active===false)throw new ApiFailure(409,'PLATFORM_REQUIRED','平台管理入口必须保持启用');
    const app=await db.$transaction(async tx=>{const result=await tx.application.update({where:{id:req.params.id},data:{...input,version:{increment:1}}});await tx.platformAudit.create({data:auditData(req.identity.user.id,'APPLICATION_UPDATE','application',result.id,{fields:Object.keys(input)})});return result;});res.json(app);
  }));
  router.get('/admin/permissions',requirePermission('platform:role:manage'),route(async(_req,res)=>res.json(await db.permission.findMany({orderBy:{code:'asc'}}))));
  router.get('/roles',requirePermission('platform:role:manage'),route(async(_req,res)=>res.json(await db.role.findMany({include:{permissions:{include:{permission:true}}},orderBy:{code:'asc'}}))));
  router.post('/roles',requirePermission('platform:role:manage'),route(async(req,res)=>{
    const input=z.object({applicationId:registryCode,code:z.string().regex(/^[a-z][a-z0-9-]{1,60}$/),name:z.string().min(1).max(100),permissionCodes:permissionInput}).strict().parse(req.body);
    const {definition,permissions}=await validateRolePermissions(input.applicationId,input.permissionCodes);
    const role=await db.$transaction(async tx=>{const result=await tx.role.create({data:{applicationId:input.applicationId,code:input.code,name:input.name,scopeType:definition.scopeType,permissions:{create:permissions.map(permission=>({permissionId:permission.id}))}}});await tx.platformAudit.create({data:auditData(req.identity.user.id,'ROLE_CREATE','role',result.id)});return result;});res.status(201).json(role);
  }));
  router.patch('/roles/:id',requirePermission('platform:role:manage'),route(async(req,res)=>{
    const input=z.object({name:z.string().min(1).max(100).optional(),active:z.boolean().optional(),permissionCodes:permissionInput.optional()}).strict().parse(req.body);
    const current=await db.role.findUnique({where:{id:req.params.id}});if(!current)throw new ApiFailure(404,'NOT_FOUND','角色不存在');
    const checked=input.permissionCodes?await validateRolePermissions(current.applicationId,input.permissionCodes):null;
    const role=await db.$transaction(async tx=>{
      if(checked||input.active!==undefined)await protectRole(tx,req.identity.user.id,current.id);
      if(checked){await tx.rolePermission.deleteMany({where:{roleId:current.id}});await tx.rolePermission.createMany({data:checked.permissions.map(permission=>({roleId:current.id,permissionId:permission.id,applicationId:current.applicationId,scopeType:current.scopeType}))});}
      const result=await tx.role.update({where:{id:current.id},data:{name:input.name,active:input.active}});
      const assigned=await tx.roleAssignment.findMany({where:{roleId:current.id},select:{userId:true}});await tx.user.updateMany({where:{id:{in:assigned.map(a=>a.userId)}},data:{authzVersion:{increment:1}}});
      await ensureAdministrator(tx);await tx.platformAudit.create({data:auditData(req.identity.user.id,'ROLE_UPDATE','role',current.id,{fields:Object.keys(input)})});return result;
    },{isolationLevel:'Serializable'});res.json(role);
  }));
  router.get('/users/:id/access',requirePermission('platform:authorization:manage'),route(async(req,res)=>{
    const user=await db.user.findUniqueOrThrow({where:{id:req.params.id},select:userFields});
    const memberships=await db.userCompany.findMany({where:{userId:user.id},include:{company:true}});
    const assignments=await db.roleAssignment.findMany({where:{userId:user.id},include:{role:true}});
    const scopes=[{applicationCode:'platform',companyId:null as string|null},...memberships.flatMap(m=>['finance','sample'].map(applicationCode=>({applicationCode,companyId:m.companyId})))];
    const effectiveAccess=[];
    for(const scope of scopes){const permissionCodes=await effectivePermissions(user.id,scope.applicationCode,scope.companyId);if(permissionCodes.length)effectiveAccess.push({...scope,permissionCodes});}
    res.json({user,memberships,assignments,effectiveAccess});
  }));
  router.get('/authorization-options',requirePermission('platform:authorization:manage'),route(async(_req,res)=>{
    const [users,companies,roles]=await Promise.all([
      db.user.findMany({select:{id:true,account:true,displayName:true},orderBy:{displayName:'asc'},take:500}),
      db.company.findMany({where:{active:true},select:{id:true,name:true},orderBy:{name:'asc'},take:500}),
      db.role.findMany({where:{active:true,application:{active:true}},select:{id:true,name:true,applicationId:true,scopeType:true},orderBy:{name:'asc'}}),
    ]);res.json({users,companies,roles});
  }));
  router.put('/users/:id/companies',requirePermission('platform:authorization:manage'),route(async(req,res)=>{
    const input=z.object({companyIds:z.array(z.string().min(1)).max(100)}).strict().parse(req.body);
    if(new Set(input.companyIds).size!==input.companyIds.length)throw new ApiFailure(400,'DUPLICATE_COMPANY','公司不能重复');
    const count=await db.company.count({where:{id:{in:input.companyIds},active:true}});if(count!==input.companyIds.length)throw new ApiFailure(400,'INVALID_COMPANY','包含无效公司');
    await db.$transaction(async tx=>{
      const revoked=await tx.roleAssignment.deleteMany({where:{userId:req.params.id,scopeType:'company',companyId:{notIn:input.companyIds}}});
      await tx.userCompany.updateMany({where:{userId:req.params.id},data:{active:false}});
      for(const companyId of input.companyIds)await tx.userCompany.upsert({where:{userId_companyId:{userId:req.params.id,companyId}},create:{userId:req.params.id,companyId},update:{active:true}});
      await tx.user.update({where:{id:req.params.id},data:{authzVersion:{increment:1}}});await tx.platformAudit.create({data:auditData(req.identity.user.id,'MEMBERSHIP_UPDATE','user',req.params.id,{companyIds:input.companyIds,revokedAssignments:revoked.count})});
    },{isolationLevel:'Serializable'});res.status(204).end();
  }));
  router.post('/users/:id/assignments',requirePermission('platform:authorization:manage'),route(async(req,res)=>{
    const input=z.object({roleId:z.string().min(1),companyId:z.string().min(1).nullable().optional()}).strict().parse(req.body);
    const assignment=await db.$transaction(async tx=>{
    const role=await tx.role.findUnique({where:{id:input.roleId},include:{application:true}});if(!role?.active||!role.application.active)throw new ApiFailure(400,'INVALID_ROLE','角色或应用未启用');
    if((role.scopeType==='company'&&!input.companyId)||(role.scopeType==='instance'&&input.companyId))throw new ApiFailure(400,'INVALID_SCOPE','角色的数据范围不正确');
    if(role.scopeType==='company'){
      const membership=await tx.userCompany.findUnique({where:{userId_companyId:{userId:req.params.id,companyId:input.companyId!}},include:{company:true}});
      if(!membership?.active||!membership.company.active)throw new ApiFailure(400,'MEMBERSHIP_REQUIRED','请先授予该公司的成员资格');
    }
    const result=await tx.roleAssignment.create({data:{userId:req.params.id,roleId:role.id,applicationId:role.applicationId,scopeType:role.scopeType,companyId:input.companyId??null}});await tx.user.update({where:{id:req.params.id},data:{authzVersion:{increment:1}}});await tx.platformAudit.create({data:auditData(req.identity.user.id,'AUTHORIZATION_GRANT','assignment',result.id,{userId:req.params.id,roleId:role.id,companyId:input.companyId??null})});return result;},{isolationLevel:'Serializable'});res.status(201).json(assignment);
  }));
  router.delete('/assignments/:id',requirePermission('platform:authorization:manage'),route(async(req,res)=>{
    await db.$transaction(async tx=>{const assignment=await tx.roleAssignment.delete({where:{id:req.params.id}});await tx.user.update({where:{id:assignment.userId},data:{authzVersion:{increment:1}}});await ensureAdministrator(tx);await tx.platformAudit.create({data:auditData(req.identity.user.id,'AUTHORIZATION_REVOKE','assignment',assignment.id,{userId:assignment.userId})});},{isolationLevel:'Serializable'});res.status(204).end();
  }));
  router.get('/audit',requirePermission('platform:audit:view'),route(async(_req,res)=>res.json(await db.platformAudit.findMany({orderBy:{createdAt:'desc'},take:200}))));
}
