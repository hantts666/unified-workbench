# Unified Workbench · 统一工作平台

统一登录、权限、公司与应用管理；通过乾坤承载独立业务子系统。现有财务工作台是首个接入对象。

**当前状态：已获批准，开始按任务实施。** 阶段进度以 `npm run spec:status` 为准；完成的功能须有实际验收证据。

## 先看这三份文件

1. [评审入口](docs/REVIEW.md)：范围、主要决策、实施阶段和待审事项。
2. [产品与验收规格](specs/001-unified-platform/spec.md)：要交付的具体行为。
3. [架构、数据库及迁移方案](specs/001-unified-platform/plan.md)：技术边界和执行顺序。

机器可读规格在 [spec.json](specs/001-unified-platform/spec.json)，任务定义在 [tasks.json](specs/001-unified-platform/tasks.json)，接口契约在 [OpenAPI](contracts/platform.openapi.json)。文档描述设计，运行状态由命令读取，不能把规格检查通过解释为业务验收通过。

## 运行

需要 Node.js 24 LTS 和 npm。规格工具的依赖通过 `npm ci` 安装，当前不需要启动业务服务。

```sh
npm ci
npm run check
npm run spec:status
npm run spec:next
npm run spec:task -- T01
```

Windows 默认 Node 版本较旧时，先安装或切换到 Node 24；不需要启动数据库或连接原财务服务器。

## Spec → 任务 → 执行 → 证据

- `spec:check` 校验需求、验收条件、任务依赖、接口、数据归属和 Skill 引用。
- `spec:next` 给出下一项可做任务；未评审时明确阻止业务任务启动。
- 用户批准后，执行者按 [执行说明](docs/WORKFLOW.md) 记录审批，再启动一项任务。
- `spec:complete` 需要该任务的验收证据，不能只改一个状态就算完成。
- `acceptance:platform` / `acceptance:finance` 对后续真实服务执行 HTTP 验收；当前无服务、无测试凭据时会失败并说明配置缺失。

项目 Skill：[unified-workbench-spec](.agents/skills/unified-workbench-spec/SKILL.md)。在项目中使用 `$unified-workbench-spec`，或让执行代理按根目录 [AGENTS.md](AGENTS.md) 工作。其他工具也可以直接读取 Skill 并执行上述命令。

## 计划中的应用结构

```text
apps/portal-web         主应用：Layout、登录与平台管理页面
apps/platform-api       认证、用户、公司、应用与授权接口
apps/finance-web        财务乾坤子应用
apps/finance-api        财务接口与 ERPNext 适配
apps/finance-worker     文件处理与后台任务
packages/contracts     前后端及子应用契约
packages/platform-sdk  子应用上下文与导航适配
```

以上目录在对应任务启动后建立，当前不放无法运行的应用占位代码。

公共仓库只放代码、规格和虚构测试样例。真实账号、服务器连接资料、财务附件、数据库备份及环境文件均不入库。公开可见不等同于授予开源许可，许可证选择见 [评审入口](docs/REVIEW.md)。
