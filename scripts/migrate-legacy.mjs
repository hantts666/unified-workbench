import fs from 'node:fs';
import path from 'node:path';
import {createHash,createDecipheriv} from 'node:crypto';
import {privateConfig,databaseUrl} from './lib/private-config.mjs';
const args=process.argv.slice(2),arg=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback,apply=args.includes('--apply');
const input=path.resolve(arg('--input','.local/migration/legacy.json')),mappingFile=path.resolve(arg('--mapping','.local/migration/erp-mapping.json'));
const raw=fs.readFileSync(input),source=JSON.parse(raw),digest=createHash('sha256').update(raw).digest('hex');
const mapping=JSON.parse(fs.readFileSync(mappingFile,'utf8')),config=privateConfig(),sourceKey=Buffer.from(fs.readFileSync(path.join(path.dirname(input),'source-master.key'),'utf8').trim(),'hex');
if(sourceKey.length!==32||source.formatVersion!==1)throw new Error('Unsupported private snapshot');
Object.assign(process.env,{PLATFORM_DATABASE_URL:databaseUrl('platform'),FINANCE_DATABASE_URL:databaseUrl('finance'),MASTER_KEY:config.MASTER_KEY});
const {db:platform}=await import('../apps/platform-api/src/db.ts'),{db:finance,encrypt}=await import('../apps/finance-api/src/db.ts'),{Prisma}=await import('../.generated/finance/index.js'),{seedDefinitions}=await import('../apps/platform-api/src/seed.ts');
const report={executedAt:new Date().toISOString(),mode:apply?'apply':'dry-run',snapshotDigest:digest,counts:{},checks:[],result:'failed'};
const userIds=new Set(source.users.map(u=>u.id)),tenantIds=new Set(source.tenants.map(t=>t.id));
const decode=value=>{const [iv,tag,data]=value.split('.');const cipher=createDecipheriv('aes-256-gcm',sourceKey,Buffer.from(iv,'hex'));cipher.setAuthTag(Buffer.from(tag,'hex'));return Buffer.concat([cipher.update(Buffer.from(data,'hex')),cipher.final()]).toString('utf8');};
const fields=(object,names)=>Object.fromEntries(names.map(name=>[name,object[name]]));
const same=(a,b)=>JSON.stringify(normalize(a))===JSON.stringify(normalize(b));
function normalize(value){if(value instanceof Date)return value.toISOString();if(Array.isArray(value))return value.map(normalize);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,normalize(value[k])]));return value;}
async function checkExisting(model,rows,keys){
  const existing=await model.findMany({where:{id:{in:rows.map(r=>r.id)}}});
  for(const row of existing){const expected=rows.find(item=>item.id===row.id);if(!same(fields(row,keys),fields(expected,keys)))throw new Error('Target contains conflicting historical data; refusing to overwrite');}
}
try{
  for(const key of ['users','tenants','memberships','documents','projects','transactions','audits','processorConfigs']){if(!Array.isArray(source[key]))throw new Error('Snapshot table missing');report.counts[key]=source[key].length;}
  if(userIds.size!==source.users.length||tenantIds.size!==source.tenants.length)throw new Error('Duplicate source identities');
  if(new Set(source.users.map(u=>u.email.trim().toLowerCase())).size!==source.users.length)throw new Error('Case-folded account conflict');
  for(const u of source.users)if(!/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(u.passwordHash))throw new Error('Unsupported legacy password hash');
  for(const m of source.memberships)if(!userIds.has(m.userId)||!tenantIds.has(m.tenantId)||!['admin','reviewer'].includes(m.role))throw new Error('Invalid legacy membership');
  for(const key of ['documents','projects','transactions','audits'])for(const row of source[key])if(!tenantIds.has(row.tenantId))throw new Error('Orphan finance ledger reference');
  for(const row of source.audits)if(!userIds.has(row.userId)&&!['worker','system','seed'].includes(row.userId))throw new Error('Unknown historical actor');
  const docIds=new Set(source.documents.map(d=>d.id));for(const row of source.transactions)if(!docIds.has(row.sourceDocumentId))throw new Error('Orphan bank source document');
  report.checks.push('source IDs, account uniqueness, password hashes, memberships and historical references validated');
  const runId='migration-'+digest,previous=await platform.platformAudit.findUnique({where:{id:runId}});
  if(previous){report.result='passed';report.alreadyApplied=true;report.checks.push('identical snapshot already applied; no record, permission or session overwritten');}
  else{
    const users=source.users.map(u=>({id:u.id,account:u.email.trim().toLowerCase(),displayName:u.name,passwordHash:u.passwordHash,active:true}));
    const companies=source.tenants.map(t=>({id:t.id,name:t.name,abbreviation:t.abbreviation,taxId:t.taxId,active:t.active}));
    const ledgers=source.tenants.map(t=>{
      const replica=mapping.find(m=>m.sourceTenantId===t.id);
      if(t.apiCredential&&(!replica||replica.sourceSite!==t.siteName||!/^unified-migration-[ab]\.localhost$/.test(replica.targetSite)))throw new Error('Connected ledger has no approved isolated ERP replica');
      return {...fields(t,['id','name','abbreviation','taxId','erpCompany','active','lockedThrough']),platformCompanyId:t.id,siteName:replica?.targetSite??t.siteName,apiCredential:t.apiCredential?encrypt(decode(t.apiCredential)):'',provisionStatus:t.apiCredential?'READY':'UNPROVISIONED'};
    });
    const documents=source.documents.map(d=>{
      if(path.posix.dirname(d.storagePath)!==`/app/uploads/${d.tenantId}`)throw new Error('Unexpected source attachment path');
      if(d.suggestion&&(d.suggestion.tenantId!==d.tenantId||d.suggestion.sourceDocumentId!==d.id))throw new Error('Suggestion identity does not match historical document');
      return {...d,createdAt:new Date(d.createdAt),updatedAt:new Date(d.updatedAt)};
    });
    const projects=source.projects.map(p=>({...p,createdAt:new Date(p.createdAt)}));
    const audits=source.audits.map(a=>({...a,createdAt:new Date(a.createdAt),actorDisplayNameSnapshot:source.users.find(u=>u.id===a.userId)?.name??a.userId}));
    const processors=source.processorConfigs.map(p=>{
      if(!source.tenants.some(t=>p.id.startsWith(t.id+':')))throw new Error('Orphan processor configuration');
      const value={...p.config};if(value.apiKey)value.apiKey=encrypt(decode(value.apiKey));return {...p,config:value};
    });
    const collisions=await platform.user.findMany({where:{account:{in:users.map(u=>u.account)},id:{notIn:users.map(u=>u.id)}},select:{id:true}});if(collisions.length)throw new Error('Existing platform account conflicts with a legacy identity');
    await checkExisting(platform.user,users,['id','account','displayName','passwordHash']);await checkExisting(platform.company,companies,['id','name','abbreviation','taxId','active']);
    await checkExisting(finance.ledgerBinding,ledgers,['id','platformCompanyId','siteName','erpCompany']);
    await checkExisting(finance.document,documents,['id','tenantId','contentHash','status','erpName','suggestion','updatedAt']);
    await checkExisting(finance.project,projects,['id','tenantId','name','contractCents','budgetCents','erpProject']);
    await checkExisting(finance.bankTransaction,source.transactions,['id','tenantId','fingerprint','matchedErpName']);
    await checkExisting(finance.audit,audits,['id','tenantId','userId','action','resourceId','detail','createdAt']);
    report.checks.push('target conflicts checked; ledger IDs and historical business references preserved; ERP credentials re-encrypted for replicas');
    if(apply){
      await seedDefinitions();
      const permissions=await platform.permission.findMany({where:{applicationId:'finance',code:{notIn:['finance:voucher:submit','finance:ledger:manage','finance:processor:manage']}}});
      await platform.role.upsert({where:{id:'legacy-finance-reviewer'},create:{id:'legacy-finance-reviewer',applicationId:'finance',scopeType:'company',code:'legacy-finance-reviewer',name:'迁移财务审核员',permissions:{create:permissions.map(p=>({permissionId:p.id}))}},update:{}});
      await platform.$transaction(async tx=>{
        await tx.user.createMany({data:users,skipDuplicates:true});await tx.company.createMany({data:companies,skipDuplicates:true});
        await tx.userCompany.createMany({data:source.memberships.map(m=>({userId:m.userId,companyId:m.tenantId})),skipDuplicates:true});
        await tx.roleAssignment.createMany({data:source.memberships.map(m=>({id:'migration-grant-'+createHash('sha256').update(m.userId+':'+m.tenantId).digest('hex'),userId:m.userId,roleId:m.role==='admin'?'finance-manager':'legacy-finance-reviewer',applicationId:'finance',scopeType:'company',companyId:m.tenantId})),skipDuplicates:true});
        await tx.session.deleteMany({where:{userId:{in:[...userIds]}}});
      },{timeout:30000});
      await finance.$transaction(async tx=>{
        await tx.ledgerBinding.createMany({data:ledgers,skipDuplicates:true});
        await tx.document.createMany({data:documents.map(d=>({...d,suggestion:d.suggestion??Prisma.DbNull})),skipDuplicates:true});
        await tx.project.createMany({data:projects,skipDuplicates:true});await tx.bankTransaction.createMany({data:source.transactions,skipDuplicates:true});
        await tx.audit.createMany({data:audits,skipDuplicates:true});await tx.processorConfig.createMany({data:processors,skipDuplicates:true});
      },{timeout:30000});
      await platform.platformAudit.create({data:{id:runId,actorId:'migration-system',action:'LEGACY_MIGRATION',resourceType:'migration',resourceId:digest,detail:{counts:report.counts,formatVersion:1}}});
      report.checks.push('platform and finance transactions applied separately; source hashes and actor IDs retained; no legacy sessions imported');
    }else report.checks.push('dry-run completed without database mutations');
    report.result='passed';report.alreadyApplied=false;
  }
  fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync(`test-results/migration-${apply?'apply':'plan'}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){console.error('Migration refused:',error.code??error.name,error.message?.startsWith('\n')?'Database rejected the operation':error.message?.slice(0,160));process.exitCode=1;}
finally{await platform.$disconnect();await finance.$disconnect();}
