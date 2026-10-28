import type {Request,Response,NextFunction,RequestHandler} from 'express';
export class ApiFailure extends Error {status:number;code:string;retryAfter?:number;constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}}
export const route=(handler:(req:any,res:Response)=>Promise<any>):RequestHandler=>(req,res,next)=>{Promise.resolve(handler(req,res)).catch(next);};
export function requireOrigin(req:Request,res:Response,next:NextFunction){
  if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
  try{
    const raw=req.headers.origin;
    const expected=(process.env.COOKIE_SECURE==='true'?'https':'http')+'://'+req.headers.host;
    if(!raw||raw!==expected||req.headers['sec-fetch-site']==='cross-site')throw new Error();
    next();
  }catch{res.status(403).json({code:'ORIGIN_REJECTED',message:'请求来源不匹配'});}
}
export function errors(error:any,req:Request,res:Response,next:NextFunction){
  if(res.headersSent)return next(error);
  if(error instanceof ApiFailure){if(error.retryAfter)res.setHeader('Retry-After',error.retryAfter);return res.status(error.status).json({code:error.code,message:error.message});}
  if(error?.name==='ZodError')return res.status(400).json({code:'INVALID_INPUT',message:'请检查填写内容'});
  if(error?.code==='P2002')return res.status(409).json({code:'ALREADY_EXISTS',message:'记录已经存在'});
  if(error?.code==='P2025')return res.status(404).json({code:'NOT_FOUND',message:'记录不存在'});
  if(error?.code==='P2003')return res.status(409).json({code:'INVALID_RELATION',message:'关联记录不匹配'});
  if(error?.code==='P2034')return res.status(409).json({code:'CONCURRENT_CHANGE',message:'资料刚被其他人修改，请刷新后重试'});
  res.status(503).json({code:'SERVICE_UNAVAILABLE',message:'服务暂时不可用，请稍后重试'});
}
