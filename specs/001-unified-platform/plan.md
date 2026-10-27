# SPEC-001 实施方案

## 结构与技术决策

首期在一个仓库中建设 portal-web、platform-api、finance-web、finance-api、finance-worker、contracts、platform-sdk。统一 Node 24 LTS。应用源码与构建脚本在对应任务开始后加入，各应用独立版本、镜像、数据库账号和发布周期。

平台继续采用 React、TypeScript、Ant Design 和 NestJS，与已有财务代码一致。乾坤版本及子应用构建方案在 T01 根据官方文档和真实 POC 固定；不直接假定 Vite 的 ESM 产物可被乾坤 HTML entry 加载。POC 比较受支持的生命周期导出、动态资源路径、React 19 根节点、刷新和卸载表现；选择可维护方案并写入 ADR，不为接入先升级整套财务依赖。

## 请求与身份链路

```text
浏览器 → 统一网关 → portal-web / finance-web
                 → /api/platform/* → platform-api → platform_db
                 → /api/finance/*  → finance-api  → finance_db
                                                      → ERPNext → 账务库
finance-api → 内网 /internal/auth/introspect → platform-api
```

浏览器只携带统一会话 Cookie。财务服务将会话与目标应用、公司、权限发送给内网鉴权接口，使用独立服务凭据认证；该凭据只接受 finance 应用所需的鉴权请求。网关不路由 `/internal/*`，后端容器不绑定公网端口，不信任外部注入的 user / role 请求头。

鉴权返回 subjectId、授权公司和权限版本；平台管理接口自行执行平台权限。正式提交、授权修改、停用等敏感写入不缓存鉴权，普通读最多缓存 30 秒，并在会话或授权版本变化时失效。不可用时敏感写入失败关闭。

首期是同一个门户内的同源登录。后续接第三方独立系统时可以在独立 Spec 中引入 OIDC，不自行实现一套身份协议。

## 路由与上下文

- 浏览器路由：`/login`、`/platform/*`、`/finance/*`。
- 财务静态入口：`/micro/finance/`；接口：`/api/finance/companies/{companyId}/*`。
- 业务子应用内部维护自己的路由，主应用负责前缀和跨应用导航；`basePath` 通过契约传入。
- Props 只包含只读用户摘要、companyId、用于展示的权限、主题、导航与订阅函数。身份凭据不进入 props 或 localStorage。
- 公司切换采用 beforeCompanyChange → 确认/取消 → 更新上下文版本 → 通知订阅。每次加载绑定 companyId 和 contextVersion，旧响应丢弃。
- 子应用独立开发模式使用同一个认证服务代理，不恢复独立账号系统。

## 数据边界

平台库表和财务库表在 `contracts/data-ownership.json` 定义。平台公司 ID 在首次迁移时复用旧 Tenant ID，财务账套配置保留旧 ID 和原外键，新增 platformCompanyId 显式引用外部标识。旧 Tenant 的 siteName、erpCompany、加密凭据、lockedThrough 留在财务库。

UserCompany 表表示公司成员资格；RoleAssignment 同时绑定应用及业务公司范围，不能仅凭成员资格获得财务权限。Permission 带应用命名空间，角色不能跨应用装配权限。平台级角色与公司级角色使用明确的 scopeType，不把空公司理解为全部公司。管理角色授予和财务提交角色分离。

公司先在平台建档，再通过财务的幂等开账接口绑定账套。失败状态可见且可重试，操作使用幂等键和调用日志，不引入跨库事务。审计记录存 actorId 与必要历史显示快照，用户停用不会删除财务审计。

## 部署

分为 platform、finance、edge 三组 Compose 配置。平台与财务 PostgreSQL 分容器、分网络、分账号、分数据卷；ERPNext 保持专属数据库与 Redis。共享外部入口只连接必要应用服务，数据库不暴露公网。平台会话存平台库，财务任务 Redis 不承担平台会话。

CI 首期只检查规格、工具与公开文件。实现后增加各应用构建、权限隔离测试、浏览器测试和迁移演练。生产部署不由公共仓库 push 自动触发，服务器凭据只通过部署环境注入。

## 阶段与退出条件

1. T01–T03：完成接入 POC、契约与独立数据库定义。
2. T04–T06：统一认证、授权和主应用，可验证公司及应用权限。
3. T07–T10：财务页面、接口与权限迁移，完成接口及浏览器验收。
4. T11–T14：账号迁移演练、财务回归、独立部署、备份恢复与切换。

任务具体依赖以 tasks.json 为准，阶段编号不替代依赖图。
