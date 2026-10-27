# 财务子系统接口与测试

财务服务不维护账号、公司成员和会话表，不提供登录、退出或密码接口。每次请求携带平台会话 Cookie，由财务服务通过内部鉴权接口核对目标公司及操作权限，再将平台公司 ID 映射到财务库的 LedgerBinding。财务代码保留旧账套 ID 与业务表的 tenantId，二者不能与客户端给出的任意标识混用。

## 接口与权限

接口前缀为 `/api/finance/companies/:companyId`。

| 路由 | 方法 | 权限 |
| --- | --- | --- |
| `/context` | GET | 当前公司至少一个有效财务权限 |
| `/ledger`、`/ledger/provision` | GET/PATCH、POST | `finance:ledger:manage` |
| `/documents`、`/documents/:id`、`/documents/:id/file` | GET | `finance:document:view` |
| `/documents`、`/manual-document` | POST | `finance:document:create` |
| `/documents/:id`、`/documents/:id/retry`、`reject`、`draft` | PATCH、POST | `finance:document:review` |
| `/documents/:id/submit` | POST | `finance:voucher:submit` |
| `/accounts` | GET | `finance:account:view` |
| `/journals` | GET | `finance:voucher:view` |
| `/erp-projects` | GET | `finance:document:review` |
| `/reports/:type` | GET | `finance:report:view` |
| `/projects` | GET/POST | `finance:project:manage` |
| `/bank`、`/bank/:id/match` | GET、POST | `finance:bank:manage` |
| `/audit` | GET | `finance:audit:view` |
| `/processors`、`/processors/:id` | GET、PATCH | `finance:processor:manage` |

`finance:application:access` 是内部鉴权的只读聚合查询，表示此公司存在至少一个有效财务权限，只用于读取账套状态；它不是可分配的角色权限，也不授权任何业务写入。接口白名单以 `apps/finance-api/src/authorization.ts` 为准，未列出的路由默认拒绝。

正式提交请求使用 `{confirmation: "确认提交正式账务"}`。财务服务在收到请求时鉴权，在完成分录、期间、原始单据与 ERP 草稿校验之后再次确认权限，再调用 ERP 提交。提交失败、重复提交和并发更新继续遵循原有状态机与 ERP 唯一原始单据引用。拒绝请求不会仅因客户端展示权限而被放行。

## 开账

平台建公司后，财务 `/context` 返回 `UNPROVISIONED`，业务写入拒绝。开账请求必须由具备账套管理权限的用户提交，携带至少 8 字符的 `Idempotency-Key`，以及公司名称、简称、已有 ERP Site、ERP 公司名称和专用 API 凭据。ERP Site 必须位于部署变量 `ERP_ALLOWED_SITES` 的明确白名单。

财务服务先保存 PROVISIONING 状态，实际读取 ERP 公司并确认授权后才设为 READY。连接失败记为 FAILED 并允许使用同一请求重试；成功请求重放返回原映射。同一公司不能重复绑定，同一幂等键不能改变公司或账套信息。密钥以服务器 MASTER_KEY 加密，不返回浏览器或写入审计。界面负责配置已有账套，ERP Site 的基础设施创建由部署工具负责。

## 真实验证

`npm run test:finance-auth` 通过真实平台 API、财务 API、两个 PostgreSQL 容器、Redis 和两个独立 ERPNext 测试 Site 验证权限及开账。测试比较授权服务故障前后的财务记录和 ERP 凭证数量。测试生成随机虚构账号、公司与单据，结束后清理；不要对正在使用的生产账套运行。

本地测试配置从忽略提交的 `.local/server.env` 和 `.local/erp-test.json` 读取。数据库、Redis 和 ERP 都通过本机 SSH 转发访问内部容器；不要把数据库或内部鉴权端口开放到公网。报告位于 `test-results`，人工核对脱敏后再保存到 `evidence/reports`。
