import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "./db.js";
import { ApiFailure } from "../../platform-api/src/http.js";
export type FinanceRequest = Request & {
  companyId: string;
  user: { id: string };
  tenant: any;
  requiredPermission: string;
};
const routes: Array<[string, RegExp, string]> = [
  ["GET", /^\/context$/, "finance:application:access"],
  ["GET", /^\/ledger$/, "finance:ledger:manage"],
  ["PATCH", /^\/ledger$/, "finance:ledger:manage"],
  ["POST", /^\/ledger\/provision$/, "finance:ledger:manage"],
  ["GET", /^\/documents(?:\/[^/]+(?:\/file)?)?$/, "finance:document:view"],
  ["POST", /^\/(documents|manual-document)$/, "finance:document:create"],
  ["PATCH", /^\/documents\/[^/]+$/, "finance:document:review"],
  [
    "POST",
    /^\/documents\/[^/]+\/(retry|reject|draft)$/,
    "finance:document:review",
  ],
  ["POST", /^\/documents\/[^/]+\/submit$/, "finance:voucher:submit"],
  ["GET", /^\/accounts$/, "finance:account:view"],
  ["GET", /^\/journals$/, "finance:voucher:view"],
  ["GET", /^\/erp-projects$/, "finance:document:review"],
  ["GET", /^\/reports\/[^/]+$/, "finance:report:view"],
  ["GET", /^\/projects$/, "finance:project:manage"],
  ["POST", /^\/projects$/, "finance:project:manage"],
  ["GET", /^\/bank$/, "finance:bank:manage"],
  ["POST", /^\/bank\/[^/]+\/match$/, "finance:bank:manage"],
  ["GET", /^\/audit$/, "finance:audit:view"],
  ["GET", /^\/processors$/, "finance:processor:manage"],
  ["PATCH", /^\/processors\/[^/]+$/, "finance:processor:manage"],
];
const allowedDecision = z.object({
  active: z.literal(true),
  allowed: z.literal(true),
  subjectId: z.string().min(1),
  companyId: z.string().min(1),
  applicationCode: z.literal("finance"),
  authzVersion: z.number().int(),
  sessionExpiresAt: z.string().datetime(),
});
export async function authorize(req: FinanceRequest, permissionCode: string) {
  const token = req.cookies?.platform_session;
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    throw new ApiFailure(401, "UNAUTHENTICATED", "请先登录");
  const secret = process.env.INTERNAL_SERVICE_SECRET,
    origin = process.env.PLATFORM_INTERNAL_ORIGIN;
  if (!secret || secret.length < 32 || !origin)
    throw new ApiFailure(503, "AUTH_UNAVAILABLE", "授权服务暂时不可用");
  let response: globalThis.Response;
  try {
    response = await fetch(new URL("/internal/auth/introspect", origin), {
      method: "POST",
      headers: {
        Authorization: "Bearer " + secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionToken: token,
        applicationCode: "finance",
        companyId: req.companyId,
        permissionCode,
      }),
      signal: AbortSignal.timeout(
        Number(process.env.INTERNAL_AUTH_TIMEOUT_MS ?? 5000),
      ),
      redirect: "error",
    });
  } catch {
    throw new ApiFailure(
      503,
      "AUTH_UNAVAILABLE",
      "授权服务暂时不可用，本次操作未执行",
    );
  }
  if (!response.ok)
    throw new ApiFailure(
      503,
      "AUTH_UNAVAILABLE",
      "授权服务暂时不可用，本次操作未执行",
    );
  const result = await response.json().catch(() => null);
  if (result?.active === false)
    throw new ApiFailure(401, "UNAUTHENTICATED", "登录已失效，请重新登录");
  if (result?.active === true && result.allowed === false)
    throw new ApiFailure(403, "FORBIDDEN", "没有此公司或操作的访问权限");
  const decision = allowedDecision.safeParse(result);
  if (
    !decision.success ||
    decision.data.companyId !== req.companyId ||
    new Date(decision.data.sessionExpiresAt) <= new Date() ||
    (req.user && req.user.id !== decision.data.subjectId)
  )
    throw new ApiFailure(503, "AUTH_UNAVAILABLE", "授权服务返回无效结果");
  req.user = { id: decision.data.subjectId };
  return decision.data;
}
export async function financeAuthorization(
  request: Request,
  res: Response,
  next: NextFunction,
) {
  const req = request as FinanceRequest;
  try {
    const match = req.path.match(/^\/companies\/([^/]+)(\/.*)$/);
    if (!match) return res.status(404).json({ message: "接口不存在" });
    req.companyId = decodeURIComponent(match[1]);
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(req.companyId))
      throw new ApiFailure(400, "INVALID_COMPANY", "公司标识无效");
    const rule = routes.find(
      ([method, pattern]) =>
        method === (req.method === "HEAD" ? "GET" : req.method) &&
        pattern.test(match[2]),
    );
    if (!rule) return res.status(404).json({ message: "接口不存在" });
    req.requiredPermission = rule[2];
    await authorize(req, rule[2]);
    req.tenant = await db.ledgerBinding.findUnique({
      where: { platformCompanyId: req.companyId },
    });
    if (req.method === 'PATCH' && match[2] === '/ledger' && !req.tenant)
      throw new ApiFailure(409,'LEDGER_NOT_READY','请先完成财务开账');
    if (!["/context", "/ledger", "/ledger/provision"].includes(match[2])) {
      if (!req.tenant || req.tenant.provisionStatus !== "READY")
        throw new ApiFailure(
          409,
          "LEDGER_NOT_READY",
          "当前公司尚未完成财务开账",
        );
      if (!req.tenant.active)
        throw new ApiFailure(423, "LEDGER_DISABLED", "当前账套已停用");
    }
    next();
  } catch (error) {
    if (error instanceof ApiFailure)
      return res
        .status(error.status)
        .json({ code: error.code, message: error.message });
    res
      .status(503)
      .json({ code: "FINANCE_UNAVAILABLE", message: "财务服务暂时不可用" });
  }
}
