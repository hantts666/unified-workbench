import { Worker } from "bullmq";
import { readFile } from "node:fs/promises";
import { db, audit, decrypt } from "../../finance-api/src/db.js";
import { redisConnection, enqueue } from "../../finance-api/src/queue.js";
import { parseBank } from "../../../processors/bank-csv/index.js";
import { extractPdf } from "../../../processors/document-parser/index.js";
import { classify } from "../../../processors/llm-provider/index.js";
import { execute } from "../../../packages/processor-sdk/index.js";
import { ERPNext } from "../../../packages/erpnext-adapter/index.js";
const worker = new Worker(
  "documents",
  async (job) => {
    const doc = await db.document.findUnique({
      where: { id: job.data.id },
      include: { tenant: true },
    });
    if (
      !doc ||
      doc.status !== "PROCESSING" ||
      doc.processingVersion !== job.data.version
    )
      return;
    const config = await db.processorConfig.findUnique({
      where: { id: `${doc.tenantId}:parser` },
    });
    if (config && !config.enabled) throw new Error("文件处理器已停用");
    const buffer = await readFile(doc.storagePath);
    let evidence: string[] = [];
    let reason = "请对照原始文件填写金额和科目；未执行云端 AI。";
    let error: string | null = null;
    let cloudAIUsed = false;
    const suggestion: any = {
      tenantId: doc.tenantId,
      sourceDocumentId: doc.id,
      documentType: "expense",
      transactionDate: new Date().toLocaleDateString("sv-SE", {
        timeZone: "Asia/Shanghai",
      }),
      counterparty: "",
      amountCents: 0,
      taxCents: 0,
      currency: "CNY",
      suggestedAccount: "",
      confidence: 0,
      reasoningSummary: reason,
      supportingEvidence: [],
      entries: [
        { account: "", debitCents: 0, creditCents: 0 },
        { account: "", debitCents: 0, creditCents: 0 },
      ],
    };
    if (/\.(csv|xlsx)$/i.test(doc.filename)) {
      const rows = await execute(
        {
          id: "bank-parser",
          version: "1.0.0",
          timeoutMs: 60000,
          run: () => parseBank(buffer, doc.filename),
        },
        undefined,
      );
      const result = await db.bankTransaction.createMany({
        data: rows.map((r) => ({
          ...r,
          tenantId: doc.tenantId,
          sourceDocumentId: doc.id,
        })),
        skipDuplicates: true,
      });
      suggestion.documentType = "bank";
      suggestion.transactionDate = rows[0].date;
      suggestion.counterparty = "银行流水批次";
      suggestion.reasoningSummary = `共解析 ${rows.length} 行，新增 ${result.count} 行，${rows.length - result.count} 行重复或疑似重复。请到银行流水逐条核对；本文件仅作为批次归档，不可直接整批记账。`;
      suggestion.supportingEvidence = rows
        .slice(0, 10)
        .map(
          (r) => `${r.date} ${r.counterparty} ${r.amountCents / 100} ${r.memo}`,
        );
    } else if (doc.mimeType === "application/pdf") {
      const text = await execute(
        {
          id: "pdf-parser",
          version: "1.0.0",
          timeoutMs: 30000,
          run: () => extractPdf(buffer),
        },
        undefined,
      );
      evidence = text ? [text.slice(0, 2000)] : [];
      if (!text.trim())
        error = "扫描 PDF 需要 OCR，当前未配置供应商；请人工录入";
      const provider = await db.processorConfig.findUnique({
        where: { id: `${doc.tenantId}:llm` },
      });
      if (provider?.enabled && text.trim()) {
        const c = provider.config as any;
        const erp = new ERPNext(doc.tenant);
        const accounts = await erp.accounts();
        await audit(doc.tenantId, "worker", "CLOUD_AI_REQUESTED", doc.id, {
          endpoint: c.endpoint,
          model: c.model,
          redactionVersion: "1.0.0",
        });
        cloudAIUsed = true;
        const ai = await execute(
          {
            id: "llm-openai-compatible",
            version: "1.0.0",
            timeoutMs: 60000,
            run: (_, signal) =>
              classify(
                {
                  endpoint: c.endpoint,
                  apiKey: decrypt(c.apiKey),
                  model: c.model,
                  text,
                  tenantId: doc.tenantId,
                  documentId: doc.id,
                  accounts: accounts.map((a: any) => a.name),
                },
                signal,
              ),
          },
          undefined,
        );
        Object.assign(suggestion, ai);
      } else suggestion.supportingEvidence = evidence;
    } else error = "未配置 OCR 供应商，请对照图片人工录入";
    await db.$transaction(async (tx) => {
      const done = await tx.document.updateMany({
        where: {
          id: doc.id,
          status: "PROCESSING",
          processingVersion: job.data.version,
        },
        data: {
          status: suggestion.documentType === "bank" ? "ARCHIVED" : "REVIEW",
          suggestion,
          error,
        },
      });
      if (done.count)
        await tx.audit.create({
          data: {
            tenantId: doc.tenantId,
            userId: "worker",
            action: "PROCESS_COMPLETED",
            resourceId: doc.id,
            detail: {
              processorVersion: "1.0.0",
              cloudAI: cloudAIUsed,
            },
          },
        });
    });
  },
  { connection: redisConnection(), concurrency: 2, lockDuration: 120000 },
);
worker.on("failed", async (job, error) => {
  console.error("Processing failed", job?.id, error.message);
  if (job && job.attemptsMade >= 3) {
    await db.document.updateMany({
      where: {
        id: job.data.id,
        status: "PROCESSING",
        processingVersion: job.data.version,
      },
      data: { status: "FAILED", error: error.message.slice(0, 500) },
    });
    await audit(
      (await db.document.findUniqueOrThrow({ where: { id: job.data.id } }))
        .tenantId,
      "worker",
      "PROCESS_FAILED",
      job.data.id,
      { message: error.message.slice(0, 500) },
    );
  }
});
async function recover() {
  const docs = await db.document.findMany({
    where: { status: "PROCESSING" },
    take: 500,
  });
  for (const d of docs) await enqueue(d.id, d.processingVersion);
}
await recover();
const timer = setInterval(() => recover().catch(console.error), 30000);
console.log("Document worker ready");
for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, async () => {
    clearInterval(timer);
    await worker.close();
    await db.$disconnect();
    process.exit(0);
  });
