import fs from 'node:fs';
import path from 'node:path';
export function privateConfig(filename='.local/server.env') {
  const absolute=path.resolve(filename);
  if(!fs.existsSync(absolute))throw new Error('Private test configuration is unavailable');
  return Object.fromEntries(fs.readFileSync(absolute,'utf8').split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>{const index=line.indexOf('=');return[line.slice(0,index),line.slice(index+1)];}));
}
export function databaseUrl(kind,owner=false,config=privateConfig()) {
  if(!['platform','finance'].includes(kind))throw new Error('Unknown database');
  const role=`${kind}_${owner?'owner':'app'}`;
  const password=config[`${kind.toUpperCase()}_DB_${owner?'OWNER':'APP'}_PASSWORD`];
  if(!password)throw new Error('Missing private database credential');
  const host=process.env.DATABASE_TEST_HOST??'127.0.0.1';
  const port=kind==='platform'?(process.env.PLATFORM_TEST_PORT??'25432'):(process.env.FINANCE_TEST_PORT??'25433');
  const url=new URL(`postgresql://${host}:${port}/${kind}`);url.username=role;url.password=password;
  // Keep test connections bounded across an SSH tunnel; application deployment sets its own pool.
  url.searchParams.set('connection_limit','3');url.searchParams.set('connect_timeout','15');
  if(kind==='platform'&&process.env.PLATFORM_TEST_SCHEMA){
    if(!/^auth_test_[a-z0-9_]+$/.test(process.env.PLATFORM_TEST_SCHEMA))throw new Error('Invalid isolated auth test schema');
    url.searchParams.set('schema',process.env.PLATFORM_TEST_SCHEMA);
  }
  return url.href;
}
