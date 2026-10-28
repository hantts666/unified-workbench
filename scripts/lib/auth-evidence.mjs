import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
export function authImplementationDigest(){
  const roots=['apps/platform-api/src','apps/portal-web/src','prisma/platform','infra/nginx','infra/compose'];
  const files=[];
  const walk=dir=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else files.push(file);}};
  roots.forEach(walk);
  const digest=createHash('sha256');
  for(const file of files.sort())digest.update(file.replaceAll('\\','/')+'\0'+fs.readFileSync(file,'utf8').replaceAll('\r\n','\n')+'\0');
  return digest.digest('hex');
}
