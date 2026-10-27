# ADR-001：乾坤子应用构建

状态：T01 通过真实 Edge 浏览器验证。直接路由、刷新、动态分包、前进后退、20 次卸载重挂均通过，页面异常与失败资源为零。结果快照见 `evidence/reports/T01-browser.json`。

主应用和财务子应用保留 React 19.2.0。乾坤采用 npm stable 2.10.16，子应用使用 Webpack 5 的 UMD 生命周期导出和唯一 chunkLoadingGlobal，动态资源通过注入的 public path 定位。现有 Vite ESM 产物不直接作为乾坤 HTML entry。

依据：[乾坤官方接入说明](https://qiankun.umijs.org/guide/getting-started/) 要求导出 bootstrap、mount、unmount，并给出 Webpack 5 UMD 配置。React 19 使用 createRoot / root.unmount，替代官方示例中的旧 ReactDOM API。

执行 `npm run build:poc` 后运行 `npm run test:poc`，真实浏览器验证动态分包、直接进入子路由、刷新、前进后退及反复挂载卸载。新的验证结果写入忽略提交的 `test-results/T01-browser.json`，验收时再保存不可变证据快照。
