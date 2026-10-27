import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {createContextStore,createScopedClient,validateContext} from '../packages/platform-sdk/index.ts';
const context={applicationCode:'finance',basePath:'/finance',companyId:'sample-a',contextVersion:0,user:{id:'sample-user',displayName:'虚构用户'},permissionCodes:['finance:document:view'],theme:'light'};
const next=(companyId)=>({...context,companyId});

test('SDK 上下文符合 JSON Schema，拒绝敏感字段与跨应用权限',()=>{
  const schema=JSON.parse(fs.readFileSync('contracts/micro-app.schema.json','utf8'));
  const validate=new Ajv2020().compile(schema);
  assert.equal(validate(validateContext(context)),true);
  assert.throws(()=>validateContext({...context,password:'synthetic'}));
  assert.throws(()=>validateContext({...context,permissionCodes:['platform:user:manage']}));
  assert.throws(()=>{validateContext(context).user.id='changed';});
});
test('取消切换保留原公司，移除守卫后只通知有效订阅',async()=>{
  const store=createContextStore(context);let calls=0;
  const unsubscribe=store.subscribe(()=>calls++),removeGuard=store.beforeCompanyChange(()=>false);
  assert.equal(await store.change(next('sample-b')),false);assert.equal(store.getContext().companyId,'sample-a');
  removeGuard();assert.equal(await store.change(next('sample-b')),true);assert.equal(calls,1);
  unsubscribe();await store.change(next('sample-c'));assert.equal(calls,1);store.dispose();
});
test('并发公司切换只接受最后一次请求',async()=>{
  const store=createContextStore(context);const resolvers=[];
  store.beforeCompanyChange(()=>new Promise(resolve=>resolvers.push(resolve)));
  const first=store.change(next('sample-b')),last=store.change(next('sample-c'));
  resolvers[1](true);assert.equal(await last,true);resolvers[0](true);assert.equal(await first,false);
  assert.equal(store.getContext().companyId,'sample-c');assert.equal(store.getContext().contextVersion,1);
});
test('切换公司中断请求，即使传输层忽略取消也丢弃旧响应',async()=>{
  const store=createContextStore(context);let resolveRequest,signal;
  const client=createScopedClient({...store,sessionExpired:()=>{}},async(url,options)=>{assert.equal(url,'/api/finance/companies/sample-a/documents');signal=options.signal;return new Promise(resolve=>resolveRequest=resolve);});
  const request=client.request('documents');
  await store.change(next('sample-b'));assert.equal(signal.aborted,true);
  resolveRequest(new Response(JSON.stringify([{id:'old-company-document'}])));
  await assert.rejects(request,{name:'AbortError'});client.dispose();store.dispose();
});
test('卸载取消进行中的请求且不再发起新请求',async()=>{
  const store=createContextStore(context);let resolveRequest;
  const client=createScopedClient({...store,sessionExpired:()=>{}},async()=>new Promise(resolve=>resolveRequest=resolve));
  const request=client.request('documents');client.dispose();resolveRequest(new Response('{}'));
  await assert.rejects(request,{name:'AbortError'});await assert.rejects(()=>client.request('documents'),{name:'AbortError'});
});
test('401 通知主应用处理统一退出',async()=>{
  const store=createContextStore(context);let expired=0;
  const client=createScopedClient({...store,sessionExpired:()=>expired++},async()=>new Response('{"message":"登录失效"}',{status:401}));
  await assert.rejects(()=>client.request('documents'),/登录失效/);assert.equal(expired,1);client.dispose();
});
