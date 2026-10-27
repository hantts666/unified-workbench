import {spawnSync} from 'node:child_process';
for(const kind of ['platform','finance']){
  const key=`${kind.toUpperCase()}_DATABASE_URL`;
  const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','generate','--schema',`prisma/${kind}/schema.prisma`],{stdio:'inherit',env:{...process.env,[key]:process.env[key]??`postgresql://127.0.0.1:5432/${kind}`}});
  if(result.status!==0)process.exit(result.status??1);
}
