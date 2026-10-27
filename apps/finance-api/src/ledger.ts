import type { Router } from "express";
import { z } from "zod";
import { db, hash, encrypt } from "./db.js";
import { authorize } from "./authorization.js";
import { ERPNext } from "../../../packages/erpnext-adapter/index.js";
import { ApiFailure, route } from "../../platform-api/src/http.js";
const safe = (ledger: any) => {
  if (!ledger) return { provisionStatus: "UNPROVISIONED", connected: false };
  const { apiCredential, ...rest } = ledger;
  return { ...rest, connected: !!apiCredential };
};
export function registerLedger(router: Router) {
  router.get(
    "/companies/:companyId/context",
    route(async (req, res) => res.json(safe(req.tenant))),
  );
  router.get(
    "/companies/:companyId/ledger",
    route(async (req, res) => res.json(safe(req.tenant))),
  );
  router.post(
    "/companies/:companyId/ledger/provision",
    route(async (req, res) => {
      const key = z
        .string()
        .min(8)
        .max(100)
        .parse(req.headers["idempotency-key"]);
      const input = z
        .object({
          name: z.string().min(2).max(150),
          abbreviation: z.string().min(1).max(20),
          taxId: z.string().max(50).default(""),
          siteName: z
            .string()
            .regex(/^[a-z0-9.-]+$/)
            .max(100),
          erpCompany: z.string().min(1).max(150),
          apiKey: z.string().min(1).max(200),
          apiSecret: z.string().min(1).max(200),
        })
        .strict()
        .parse(req.body);
      const sites = (process.env.ERP_ALLOWED_SITES ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!sites.includes(input.siteName))
        throw new ApiFailure(
          400,
          "UNTRUSTED_SITE",
          "该账套不在此环境的允许范围内",
        );
      const { apiKey, apiSecret, ...metadata } = input;
      const requestDigest = hash(JSON.stringify(metadata)),
        auditId = "provision-" + hash(req.companyId + ":" + key);
      const previous = await db.audit.findUnique({ where: { id: auditId } });
      if (previous && (previous.detail as any).requestDigest !== requestDigest)
        throw new ApiFailure(
          409,
          "IDEMPOTENCY_CONFLICT",
          "同一开账请求不能修改公司或账套信息",
        );
      let ledger = await db.ledgerBinding.findUnique({
        where: { platformCompanyId: req.companyId },
      });
      if (ledger?.provisionStatus === "READY") {
        if (previous && (previous.detail as any).status === "READY")
          return res.json(safe(ledger));
        throw new ApiFailure(
          409,
          "LEDGER_EXISTS",
          "此公司已开账，不能重复绑定",
        );
      }
      const apiCredential = encrypt(apiKey + ":" + apiSecret);
      ledger = await db.$transaction(async (tx) => {
        const existing = await tx.ledgerBinding.findUnique({
          where: { platformCompanyId: req.companyId },
        });
        let result;
        if (existing) {
          if (existing.provisionStatus !== "FAILED")
            throw new ApiFailure(
              409,
              "PROVISION_IN_PROGRESS",
              "账套正在配置，请稍后重试",
            );
          const lock = await tx.ledgerBinding.updateMany({
            where: {
              id: existing.id,
              version: existing.version,
              provisionStatus: "FAILED",
            },
            data: {
              ...metadata,
              provisionStatus: "PROVISIONING",
              version: { increment: 1 },
            },
          });
          if (lock.count !== 1)
            throw new ApiFailure(
              409,
              "PROVISION_IN_PROGRESS",
              "账套配置已被其他操作更新",
            );
          result = await tx.ledgerBinding.findUniqueOrThrow({
            where: { id: existing.id },
          });
        } else
          result = await tx.ledgerBinding.create({
            data: {
              ...metadata,
              platformCompanyId: req.companyId,
              provisionStatus: "PROVISIONING",
            },
          });
        await tx.audit.upsert({
          where: { id: auditId },
          create: {
            id: auditId,
            tenantId: result.id,
            userId: req.user.id,
            action: "LEDGER_PROVISION",
            resourceId: result.id,
            detail: { requestDigest, status: "PROVISIONING" },
          },
          update: { detail: { requestDigest, status: "PROVISIONING" } },
        });
        return result;
      });
      try {
        const erp = new ERPNext({ ...ledger, apiCredential });
        const company = await erp.request(
          "/api/resource/Company/" + encodeURIComponent(input.erpCompany),
        );
        if (company?.name !== input.erpCompany)
          throw new Error("Company mismatch");
        await authorize(req, "finance:ledger:manage");
        const result = await db.$transaction(async (tx) => {
          const ready = await tx.ledgerBinding.update({
            where: { id: ledger!.id },
            data: {
              apiCredential,
              provisionStatus: "READY",
              version: { increment: 1 },
            },
          });
          await tx.audit.update({
            where: { id: auditId },
            data: { detail: { requestDigest, status: "READY" } },
          });
          return ready;
        });
        res.status(201).json(safe(result));
      } catch {
        await db.$transaction([
          db.ledgerBinding.update({
            where: { id: ledger.id },
            data: {
              apiCredential: "",
              provisionStatus: "FAILED",
              version: { increment: 1 },
            },
          }),
          db.audit.update({
            where: { id: auditId },
            data: {
              detail: {
                requestDigest,
                status: "FAILED",
                errorCode: "ERP_VERIFICATION_FAILED",
              },
            },
          }),
        ]);
        throw new ApiFailure(
          502,
          "PROVISION_FAILED",
          "账套连接验证失败，可核对后使用同一请求重试",
        );
      }
    }),
  );
}
