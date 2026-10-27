import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PrismaClient as PlatformClient} from '../.generated/platform/index.js';
import {PrismaClient as FinanceClient} from '../.generated/finance/index.js';
import {databaseUrl} from '../scripts/lib/private-config.mjs';
const platform=new PlatformClient({datasourceUrl:databaseUrl('platform')});
const finance=new FinanceClient({datasourceUrl:databaseUrl('finance')});
const wrongFinanceUrl=new URL(databaseUrl('finance'));wrongFinanceUrl.port=new URL(databaseUrl('platform')).port;wrongFinanceUrl.pathname='/platform';
const wrongPlatformUrl=new URL(databaseUrl('platform'));wrongPlatformUrl.port=new URL(databaseUrl('finance')).port;wrongPlatformUrl.pathname='/finance';
const wrongFinance=new FinanceClient({datasourceUrl:wrongFinanceUrl.href}),wrongPlatform=new PlatformClient({datasourceUrl:wrongPlatformUrl.href});
try{
  const checks=[];
  const pTables=await platform.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
  const fTables=await finance.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
  assert.ok(pTables.some(row=>row.tablename==='User'));assert.ok(!pTables.some(row=>row.tablename==='LedgerBinding'));
  assert.ok(fTables.some(row=>row.tablename==='LedgerBinding'));assert.ok(!fTables.some(row=>row.tablename==='User'));
  checks.push('platform and finance tables physically separated');
  await assert.rejects(()=>wrongFinance.$connect());await assert.rejects(()=>wrongPlatform.$connect());
  checks.push('both cross-database credential attempts rejected');
  for(const client of [platform,finance]){
    const roles=await client.$queryRaw`SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user`;
    assert.deepEqual(roles,[{rolsuper:false,rolcreatedb:false,rolcreaterole:false}]);
    await assert.rejects(()=>client.$executeRawUnsafe('CREATE TABLE "__isolation_probe" (id integer)'));
  }
  checks.push('application roles cannot create tables, roles or databases');
  await platform.user.count();await finance.document.count();
  checks.push('application roles can query their own business tables');
  fs.mkdirSync('test-results',{recursive:true});
  fs.writeFileSync('test-results/T03-database.json',JSON.stringify({executedAt:new Date().toISOString(),result:'passed',checks,platformTableCount:pTables.length,financeTableCount:fTables.length},null,2)+'\n');
  console.log('T03 database isolation checks passed');
}catch{console.error('T03 database isolation failed; inspect private environment');process.exitCode=1;}
finally{await Promise.allSettled([platform,finance,wrongFinance,wrongPlatform].map(client=>client.$disconnect()));}
