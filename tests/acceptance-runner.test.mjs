import test from 'node:test';
import assert from 'node:assert/strict';
import {Client,runAction} from '../scripts/lib/acceptance-actions.mjs';

const env={ACCEPTANCE_USER:'synthetic-user',ACCEPTANCE_PASSWORD:'synthetic-password'};
const me={id:'synthetic-id',displayName:'虚构用户'};
function response(status,data,cookie=false){return new Response(status===204?null:JSON.stringify(data),{status,headers:cookie?{'Set-Cookie':'platform_session=synthetic-session; HttpOnly; SameSite=Strict; Path=/'}:{}});}

test('验收执行器真实检查登录会话及用户摘要',async()=>{
  const requests=[];
  const client=new Client('http://127.0.0.1:8000',async(url,options)=>{
    requests.push({path:url.pathname,options});
    return response(200,me,url.pathname.endsWith('/login'));
  });
  await runAction('login-and-me',env,client);
  assert.equal(requests[0].path,'/api/platform/auth/login');
  assert.equal(requests[1].options.headers.Cookie,'platform_session=synthetic-session');
  assert.equal(requests[0].options.redirect,'manual');
});

test('对错误状态返回失败，不能把未执行或 200 越权响应算通过',async()=>{
  const client=new Client('http://127.0.0.1:8000',async()=>response(200,me));
  await assert.rejects(()=>runAction('anonymous-me',env,client));
});

test('注销验收保留旧 Cookie 再验证服务器已失效',async()=>{
  let loggedOut=false;
  const client=new Client('http://127.0.0.1:8000',async(url,options)=>{
    if(url.pathname.endsWith('/login'))return response(200,me,true);
    if(url.pathname.endsWith('/logout')){loggedOut=true;return response(204);}
    assert.equal(options.headers.Cookie,'platform_session=synthetic-session');
    return response(loggedOut?401:200,loggedOut?{code:'UNAUTHORIZED',message:'会话失效'}:me);
  });
  await runAction('logout-and-reject-session',env,client);
});

test('跨站拒绝之后仍检查会话存在，避免把错误注销算成通过',async()=>{
  const client=new Client('http://127.0.0.1:8000',async(url,options)=>{
    if(url.pathname.endsWith('/login'))return response(200,me,true);
    if(url.pathname.endsWith('/logout')){assert.equal(options.headers.Origin,'https://attacker.invalid');return response(403);}
    return response(401);
  });
  await assert.rejects(()=>runAction('reject-cross-origin-logout',env,client));
});

test('验收入口禁止带入凭据、路径或跨源跳转',async()=>{
  assert.throws(()=>new Client('https://user:password@example.invalid'));
  assert.throws(()=>new Client('https://example.invalid/private'));
  await assert.rejects(()=>new Client('https://example.invalid').request('https://other.invalid/api'));
});
