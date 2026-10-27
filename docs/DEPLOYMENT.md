# 独立测试部署与运维

## 部署边界

当前部署分为 11 个容器：平台数据库、财务数据库、财务 Redis、平台 API、财务 API、财务 worker、门户前端、财务前端、示例前端、统一网关、ERP 访问代理。数据库没有主机公开端口。

ERPNext 是既有独立会计引擎。本测试环境通过受限代理连接 `unified-a/b.localhost` 和 `unified-migration-a/b.localhost` 四个测试站点；不允许通过代理访问原站点。

平台服务只持有平台数据库凭据；财务服务只持有财务数据库凭据。内部认证接口由财务服务凭据调用，网关不开放 `/internal`。上传卷同时供财务 API 和 worker 使用，镜像中没有上传内容。

## 从新环境启动

需要 Linux、Docker Engine / Compose、Python 3，以及已经准备好的 ERPNext 16 测试站点和专用网络。构建机可访问 npm 和镜像仓库。开发或执行浏览器验收还需要 Node 24、npm 和 Chromium / Edge。

1. 将已提交的代码导出到项目目录的 `releases/<完整提交SHA>`，写入 `.source-revision`，建立 `source-current` 链接。仓库提供 `scripts/sync-source.ps1`，从 Windows 通过既有 SSH 配置传输已提交版本。
2. 仅第一次运行 `python3 source-current/scripts/prepare-test-env.py --root <项目目录> --stack unified-workbench --port 3200 --bind 127.0.0.1`。该命令生成私有 `.env`，不覆盖现有文件，不打印密码。按实际入口调整 bind；公网测试需放行相应端口。
3. 运行 `python3 source-current/scripts/initialize-data.py --root <项目目录>`，建立两套数据库、Redis 并执行各自迁移。数据库 owner 连接只供迁移使用。
4. 为受控测试 ERP 设置专用账号和凭据。已有历史需要按 `MIGRATION-REHEARSAL.md` 先迁移到独立副本；不要把原站点填进代理白名单。
5. 运行 `python3 source-current/scripts/deploy-test.py --root <项目目录>`。脚本构建各镜像，使用应用账号启动服务，复制已有演练附件，确认两项健康检查版本一致后更新 `app-current`，保留 `app-previous`。
6. 首次管理账号由 `.env` 的 BOOTSTRAP_ACCOUNT / BOOTSTRAP_PASSWORD 创建。管理员登录后创建公司、用户、成员资格和角色授权。已有账号不被启动过程覆盖。

新建空环境可另用 `--stack unified-clean` 与独立目录、端口；必须重新生成凭据，不能指向已有数据卷。仅初始化空库不会产生财务账套。

## 本机开发与验收

```sh
npm ci
npm run db:generate
npm run typecheck
npm run check
npm run build:portal
npm run build:finance
npm run build:sample
```

真实集成测试从忽略目录 `.local/server.env` 读取私有配置。默认数据库隧道端口为 25432 / 25433，Redis 为 26379，ERP 后端为 28180；只在授权机器上建立这些 SSH 隧道。测试不是虚拟接口，须先确认连接的是独立环境。

部署后设置 `DEPLOYED_TEST_BASE` 为测试网关地址，运行 `npm run test:deployed`。该测试会短暂停止本项目的测试平台 API，以验证授权故障时财务不能写入。不要对正式环境运行。

财务回归另设 `TEST_LOGIN_FILE` 指向私有登录文件，运行 `npm run test:finance-regression`。脚本要求账套指向演练副本，生成虚构凭证并保留用于核对。报告位于 test-results，公开证据须脱敏后保存。

## 备份与隔离恢复

- `backup-test.py --root <项目目录> --output <项目目录>/private/<新备份目录>` 短暂停止本项目的 API 和 worker，备份两个 PostgreSQL、ERP 副本站点、附件、Redis 和恢复所需环境文件，完成后重新启动服务。
- `restore-test-databases.py --backup <备份目录> --report <私有报告路径>` 将两个库分别恢复到临时、无网络、无公开端口的容器，核对每张表数量及完整记录摘要；附件恢复到独立目录并逐一核对哈希。临时数据库验收后自动移除。
- `restore-test-erp.py --backup <备份目录> --report <私有报告路径>` 恢复到专用 recovery Site，核对凭证、分录、总账、科目和项目；原站点不作为恢复目标。
- 备份和环境文件含密钥，必须放在服务器受限目录，不能提交 GitHub 或加入镜像。

## 发布、回滚和正式切换

代码同步与运行部署是两步。`source-current` 只表示源码已到服务器；`app-current` 及健康检查 revision 才表示运行版本。

回滚优先切换到兼容的旧应用镜像，保持数据库和上传卷不变。存在新增业务或正式凭证时，禁止用旧备份覆盖在线库。数据库恢复只向隔离目标执行，正式恢复应另行核对恢复点后的新增记录。

已验证的同 schema 回滚命令为 `python3 source-current/scripts/rollback-test.py --root <项目目录> --revision <完整旧提交SHA>`。目标镜像必须已在服务器构建；脚本核对 schema 后只更换应用容器，不执行数据库恢复。

正式切换须进入维护窗口、停止旧写入口和后台写任务、核对增量、使旧会话失效，再切换单一可写入口。当前测试部署不代表正式切换完成。

详细清单见 `CUTOVER.md`。如果服务器已有 Docker 入站保护规则，除了主机防火墙，还需仅为测试网关端口增加对应例外；不得删除或整体关闭原规则。
