import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Alert, Button, Empty, Spin } from "antd";
import { loadMicroApp, type MicroApp } from "qiankun";
import { createContextStore } from "../../../packages/platform-sdk/index.js";
import type { UserSummary } from "../../../packages/contracts/index.js";
import { api, navigate } from "./api.js";
const failedAttempts = new Map<string, number>();
export interface MicroHandle {
  changeCompany: (id: string) => Promise<boolean>;
}
export const MicroWorkspace = forwardRef<
  MicroHandle,
  { application: any; companyId: string; user: UserSummary }
>(({ application, companyId, user }, ref) => {
  const container = useRef<HTMLDivElement>(null),
    store = useRef<ReturnType<typeof createContextStore> | null>(null),
    instance = useRef<MicroApp | null>(null),
    queue = useRef(Promise.resolve());
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [empty, setEmpty] = useState(false),
    [retry, setRetry] = useState(0);
  let switchVersion = useRef(0);
  useImperativeHandle(
    ref,
    () => ({
      async changeCompany(id) {
        const ticket = ++switchVersion.current,
          currentStore = store.current;
        if (!currentStore) return false;
        const permissions = await api(
          `/permissions?applicationCode=${encodeURIComponent(application.code)}&companyId=${encodeURIComponent(id)}`,
        );
        if (ticket !== switchVersion.current || currentStore !== store.current)
          return false;
        return currentStore.change({
          ...currentStore.getContext(),
          companyId: id,
          permissionCodes: permissions,
        });
      },
    }),
    [application.code],
  );
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setEmpty(false);
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        if (cancelled) return;
        const permissions = await api(
          `/permissions?applicationCode=${encodeURIComponent(application.code)}&companyId=${encodeURIComponent(companyId)}`,
        );
        if (cancelled) return;
        const context = createContextStore({
          applicationCode: application.code,
          basePath: application.activeRule,
          companyId,
          contextVersion: 0,
          user,
          permissionCodes: permissions,
          theme: "light",
        });
        store.current = context;
        if (!permissions.length) {
          setEmpty(true);
          setLoading(false);
          return;
        }
        const platform = {
          getContext: context.getContext,
          subscribe: context.subscribe,
          beforeCompanyChange: context.beforeCompanyChange,
          navigate,
          sessionExpired: () =>
            window.dispatchEvent(new Event("platform-session-expired")),
        };
        // qiankun caches both rejected lifecycle promises and failed HTML entries.
        // A retry must get a new cache key while successful mounts keep theirs.
        const attempt = failedAttempts.get(application.code) ?? 0;
        const entry = new URL(application.entry, location.origin);
        if (attempt) entry.searchParams.set('retry', String(attempt));
        const app = loadMicroApp(
          {
            name: attempt ? `${application.code}-retry-${attempt}` : application.code,
            entry: entry.href,
            container: container.current!,
            props: { platform },
          },
          {
            sandbox: { experimentalStyleIsolation: true }, singular: true,
            fetch: async (input, init) => {
              const response = await fetch(input, {...init, signal: AbortSignal.timeout(20000)});
              if (!response.ok) throw new Error('应用资源暂时不可用');
              return response;
            },
            getTemplate: html => {
              if (!attempt) return html;
              const template = new DOMParser().parseFromString(html, 'text/html');
              for (const element of Array.from(template.querySelectorAll('script[src],link[rel=stylesheet][href]'))) {
                const attribute = element.tagName === 'SCRIPT' ? 'src' : 'href';
                const resource = new URL(element.getAttribute(attribute)!, entry);
                resource.searchParams.set('retry', String(attempt));
                element.setAttribute(attribute, resource.href);
              }
              return template.documentElement.outerHTML;
            },
          },
        );
        instance.current = app;
        // single-spa exposes separate rejecting promises for load and bootstrap.
        // mountPromise below owns the visible error and retry state.
        void app.loadPromise.catch(() => {});
        void app.bootstrapPromise.catch(() => {});
        await app.mountPromise;
        if (!cancelled) setLoading(false);
      })
      .catch(() => {
        failedAttempts.set(application.code, (failedAttempts.get(application.code) ?? 0) + 1);
        if (!cancelled) {
          setError("应用暂时无法打开，请重试。你仍可使用平台和其他应用。");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      switchVersion.current++;
      const previousStore = store.current;
      store.current = null;
      queue.current = queue.current
        .catch(() => {})
        .then(async () => {
          const mounted = instance.current;
          instance.current = null;
          try { if (mounted) await mounted.unmount(); }
          finally { previousStore?.dispose(); }
        });
    };
  }, [application.code, retry, user.id, companyId]);
  return (
    <div className="portal-micro">
      {loading && (
        <div className="portal-loading">
          <Spin tip="正在打开应用…" spinning>
            <div />
          </Spin>
        </div>
      )}
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            <Button onClick={() => setRetry((v) => v + 1)}>重新打开</Button>
          }
        />
      )}
      {empty && <Empty description="你在当前公司没有此应用的使用权限" />}
      <div ref={container} data-testid="micro-container" />
    </div>
  );
});
