import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const SECRET_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:postgres(?:ql)?|mysql|mariadb):\/\/[^\s:@]+:[^\s@]+@/i,
  /\bAKIA[A-Z0-9]{16}\b/,
];
const ignored = new Set(['.git','node_modules','.local','.generated','test-results','coverage','dist','playwright-report','__pycache__']);

export function audit(root) {
  const findings=[];
  let files=0;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      if (ignored.has(entry.name)) continue;
      const absolute=path.join(directory,entry.name);
      const relative=path.relative(root,absolute).split(path.sep).join('/');
      if (entry.isSymbolicLink()) {findings.push(`${relative}: 公共项目不允许链接到外部文件`);continue;}
      if (entry.isDirectory()) {walk(absolute);continue;}
      files++;
      const sourceMigration=/^prisma\/[a-z-]+\/migrations\/[a-z0-9_-]+\/migration\.sql$/.test(relative);
      if ((entry.name.startsWith('.env') && entry.name!=='.env.example') || /(?:^|\/)(?:secrets|\.secrets|uploads|backups)\//i.test(relative) || (!sourceMigration && /\.(pem|key|p12|pfx|sql|dump|sqlite3?|db|zip|tar|gz)$/i.test(entry.name))) findings.push(`${relative}: 私密或数据文件类型`);
      const buffer=fs.readFileSync(absolute);
      if (buffer.includes(0)) {findings.push(`${relative}: 未预期二进制文件，请人工审查`);continue;}
      const content=buffer.toString('utf8');
      if (SECRET_PATTERNS.some(pattern=>pattern.test(content))) findings.push(`${relative}: 可能存在真实凭据（内容不输出）`);
    }
  }
  walk(root);
  return {files,findings};
}

const calledDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (calledDirectly) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const result=audit(root);
  if (result.findings.length) {console.error(result.findings.join('\n'));process.exitCode=1;}
  else console.log(`公共文件扫描通过：${result.files} 个文件。仍需人工确认无真实财务资料；模式扫描不能证明不存在所有秘密。`);
}
