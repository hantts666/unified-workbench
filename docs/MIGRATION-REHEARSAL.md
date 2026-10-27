# 历史迁移演练

这是独立测试环境的演练工具。正式切换前仍须执行 `MIGRATION.md` 中的维护窗口和最终增量核对，不允许将演练副本回写原系统。

## 输入与执行

1. 使用 `scripts/export-legacy-snapshot.py` 只读导出旧库业务记录并复制附件，逐一核对 SHA-256。私有输出保存在服务器受限目录。
2. 使用 `scripts/clone-legacy-erp.py` 从原 ERP 备份恢复两个独立站点，保留新数据库凭据、复制原加密密钥，禁用调度与邮件。
3. 将 `legacy.json`、`source-master.key`、`erp-mapping.json`、`export-report.json` 存入本机忽略目录 `.local/migration/`。数据库及新的加密主密钥来自 `.local/server.env`；连接使用受控 SSH 隧道。
4. 运行 `npm run migration:plan`。没有冲突后运行 `npm run migration:apply`。这些命令只操作新平台库与新财务库。
5. 运行 `npm run test:migration -- --test-login <私有登录文件路径>`。登录文件只需 account 或 email 和 password，绝不能提交到仓库。

## 保留和限制

- 保留用户 ID、scrypt 密码哈希、账套 ID、单据 ID、ERP 引用和历史审计；不导入旧登录会话。
- 原管理员映射财务管理角色；审核员不获得正式提交、账套管理或处理器管理权限。平台管理权限独立授予。
- 无 ERP 凭据的公司保留为未开账；连接账套必须指向独立恢复站点。
- 凭据用新财务库的主密钥重新加密，公开报告仅包含数量与断言，不包含原始记录。
- 相同快照完成后重放不修改业务、权限或有效新会话。历史冲突先拒绝；两个数据库分别事务提交，失败可以在核对后重试。
- 附件路径仍为 `/app/uploads/<账套ID>/<文件>`；部署时须将私有附件副本放入新上传卷并核对摘要。
- 演练数据库包含迁移历史，不能作为空测试库重置。自动化测试只清理自己生成的记录和会话。

验收报告在 `evidence/reports/T11-migration.json`。原系统在演练期间继续运行；本次没有正式切换。
