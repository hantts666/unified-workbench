let acceptanceFailed=false;
import assert from 'node:assert/strict';
import {randomUUID,scryptSync} from 'node:crypto';
import fs from 'node:fs';
import {databaseUrl} from '../scripts/lib/private-config.mjs';
import {Client,runAction} from '../scripts/lib/acceptance-actions.mjs';
process.env.PLATFORM_DATABASE_URL=databaseUrl('platform');
process.env.COOKIE_SECURE='false';
const {db}=await import('../apps/platform-api/src/db.ts');
const {hash,passwordHash,passwordMatches}=await import('../apps/platform-api/src/security.ts');
const {createPlatformApp}=await import('../apps/platform-api/src/main.ts');
const account='qa-auth-'+randomUUID(),password=randomUUID()+'test';
let app,user;const checks=[];
try{
  const legacySalt='a'.repeat(32),legacyHash=legacySalt+':'+scryptSync(password,legacySalt,64).toString('hex');
  assert.equal(await passwordMatches(password,legacyHash),true);assert.equal(await passwordMatches('wrong',legacyHash),false);checks.push('legacy scrypt hashes compatible');
  user=await db.user.create({data:{account,displayName:'虚构认证测试',passwordHash:legacyHash}});
  let base=process.env.DEPLOYED_TEST_BASE;
  if(!base){app=await createPlatformApp();await app.listen(0,'127.0.0.1');base=await app.getUrl();}
  const env={ACCEPTANCE_USER:account,ACCEPTANCE_PASSWORD:password};
  for(const action of ['anonymous-me','login-and-me','reject-cross-origin-logout','logout-and-reject-session']){await runAction(action,env,new Client(base));checks.push(action);}
  const noOrigin=await fetch(base+'/api/platform/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account,password})});assert.equal(noOrigin.status,403);checks.push('missing Origin rejected');
  const expired=new Client(base);await expired.login(account,password);const token=expired.cookie.slice('platform_session='.length);
  assert.equal((await db.session.findUnique({where:{tokenHash:hash(token)}})).tokenHash===token,false);
  await db.session.update({where:{tokenHash:hash(token)},data:{expiresAt:new Date(Date.now()-1000)}});assert.equal((await expired.request('/api/platform/me')).status,401);checks.push('hashed and expiring sessions');
  const disabled=new Client(base);await disabled.login(account,password);await db.user.update({where:{id:user.id},data:{active:false}});assert.equal((await disabled.request('/api/platform/me')).status,401);await db.user.update({where:{id:user.id},data:{active:true}});checks.push('disabled account invalidates active session');
  const first=new Client(base),second=new Client(base);await first.login(account,password);await second.login(account,password);
  const newPassword=randomUUID()+'next';assert.equal((await first.request('/api/platform/auth/password',{method:'POST',body:{current:password,next:newPassword}})).status,204);
  assert.equal((await first.request('/api/platform/me')).status,401);assert.equal((await second.request('/api/platform/me')).status,401);await new Client(base).login(account,newPassword);checks.push('password change revokes every session');
  const limited=new Client(base);for(let i=0;i<10;i++)assert.equal((await limited.request('/api/platform/auth/login',{method:'POST',body:{account,password:'incorrect'}})).status,401);
  assert.equal((await limited.request('/api/platform/auth/login',{method:'POST',body:{account,password:newPassword}})).status,429);checks.push('account login rate limit persisted in database');
  fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync(`test-results/${process.env.DEPLOYED_TEST_BASE?'T10-auth':'T04-auth'}.json`,JSON.stringify({executedAt:new Date().toISOString(),result:'passed',database:'real PostgreSQL test container',transport:process.env.DEPLOYED_TEST_BASE?'deployed Docker gateway':'real HTTP',checks},null,2)+'\n');
  console.log(`T04 authentication passed (${checks.length} checks)`);
}catch(error){console.error('T04 authentication failed:',error.code??error.name, error.message?.slice(0,120));acceptanceFailed=true;process.exitCode=1;}
finally{
  await app?.close();
  if(user){await db.session.deleteMany({where:{userId:user.id}});await db.platformAudit.deleteMany({where:{OR:[{actorId:user.id},{resourceType:'login',resourceId:hash(account)}]}});await db.user.delete({where:{id:user.id}});}
  await db.$disconnect();
if(acceptanceFailed)process.exitCode=1;
}
