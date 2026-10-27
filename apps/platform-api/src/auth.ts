import type {Router,Request,Response,NextFunction} from 'express';
import {z} from 'zod';
import {db} from './db.js';
import {hash,newSession,passwordHash,passwordMatches} from './security.js';
import {ApiFailure,route} from './http.js';
const sessionMs=8*60*60*1000;
const cookieOptions=()=>({httpOnly:true,sameSite:'strict' as const,secure:process.env.COOKIE_SECURE==='true',path:'/'});
const dummyHash=await passwordHash(newSession());
export async function findSession(token:unknown){
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return null;
  const session=await db.session.findUnique({where:{tokenHash:hash(token)},include:{user:true}});
  return session&&!session.revokedAt&&session.expiresAt>new Date()&&session.user.active?session:null;
}
export function requireSession(req:Request,res:Response,next:NextFunction){
  findSession(req.cookies?.platform_session).then(session=>{
    if(!session)return res.status(401).json({code:'UNAUTHENTICATED',message:'请先登录'});
    (req as any).identity=session;next();
  }).catch(next);
}
export async function audit(actorId:string,action:string,resourceType:string,resourceId:string,detail:object={}){
  await db.platformAudit.create({data:{actorId,action,resourceType,resourceId,detail}});
}
export function registerAuth(router:Router){
  router.post('/auth/login',route(async(req,res)=>{
    const input=z.object({account:z.string().trim().min(1).max(200),password:z.string().min(1).max(200)}).strict().parse(req.body);
    const account=input.account.toLowerCase(),resourceId=hash(account),since=new Date(Date.now()-15*60*1000);
    const failures=await db.platformAudit.count({where:{action:'AUTH_LOGIN_FAILED',resourceType:'login',resourceId,createdAt:{gte:since}}});
    if(failures>=10)throw new ApiFailure(429,'LOGIN_RATE_LIMIT','尝试过多，请稍后再试');
    const user=await db.user.findUnique({where:{account}});
    const valid=await passwordMatches(input.password,user?.passwordHash??dummyHash);
    if(!user?.active||!valid){await audit('anonymous','AUTH_LOGIN_FAILED','login',resourceId);throw new ApiFailure(401,'INVALID_CREDENTIALS','账号或密码不正确');}
    const token=newSession();
    await db.$transaction([
      db.session.create({data:{tokenHash:hash(token),userId:user.id,expiresAt:new Date(Date.now()+sessionMs)}}),
      db.platformAudit.create({data:{actorId:user.id,action:'AUTH_LOGIN','resourceType':'user',resourceId:user.id,detail:{}}}),
    ]);
    res.cookie('platform_session',token,{...cookieOptions(),maxAge:sessionMs});
    res.json({id:user.id,displayName:user.displayName});
  }));
  router.get('/me',requireSession,route(async(req,res)=>res.json({id:req.identity.user.id,displayName:req.identity.user.displayName})));
  router.post('/auth/logout',requireSession,route(async(req,res)=>{
    await db.$transaction([
      db.session.update({where:{tokenHash:req.identity.tokenHash},data:{revokedAt:new Date()}}),
      db.platformAudit.create({data:{actorId:req.identity.user.id,action:'AUTH_LOGOUT',resourceType:'user',resourceId:req.identity.user.id,detail:{}}}),
    ]);
    res.clearCookie('platform_session',cookieOptions());res.status(204).end();
  }));
  router.post('/auth/password',requireSession,route(async(req,res)=>{
    const input=z.object({current:z.string().min(1).max(200),next:z.string().min(12).max(200)}).strict().parse(req.body);
    if(!await passwordMatches(input.current,req.identity.user.passwordHash))throw new ApiFailure(400,'PASSWORD_MISMATCH','当前密码不正确');
    await db.$transaction([
      db.user.update({where:{id:req.identity.user.id},data:{passwordHash:await passwordHash(input.next),authzVersion:{increment:1}}}),
      db.session.updateMany({where:{userId:req.identity.user.id,revokedAt:null},data:{revokedAt:new Date()}}),
      db.platformAudit.create({data:{actorId:req.identity.user.id,action:'AUTH_PASSWORD_CHANGE',resourceType:'user',resourceId:req.identity.user.id,detail:{}}}),
    ]);
    res.clearCookie('platform_session',cookieOptions());res.status(204).end();
  }));
}
