import { z } from "zod";
export const cents = z.number().int().min(0).max(2_000_000_000);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "日期无效",
  );
export const entrySchema = z.object({
  account: z.string().min(1),
  debitCents: cents,
  creditCents: cents,
  project: z.string().optional(),
});
export const suggestionSchema = z.object({
  tenantId: z.string(),
  sourceDocumentId: z.string(),
  documentType: z.enum(["expense", "invoice", "bank", "manual"]),
  invoiceNumber: z.string().trim().max(100).optional(),
  transactionDate: date,
  counterparty: z.string().max(200),
  amountCents: cents,
  taxCents: cents,
  currency: z.literal("CNY"),
  suggestedAccount: z.string(),
  suggestedProject: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reasoningSummary: z.string().max(3000),
  supportingEvidence: z.array(z.string().max(2000)).max(30),
  entries: z.array(entrySchema).min(2).max(100),
});
export type Suggestion = z.infer<typeof suggestionSchema>;
export const projectSchema = z.object({
  name: z.string().trim().min(1).max(150),
  customer: z.string().max(150),
  manager: z.string().max(100),
  contractCents: cents,
  budgetCents: cents,
});
