import type {Router,Request,Response,NextFunction} from 'express';
import {z} from 'zod';
import {db} from './db.js';
import {findSession} from './auth.js';
import {sameSecret} from './security.js';
import {ApiFailure,route} from './http.js';
import {trustedApplications} from '../../../packages/contracts/applications.js';

export async function effectivePermissions(userId:string,applicationCode:string,companyId:string|null){
  const application=await db.application.findUnique({where:{code:applicationCode}});
  const user=await db.user.findUnique({where:{id:userId}});
  if(!application?.active||!user?.active)return [];
  const definition=trustedApplications[applicationCode as keyof typeof trustedApplications];
  if(!definition)return [];
  if(definition.scopeType==='company'){
    if(!companyId)return [];
    const member=await db.userCompany.findUnique({where:{userId_companyId:{userId,companyId}},include:{company:true}});
    if(!member?.active||!member.company.active)return [];
  }
  const assignments=await db.roleAssignment.findMany({where:{userId,applicationId:application.id,scopeType:definition.scopeType,companyId:definition.scopeType==='instance'?null:companyId,role:{active:true}},include:{role:{include:{permissions:{include:{permission:true}}}}}});
  return [...new Set(assignments.flatMap(assignment=>assignment.role.permissions.map(item=>item.permission.code)))].sort();
}
export function requirePermission(permission:string){
  return (req:Request,res:Response,next:NextFunction)=>{
    effectivePermissions((req as any).identity.user.id,'platform',null).then(permissions=>{
      if(!permissions.includes(permission))return res.status(403).json({code:'FORBIDDEN',message:'没有此项操作权限'});
      next();
    }).catch(next);
  };
}
export function registerIntrospection(router:Router){
  router.post('/auth/introspect',route(async(req,res)=>{
    const secret=process.env.INTERNAL_SERVICE_SECRET;
    if(!secret||secret.length<32)throw new ApiFailure(503,'AUTH_UNAVAILABLE','鉴权暂时不可用');
    const supplied=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'';
    if(!supplied||!sameSecret(supplied,secret))throw new ApiFailure(401,'SERVICE_UNAUTHENTICATED','服务身份无效');
    const input=z.object({sessionToken:z.string().max(256),applicationCode:z.string(),companyId:z.string().min(1),permissionCode:z.string()}).strict().parse(req.body);
    if(input.applicationCode!=='finance'||!input.permissionCode.startsWith('finance:'))throw new ApiFailure(403,'SERVICE_SCOPE_REJECTED','服务超出授权范围');
    const session=await findSession(input.sessionToken);
    if(!session)return res.json({active:false,allowed:false});
    const permissions=await effectivePermissions(session.userId,input.applicationCode,input.companyId);
    const allowed=input.permissionCode==='finance:application:access'?permissions.length>0:permissions.includes(input.permissionCode);
    res.json({active:true,allowed,subjectId:session.userId,companyId:input.companyId,applicationCode:input.applicationCode,authzVersion:session.user.authzVersion,sessionExpiresAt:session.expiresAt.toISOString()});
  }));
}
