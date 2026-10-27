import { suggestionSchema, type Suggestion } from "../finance-contracts/index.js";
export function validateJournal(
  input: unknown,
  scope: {
    tenantId: string;
    documentId: string;
    lockedThrough: string;
    accounts?: string[];
  },
): Suggestion {
  const s = suggestionSchema.parse(input);
  if (s.tenantId !== scope.tenantId || s.sourceDocumentId !== scope.documentId)
    throw new Error("公司或原始单据不匹配");
  if (scope.lockedThrough && s.transactionDate <= scope.lockedThrough)
    throw new Error("该会计期间已锁定");
  if (s.taxCents > s.amountCents) throw new Error("税额不能大于含税金额");
  if (s.documentType === "invoice" && !s.invoiceNumber?.trim())
    throw new Error("发票必须填写号码以检测重复记账");
  let debit = 0,
    credit = 0;
  for (const e of s.entries) {
    if (e.debitCents > 0 === e.creditCents > 0)
      throw new Error("每个分录必须且只能填写借方或贷方");
    if (scope.accounts && !scope.accounts.includes(e.account))
      throw new Error("科目不属于当前公司或不是可记账科目");
    debit += e.debitCents;
    credit += e.creditCents;
  }
  if (!debit || debit !== credit || debit !== s.amountCents)
    throw new Error("借贷必须平衡，且合计必须等于单据金额");
  return s;
}
