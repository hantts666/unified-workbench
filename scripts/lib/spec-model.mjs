import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SPEC_PATH = 'specs/001-unified-platform/spec.json';
export const TASK_PATH = 'specs/001-unified-platform/tasks.json';

export function inside(root, relative, mustExist = true) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.includes('\\')) {
    throw new Error(`必须使用仓库内相对路径：${relative}`);
  }
  const resolved = path.resolve(root, relative);
  const isInside = target => target.startsWith(path.resolve(root) + path.sep);
  if (!isInside(resolved)) throw new Error(`路径越过仓库边界：${relative}`);
  if (mustExist) {
    if (!fs.existsSync(resolved)) throw new Error(`文件不存在：${relative}`);
    const canonicalRoot = fs.realpathSync(root);
    if (!fs.realpathSync(resolved).startsWith(canonicalRoot + path.sep)) throw new Error(`链接越过仓库边界：${relative}`);
  }
  return resolved;
}

export const readJson = (root, name) => JSON.parse(fs.readFileSync(inside(root, name), 'utf8'));
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

export function loadModel(root) {
  return {
    spec: readJson(root, SPEC_PATH),
    taskFile: readJson(root, TASK_PATH),
    openapi: readJson(root, 'contracts/platform.openapi.json'),
    ownership: readJson(root, 'contracts/data-ownership.json'),
    permissions: readJson(root, 'contracts/permissions.json'),
    cases: readJson(root, 'contracts/acceptance-cases.json'),
    approval: readJson(root, '.spec/approval.json'),
    state: readJson(root, '.spec/state.json'),
  };
}

export function scopeDigest(root, model = loadModel(root)) {
  if (!Array.isArray(model.spec.scopeFiles) || !model.spec.scopeFiles.length) throw new Error('规格缺少指纹范围');
  const chunks = [...model.spec.scopeFiles].sort().map(name => `${name}\0${fs.readFileSync(inside(root, name), 'utf8').replace(/\r\n/g, '\n')}\0`);
  return sha256(chunks.join(''));
}

export function operations(openapi) {
  const result = new Map();
  for (const [url, item] of Object.entries(openapi.paths ?? {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      if (item[method]) result.set(item[method].operationId, {url, method, ...item[method]});
    }
  }
  return result;
}

export function validateModel(root, model, actionNames) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const {spec, taskFile, openapi, ownership, cases, state} = model;
  require(['pending_review','approved'].includes(model.approval.status), '审批状态无效');
  const requirements = spec.requirements ?? [];
  const acceptance = spec.acceptance ?? [];
  const tasks = taskFile.tasks ?? [];
  require(spec.id === taskFile.specId, '任务与规格 ID 不一致');
  require(spec.approvalRequiredBeforeImplementation === true, '必须保留用户评审后再实施的约束');
  require(requirements.length > 0 && acceptance.length > 0 && tasks.length > 0, '需求、验收与任务不能为空');
  for (const [label, list, pattern] of [['需求', requirements, /^R\d{2}$/], ['验收', acceptance, /^AC\d{2}$/], ['任务', tasks, /^T\d{2}$/]]) {
    require(new Set(list.map(x => x.id)).size === list.length, `${label} ID 重复`);
    for (const value of list) require(pattern.test(value.id) && typeof value.title === 'string' && value.title.length > 0, `${label}缺少有效 ID 或标题`);
  }
  const requirementIds = new Set(requirements.map(x => x.id));
  const acMap = new Map(acceptance.map(x => [x.id, x]));
  const taskMap = new Map(tasks.map(x => [x.id, x]));
  for (const ac of acceptance) {
    require(requirementIds.has(ac.requirementId), `${ac.id} 引用了不存在的需求`);
    require(['http', 'browser', 'integration', 'review', 'recovery'].includes(ac.kind), `${ac.id} 的验证方式无效`);
    require(tasks.some(task => task.acceptanceIds?.includes(ac.id)), `${ac.id} 没有实施任务`);
    if (ac.kind === 'http') require((cases.profiles[ac.profile] ?? []).some(c => c.acceptanceIds.includes(ac.id)), `${ac.id} 没有可执行 HTTP 用例`);
  }
  for (const req of requirements) {
    require(acceptance.some(ac => ac.requirementId === req.id), `${req.id} 没有验收条件`);
    require(tasks.some(task => task.requirementIds?.includes(req.id)), `${req.id} 没有实施任务`);
  }
  for (const task of tasks) {
    for (const key of ['dependsOn', 'requirementIds', 'acceptanceIds', 'deliverables']) require(Array.isArray(task[key]), `${task.id} 缺少 ${key}`);
    require(task.acceptanceIds?.length > 0 && task.deliverables?.length > 0 && Boolean(task.verification), `${task.id} 缺少交付或验证`);
    for (const dependency of task.dependsOn ?? []) require(taskMap.has(dependency) && dependency !== task.id, `${task.id} 的依赖无效：${dependency}`);
    for (const req of task.requirementIds ?? []) require(requirementIds.has(req), `${task.id} 引用了不存在的需求 ${req}`);
    for (const ac of task.acceptanceIds ?? []) require(acMap.has(ac) && task.requirementIds.includes(acMap.get(ac)?.requirementId), `${task.id} 的验收与需求不对应：${ac}`);
  }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { errors.push(`任务依赖存在循环：${id}`); return; }
    if (visited.has(id) || !taskMap.has(id)) return;
    visiting.add(id);
    for (const dep of taskMap.get(id).dependsOn ?? []) visit(dep);
    visiting.delete(id); visited.add(id);
  }
  tasks.forEach(task => visit(task.id));
  const opList = [];
  for (const item of Object.values(openapi.paths ?? {})) for (const method of ['get','post','put','patch','delete']) if (item[method]) opList.push(item[method]);
  require(opList.every(op => Boolean(op.operationId)), '接口缺少 operationId');
  require(new Set(opList.map(x => x.operationId)).size === opList.length, 'operationId 重复');
  const opMap = operations(openapi);
  const permissions = model.permissions.permissions ?? [];
  const permissionCodes = new Set(permissions.map(item=>item.code));
  require(permissionCodes.size === permissions.length, '权限编码重复');
  for (const permission of permissions) {
    require(/^[a-z][a-z0-9-]*:[a-z-]+:[a-z-]+$/.test(permission.code), '权限编码格式无效');
    require(['instance','company'].includes(permission.scope), `${permission.code} 的数据范围无效`);
  }
  for (const role of model.permissions.roles ?? []) for (const permission of role.permissionCodes ?? []) {
    require(permissionCodes.has(permission), `${role.code} 引用了不存在的权限`);
    require(permission.startsWith(role.applicationCode + ':'), `${role.code} 不允许跨应用装配权限`);
  }
  for (const op of opMap.values()) if (op['x-permission']) require(permissionCodes.has(op['x-permission']), `${op.operationId} 的权限未注册`);
  const allCases = Object.values(cases.profiles ?? {}).flat();
  require(new Set(allCases.map(x => x.id)).size === allCases.length, 'HTTP 用例 ID 重复');
  for (const c of allCases) {
    require(actionNames.has(c.action), `${c.id} 的验收动作没有执行器：${c.action}`);
    require(opMap.has(c.operationId), `${c.id} 引用了不存在的接口`);
    for (const ac of c.acceptanceIds ?? []) require(acMap.has(ac), `${c.id} 引用了不存在的验收 ${ac}`);
  }
  const databases = ownership.databases ?? [];
  require(databases.length === 3, '必须声明平台、财务业务和 ERP 三类数据库');
  for (const field of ['id','container','volume','account']) require(new Set(databases.map(db => db[field])).size === databases.length, `数据库 ${field} 未独立`);
  require(databases.find(db => db.id === 'platform_db')?.ownerService === 'platform-api', '平台库归属不正确');
  require(databases.find(db => db.id === 'finance_db')?.ownerService === 'finance-api', '财务库归属不正确');
  require((ownership.externalReferences ?? []).every(ref => ref.crossDatabaseForeignKey === false), '不允许跨数据库外键');
  for (const [id, entry] of Object.entries(state.tasks ?? {})) {
    require(taskMap.has(id), `状态中存在未知任务 ${id}`);
    require(['pending','in_progress','done'].includes(entry.status), `${id} 状态非法`);
    if (entry.status !== 'pending' && taskMap.has(id)) require(taskMap.get(id).dependsOn.every(dep => state.tasks[dep]?.status === 'done'), `${id} 的前置任务尚未完成`);
    if (entry.status === 'done') require(Boolean(entry.evidence), `${id} 完成状态缺少证据`);
  }
  for (const required of [SPEC_PATH, TASK_PATH, 'contracts/platform.openapi.json','contracts/micro-app.schema.json','contracts/data-ownership.json','contracts/acceptance-cases.json']) require(spec.scopeFiles?.includes(required), `审批指纹未包含 ${required}`);
  try { scopeDigest(root, model); } catch (error) { errors.push(error.message); }
  return errors;
}

export function approvalState(root, model) {
  const approval = model.approval;
  if (approval.status !== 'approved') return {valid:false, reason:'等待用户评审，业务任务尚未获准启动'};
  if (!approval.reviewer || !approval.approvedAt || !approval.evidence) return {valid:false, reason:'审批记录不完整'};
  try {
    const evidence = fs.readFileSync(inside(root, approval.evidence), 'utf8');
    if (evidence.trim().length < 20) return {valid:false, reason:'审批证据为空或过短'};
    const time = Date.parse(approval.approvedAt);
    if (!Number.isFinite(time) || time > Date.now() + 60000) return {valid:false, reason:'审批时间无效'};
    if (approval.scopeDigest !== scopeDigest(root, model)) return {valid:false, reason:'规格已变化，审批指纹失效'};
    return {valid:true, reason:'当前规格已记录用户批准'};
  } catch (error) { return {valid:false, reason:error.message}; }
}

export function readyTasks(model) {
  return model.taskFile.tasks.filter(task => (!model.state.tasks[task.id] || model.state.tasks[task.id].status === 'pending') && task.dependsOn.every(dep => model.state.tasks[dep]?.status === 'done'));
}

export function canStart(root, model, id) {
  const approval = approvalState(root, model);
  if (!approval.valid) throw new Error(approval.reason);
  const task = model.taskFile.tasks.find(item => item.id === id);
  if (!task) throw new Error(`未知任务：${id}`);
  if (model.state.tasks[id]?.status && model.state.tasks[id].status !== 'pending') throw new Error(`${id} 不是待开始状态`);
  if (!readyTasks(model).some(item => item.id === id)) throw new Error(`${id} 的依赖尚未完成`);
  return task;
}

export function validateEvidence(root, model, id, evidence) {
  const errors = [];
  const task = model.taskFile.tasks.find(item => item.id === id);
  if (!task) return [`未知任务 ${id}`];
  if (evidence.exampleOnly) errors.push('示例不能作为执行证据');
  if (evidence.taskId !== id) errors.push('证据与任务不一致');
  if (evidence.specDigest !== scopeDigest(root, model)) errors.push('证据不是针对当前规格');
  if (!/^[a-f0-9]{40}$/.test(evidence.sourceCommit ?? '')) errors.push('缺少源码 commit SHA');
  const time = Date.parse(evidence.executedAt);
  if (!Number.isFinite(time) || time > Date.now() + 60000 || time < Date.parse(model.approval.approvedAt)) errors.push('证据执行时间无效或早于审批');
  const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
  if (new Set(checks.map(item => item.acceptanceId)).size !== checks.length) errors.push('证据中的验收 ID 重复');
  for (const ac of task.acceptanceIds) {
    const check = checks.find(item => item.acceptanceId === ac);
    if (!check || check.status !== 'passed' || check.exitCode !== 0 || !check.command?.trim()) {errors.push(`${ac} 没有成功执行的记录`); continue;}
    try {
      const content = fs.readFileSync(inside(root, check.report));
      if (content.length === 0 || check.reportSha256 !== sha256(content)) errors.push(`${ac} 的报告为空或校验值不一致`);
    } catch (error) {errors.push(`${ac}: ${error.message}`);}
  }
  return errors;
}

export function saveJson(root, name, value) {
  const target = inside(root, name);
  const temporary = target + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, target);
}
