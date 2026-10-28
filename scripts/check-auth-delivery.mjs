import fs from 'node:fs';
import {authImplementationDigest} from './lib/auth-evidence.mjs';
const spec=JSON.parse(fs.readFileSync('specs/002-auth-permissions/spec.json','utf8'));
if(!fs.readFileSync(spec.approval,'utf8').includes('先给我完善其登录和权限相关功能，自己检查自己完善'))throw Error('Missing actual approval record');
const observed=new Set();
for(const file of spec.reports){
  const report=JSON.parse(fs.readFileSync(file,'utf8'));
  if(report.result!=='passed'||report.implementationDigest!==authImplementationDigest())throw Error('Missing or stale acceptance: '+file);
  if(!Array.isArray(report.checks)||report.checks.length===0||report.pageErrors?.length)throw Error('Incomplete acceptance: '+file);
  for(const check of report.checks)observed.add(check.id);
}
for(const requirement of spec.requirements)if(!observed.has(requirement.id))throw Error('Unverified requirement: '+requirement.id);
console.log('SPEC-002 delivery passed: '+spec.requirements.length+' requirements with matching implementation and real API/browser/deployment evidence.');
