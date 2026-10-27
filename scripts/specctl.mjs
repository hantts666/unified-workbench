import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import {parse as parseYaml} from 'yaml';
import {ACTION_NAMES} from './lib/acceptance-actions.mjs';
import {loadModel, validateModel, scopeDigest, approvalState, readyTasks, canStart, validateEvidence, readJson, inside, saveJson} from './lib/spec-model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command = 'status', id] = process.argv.slice(2);
const args = process.argv.slice(3);
const option = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

try {
  const model = loadModel(root);
  const errors = validateModel(root, model, ACTION_NAMES);
  if (errors.length) throw new Error(errors.join('\n'));
  const approval = approvalState(root, model);
  if (command === 'check') {
    await SwaggerParser.validate(structuredClone(model.openapi), {resolve:{external:false}});
    const ajv = new Ajv2020({strict:true});
    ajv.compile(readJson(root, 'contracts/micro-app.schema.json'));
    const skill = fs.readFileSync(inside(root, '.agents/skills/unified-workbench-spec/SKILL.md'), 'utf8');
    const front = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!front) throw new Error('Skill 缺少 YAML frontmatter');
    const metadata = parseYaml(front[1]);
    if (metadata.name !== 'unified-workbench-spec' || !metadata.description) throw new Error('Skill 名称或描述无效');
    if (model.approval.status === 'approved' && !approval.valid) throw new Error(approval.reason);
    for (const [taskId, state] of Object.entries(model.state.tasks)) {
      if (state.status === 'done') {
        const evidenceErrors = validateEvidence(root, model, taskId, readJson(root, state.evidence));
        if (evidenceErrors.length) throw new Error(evidenceErrors.join('\n'));
      }
    }
    console.log(`规格检查通过：${model.spec.requirements.length} 项需求，${model.spec.acceptance.length} 项验收，${model.taskFile.tasks.length} 项任务。`);
    console.log('OpenAPI、上下文 JSON Schema、Skill 元数据与任务图有效；业务验收尚需真实执行证据。');
  } else if (command === 'status') {
    console.log(`SPEC-001 v${model.spec.version} | ${model.approval.status}`);
    console.log(approval.reason);
    console.log(`Scope SHA-256: ${scopeDigest(root, model)}`);
    for (const task of model.taskFile.tasks) console.log(`${task.id} ${(model.state.tasks[task.id]?.status ?? 'pending').padEnd(11)} ${task.title}`);
  } else if (command === 'next') {
    if (!approval.valid) console.log(`BLOCKED: ${approval.reason}。批准后首先执行：${readyTasks(model).map(x=>x.id).join(', ') || '无就绪任务'}`);
    else for (const task of readyTasks(model)) console.log(`${task.id} ${task.title}`);
  } else if (command === 'task') {
    const task = model.taskFile.tasks.find(item => item.id === id);
    if (!task) throw new Error(`未知任务：${id}`);
    console.log(JSON.stringify({...task, status:model.state.tasks[id]?.status ?? 'pending', acceptance:model.spec.acceptance.filter(ac=>task.acceptanceIds.includes(ac.id))}, null, 2));
  } else if (command === 'approve') {
    const reviewer = option('reviewer'), evidence = option('evidence');
    if (!reviewer || !evidence) throw new Error('需要 --reviewer 与 --evidence；仅在人类明确批准后登记');
    if (fs.readFileSync(inside(root, evidence), 'utf8').trim().length < 20) throw new Error('审批证据为空或过短');
    saveJson(root, '.spec/approval.json', {status:'approved', reviewer, approvedAt:new Date().toISOString(), evidence, scopeDigest:scopeDigest(root, model)});
    console.log('已登记当前规格的批准。此记录不能替代真实的人类授权。');
  } else if (command === 'start') {
    canStart(root, model, id);
    model.state.tasks[id] = {status:'in_progress', startedAt:new Date().toISOString()};
    saveJson(root, '.spec/state.json', model.state);
    console.log(`已开始 ${id}`);
  } else if (command === 'complete') {
    if (!approval.valid) throw new Error(approval.reason);
    if (model.state.tasks[id]?.status !== 'in_progress') throw new Error('任务必须先开始再完成');
    const evidencePath = option('evidence');
    const evidence = readJson(root, evidencePath);
    const evidenceErrors = validateEvidence(root, model, id, evidence);
    const git = spawnSync('git', ['rev-parse','HEAD'], {cwd:root, encoding:'utf8'});
    if (git.status !== 0 || evidence.sourceCommit !== git.stdout.trim()) evidenceErrors.push('证据的源码版本不是当前 Git HEAD');
    if (evidenceErrors.length) throw new Error(evidenceErrors.join('\n'));
    model.state.tasks[id] = {...model.state.tasks[id], status:'done', completedAt:new Date().toISOString(), evidence:evidencePath};
    saveJson(root, '.spec/state.json', model.state);
    console.log(`已完成 ${id}，证据：${evidencePath}`);
  } else throw new Error(`未知命令 ${command}`);
} catch (error) {
  console.error(`失败：${error.message}`);
  process.exitCode = 1;
}
