# 数据库表结构

平台 PostgreSQL 与财务 PostgreSQL 使用独立容器、卷和账号。ERPNext 的 MariaDB 由 ERP 管理，平台和财务不跨库访问。金额整数采用分；ERP 返回值以其报表币种为准。

平台 `Company.id` 对应财务 `LedgerBinding.platformCompanyId`；历史财务 `tenantId` 对应 `LedgerBinding.id`。财务审计 `userId` 保留平台用户 ID，无跨库外键。

## 平台库

### User

统一账号，只存密码哈希

| 字段 | 类型 | 约束 / 关系 |
| --- | --- | --- |
| id | `String` | @id @default(cuid()) |
| account | `String` | @unique |
| displayName | `String` | — |
| passwordHash | `String` | — |
| active | `Boolean` | @default(true) |
| authzVersion | `Int` | @default(1) |
| createdAt | `DateTime` | @default(now()) |
| updatedAt | `DateTime` | @updatedAt |
| sessions | `Session[]` | — |
| companies | `UserCompany[]` | — |
| assignments | `RoleAssignment[]` | — |

### Session

统一会话，只存令牌摘要

| 字段 | 类型 | 约束 / 关系 |
| --- | --- | --- |
| tokenHash | `String` | @id |
| userId | `String` | — |
| user | `User` | @relation(fields:[userId], references:[id], onDelete:Cascade) |
| expiresAt | `DateTime` | — |
| revokedAt | `DateTime?` | — |
| createdAt | `DateTime` | @default(now()) |

索引与联合约束：`@@index([userId, expiresAt])`。

### Company

组织内公司

| 字段 | 类型 | 约束 / 关系 |
| --- | --- | --- |
| id | `String` | @id @default(cuid()) |
| name | `String` | — |
| abbreviation | `String` | — |
| taxId | `String` | @default("") |
| active | `Boolean` | @default(true) |
| version | `Int` | @default(1) |
| createdAt | `DateTime` | @default(now()) |
| updatedAt | `DateTime` | @updatedAt |
| members | `UserCompany[]` | — |

### UserCompany

用户的公司成员资格

| 字段 | 类型 | 约束 / 关系 |
| --- | --- | --- |
| userId | `String` | — |
| companyId | `String` | — |
| active | `Boolean` | @default(true) |
| user | `User` | @relation(fields:[userId], references:[id], onDelete:Cascade) |
| company | `Company` | @relation(fields:[companyId], references:[id], onDelete:Restrict) |
| assignments | `RoleAssignment[]` | — |

索引与联合约束：`@@id([userId, companyId])`。

### Application

受信子应用注册

| 字段 | 类型 | 约束 / 关系 |
| --- | --- | --- |
| id | `String` | @id @default(cuid()) |
| code | `String` | @unique |
| name | `String` | — |
| activeRule | `String` | @unique |
| entryKey | `String` | — |
| active | `Boolean` | @default(true) |
| version | `Int` | @default(1) |
| roles | `Role[]` | — |
| permissions | `Permission[]` | — |

### Permission

具体操作权限

| 字段 | 类型 | 约束 / 关系 |
| --- | --- | --- |
| id | `String` | @id @default(cuid()) |
| applicationId | `String` | — |
| application | `Application` | @relation(fields:[applicationId], references:[id], onDelete:Restrict) |
| code | `String` | @unique |
| scopeType | `String` | — |
| description | `String` | @default("") |
| roles | `RolePermission[]` | — |

索引与联合约束：`@@unique([id, applicationId, scopeType])`。

### Role

某应用的角色

| 字段 | 类型 | 约束 / 关系 |
| --- | --- | --- |
| id | `String` | @id @default(cuid()) |
| applicationId | `String` | — |
| application | `Application` | @relation(fields:[applicationId], references:[id], onDelete:Restrict) |
| code | `String` | — |
| name | `String` | — |
| scopeType | `String` | — |
| active | `Boolean` | @default(true) |
| permissions | `RolePermission[]` | — |
| assignments | `RoleAssignment[]` | — |

索引与联合约束：`@@unique([applicationId, code])`；`@@unique([id, applicationId, scopeType])`。

### RolePermission

角色包含的权限，约束应用与范围相符

| 字段 | 类型 | 约束 / 关系 |
| --- | --- | --- |
| roleId | `String` | — |
| permissionId | `String` | — |
| applicationId | `String` | — |
| scopeType | `String` | — |
| role | `Role` | @relation(fields:[roleId, applicationId, scopeType], references:[id, applicationId, scopeType], onDelete:Cascade) |
| permission | `Permission` | @relation(fields:[permissionId, applicationId, scopeType], references:[id, applicationId, scopeType], onDelete:Restrict) |

索引与联合约束：`@@id([roleId, permissionId])`。

### RoleAssignment

用户在指定公司或平台实例内的角色授权

| 字段 | 类型 | 约束 / 关系 |
| --- | --- | --- |
| id | `String` | @id @default(cuid()) |
| userId | `String` | — |
| roleId | `String` | — |
| applicationId | `String` | — |
| scopeType | `String` | — |
| companyId | `String?` | — |
| user | `User` | @relation(fields:[userId], references:[id], onDelete:Cascade) |
| role | `Role` | @relation(fields:[roleId, applicationId, scopeType], references:[id, applicationId, scopeType], onDelete:Restrict) |
| membership | `UserCompany?` | @relation(fields:[userId, companyId], references:[userId, companyId], onDelete:Restrict) |

索引与联合约束：`@@index([userId, applicationId, companyId])`。

### PlatformAudit

平台管理和登录审计

| 字段 | 类型 | 约束 / 关系 |
| --- | --- | --- |
| id | `String` | @id @default(cuid()) |
| actorId | `String` | — |
| action | `String` | — |
| resourceType | `String` | — |
| resourceId | `String` | — |
| detail | `Json` | — |
| createdAt | `DateTime` | @default(now()) |

索引与联合约束：`@@index([actorId, createdAt])`。

## 财务业务库

### LedgerBinding

平台公司与 ERP 账套映射；保留旧账套 ID

| 字段 | 类型 | 约束 / 关系 |
| --- | --- | --- |
| id | `String` | @id @default(cuid()) |
| platformCompanyId | `String` | @unique |
| name | `String` | — |
| abbreviation | `String` | — |
| taxId | `String` | @default("") |
| siteName | `String` | — |
| erpCompany | `String` | — |
| apiCredential | `String` | @default("") |
| active | `Boolean` | @default(true) |
| lockedThrough | `String` | @default("") |
| provisionStatus | `String` | @default("READY") |
| version | `Int` | @default(1) |
| documents | `Document[]` | — |
| projects | `Project[]` | — |
| transactions | `BankTransaction[]` | — |

索引与联合约束：`@@unique([siteName, erpCompany])`。

### Document

单据、解析建议、状态及 ERP 凭证引用

| 字段 | 类型 | 约束 / 关系 |
| --- | --- | --- |
| id | `String` | @id @default(cuid()) |
| tenantId | `String` | — |
| tenant | `LedgerBinding` | @relation(fields:[tenantId], references:[id]) |
| filename | `String` | — |
| contentHash | `String` | — |
| storagePath | `String` | — |
| mimeType | `String` | — |
| status | `String` | @default("PROCESSING") |
| suggestion | `Json?` | — |
| error | `String?` | — |
| erpName | `String?` | — |
| invoiceNumber | `String?` | — |
| processingVersion | `Int` | @default(1) |
| createdAt | `DateTime` | @default(now()) |
| updatedAt | `DateTime` | @updatedAt |

索引与联合约束：`@@unique([tenantId, contentHash])`；`@@unique([tenantId, invoiceNumber])`；`@@index([tenantId, status])`。

### Project

项目、合同和预算

| 字段 | 类型 | 约束 / 关系 |
| --- | --- | --- |
| id | `String` | @id @default(cuid()) |
| tenantId | `String` | — |
| tenant | `LedgerBinding` | @relation(fields:[tenantId], references:[id]) |
| name | `String` | — |
| customer | `String` | — |
| manager | `String` | — |
| contractCents | `Int` | — |
| budgetCents | `Int` | — |
| erpProject | `String?` | — |
| createdAt | `DateTime` | @default(now()) |

索引与联合约束：`@@index([tenantId])`。

### BankTransaction

银行流水及凭证匹配

| 字段 | 类型 | 约束 / 关系 |
| --- | --- | --- |
| id | `String` | @id @default(cuid()) |
| tenantId | `String` | — |
| tenant | `LedgerBinding` | @relation(fields:[tenantId], references:[id]) |
| sourceDocumentId | `String` | — |
| fingerprint | `String` | — |
| date | `String` | — |
| counterparty | `String` | — |
| amountCents | `Int` | — |
| memo | `String` | — |
| matchedErpName | `String?` | — |

索引与联合约束：`@@unique([tenantId, fingerprint])`；`@@index([tenantId])`。

### Audit

财务业务操作审计，用户 ID 只作外部引用

| 字段 | 类型 | 约束 / 关系 |
| --- | --- | --- |
| id | `String` | @id @default(cuid()) |
| tenantId | `String` | — |
| userId | `String` | — |
| actorDisplayNameSnapshot | `String?` | — |
| action | `String` | — |
| resourceId | `String` | — |
| detail | `Json` | — |
| createdAt | `DateTime` | @default(now()) |

索引与联合约束：`@@index([tenantId, createdAt])`。

### ProcessorConfig

解析和 AI 处理器配置

| 字段 | 类型 | 约束 / 关系 |
| --- | --- | --- |
| id | `String` | @id |
| enabled | `Boolean` | @default(true) |
| config | `Json` | — |

## 数据归属

| 内容 | 所属系统 |
| --- | --- |
| 用户、密码、会话、角色、公司成员资格 | 平台库 |
| 原始单据、解析结果、项目预算、银行匹配、操作审计 | 财务库 |
| 会计科目、正式凭证、总账和原生财务报表 | ERPNext |
| 单据原件 | 独立上传卷，财务库记录路径和 SHA-256 |

可执行模型以 `prisma/platform/schema.prisma` 和 `prisma/finance/schema.prisma` 为准，额外数据库约束见各自 migrations。迁移报告不包含密码哈希、密钥或财务原件。
