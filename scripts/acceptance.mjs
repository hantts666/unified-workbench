import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client, REQUIRED_ENV, runAction} from './lib/acceptance-actions.mjs';
import {readJson, scopeDigest} from './lib/spec-model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = process.argv[2];
try {
  if (!REQUIRED_ENV[profile]) throw new Error('需要 platform 或 finance 验收配置');
  const missing = REQUIRED_ENV[profile].filter(name=>!process.env[name]);
  if (missing.length) throw new Error(`未执行：缺少 ${missing.join(', ')}。需要后续已部署的隔离测试环境。`);
  if (profile === 'finance' && process.env.ACCEPTANCE_COMPANY_A === process.env.ACCEPTANCE_COMPANY_B) throw new Error('越权测试需要不同的两家公司');
  const definitions = readJson(root, 'contracts/acceptance-cases.json').profiles[profile];
  const results = [];
  for (const c of definitions) {
    try {
      await runAction(c.action,process.env,new Client(process.env.ACCEPTANCE_BASE_URL));
      results.push({caseId:c.id,acceptanceIds:c.acceptanceIds,status:'passed'});
      console.log(`${c.id}: passed`);
    } catch {
      // 断言与响应可能含受保护信息，公共报告只输出用例编号和结果。
      results.push({caseId:c.id,acceptanceIds:c.acceptanceIds,status:'failed'});
      console.error(`${c.id}: failed（核对隔离环境中的服务日志；不输出凭据或响应正文）`);
    }
  }
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  const report = {profile,scopeDigest:scopeDigest(root),executedAt:new Date().toISOString(),results};
  fs.writeFileSync(path.join(root,'test-results',`acceptance-${profile}.json`),JSON.stringify(report,null,2)+'\n');
  if (results.some(item=>item.status !== 'passed')) process.exitCode=1;
} catch (error) {
  console.error(error.message);
  process.exitCode=1;
}
