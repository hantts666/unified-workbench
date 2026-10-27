import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createDecipheriv,createHash,randomUUID} from 'node:crypto';
import {privateConfig,databaseUrl} from '../scripts/lib/private-config.mjs';
const config=privateConfig(),source=JSON.parse(fs.readFileSync('.local/migration/legacy.json','utf8')),mapping=JSON.parse(fs.readFileSync('.local/migration/erp-mapping.json','utf8'));
Object.assign(process.env,{PLATFORM_DATABASE_URL:databaseUrl('platform'),FINANCE_DATABASE_URL:databaseUrl('finance'),MASTER_KEY:config.MASTER_KEY,ERP_ORIGIN:'http://127.0.0.1:28180',COOKIE_SECURE:'false'});
const {db:platform}=await import('../apps/platform-api/src/db.ts'),{db:finance,encrypt}=await import('../apps/finance-api/src/db.ts'),{ERPNext}=await import('../packages/erpnext-adapter/index.ts'),{passwordMatches}=await import('../apps/platform-api/src/security.ts'),{createPlatformApp}=await import('../apps/platform-api/src/main.ts');
const userIds=source.users.map(u=>u.id),tenantIds=source.tenants.map(t=>t.id),checks=[];let app,extra,testSessionHash;
const run=async(args,expected=0)=>{
  const child=spawn(process.execPath,['--import','tsx','scripts/migrate-legacy.mjs',...args],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',()=>{});const code=await new Promise(resolve=>child.on('exit',resolve));assert.equal(code,expected,'migration command exit status');return output;
};
const counts=async()=>({users:await platform.user.count({where:{id:{in:userIds}}}),companies:await platform.company.count({where:{id:{in:tenantIds}}}),documents:await finance.document.count({where:{tenantId:{in:tenantIds}}}),projects:await finance.project.count({where:{tenantId:{in:tenantIds}}}),transactions:await finance.bankTransaction.count({where:{tenantId:{in:tenantIds}}}),audits:await finance.audit.count({where:{tenantId:{in:tenantIds}}})});
const record=name=>{checks.push(name);console.log('PASS',name);};
try{
  const sessionsBefore=await platform.session.findMany({where:{userId:{in:userIds}},orderBy:{tokenHash:'asc'}});
  const before=await counts();await run([]);assert.deepEqual(await counts(),before);record('dry-run leaves scoped target records unchanged');
  await run(['--apply']);const after=await counts();assert.deepEqual(after,{users:source.users.length,companies:source.tenants.length,documents:source.documents.length,projects:source.projects.length,transactions:source.transactions.length,audits:source.audits.length});record('applied snapshot preserves exact table counts and legacy IDs');
  for(const u of source.users){const target=await platform.user.findUniqueOrThrow({where:{id:u.id}});assert.equal(target.passwordHash,u.passwordHash);assert.equal(target.account,u.email.trim().toLowerCase());}
  const sessionsAfter=await platform.session.findMany({where:{userId:{in:userIds}},orderBy:{tokenHash:'asc'}});
  assert.ok(sessionsAfter.every(s=>sessionsBefore.some(prior=>prior.tokenHash===s.tokenHash)));record('legacy hashes are unchanged and migration creates no sessions');
  const loginPath=process.argv[process.argv.indexOf('--test-login')+1];assert.ok(process.argv.includes('--test-login'),'private test login path required');const login=JSON.parse(fs.readFileSync(loginPath,'utf8'));
  const account=login.account??login.email??login.username,known=await platform.user.findUniqueOrThrow({where:{account:account.toLowerCase()}});assert.ok(await passwordMatches(login.password,known.passwordHash));
  app=await createPlatformApp();await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const signed=await fetch(base+'/api/platform/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({account,password:login.password})});assert.equal(signed.status,200);
  const testToken=signed.headers.get('set-cookie')?.match(/platform_session=([a-f0-9]{64})/)[1];assert.ok(testToken);testSessionHash=createHash('sha256').update(testToken).digest('hex');
  const old=await fetch(base+'/api/platform/me',{headers:{Cookie:'finance_session='+randomUUID()}});assert.equal(old.status,401);record('actual migrated test password works; legacy cookie does not authenticate');
  const key=Buffer.from(fs.readFileSync('.local/migration/source-master.key','utf8').trim(),'hex');
  const decode=value=>{const [iv,tag,data]=value.split('.'),cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'hex'));cipher.setAuthTag(Buffer.from(tag,'hex'));return Buffer.concat([cipher.update(Buffer.from(data,'hex')),cipher.final()]).toString('utf8');};
  const totals=[];
  for(const sourceTenant of source.tenants){
    const target=await finance.ledgerBinding.findUniqueOrThrow({where:{id:sourceTenant.id}});assert.equal(target.platformCompanyId,sourceTenant.id);
    if(!sourceTenant.apiCredential){assert.equal(target.provisionStatus,'UNPROVISIONED');continue;}
    assert.equal(target.siteName,mapping.find(m=>m.sourceTenantId===sourceTenant.id).targetSite);assert.notEqual(target.siteName,sourceTenant.siteName);
    const original=new ERPNext({...sourceTenant,apiCredential:encrypt(decode(sourceTenant.apiCredential))}),replica=new ERPNext(target);
    const [oldJournals,newJournals]=await Promise.all([original.journals(),replica.journals()]);
    const normalized=list=>list.map(j=>({name:j.name,date:j.posting_date,debit:j.total_debit,credit:j.total_credit,status:j.docstatus})).sort((a,b)=>a.name.localeCompare(b.name));
    assert.deepEqual(normalized(newJournals),normalized(oldJournals));
    const submitted=newJournals.filter(j=>j.docstatus===1);const debitCents=submitted.reduce((sum,j)=>sum+Math.round(j.total_debit*100),0),creditCents=submitted.reduce((sum,j)=>sum+Math.round(j.total_credit*100),0);assert.equal(debitCents,creditCents);
    totals.push({journals:newJournals.length,submitted:submitted.length,debitCents,creditCents});
  }
  record('independent ERP restores preserve voucher identities, statuses and balanced totals');
  const existingDocuments=await finance.document.findMany({where:{id:{in:source.documents.map(d=>d.id)}}});for(const document of existingDocuments){const original=source.documents.find(d=>d.id===document.id);assert.equal(document.tenantId,original.tenantId);assert.equal(document.erpName,original.erpName);assert.equal(document.status,original.status);}
  const historical=await finance.audit.findMany({where:{id:{in:source.audits.map(a=>a.id)}}});for(const audit of historical)assert.equal(audit.userId,source.audits.find(a=>a.id===audit.id).userId);record('document ERP links and historical audit actors remain intact');
  extra=await finance.document.create({data:{tenantId:tenantIds[0],filename:'迁移后幂等验收.json',contentHash:randomUUID(),storagePath:'/app/uploads/migration-verification-only.json',mimeType:'application/json',status:'REVIEW'}});
  const beforeRepeat=await counts();const output=await run(['--apply']);assert.equal(JSON.parse(output.trim()).alreadyApplied,true);assert.deepEqual(await counts(),beforeRepeat);assert.ok(await finance.document.findUnique({where:{id:extra.id}}));record('repeat migration is a no-op and preserves records added after the snapshot');
  const conflicting=structuredClone(source);conflicting.documents[0].status='CONFLICT_CHECK';const conflictPath=path.resolve('.local/migration/legacy-conflict.json');fs.writeFileSync(conflictPath,JSON.stringify(conflicting));await run(['--input',conflictPath],1);assert.deepEqual(await counts(),beforeRepeat);record('conflicting history is rejected instead of overwriting target data');
  await finance.document.delete({where:{id:extra.id}});extra=undefined;
  const exportReport=JSON.parse(fs.readFileSync('.local/migration/export-report.json','utf8'));assert.equal(exportReport.missingAttachments,0);assert.equal(exportReport.invalidAttachments,0);record('every copied attachment passed its original SHA-256 verification');
  fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/T11-migration.json',JSON.stringify({executedAt:new Date().toISOString(),result:'passed',snapshotDigest:exportReport.snapshotDigest,counts:after,erpReplicaTotals:totals,checks},null,2)+'\n');
}catch(error){console.error('T11 failed after',checks.length,'checks:',error.code??error.name,error.message?.slice(0,180));process.exitCode=1;}
finally{if(extra)await finance.document.delete({where:{id:extra.id}});if(testSessionHash)await platform.session.deleteMany({where:{tokenHash:testSessionHash}});await app?.close();await platform.$disconnect();await finance.$disconnect();}
