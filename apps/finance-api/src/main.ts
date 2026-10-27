import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  Module,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  Res,
  UseInterceptors,
  UploadedFile,
  HttpException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  authorize,
  financeAuthorization,
  type FinanceRequest,
} from "./authorization.js";
import { registerLedger } from "./ledger.js";
import { requireOrigin, errors } from "../../platform-api/src/http.js";
import { z } from "zod";
import { db, hash, audit, encrypt } from "./db.js";
import { enqueue, queue } from "./queue.js";
import { ERPNext } from "../../../packages/erpnext-adapter/index.js";
import { validateJournal } from "../../../packages/accounting-rules/index.js";
import {
  projectSchema,
  date,
  suggestionSchema,
} from "../../../packages/finance-contracts/index.js";
type R = FinanceRequest;
function fail(message: string, status = 400): never {
  throw new HttpException(message, status);
}
const safeTenant = (t: any) => {
  const { apiCredential, ...rest } = t;
  return { ...rest, connected: !!apiCredential };
};
let activeWrites = 0;
async function getDoc(req: R, id: string) {
  const doc = await db.document.findFirst({
    where: { id, tenantId: req.tenant.id },
  });
  if (!doc) fail("单据不存在", 404);
  return doc;
}
async function checked(req: R, doc: any, input?: unknown) {
  if (doc.status === "PROCESSING" || doc.status === "FAILED")
    fail("请等待解析完成或重试");
  const erp = new ERPNext(req.tenant),
    accounts = await erp.accounts();
  const suggestion = validateJournal(input ?? doc.suggestion, {
    tenantId: req.tenant.id,
    documentId: doc.id,
    lockedThrough: req.tenant.lockedThrough,
    accounts: accounts.map((a: any) => a.name),
  });
  if (suggestion.documentType === "bank")
    fail("银行流水批次仅作归档，请逐条匹配已提交的 ERPNext 凭证");
  for (const e of suggestion.entries) {
    if (e.project) {
      const projects = await erp.list(
        "Project",
        ["name"],
        [
          ["name", "=", e.project],
          ["company", "=", req.tenant.erpCompany],
        ],
        1,
      );
      if (!projects.length) fail("项目不属于当前公司");
    }
  }
  return { erp, suggestion };
}
@Controller("api/finance")
class ApiController {
  @Get("health") async health() {
    await db.$queryRaw`SELECT 1`;
    await queue.getJobCounts();
    return { status: "ok", service: "finance-api", revision: process.env.APP_REVISION ?? "development", activeWrites };
  }
  @Patch("companies/:companyId/ledger") async updateTenant(
    @Req() req: R,
    @Body() raw: unknown,
  ) {
    const b = z
      .object({
        name: z.string().min(2).max(150).optional(),
        taxId: z.string().max(30).optional(),
        active: z.boolean().optional(),
        lockedThrough: z.union([date, z.literal("")]).optional(),
        apiKey: z.string().max(200).optional(),
        apiSecret: z.string().max(200).optional(),
      })
      .parse(raw);
    const { apiKey, apiSecret, ...data } = b;
    if (
      data.lockedThrough !== undefined &&
      data.lockedThrough < req.tenant.lockedThrough
    )
      fail("解锁期间请由维护人员核对 ERPNext 后处理");
    if (!!apiKey !== !!apiSecret) fail("API Key 与 Secret 必须同时填写");
    return db.$transaction(async (tx) => {
      const t = await tx.ledgerBinding.update({
        where: { id: req.tenant.id },
        data: {
          ...data,
          ...(apiKey
            ? { apiCredential: encrypt(`${apiKey}:${apiSecret}`) }
            : {}),
        },
      });
      await tx.audit.create({
        data: {
          tenantId: t.id,
          userId: req.user.id,
          action: "TENANT_UPDATED",
          resourceId: t.id,
          detail: { ...data, credentialChanged: !!apiKey },
        },
      });
      return safeTenant(t);
    });
  }
  @Get("companies/:companyId/documents") documents(@Req() req: R) {
    return db.document.findMany({
      where: { tenantId: req.tenant.id },
      select: {
        id: true,
        filename: true,
        status: true,
        suggestion: true,
        error: true,
        erpName: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }
  @Get("companies/:companyId/documents/:id") async document(
    @Req() req: R,
    @Param("id") id: string,
  ) {
    const { storagePath, ...result } = await getDoc(req, id);
    return result;
  }
  @Post("companies/:companyId/manual-document") async manual(@Req() req: R) {
    const reference = randomBytes(16).toString("hex");
    const source = JSON.stringify({
      type: "manual",
      createdBy: req.user.id,
      createdAt: new Date().toISOString(),
      reference,
    });
    const dir = path.resolve(
      process.env.UPLOAD_DIR ?? "./uploads",
      req.tenant.id,
    );
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const storagePath = path.join(dir, reference + ".json");
    await writeFile(storagePath, source, { mode: 0o600 });
    return db.$transaction(async (tx) => {
      const d = await tx.document.create({
        data: {
          tenantId: req.tenant.id,
          filename: `手工凭证-${new Date().toISOString().slice(0, 10)}.json`,
          contentHash: hash(source),
          storagePath,
          mimeType: "application/json",
          status: "REVIEW",
        },
      });
      const suggestion = {
        tenantId: req.tenant.id,
        sourceDocumentId: d.id,
        documentType: "manual",
        transactionDate: new Date().toLocaleDateString("sv-SE", {
          timeZone: "Asia/Shanghai",
        }),
        counterparty: "",
        amountCents: 0,
        taxCents: 0,
        currency: "CNY",
        suggestedAccount: "",
        confidence: 0,
        reasoningSummary: "人工录入，请核对业务凭据。",
        supportingEvidence: [],
        entries: [
          { account: "", debitCents: 0, creditCents: 0 },
          { account: "", debitCents: 0, creditCents: 0 },
        ],
      };
      const result = await tx.document.update({
        where: { id: d.id },
        data: { suggestion },
      });
      await tx.audit.create({
        data: {
          tenantId: req.tenant.id,
          userId: req.user.id,
          action: "MANUAL_CREATED",
          resourceId: d.id,
          detail: { reference },
        },
      });
      return result;
    });
  }
  @Post("companies/:companyId/documents")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 20 * 1024 * 1024, files: 1 },
      storage: undefined,
    }),
  )
  async upload(
    @Req() req: R,
    @UploadedFile() file: { originalname: string; buffer: Buffer },
  ) {
    if (!file) fail("请选择文件");
    const ext = path.extname(file.originalname).toLowerCase();
    const mime: Record<string, string> = {
      ".csv": "text/csv",
      ".xlsx":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
    };
    if (!mime[ext]) fail("仅支持 CSV、XLSX、PDF、JPG 和 PNG");
    const sig = file.buffer.subarray(0, 8);
    if (ext === ".pdf" && !sig.toString().startsWith("%PDF-"))
      fail("PDF 文件格式无效");
    if (ext === ".xlsx" && sig.subarray(0, 2).toString() !== "PK")
      fail("Excel 文件格式无效");
    if (ext === ".png" && sig.toString("hex") !== "89504e470d0a1a0a")
      fail("PNG 文件格式无效");
    if (
      [".jpg", ".jpeg"].includes(ext) &&
      sig.subarray(0, 3).toString("hex") !== "ffd8ff"
    )
      fail("JPG 文件格式无效");
    if (
      ext === ".csv" &&
      file.buffer.includes(0) &&
      !sig.subarray(0, 2).equals(Buffer.from([255, 254]))
    )
      fail("CSV 编码无效");
    const contentHash = hash(file.buffer),
      existing = await db.document.findUnique({
        where: {
          tenantId_contentHash: { tenantId: req.tenant.id, contentHash },
        },
      });
    if (existing) return { duplicate: true, id: existing.id };
    const dir = path.join(process.env.UPLOAD_DIR ?? "./uploads", req.tenant.id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const storagePath = path.resolve(dir, contentHash + ext);
    await writeFile(storagePath, file.buffer, { mode: 0o600 });
    let doc;
    try {
      doc = await db.$transaction(async (tx) => {
        const d = await tx.document.create({
          data: {
            tenantId: req.tenant.id,
            filename: Buffer.from(file.originalname, "latin1")
              .toString("utf8")
              .slice(0, 200),
            contentHash,
            storagePath,
            mimeType: mime[ext],
          },
        });
        await tx.audit.create({
          data: {
            tenantId: req.tenant.id,
            userId: req.user.id,
            action: "DOCUMENT_UPLOADED",
            resourceId: d.id,
            detail: { filename: d.filename, contentHash },
          },
        });
        return d;
      });
    } catch (error: any) {
      if (error.code === "P2002")
        return {
          duplicate: true,
          id: (
            await db.document.findUniqueOrThrow({
              where: {
                tenantId_contentHash: { tenantId: req.tenant.id, contentHash },
              },
            })
          ).id,
        };
      throw error;
    }
    await enqueue(doc.id, doc.processingVersion).catch(() => {});
    return { id: doc.id, duplicate: false };
  }
  @Get("companies/:companyId/documents/:id/file") async file(
    @Req() req: R,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const doc = await getDoc(req, id);
    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader(
      "Content-Disposition",
      `${doc.mimeType.startsWith("image/") || doc.mimeType === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.send(await readFile(doc.storagePath));
  }
  @Patch("companies/:companyId/documents/:id") async edit(
    @Req() req: R,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const doc = await getDoc(req, id);
    if (!["REVIEW", "REJECTED"].includes(doc.status))
      fail("仅待审核或已驳回的单据可以修改");
    const b = suggestionSchema.parse(raw);
    if (b.tenantId !== req.tenant.id || b.sourceDocumentId !== id)
      fail("公司或原始单据不匹配");
    return db.$transaction(async (tx) => {
      const updated = await tx.document.updateMany({
        where: {
          id,
          tenantId: req.tenant.id,
          status: doc.status,
          updatedAt: doc.updatedAt,
        },
        data: {
          suggestion: b,
          invoiceNumber: b.invoiceNumber || null,
          status: "REVIEW",
          error: null,
        },
      });
      if (!updated.count) fail("单据已被其他操作更新，请刷新", 409);
      await tx.audit.create({
        data: {
          tenantId: req.tenant.id,
          userId: req.user.id,
          action: "SUGGESTION_EDITED",
          resourceId: id,
          detail: { before: doc.suggestion, after: b },
        },
      });
      return { ok: true };
    });
  }
  @Post("companies/:companyId/documents/:id/retry") async retry(
    @Req() req: R,
    @Param("id") id: string,
  ) {
    const doc = await getDoc(req, id);
    if (!["FAILED", "REJECTED"].includes(doc.status))
      fail("仅失败或驳回的单据可以重新解析");
    const version = doc.processingVersion + 1;
    const updated = await db.document.updateMany({
      where: {
        id,
        status: doc.status,
        processingVersion: doc.processingVersion,
      },
      data: { status: "PROCESSING", processingVersion: version, error: null },
    });
    if (!updated.count) fail("单据已被更新", 409);
    await audit(req.tenant.id, req.user.id, "PROCESS_RETRY", id);
    await enqueue(id, version).catch(() => {});
    return { ok: true };
  }
  @Post("companies/:companyId/documents/:id/reject") async reject(
    @Req() req: R,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const b = z.object({ reason: z.string().min(1).max(500) }).parse(raw);
    const doc = await getDoc(req, id);
    if (doc.status !== "REVIEW") fail("仅待审核单据可以驳回");
    return db.$transaction(async (tx) => {
      const r = await tx.document.updateMany({
        where: { id, status: "REVIEW" },
        data: { status: "REJECTED", error: b.reason },
      });
      if (!r.count) fail("状态已变化", 409);
      await tx.audit.create({
        data: {
          tenantId: req.tenant.id,
          userId: req.user.id,
          action: "REJECTED",
          resourceId: id,
          detail: b,
        },
      });
      return { ok: true };
    });
  }
  @Post("companies/:companyId/documents/:id/draft") async draft(
    @Req() req: R,
    @Param("id") id: string,
  ) {
    const doc = await getDoc(req, id);
    if (["DRAFT", "SUBMITTED"].includes(doc.status))
      return { name: doc.erpName };
    if (
      doc.status === "DRAFTING" &&
      doc.updatedAt.getTime() < Date.now() - 120000
    ) {
      await db.document.updateMany({
        where: { id, status: "DRAFTING", updatedAt: doc.updatedAt },
        data: { status: "REVIEW" },
      });
      doc.status = "REVIEW";
    }
    if (doc.status !== "REVIEW") fail("单据尚未准备好或正在处理", 409);
    const { erp, suggestion } = await checked(req, doc);
    const lock = await db.document.updateMany({
      where: { id, status: "REVIEW", updatedAt: doc.updatedAt },
      data: { status: "DRAFTING" },
    });
    if (!lock.count) fail("单据已被其他操作更新", 409);
    try {
      await authorize(req, "finance:document:review");
      const result = await erp.draft(suggestion, id);
      await db.$transaction([
        db.document.update({
          where: { id },
          data: {
            status: result.docstatus === 1 ? "SUBMITTED" : "DRAFT",
            erpName: result.name,
            error: null,
          },
        }),
        db.audit.create({
          data: {
            tenantId: req.tenant.id,
            userId: req.user.id,
            action: "ERP_DRAFT_CREATED",
            resourceId: id,
            detail: { erpName: result.name },
          },
        }),
      ]);
      return { name: result.name };
    } catch (e: any) {
      await db.document.updateMany({
        where: { id, status: "DRAFTING" },
        data: { status: "REVIEW", error: e.message },
      });
      await audit(req.tenant.id, req.user.id, "ERP_DRAFT_FAILED", id, {
        message: e.message,
      });
      throw e;
    }
  }
  @Post("companies/:companyId/documents/:id/submit") async submit(
    @Req() req: R,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const confirmation = z
      .object({ confirmation: z.literal("确认提交正式账务") })
      .strict()
      .parse(raw);
    const doc = await getDoc(req, id);
    if (doc.status === "SUBMITTED") return { name: doc.erpName };
    if (
      doc.status === "SUBMITTING" &&
      doc.updatedAt.getTime() < Date.now() - 120000
    ) {
      await db.document.updateMany({
        where: { id, status: "SUBMITTING", updatedAt: doc.updatedAt },
        data: { status: "DRAFT" },
      });
      doc.status = "DRAFT";
    }
    if (doc.status !== "DRAFT" || !doc.erpName)
      fail("请先审核并创建 ERPNext 草稿", 409);
    const { erp, suggestion } = await checked(req, doc);
    const erpDoc = await erp.request(
      `/api/resource/Journal%20Entry/${encodeURIComponent(doc.erpName)}`,
    );
    if (erpDoc.company !== req.tenant.erpCompany) fail("ERPNext 公司不匹配");
    const actual = erpDoc.accounts.map((a: any) => ({
      account: a.account,
      debitCents: Math.round(a.debit_in_account_currency * 100),
      creditCents: Math.round(a.credit_in_account_currency * 100),
      project: a.project || "",
    }));
    const expected = suggestion.entries.map((e) => ({
      account: e.account,
      debitCents: e.debitCents,
      creditCents: e.creditCents,
      project: e.project || "",
    }));
    if (
      erpDoc.posting_date !== suggestion.transactionDate ||
      JSON.stringify(actual) !== JSON.stringify(expected) ||
      erpDoc.custom_platform_reference !== id
    )
      fail(
        "ERPNext 草稿与已审核建议不一致，请在 ERPNext 核对后恢复为已审核内容再提交",
      );
    validateJournal(
      {
        ...(doc.suggestion as any),
        transactionDate: erpDoc.posting_date,
        amountCents: Math.round(erpDoc.total_debit * 100),
        entries: erpDoc.accounts.map((a: any) => ({
          account: a.account,
          debitCents: Math.round(a.debit_in_account_currency * 100),
          creditCents: Math.round(a.credit_in_account_currency * 100),
        })),
      },
      {
        tenantId: req.tenant.id,
        documentId: id,
        lockedThrough: req.tenant.lockedThrough,
        accounts: (await erp.accounts()).map((a: any) => a.name),
      },
    );
    const lock = await db.document.updateMany({
      where: { id, status: "DRAFT", updatedAt: doc.updatedAt },
      data: { status: "SUBMITTING" },
    });
    if (!lock.count) fail("正在提交或状态已更新", 409);
    try {
      await authorize(req, "finance:voucher:submit");
      const result = await erp.submit(doc.erpName);
      await db.$transaction([
        db.document.update({
          where: { id },
          data: { status: "SUBMITTED", error: null },
        }),
        db.audit.create({
          data: {
            tenantId: req.tenant.id,
            userId: req.user.id,
            action: "ERP_SUBMITTED",
            resourceId: id,
            detail: {
              erpName: result.name,
              confirmation: confirmation.confirmation,
            },
          },
        }),
      ]);
      return { name: result.name };
    } catch (e: any) {
      await db.document.updateMany({
        where: { id, status: "SUBMITTING" },
        data: { status: "DRAFT", error: e.message },
      });
      await audit(req.tenant.id, req.user.id, "ERP_SUBMIT_FAILED", id, {
        message: e.message,
      });
      throw e;
    }
  }
  @Get("companies/:companyId/accounts") accounts(@Req() req: R) {
    return new ERPNext(req.tenant).accounts();
  }
  @Get("companies/:companyId/journals") journals(@Req() req: R) {
    return new ERPNext(req.tenant).journals();
  }
  @Get("companies/:companyId/erp-projects") erpProjects(@Req() req: R) {
    return new ERPNext(req.tenant).list(
      "Project",
      ["name", "project_name"],
      [["company", "=", req.tenant.erpCompany]],
      500,
    );
  }
  @Get("companies/:companyId/reports/:type") async report(
    @Req() req: R,
    @Param("type") type: string,
  ) {
    const q = z.object({ from: date, to: date }).parse(req.query);
    if (q.from > q.to) fail("起始日期不能晚于结束日期");
    const erp = new ERPNext(req.tenant);
    const year = q.to.slice(0, 4);
    const filters = {
      from_date: q.from,
      to_date: q.to,
      from_fiscal_year: year,
      to_fiscal_year: year,
      period_start_date: q.from,
      period_end_date: q.to,
      filter_based_on: "Date Range",
      periodicity: "Monthly",
      accumulated_values: 1,
      presentation_currency: "CNY",
      fiscal_year: year,
    };
    const names: Record<string, string> = {
      balance: "Balance Sheet",
      profit: "Profit and Loss Statement",
      ledger: "General Ledger",
      receivable: "Accounts Receivable",
      payable: "Accounts Payable",
    };
    if (!names[type]) fail("报表不存在", 404);
    return erp.report(names[type], {
      ...filters,
      ...(["receivable", "payable"].includes(type)
        ? {
            report_date: q.to,
            ageing_based_on: "Due Date",
            range1: 30,
            range2: 60,
            range3: 90,
            range4: 120,
            party_type: type === "receivable" ? "Customer" : "Supplier",
          }
        : {}),
    });
  }
  @Get("companies/:companyId/projects") async projects(@Req() req: R) {
    const projects = await db.project.findMany({
      where: { tenantId: req.tenant.id },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(
      projects.map(async (p) => {
        try {
          return {
            ...p,
            metrics: p.erpProject
              ? await new ERPNext(req.tenant).projectMetrics(p.erpProject)
              : null,
          };
        } catch {
          return { ...p, metrics: null, metricsError: "ERPNext 暂时不可用" };
        }
      }),
    );
  }
  @Post("companies/:companyId/projects") async project(
    @Req() req: R,
    @Body() raw: unknown,
  ) {
    const b = projectSchema.parse(raw);
    const erp = new ERPNext(req.tenant);
    const result = await erp.request("/api/resource/Project", "POST", {
      project_name: `${b.name} · ${randomBytes(3).toString("hex")}`,
      company: req.tenant.erpCompany,
      expected_start_date: new Date().toISOString().slice(0, 10),
      status: "Open",
    });
    return db.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: { ...b, tenantId: req.tenant.id, erpProject: result.name },
      });
      await tx.audit.create({
        data: {
          tenantId: req.tenant.id,
          userId: req.user.id,
          action: "PROJECT_CREATED",
          resourceId: p.id,
          detail: { erpProject: result.name },
        },
      });
      return p;
    });
  }
  @Get("companies/:companyId/bank") bank(@Req() req: R) {
    return db.bankTransaction.findMany({
      where: { tenantId: req.tenant.id },
      orderBy: { date: "desc" },
      take: 1000,
    });
  }
  @Post("companies/:companyId/bank/:id/match") async match(
    @Req() req: R,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const b = z.object({ erpName: z.string().min(1).max(150) }).parse(raw);
    const bank = await db.bankTransaction.findFirst({
      where: { id, tenantId: req.tenant.id },
    });
    if (!bank) fail("流水不存在", 404);
    if (bank.matchedErpName) fail("该流水已匹配");
    const erp = new ERPNext(req.tenant);
    const journal = await erp.request(
      `/api/resource/Journal%20Entry/${encodeURIComponent(b.erpName)}`,
    );
    if (journal.company !== req.tenant.erpCompany || journal.docstatus !== 1)
      fail("只可匹配当前公司已提交的凭证");
    if (journal.posting_date !== bank.date) fail("流水日期与凭证日期不一致");
    const accounts = await erp.accounts();
    const bankNames = accounts
      .filter((a: any) => ["Bank", "Cash"].includes(a.account_type))
      .map((a: any) => a.name);
    const net = journal.accounts
      .filter((a: any) => bankNames.includes(a.account))
      .reduce(
        (s: number, a: any) =>
          s +
          Math.round(
            (a.debit_in_account_currency - a.credit_in_account_currency) * 100,
          ),
        0,
      );
    if (net !== bank.amountCents) fail("凭证的银行/现金净额与流水不一致");
    return db.$transaction(
      async (tx) => {
        const found = await tx.bankTransaction.findFirst({
          where: { tenantId: req.tenant.id, matchedErpName: b.erpName },
        });
        if (found) fail("该凭证已被另一条流水匹配");
        const updated = await tx.bankTransaction.updateMany({
          where: { id, matchedErpName: null },
          data: { matchedErpName: b.erpName },
        });
        if (!updated.count) fail("流水已被其他操作更新", 409);
        await tx.audit.create({
          data: {
            tenantId: req.tenant.id,
            userId: req.user.id,
            action: "BANK_MATCHED",
            resourceId: id,
            detail: b,
          },
        });
        return { ok: true };
      },
      { isolationLevel: "Serializable" },
    );
  }
  @Get("companies/:companyId/audit") logs(@Req() req: R) {
    return db.audit.findMany({
      where: { tenantId: req.tenant.id },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
  }
  @Get("companies/:companyId/processors") async processors(@Req() req: R) {
    const records = await db.processorConfig.findMany({
      where: { id: { startsWith: `${req.tenant.id}:` } },
    });
    return [
      {
        id: "parser",
        name: "文件解析 / 银行流水",
        version: "1.0.0",
        enabled: records.find((r) => r.id.endsWith(":parser"))?.enabled ?? true,
      },
      {
        id: "ocr",
        name: "图像 OCR",
        version: "接口预留",
        enabled: false,
        note: "未配置，图片与扫描件由人工录入",
      },
      {
        id: "llm",
        name: "OpenAI 兼容模型",
        version: "1.0.0",
        enabled: records.find((r) => r.id.endsWith(":llm"))?.enabled ?? false,
        config: (() => {
          const c = records.find((r) => r.id.endsWith(":llm"))?.config as any;
          return c
            ? { endpoint: c.endpoint, model: c.model, hasKey: !!c.apiKey }
            : null;
        })(),
      },
    ];
  }
  @Patch("companies/:companyId/processors/:id") async processor(
    @Req() req: R,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    if (!["parser", "llm"].includes(id)) fail("该处理器暂不可配置");
    const b = z
      .object({
        enabled: z.boolean(),
        endpoint: z.string().url().optional(),
        model: z.string().max(150).optional(),
        apiKey: z.string().max(1000).optional(),
        acknowledgeCloud: z.boolean().optional(),
      })
      .parse(raw);
    const old = await db.processorConfig.findUnique({
      where: { id: `${req.tenant.id}:${id}` },
    });
    const config: any = { ...(old?.config as any) };
    if (id === "llm") {
      if (b.enabled && !b.acknowledgeCloud)
        fail("请明确确认将脱敏后的单据文本发送至所配置的模型供应商");
      if (b.endpoint) {
        if (!b.endpoint.startsWith("https://")) fail("模型地址必须为 HTTPS");
        config.endpoint = b.endpoint;
      }
      if (b.model) config.model = b.model;
      if (b.apiKey) config.apiKey = encrypt(b.apiKey);
      if (b.enabled && (!config.endpoint || !config.model || !config.apiKey))
        fail("请配置地址、模型和密钥");
    }
    return db.$transaction(async (tx) => {
      await tx.processorConfig.upsert({
        where: { id: `${req.tenant.id}:${id}` },
        create: { id: `${req.tenant.id}:${id}`, enabled: b.enabled, config },
        update: { enabled: b.enabled, config },
      });
      await tx.audit.create({
        data: {
          tenantId: req.tenant.id,
          userId: req.user.id,
          action: "PROCESSOR_CONFIGURED",
          resourceId: id,
          detail: {
            enabled: b.enabled,
            endpoint: config.endpoint ?? null,
            model: config.model ?? null,
          },
        },
      });
      return { ok: true };
    });
  }
}

@Module({ controllers: [ApiController] })
class FinanceModule {}
export async function createFinanceApp() {
  const app = await NestFactory.create(FinanceModule, {
    bodyParser: false,
    logger: false,
  });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(
    "/api/finance",
    requireOrigin,
    async (req: Request, res: Response, next: NextFunction) => {
      res.setHeader("Cache-Control", "no-store");
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        if (
          existsSync(
            path.join(process.env.UPLOAD_DIR ?? "./uploads", ".maintenance"),
          )
        )
          return res.status(503).json({ message: "系统维护中，请稍后再试" });
        activeWrites++;
        let finished = false;
        const finish = () => {
          if (!finished) {
            finished = true;
            activeWrites--;
          }
        };
        res.once("finish", finish);
        res.once("close", finish);
      }
      if (req.path === "/health" && req.method === "GET") return next();
      await financeAuthorization(req, res, next);
    },
  );
  const ledger = express.Router();
  registerLedger(ledger);
  app.use("/api/finance", ledger);
  app.use(errors);
  app.useGlobalFilters({
    catch(exception: any, host: any) {
      const res = host.switchToHttp().getResponse();
      if (exception instanceof z.ZodError)
        return res.status(400).json({ message: "请检查填写内容" });
      if (exception instanceof HttpException)
        return res
          .status(exception.getStatus())
          .json({ message: exception.message });
      if (exception.code === "P2002")
        return res
          .status(409)
          .json({ message: "记录已存在或发票号码重复，请核对" });
      if (exception.code === "P2025")
        return res.status(404).json({ message: "记录不存在" });
      if (exception.status && exception.code)
        return res
          .status(exception.status)
          .json({ message: exception.message, code: exception.code });
      // Business validators use controlled errors; never expose Prisma, filesystem or credential details.
      const allowed =
        /^(公司或原始单据不匹配|该会计期间已锁定|税额不能大于含税金额|发票必须填写号码|每个分录必须|科目不属于|借贷必须平衡|ERPNext 拒绝请求|当前账套尚未连接|凭证公司不匹配|凭证已撤销)/;
      return res
        .status(400)
        .json({
          message: allowed.test(exception.message ?? "")
            ? exception.message
            : "操作未完成，请刷新后重试",
        });
    },
  });
  await app.init();
  return app;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = await createFinanceApp();
  await app.listen(Number(process.env.PORT ?? 3102), "0.0.0.0");
  console.log("Finance API ready");
  process.once("SIGTERM", async () => {
    await app.close();
    await queue.close();
    await db.$disconnect();
    process.exit(0);
  });
}
