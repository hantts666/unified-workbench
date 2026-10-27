# 数据模型设计（待实现）

这是目标结构，不是当前服务器实际表结构。数据库迁移脚本在 T03 / T11 实现并演练。

## 平台数据库

ID 使用稳定字符串标识；日期字段使用带时区时间。所有业务授权在服务层校验公司有效、成员有效、应用启用和角色有效。

| 表 | 主要字段 | 约束与索引 |
| --- | --- | --- |
| User | id、account、displayName、passwordHash、active、authzVersion、createdAt、updatedAt | account 唯一；不保存明文密码；旧 id 与哈希保留 |
| Session | tokenHash、userId、expiresAt、revokedAt、createdAt | tokenHash 主键；userId / expiresAt 索引；仅存会话哈希 |
| Company | id、name、abbreviation、taxId、active、version、createdAt、updatedAt | 首次迁移复用旧 Tenant.id；名称不作为跨系统标识 |
| UserCompany | userId、companyId、active | userId + companyId 联合唯一；平台库内外键 |
| Application | id、code、name、activeRule、entryKey、active、version | code 和 activeRule 唯一；entryKey 指向部署受信配置，不接受任意外部 JS 地址 |
| Permission | id、applicationId、code、scopeType、description | code 唯一；scopeType 为 instance / company；命名空间与应用一致 |
| Role | id、applicationId、code、name、active | applicationId + code 唯一 |
| RolePermission | roleId、permissionId | 联合唯一；只能关联同一应用的权限 |
| RoleAssignment | id、userId、roleId、applicationId、scopeType、companyId | company 角色必须指定 companyId；instance 角色必须为空且权限都为 instance；用部分唯一索引防重复 |
| PlatformAudit | id、actorId、action、resourceType、resourceId、detail、createdAt | actorId / createdAt 索引；detail 脱敏；记录登录、授权、停用等操作 |

`applicationId` 可由 roleId 推导，但在授权表保留用于约束与查询；写入时必须验证与 Role.applicationId 一致。空 companyId 不表示所有公司。业务人员新增一家公司时，需要独立授权。

本期平台是单组织安装，不把 Company 充当 SaaS tenant；将来需要多组织时新增独立组织模型及隔离规格。

## 财务业务数据库

| 表 | 主要字段 | 归属与迁移 |
| --- | --- | --- |
| LedgerBinding | id、platformCompanyId、siteName、erpCompany、apiCredential、active、lockedThrough、provisionStatus、version | 由原 Tenant 拆出；id 保留；platformCompanyId 唯一；ERP Site + Company 唯一；密钥仅在财务侧加密保存 |
| Document | id、tenantId、filename、contentHash、storagePath、mimeType、status、suggestion、erpName、createdAt、updatedAt | tenantId 继续引用本库 LedgerBinding.id；公司 + 文件哈希唯一；状态索引保留 |
| Project | id、tenantId、name、customer、manager、contractCents、budgetCents、erpProject | 合同预算留在财务业务库；金额使用整数分 |
| BankTransaction | id、tenantId、sourceDocumentId、fingerprint、date、amountCents、counterparty、memo、matchedErpName | 公司 + 指纹唯一；流水匹配和去重规则保留 |
| Audit | id、tenantId、userId、actorDisplayNameSnapshot、action、resourceId、detail、createdAt | userId 为平台稳定外部 ID，无跨库外键；历史显示快照只补充，不改写旧审计 |
| ProcessorConfig | id、enabled、config | 公司级处理器配置留在财务侧；不迁移到全局平台设置 |

为减少第一次迁移的风险，旧业务表中的 tenantId 暂保留字段名；代码通过 LedgerBinding 解析，不把它解释为新的组织租户 ID。后续字段重命名另做兼容迁移。

## ERPNext 数据库

正式 Company、Account、Journal Entry、GL Entry、Sales/Purchase Invoice、Payment Entry 和 ERP Project 仍归 ERPNext 管理。平台库不复制正式总账，财务服务继续通过 ERP API 读写。

## 关键一致性

- 平台停用公司后，鉴权拒绝其财务操作；财务锁期仍独立生效。
- 公司建档和开账分开，未开账不能记账。失败开账可用同一幂等键重试，不让重试创建重复账套。
- 审计依赖稳定 ID 和必要历史快照，用户停用不删除财务历史。
- 公司更名通过平台版本与幂等同步更新展示资料，不直接改写 ERP 已提交凭证的历史。
