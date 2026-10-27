# 执行方法

## 当前可以做什么

```sh
npm ci
npm run check
npm run spec:status
npm run spec:next
npm run spec:task -- T01
```

用户已在 `docs/reviews/2026-10-27-approval.md` 批准开始实施。后续使用审批指纹与任务依赖推进；新的审批登记必须对应真实的人类指令。

## 明确批准之后

执行者先把用户真实的批准语句、日期和批准范围记录在 `docs/reviews/` 下的新 Markdown 文件中。公开文件只保留必要的批准内容，不复制聊天中的账号或其他私人信息。然后登记：

```sh
npm run spec:approve -- --reviewer OWNER --evidence docs/reviews/实际评审记录.md
npm run spec:next
npm run spec:start -- T01
```

`OWNER` 是命令说明中的参数名，使用时填真实评审人。审批命令绑定当前规格指纹。这个登记工具是执行护栏，不能鉴别人类身份，也不能替代会话中的真实批准。

## 一项任务的执行

1. `spec:task -- Txx` 读取边界、依赖、AC 与验证项。
2. `spec:start -- Txx` 检查审批与依赖，标记进行中。
3. 实现任务，运行该任务要求的真实验证，修复失败。
4. 写入 `evidence/Txx.json`，记录命令、退出码、实际检查到的 AC 与证据文件。
5. `spec:complete -- Txx --evidence evidence/Txx.json` 核对证据后完成。

证据结构示例见 `contracts/evidence.example.json`。示例不是执行结果，不能直接用来完成任务。自动化记录要引用实际生成的检查报告；人工检查要有对应记录。源码文件存在或描述写完不等于业务验收完成。

## HTTP 验收

后续测试环境准备四类虚构用户及两家公司，通过本地环境变量提供测试凭据：

```text
ACCEPTANCE_BASE_URL          被验收的统一网关，例如本地地址
ACCEPTANCE_COMPANY_A         虚构公司 A 的 ID
ACCEPTANCE_COMPANY_B         虚构公司 B 的 ID
ACCEPTANCE_USER              仅 A 公司、财务只读测试用户
ACCEPTANCE_PASSWORD          对应测试密码
ACCEPTANCE_PLATFORM_ADMIN    无财务权限的平台管理员
ACCEPTANCE_ADMIN_PASSWORD    对应测试密码
ACCEPTANCE_DRAFT_A           A 公司可提交的虚构草稿单据 ID
ACCEPTANCE_DOCUMENT_B        B 公司已有虚构单据 ID
```

使用隔离测试环境运行：

```sh
npm run acceptance:platform
npm run acceptance:finance
```

脚本真实请求平台与财务接口，只登录虚构测试账号并执行预期被拒绝的越权操作；不创建或提交真实凭证。缺少环境变量会返回非零退出码，报告位于忽略提交的 `test-results/`。不输出测试密码、Cookie 或响应正文。

浏览器、数据库、财务回归和恢复用例已按任务实现并在独立测试环境执行，脱敏报告见 `evidence/reports/`，逐项完成状态见 `npm run spec:status`。正式生产切换尚未执行。
