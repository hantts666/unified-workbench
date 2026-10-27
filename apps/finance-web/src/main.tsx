import "./public-path.js";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { App as AntApp, ConfigProvider, Result } from "antd";
import zhCN from "antd/locale/zh_CN";
import { StyleProvider } from "@ant-design/cssinjs";
import type { MicroAppProps } from "../../../packages/contracts/index.js";
import { createFinanceClient, type FinanceClient } from "./api.js";
import { Workspace } from "./workspace.js";
let root: Root | undefined,
  client: FinanceClient | undefined,
  popupRoot: HTMLElement | undefined;
export async function bootstrap() {}
export async function mount(props: MicroAppProps) {
  const target = props.container.querySelector<HTMLElement>("#finance-root");
  if (!target || !props.platform) throw new Error("财务应用需要由统一门户加载");
  target.classList.add("finance-scope");
  popupRoot = target;
  client = createFinanceClient(props.platform);
  root = createRoot(target);
  root.render(
    <StyleProvider container={target}>
      <ConfigProvider
        prefixCls="finance-ant"
        virtual={false}
        locale={zhCN}
        getPopupContainer={() => target}
        theme={{
          token: {
            colorPrimary: "#28675b",
            fontFamily: "Segoe UI, Microsoft YaHei, sans-serif",
            borderRadius: 6,
            fontSize: 13,
          },
        }}
      >
        <AntApp
          message={{ getContainer: () => target }}
          notification={{ getContainer: () => target }}
        >
          <Workspace
            platform={props.platform}
            client={client}
            popupRoot={target}
          />
        </AntApp>
      </ConfigProvider>
    </StyleProvider>,
  );
}
export async function unmount() {
  client?.dispose();
  root?.unmount();
  popupRoot?.replaceChildren();
  root = undefined;
  client = undefined;
  popupRoot = undefined;
}
export async function update() {}
if (!window.__POWERED_BY_QIANKUN__) {
  const target = document.getElementById("finance-root");
  if (target)
    createRoot(target).render(
      <Result
        title="请从统一工作台进入财务应用"
        extra={<a href="/platform">打开统一工作台</a>}
      />,
    );
}
