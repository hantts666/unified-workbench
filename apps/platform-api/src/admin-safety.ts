import {effectivePermissions} from './authorization.js';
import {ApiFailure} from './http.js';

export async function canAuthorize(tx:any,actorId:string){
  return !!await tx.roleAssignment.findFirst({where:{userId:actorId,applicationId:'platform',scopeType:'instance',companyId:null,user:{active:true,mustChangePassword:false},role:{active:true,application:{active:true},permissions:{some:{permission:{code:'platform:authorization:manage'}}}}},select:{id:true}});
}
export async function protectUser(tx:any,actorId:string,targetId:string){
  if(await canAuthorize(tx,actorId))return;
  // Compare assigned permissions, including temporarily disabled accounts/roles. A
  // helpdesk operator must not take over a privileged account by first reactivating it.
  const assignments=await tx.roleAssignment.findMany({where:{userId:targetId},include:{role:{include:{permissions:{include:{permission:true}}}}}});
  for(const assignment of assignments){
    const owned=await effectivePermissions(actorId,assignment.applicationId,assignment.companyId,tx);
    if(assignment.role.permissions.some((p:any)=>!owned.includes(p.permission.code)))throw new ApiFailure(403,'PRIVILEGED_ACCOUNT','此账号的权限超出你的管理范围，请由授权管理员处理');
  }
}
export async function protectRole(tx:any,actorId:string,roleId:string){
  if(await canAuthorize(tx,actorId))return;
  if(await tx.roleAssignment.count({where:{roleId}}))throw new ApiFailure(403,'ASSIGNED_ROLE_PROTECTED','已分配角色的权限或状态只能由授权管理员修改');
}
