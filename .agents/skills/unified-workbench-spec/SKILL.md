---
name: unified-workbench-spec
description: 在 Unified Workbench 中按可执行规格准备、评审、实现和验收统一登录平台及乾坤财务子系统，读取任务依赖、检查审批范围并记录真实验证证据。适用于本项目的平台化迁移，不用于无关项目。
---

# Unified Workbench Spec 执行

从仓库根目录执行命令。先阅读 `AGENTS.md`，运行 `npm run spec:status` 和 `npm run spec:check`。

## 准备或评审

阅读 `docs/REVIEW.md` 以及 `specs/001-unified-platform/spec.md`、`plan.md`。修改需求时同步 spec.json、tasks.json 与相关接口或数据契约，然后运行 `npm run check`。

用户当前要求审完再开始实现。pending_review 时只做规格、任务和工具准备，不启动业务实现，不伪造审批。用户明确批准后才按 `docs/WORKFLOW.md` 用真实批准记录执行 spec:approve。范围指纹失效时核对实际变更；不能沿用旧批准掩盖新范围。

## 实现

1. 运行 `npm run spec:next`，读取一个依赖满足的任务，再用 `npm run spec:task -- Txx` 获取需求与验收边界。
2. 运行 `npm run spec:start -- Txx`。按任务涉及内容读取 `contracts/`，涉及迁移时再读 `docs/MIGRATION.md`。
3. 平台后端拥有身份和授权，财务后端拥有账套映射和财务规则。Props 与菜单不能替代后端鉴权；库之间只通过服务 API 和外部 ID 关联。
4. 对变更执行对应验证。乾坤验证包含路由刷新、切换公司、卸载清理和弹窗隔离；财务写入验证包含公司、权限、锁期、借贷平衡和幂等。
5. 按 `contracts/evidence.example.json` 的结构记录实际结果，运行 spec:complete；报告未执行项，不把计划或 mock 结果当作真实验收。

## 收尾

运行 `npm run check`，说明完成的任务、实际验证和剩余工作。公开发布前运行 public:audit；不得提交旧项目凭据、环境文件、附件、数据库副本或原始财务响应。实际部署和数据迁移按任务阶段及人类授权执行，当前准备授权不包含生产迁移。
