import {spawnSync} from 'node:child_process';
import {PrismaClient} from '../.generated/platform/index.js';
import {databaseUrl} from './lib/private-config.mjs';
const schema=process.env.PLATFORM_TEST_SCHEMA;
if(!schema||!/^auth_test_[a-z0-9_]+$/.test(schema))throw Error('Set a dedicated auth_test_ schema; public is never a test target');
const owner=new PrismaClient({datasourceUrl:databaseUrl('platform',true)});
try{
  await owner.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS "'+schema+'" AUTHORIZATION platform_owner');
  await owner.$executeRawUnsafe('GRANT USAGE ON SCHEMA "'+schema+'" TO platform_app');
  await owner.$executeRawUnsafe('ALTER DEFAULT PRIVILEGES IN SCHEMA "'+schema+'" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO platform_app');
  const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema','prisma/platform/schema.prisma'],{env:{...process.env,PLATFORM_DATABASE_URL:databaseUrl('platform',true)},encoding:'utf8'});
  if(result.status!==0)throw Error('Isolated migration failed; no private connection details logged');
  await owner.$executeRawUnsafe('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "'+schema+'" TO platform_app');
  console.log('Isolated authentication test schema is ready; deployed public schema unchanged.');
}finally{await owner.$disconnect();}
