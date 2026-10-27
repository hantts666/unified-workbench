import {spawnSync} from 'node:child_process';
import {databaseUrl} from './lib/private-config.mjs';
for(const kind of ['platform','finance']) {
  const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema',`prisma/${kind}/schema.prisma`],{env:{...process.env,[`${kind.toUpperCase()}_DATABASE_URL`]:databaseUrl(kind,true)},encoding:'utf8'});
  // Database URLs and engine errors are never echoed into public reports.
  if(result.status!==0){console.error(`${kind} migration failed; inspect the private environment`);process.exit(1);}
  console.log(`${kind} migrations applied`);
}
