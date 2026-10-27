import { test } from "node:test";
import assert from "node:assert/strict";
import { validateJournal } from "../packages/accounting-rules/index.js";
import { normalizeBankRows, money } from "../processors/bank-csv/index.js";
import { parseBank } from "../processors/bank-csv/index.js";
import ExcelJS from "exceljs";
import { pdfFixture } from "./pdf-fixture.js";
import { extractPdf } from "../processors/document-parser/index.js";
import { redact } from "../processors/llm-provider/index.js";
import { execute } from "../packages/processor-sdk/index.js";
const valid = {
  tenantId: "a",
  sourceDocumentId: "doc",
  documentType: "expense",
  transactionDate: "2026-10-10",
  counterparty: "测试供应商",
  amountCents: 10000,
  taxCents: 600,
  currency: "CNY",
  suggestedAccount: "费用-a",
  confidence: 0,
  reasoningSummary: "人工核对",
  supportingEvidence: [],
  entries: [
    { account: "费用-a", debitCents: 10000, creditCents: 0 },
    { account: "银行-a", debitCents: 0, creditCents: 10000 },
  ],
};
const scope = {
  tenantId: "a",
  documentId: "doc",
  lockedThrough: "2026-09-30",
  accounts: ["费用-a", "银行-a"],
};
test("合法平衡分录允许审核", () =>
  assert.equal(validateJournal(valid, scope).amountCents, 10000));
test("不平衡分录拒绝", () =>
  assert.throws(
    () =>
      validateJournal(
        {
          ...valid,
          entries: [
            valid.entries[0],
            { ...valid.entries[1], creditCents: 9999 },
          ],
        },
        scope,
      ),
    /借贷/,
  ));
test("关闭期间拒绝", () =>
  assert.throws(
    () => validateJournal({ ...valid, transactionDate: "2026-09-30" }, scope),
    /锁定/,
  ));
test("跨公司单据拒绝", () =>
  assert.throws(
    () => validateJournal({ ...valid, tenantId: "b" }, scope),
    /公司/,
  ));
test("跨公司科目拒绝", () =>
  assert.throws(
    () =>
      validateJournal(
        {
          ...valid,
          entries: [
            { ...valid.entries[0], account: "费用-b" },
            valid.entries[1],
          ],
        },
        scope,
      ),
    /科目/,
  ));
test("税额大于总额拒绝", () =>
  assert.throws(
    () => validateJournal({ ...valid, taxCents: 10001 }, scope),
    /税额/,
  ));
test("同一行双边金额拒绝", () =>
  assert.throws(
    () =>
      validateJournal(
        {
          ...valid,
          entries: [
            { ...valid.entries[0], creditCents: 10000 },
            valid.entries[1],
          ],
        },
        scope,
      ),
    /只能/,
  ));
test("非整数分与无效日期拒绝", () => {
  assert.throws(() => validateJournal({ ...valid, amountCents: 10.01 }, scope));
  assert.throws(() =>
    validateJournal({ ...valid, transactionDate: "2026-02-30" }, scope),
  );
});
test("银行金额用整数分精确解析", () => {
  assert.equal(money("1,234.56"), 123456);
  assert.equal(money("-0.01"), -1);
  assert.throws(() => money("1.234"));
});
test("银行语义去重与方向", () => {
  const a = normalizeBankRows([
    {
      交易日期: "2026/10/10",
      对方户名: "测试",
      收入: "1,000.00",
      支出: "0",
      摘要: "项目款",
    },
  ]);
  const b = normalizeBankRows([
    { 交易日期: "2026-10-10", 对方户名: "测试", 收入: "1000", 摘要: "项目款" },
  ]);
  assert.equal(a[0].fingerprint, b[0].fingerprint);
  assert.equal(a[0].amountCents, 100000);
  assert.equal(
    normalizeBankRows([
      { date: "2026-10-10", amount: "12.34", direction: "out" },
    ])[0].amountCents,
    -1234,
  );
});
test("银行缺失日期拒绝", () =>
  assert.throws(() => normalizeBankRows([{ 金额: "100" }]), /日期/));
test("云端传输基础脱敏", () => {
  const value = redact(
    "账号 1234567890123456 手机 13812345678 邮箱 test@example.com",
  );
  assert.ok(!value.includes("1234567890123456"));
  assert.ok(!value.includes("13812345678"));
  assert.ok(!value.includes("test@example.com"));
});
test("外部处理器超时", async () => {
  await assert.rejects(
    execute(
      {
        id: "slow",
        version: "1",
        timeoutMs: 10,
        run: () => new Promise(() => {}),
      },
      undefined,
    ),
    /超时/,
  );
});
test("真实 Excel 文件解析", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("银行流水");
  sheet.addRow(["交易日期", "对方户名", "收入", "支出", "摘要"]);
  sheet.addRow(["2026-10-15", "虚构客户", 123.45, 0, "收款"]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const rows = await parseBank(buffer, "bank.xlsx");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amountCents, 12345);
});
test("发票无号码拒绝", () =>
  assert.throws(
    () => validateJournal({ ...valid, documentType: "invoice" }, scope),
    /号码/,
  ));
test("真实 PDF 文本解析", async () => {
  const text = await extractPdf(pdfFixture());
  assert.match(text, /Test invoice CNY 88\.88/);
});
