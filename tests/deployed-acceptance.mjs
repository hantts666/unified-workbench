import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const base=process.env.DEPLOYED_TEST_BASE;
assert.ok(base,'DEPLOYED_TEST_BASE is required');
const health=await (await fetch(base+'/api/platform/health')).json();assert.match(health.revision,/^[a-f0-9]{40}$/);
const start=Date.now();
for(const file of ['platform-auth','finance-authorization']){
  const child=spawn(process.execPath,['--import','tsx',`tests/${file}.integration.mjs`],{stdio:'inherit',env:process.env});
  const code=await new Promise(resolve=>child.on('exit',resolve));assert.equal(code,0);
}
const reports=['test-results/T10-auth.json','test-results/T10-finance-authorization.json'].map(file=>{
  assert.ok(fs.statSync(file).mtimeMs>=start,'Acceptance report must come from this run');
  const report=JSON.parse(fs.readFileSync(file));assert.equal(report.result,'passed');return report;
});
fs.writeFileSync('test-results/T10-deployed.json',JSON.stringify({executedAt:new Date().toISOString(),result:'passed',deployedRevision:health.revision,reports},null,2)+'\n');
