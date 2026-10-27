# 平台管理接口与授权

浏览器统一使用同源 `/api/platform`，会话由 HttpOnly Cookie 提供。所有写请求校验 Origin；接口不接受客户端传入操作者身份。当前权限每次从平台库读取，无授权缓存。

| 接口 | 用途 | 权限 |
| --- | --- | --- |
| `GET /companies` | 当前用户可用公司 | 已登录 |
| `GET /applications` | 至少在一家公司有权限的已启用应用 | 已登录 |
| `GET /permissions?applicationCode=…&companyId=…` | 当前用户在指定范围的操作权限 | 已登录 |
| `GET, POST /users`、`PATCH /users/:id` | 用户列表、新增、停用和密码重置 | `platform:user:manage` |
| `GET, POST /admin/companies`、`PATCH /admin/companies/:id` | 公司资料与启停 | `platform:company:manage` |
| `GET, POST /admin/applications`、`PATCH /admin/applications/:id` | 受信应用注册与启停 | `platform:application:manage` |
| `GET /admin/permissions`、`GET, POST /roles`、`PATCH /roles/:id` | 应用角色与操作权限 | `platform:role:manage` |
| `GET /users/:id/access` | 用户公司及角色授权 | `platform:authorization:manage` |
| `PUT /users/:id/companies` | 更新公司成员资格 | `platform:authorization:manage` |
| `POST /users/:id/assignments`、`DELETE /assignments/:id` | 授予与撤销角色 | `platform:authorization:manage` |
| `GET /audit` | 最近 200 条平台审计 | `platform:audit:view` |

用户新增需要 `account`、`displayName`、至少 12 字符的 `password`。用户更新可提供 `displayName`、`active`、`password`；停用或重置密码会撤销该用户全部会话。公司新增需要 `name`、`abbreviation`，可选 `taxId`。成员资格以 `{companyIds: string[]}` 更新。

角色新增需要 `applicationId`、`code`、`name`、`permissionCodes`；更新支持 `name`、`active`、`permissionCodes`。同一角色只能包含同一应用和范围的权限。角色授权请求为 `{roleId, companyId?}`：平台角色不指定公司，业务角色必须指定有效公司并先有公司成员资格。

平台、财务和样例应用的入口由部署代码白名单定义，管理接口只编辑名称和启停状态。任意外部 URL 不能注册为应用入口。平台管理应用必须保持启用，最后一个授权管理员不能被移除。数据模型不提供跨库外键。

内部 `/internal/auth/introspect` 只供财务服务调用，不允许由网关发布。服务凭据通过 Authorization Bearer 传递；请求为 `{sessionToken, applicationCode: "finance", companyId, permissionCode}`。返回会话有效性、允许结果、用户 ID、授权版本和有效期，不返回凭据或完整用户资料。无效服务身份返回 401，超出财务范围返回 403；无效会话返回 `{active:false,allowed:false}`。财务端必须失败关闭并继续验证公司账套映射和财务规则。

后端错误使用 `{code,message}`；400 表示输入无效，401 未登录，403 无权限，404 记录不存在，409 重复、关联冲突或最后管理员保护，503 服务暂不可用。响应不含数据库异常原文、密码哈希或密钥。
