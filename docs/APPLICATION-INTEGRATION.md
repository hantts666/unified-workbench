# 新业务应用接入

`sample-web` 是最小可运行样例，财务是完整业务样例。业务应用不自带登录、门户 Layout 或公司选择器。

1. 独立应用目录放在 `apps/<code>-web`。入口导出乾坤 `bootstrap/mount/unmount/update`，使用主应用提供的 container 挂载；卸载时释放 React root、订阅、计时器和进行中的请求。
2. 只从 `props.platform.getContext()` 获取当前公司、用户摘要及展示权限。通过 `subscribe` 响应变化；带未保存编辑的页面注册 `beforeCompanyChange`，明确处理取消。
3. 使用 `platform.navigate('/<code>/...')` 导航并订阅 popstate。Webpack UMD 每个应用使用独立 library 和 chunkLoadingGlobal，动态资源路径读取乾坤注入值。
4. CSS 使用应用前缀，弹窗放入自身 container。不要覆盖主应用 body、全局主题或弹窗容器。
5. 请求通过 SDK 取消旧上下文请求。后端必须重新校验会话、公司与具体操作权限；props 不能授权数据库写入。示例没有后端写功能，不能作为完整业务鉴权样板。
6. 受信应用清单位于 `packages/contracts/applications.ts`。登记应用权限和角色后，由平台管理员授予成员公司范围内的权限。不得允许用户填任意第三方入口 URL。

独立构建命令为 `npm run build:portal`、`npm run build:finance`、`npm run build:sample`，产物分别位于 `dist/portal`、`dist/finance`、`dist/sample`。部署时每个产物使用独立静态容器，统一网关分别转发 `/micro/finance/` 和 `/micro/sample/`。

门户对子应用加载失败显示“重新打开”。故障注入验收需证明主导航仍可操作、其他应用可打开、恢复资源后可重试。新增应用也应验证直接刷新、前进后退、动态分包、公司切换及卸载。
