import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {ACTION_NAMES} from '../scripts/lib/acceptance-actions.mjs';
import {loadModel,validateModel,scopeDigest,approvalState,canStart,validateEvidence,sha256,inside} from '../scripts/lib/spec-model.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

function fixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'unified-spec-test-'));
  const original=loadModel(root);
  for(const name of [...original.spec.scopeFiles,'.spec/approval.json','.spec/state.json']) {
    const target=path.join(directory,name);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(path.join(root,name),target);
  }
  t.after(()=>{
    assert.ok(path.resolve(directory).startsWith(path.join(os.tmpdir(),'unified-spec-test-')));
    fs.rmSync(directory,{recursive:true,force:true});
  });
  const model=loadModel(directory);
  model.approval={status:'pending_review'};
  model.state={tasks:{}};
  return {directory,model};
}

function syntheticApproval(directory,model) {
  fs.mkdirSync(path.join(directory,'evidence'),{recursive:true});
  fs.writeFileSync(path.join(directory,'evidence','synthetic-review.md'),'Synthetic unit-test approval; never used to authorize the actual repository.');
  model.approval={status:'approved',reviewer:'synthetic-test-only',approvedAt:new Date(Date.now()-1000).toISOString(),evidence:'evidence/synthetic-review.md',scopeDigest:scopeDigest(directory,model)};
}

test('准备规格的需求、任务、接口及执行器能够相互追溯',()=>{
  assert.deepEqual(validateModel(root,loadModel(root),ACTION_NAMES),[]);
});

test('未获批准时拒绝启动业务任务且不修改状态',t=>{
  const {directory,model}=fixture(t);
  const state=JSON.stringify(model.state);
  assert.throws(()=>canStart(directory,model,'T01'),/等待用户评审/);
  assert.equal(JSON.stringify(model.state),state);
});

test('新增需求没有任务或验收时检查失败',()=>{
  const model=loadModel(root);
  model.spec.requirements.push({id:'R99',title:'没有实现路径的需求'});
  const errors=validateModel(root,model,ACTION_NAMES);
  assert.ok(errors.some(error=>error.includes('R99 没有验收')));
  assert.ok(errors.some(error=>error.includes('R99 没有实施')));
});

test('循环依赖与未实现的 HTTP 执行器会被发现',()=>{
  const model=loadModel(root);
  model.taskFile.tasks[0].dependsOn=['T14'];
  model.cases.profiles.platform[0].action='nonexistent-action';
  const errors=validateModel(root,model,ACTION_NAMES);
  assert.ok(errors.some(error=>error.includes('循环')));
  assert.ok(errors.some(error=>error.includes('没有执行器')));
});

test('平台和财务不能误用同一数据库账号或数据卷',()=>{
  const model=loadModel(root);
  model.ownership.databases[1].account=model.ownership.databases[0].account;
  model.ownership.databases[1].volume=model.ownership.databases[0].volume;
  assert.ok(validateModel(root,model,ACTION_NAMES).some(error=>error.includes('account 未独立')));
  assert.ok(validateModel(root,model,ACTION_NAMES).some(error=>error.includes('volume 未独立')));
});

test('平台角色不能混入财务权限，接口不能引用未注册权限',()=>{
  const model=loadModel(root);
  model.permissions.roles[0].permissionCodes.push('finance:voucher:submit');
  model.openapi.paths['/api/finance/companies/{companyId}/documents'].get['x-permission']='finance:missing:permission';
  const errors=validateModel(root,model,ACTION_NAMES);
  assert.ok(errors.some(error=>error.includes('不允许跨应用')));
  assert.ok(errors.some(error=>error.includes('权限未注册')));
});

test('审批绑定文件内容；改动范围后不能启动任务',t=>{
  const {directory,model}=fixture(t);
  syntheticApproval(directory,model);
  assert.equal(approvalState(directory,model).valid,true);
  assert.equal(canStart(directory,model,'T01').id,'T01');
  fs.appendFileSync(path.join(directory,'specs/001-unified-platform/spec.md'),'\nChanged scope in synthetic test.\n');
  assert.equal(approvalState(directory,model).valid,false);
  assert.throws(()=>canStart(directory,model,'T01'),/指纹失效/);
});

test('有审批仍然不能越过前置任务',t=>{
  const {directory,model}=fixture(t);
  syntheticApproval(directory,model);
  assert.throws(()=>canStart(directory,model,'T02'),/依赖尚未完成/);
  model.state.tasks.T01={status:'done'};
  assert.equal(canStart(directory,model,'T02').id,'T02');
});

test('示例、缺项、未执行和被篡改报告不能作为完成证据',t=>{
  const {directory,model}=fixture(t);
  syntheticApproval(directory,model);
  const report='Synthetic tool validation only; not business acceptance.';
  fs.writeFileSync(path.join(directory,'evidence','synthetic-report.txt'),report);
  const evidence={taskId:'T01',specDigest:scopeDigest(directory,model),sourceCommit:'a'.repeat(40),executedAt:new Date().toISOString(),checks:[{acceptanceId:'AC26',status:'passed',command:'synthetic-test',exitCode:0,report:'evidence/synthetic-report.txt',reportSha256:sha256(report)}]};
  assert.deepEqual(validateEvidence(directory,model,'T01',evidence),[]);
  assert.ok(validateEvidence(directory,model,'T01',{...evidence,exampleOnly:true}).some(error=>error.includes('示例')));
  assert.ok(validateEvidence(directory,model,'T01',{...evidence,checks:[]}).some(error=>error.includes('没有成功')));
  evidence.checks[0].exitCode=1;
  assert.ok(validateEvidence(directory,model,'T01',evidence).some(error=>error.includes('没有成功')));
  evidence.checks[0].exitCode=0;
  fs.appendFileSync(path.join(directory,'evidence','synthetic-report.txt'),' changed');
  assert.ok(validateEvidence(directory,model,'T01',evidence).some(error=>error.includes('校验值')));
});

test('证据路径不能读取仓库以外的文件',()=>{
  assert.throws(()=>inside(root,'../finance-workbench/package.json'),/越过仓库/);
  assert.throws(()=>inside(root,'C:/private/file'),/相对路径/);
});

test('子应用上下文拒绝凭据和无效公司',()=>{
  const ajv=new Ajv2020({strict:true});
  const validate=ajv.compile(JSON.parse(fs.readFileSync(path.join(root,'contracts/micro-app.schema.json'),'utf8')));
  const context={applicationCode:'finance',basePath:'/finance',companyId:'sample-a',contextVersion:0,user:{id:'sample-user',displayName:'示例用户'},permissionCodes:['finance:document:view'],theme:'light'};
  assert.equal(validate(context),true);
  assert.equal(validate({...context,sessionToken:'synthetic-context-value'}),false);
  assert.equal(validate({...context,companyId:''}),false);
});
