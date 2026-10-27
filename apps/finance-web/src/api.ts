import type { PlatformBridge } from "../../../packages/contracts/index.js";
import { createScopedClient } from "../../../packages/platform-sdk/index.js";
export type FinanceClient = ReturnType<typeof createFinanceClient>;
export function createFinanceClient(platform: PlatformBridge) {
  const scoped = createScopedClient(platform),
    companyId = platform.getContext().companyId;
  let ledgerId = "",
    disposed = false;
  // getRandomValues is also available on the IP-based HTTP test entry.
  // Keep a cryptographically random key stable for this mounted instance.
  const provisioningKey = Array.from(crypto.getRandomValues(new Uint8Array(16)),
    value => value.toString(16).padStart(2, '0')).join('');
  const current = () => {
    if (disposed || companyId !== platform.getContext().companyId)
      throw new DOMException("公司已改变或应用已关闭", "AbortError");
  };
  const api = async <T = any>(
    url: string,
    options: RequestInit = {},
  ): Promise<T> => {
    current();
    const match = url.match(/^\/tenants\/([^/]+)(?:\/(.*))?$/);
    if (!match || !ledgerId || match[1] !== ledgerId)
      throw new DOMException("账套上下文已改变", "AbortError");
    return scoped.request<T>(match[2] || "ledger", options);
  };
  return {
    companyId,
    api,
    post: (url: string, body: unknown = {}) =>
      api(url, { method: "POST", body: JSON.stringify(body) }),
    patch: (url: string, body: unknown) =>
      api(url, { method: "PATCH", body: JSON.stringify(body) }),
    async context() {
      current();
      const value = await scoped.request<any>("context");
      ledgerId = value.id ?? "";
      return value;
    },
    async provision(body: unknown) {
      current();
      return scoped.request("ledger/provision", {
        method: "POST",
        headers: { "Idempotency-Key": provisioningKey },
        body: JSON.stringify(body),
      });
    },
    fileUrl(id: string) {
      current();
      return `/api/finance/companies/${encodeURIComponent(companyId)}/documents/${encodeURIComponent(id)}/file`;
    },
    dispose() {
      disposed = true;
      scoped.dispose();
    },
  };
}
