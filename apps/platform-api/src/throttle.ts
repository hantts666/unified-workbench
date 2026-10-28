import {db} from './db.js';
import {hash} from './security.js';
import {ApiFailure} from './http.js';

export const throttleKey=(kind:string,value:string)=>kind+':'+hash(value);
// PostgreSQL serializes contenders on each key; a parallel burst cannot bypass the limit.
export async function consumeAttempt(kind:string,value:string,limit:number){
  const key=throttleKey(kind,value);
  const [bucket]=await db.$queryRaw<Array<{attempts:number;expiresAt:Date}>>`
    INSERT INTO "AuthThrottle" ("key","attempts","expiresAt")
    VALUES (${key},1,CURRENT_TIMESTAMP + INTERVAL '15 minutes')
    ON CONFLICT ("key") DO UPDATE SET
      "attempts"=CASE WHEN "AuthThrottle"."expiresAt"<=CURRENT_TIMESTAMP THEN 1 ELSE "AuthThrottle"."attempts"+1 END,
      "expiresAt"=CASE WHEN "AuthThrottle"."expiresAt"<=CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes' ELSE "AuthThrottle"."expiresAt" END
    RETURNING "attempts","expiresAt"`;
  if(bucket.attempts>limit){
    const error=new ApiFailure(429,'LOGIN_RATE_LIMIT','尝试过多，请 15 分钟后重试，或联系管理员解除登录限制');
    error.retryAfter=Math.max(1,Math.ceil((bucket.expiresAt.getTime()-Date.now())/1000));
    throw error;
  }
}
