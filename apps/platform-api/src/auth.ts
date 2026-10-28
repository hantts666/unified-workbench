import type {Router,Request,Response,NextFunction} from 'express';
import {z} from 'zod';
import {db} from './db.js';
import {hash,newSession,passwordHash,passwordMatches} from './security.js';
import {ApiFailure,route} from './http.js';
import {consumeAttempt,throttleKey} from './throttle.js';
const sessionMs=8*60*60*1000;
const cookieOptions=()=>({httpOnly:true,sameSite:'strict' as const,secure:process.env.COOKIE_SECURE==='true',path:'/'});
const dummyHash=await passwordHash(newSession());
export async function findSession(token:unknown){
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return null;
  const session=await db.session.findUnique({where:{tokenHash:hash(token)},include:{user:true}});
  return session&&!session.revokedAt&&session.expiresAt>new Date()&&session.user.active?session:null;
}
export function requireIdentity(req:Request,res:Response,next:NextFunction){
  findSession(req.cookies?.platform_session).then(session=>{
    if(!session)return res.status(401).json({code:'UNAUTHENTICATED',message:'登录已失效，请重新登录'});
    (req as any).identity=session;next();
  }).catch(next);
}
export function requireSession(req:Request,res:Response,next:NextFunction){
  requireIdentity(req,res,(error?:any)=>{
    if(error)return next(error);
    if((req as any).identity.user.mustChangePassword)return res.status(403).json({code:'PASSWORD_CHANGE_REQUIRED',message:'请先修改初始或重置后的密码'});
    next();
  });
}
export async function audit(actorId:string,action:string,resourceType:string,resourceId:string,detail:object={}){
  await db.platformAudit.create({data:{actorId,action,resourceType,resourceId,detail}});
}
export function registerAuth(router:Router){
  router.post('/auth/login',route(async(req,res)=>{
    const input=z.object({account:z.string().trim().min(1).max(200),password:z.string().min(1).max(200)}).strict().parse(req.body);
    const account=input.account.toLowerCase();
    await consumeAttempt('login-ip',req.ip??req.socket.remoteAddress??'unknown',120);
    await consumeAttempt('login-account',account,10);
    const user=await db.user.findUnique({where:{account}});
    const valid=await passwordMatches(input.password,user?.passwordHash??dummyHash);
    if(!user?.active||!valid){await audit('anonymous','AUTH_LOGIN_FAILED','login',hash(account));throw new ApiFailure(401,'INVALID_CREDENTIALS','账号或密码不正确');}
    const token=newSession(),now=new Date();
    await db.$transaction(async tx=>{
      // Lock the credential row: a concurrent reset either prevents login or revokes this session.
      const accepted=await tx.user.updateMany({where:{id:user.id,active:true,passwordHash:user.passwordHash},data:{lastLoginAt:now}});
      if(!accepted.count)throw new ApiFailure(401,'INVALID_CREDENTIALS','账号或密码不正确');
      const oldToken=req.cookies?.platform_session;
      if(typeof oldToken==='string')await tx.session.updateMany({where:{tokenHash:hash(oldToken),userId:user.id,revokedAt:null},data:{revokedAt:now}});
      const previous=await tx.session.findMany({where:{userId:user.id,revokedAt:null,expiresAt:{gt:now}},orderBy:{createdAt:'desc'},skip:9,select:{tokenHash:true}});
      if(previous.length)await tx.session.updateMany({where:{tokenHash:{in:previous.map(s=>s.tokenHash)}},data:{revokedAt:now}});
      await tx.session.create({data:{tokenHash:hash(token),userId:user.id,expiresAt:new Date(now.getTime()+sessionMs),userAgent:(req.get('user-agent')??'未知设备').slice(0,300)}});
      await tx.authThrottle.deleteMany({where:{key:throttleKey('login-account',account)}});
      await tx.platformAudit.create({data:{actorId:user.id,action:'AUTH_LOGIN',resourceType:'user',resourceId:user.id,detail:{}}});
    });
    res.cookie('platform_session',token,{...cookieOptions(),maxAge:sessionMs});
    res.json({id:user.id,displayName:user.displayName});
  }));
  router.get('/me',requireIdentity,route(async(req,res)=>{
    const u=req.identity.user;
    res.json({id:u.id,account:u.account,displayName:u.displayName,authzVersion:u.authzVersion,mustChangePassword:u.mustChangePassword,lastLoginAt:u.lastLoginAt,sessionExpiresAt:req.identity.expiresAt});
  }));
  // Even a revoked cookie can always be cleared.
  router.post('/auth/logout',route(async(req,res)=>{
    const session=await findSession(req.cookies?.platform_session);
    if(session)await db.$transaction([
      db.session.update({where:{tokenHash:session.tokenHash},data:{revokedAt:new Date()}}),
      db.platformAudit.create({data:{actorId:session.userId,action:'AUTH_LOGOUT',resourceType:'user',resourceId:session.userId,detail:{}}}),
    ]);
    res.clearCookie('platform_session',cookieOptions());res.status(204).end();
  }));
  router.post('/auth/password',requireIdentity,route(async(req,res)=>{
    const input=z.object({current:z.string().min(1).max(200),next:z.string().min(12).max(200)}).strict().parse(req.body);
    await consumeAttempt('password-change',req.identity.user.id,10);
    if(!await passwordMatches(input.current,req.identity.user.passwordHash))throw new ApiFailure(400,'PASSWORD_MISMATCH','当前密码不正确');
    if(input.current===input.next)throw new ApiFailure(400,'PASSWORD_UNCHANGED','新密码不能与当前密码相同');
    const nextHash=await passwordHash(input.next);
    await db.$transaction(async tx=>{
      const result=await tx.user.updateMany({where:{id:req.identity.user.id,active:true,passwordHash:req.identity.user.passwordHash},data:{passwordHash:nextHash,mustChangePassword:false,authzVersion:{increment:1}}});
      if(!result.count)throw new ApiFailure(409,'CREDENTIAL_CHANGED','密码已被修改，请重新登录');
      await tx.session.updateMany({where:{userId:req.identity.user.id,revokedAt:null},data:{revokedAt:new Date()}});
      await tx.authThrottle.deleteMany({where:{key:{in:[throttleKey('password-change',req.identity.user.id),throttleKey('login-account',req.identity.user.account)]}}});
      await tx.platformAudit.create({data:{actorId:req.identity.user.id,action:'AUTH_PASSWORD_CHANGE',resourceType:'user',resourceId:req.identity.user.id,detail:{}}});
    });
    res.clearCookie('platform_session',cookieOptions());res.status(204).end();
  }));
  router.get('/auth/sessions',requireIdentity,route(async(req,res)=>{
    const sessions=await db.session.findMany({where:{userId:req.identity.user.id,revokedAt:null,expiresAt:{gt:new Date()}},select:{id:true,userAgent:true,createdAt:true,expiresAt:true},orderBy:{createdAt:'desc'},take:10});
    res.json(sessions.map(s=>({...s,current:s.id===req.identity.id})));
  }));
  router.post('/auth/sessions/revoke-others',requireIdentity,route(async(req,res)=>{
    await db.$transaction([
      db.session.updateMany({where:{userId:req.identity.user.id,id:{not:req.identity.id},revokedAt:null},data:{revokedAt:new Date()}}),
      db.platformAudit.create({data:{actorId:req.identity.user.id,action:'AUTH_REVOKE_OTHERS',resourceType:'user',resourceId:req.identity.user.id,detail:{}}}),
    ]);res.status(204).end();
  }));
  router.delete('/auth/sessions/:id',requireIdentity,route(async(req,res)=>{
    await db.$transaction(async tx=>{
      const result=await tx.session.updateMany({where:{id:req.params.id,userId:req.identity.user.id,revokedAt:null,expiresAt:{gt:new Date()}},data:{revokedAt:new Date()}});
      if(!result.count)throw new ApiFailure(404,'NOT_FOUND','登录记录不存在或已失效');
      await tx.platformAudit.create({data:{actorId:req.identity.user.id,action:'AUTH_REVOKE_SESSION',resourceType:'session',resourceId:req.params.id,detail:{}}});
    });
    if(req.params.id===req.identity.id)res.clearCookie('platform_session',cookieOptions());
    res.status(204).end();
  }));
}
