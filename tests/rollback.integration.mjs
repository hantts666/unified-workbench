import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {Client} from '../scripts/lib/acceptance-actions.mjs';
const base=process.env.DEPLOYED_TEST_BASE,previous=process.env.ROLLBACK_TEST_REVISION;
assert.ok(base&&/^[a-f0-9]{40}$/.test(previous??''),'Deployed test URL and previous revision required');
const credentials=JSON.parse(fs.readFileSync(process.env.TEST_LOGIN_FILE,'utf8')),client=new Client(base);
await client.login(credentials.account??credentials.email,credentials.password);
const before=(await client.request('/api/platform/health')).data.revision;
assert.notEqual(before,previous,'Rollback must change the running version');
const root='/api/finance/companies/demo-a';
const context=(await client.request(root+'/context')).data;assert.equal(context.siteName,'unified-migration-a.localhost');
const accounts=(await client.request(root+'/accounts')).data;
const bank=accounts.find(a=>a.account_name==='银行存款-测试'),expense=accounts.find(a=>a.account_name==='管理费用-测试');assert.ok(bank&&expense);
const doc=(await client.request(root+'/manual-document',{method:'POST',body:{}})).data;
const suggestion={...doc.suggestion,transactionDate:new Date().toISOString().slice(0,10),counterparty:'虚构回滚验收供应商',amountCents:13579,taxCents:0,entries:[{account:expense.name,debitCents:13579,creditCents:0},{account:bank.name,debitCents:0,creditCents:13579}],reasoningSummary:'隔离环境备份后的新增账务回滚验收'};
assert.equal((await client.request(root+'/documents/'+doc.id,{method:'PATCH',body:suggestion})).status,200);
assert.equal((await client.request(root+'/documents/'+doc.id+'/draft',{method:'POST',body:{}})).status,201);
const submit=await client.request(root+'/documents/'+doc.id+'/submit',{method:'POST',body:{confirmation:'确认提交正式账务'}});assert.equal(submit.status,201);
const vouchersBefore=(await client.request(root+'/journals')).data,documentsBefore=(await client.request(root+'/documents')).data;
const ssh=(command)=>new Promise((resolve,reject)=>{const child=spawn('ssh',['-o','BatchMode=yes',process.env.TEST_SSH_HOST??'tuofei-dev',command],{stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',d=>errors+=d);child.on('exit',code=>code===0?resolve():reject(new Error('Test image rollback command failed; inspect server private logs')));});
let switched=false;
try{
  switched=true;await ssh('python3 /data/projects/unified-workbench/source-current/scripts/rollback-test.py --revision '+previous+' > /data/projects/unified-workbench/private/rollback-test.log 2>&1');
  assert.equal((await client.request('/api/platform/health')).data.revision,previous);
  const current=(await client.request(root+'/documents/'+doc.id)).data;assert.equal(current.status,'SUBMITTED');assert.equal(current.erpName,submit.data.name);
  const vouchersAfter=(await client.request(root+'/journals')).data,documentsAfter=(await client.request(root+'/documents')).data;
  assert.deepEqual(vouchersAfter,vouchersBefore);assert.deepEqual(documentsAfter,documentsBefore);
  assert.equal((await client.request(root+'/documents/'+doc.id+'/submit',{method:'POST',body:{confirmation:'确认提交正式账务'}})).data.name,submit.data.name);
  fs.writeFileSync('test-results/T13-rollback.json',JSON.stringify({executedAt:new Date().toISOString(),result:'passed',fromRevision:before,toRevision:previous,checks:['new formal voucher created after backup','application images rolled back to an earlier compatible revision','all finance documents and ERP vouchers remain unchanged','newly submitted voucher remains idempotent after rollback'],databaseRestorePerformed:false},null,2)+'\n');
}finally{
  if(switched)await ssh('python3 /data/projects/unified-workbench/source-current/scripts/deploy-test.py --skip-build > /data/projects/unified-workbench/private/redeploy-after-rollback.log 2>&1');
}
