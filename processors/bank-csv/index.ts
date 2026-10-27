import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
export function money(value: unknown): number {
  const s = String(value ?? "")
    .trim()
    .replace(/[,¥￥\s]/g, "");
  if (!s) return 0;
  if (!/^-?\d+(\.\d{1,2})?$/.test(s))
    throw new Error(`金额格式不正确：${s.slice(0, 30)}`);
  const negative = s.startsWith("-"),
    [a, b = ""] = s.replace("-", "").split(".");
  const result = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 2_000_000_000)
    throw new Error("金额超出支持范围");
  return negative ? -result : result;
}
export function normalizeBankRows(rows: Record<string, unknown>[]) {
  return rows.map((r, index) => {
    const find = (keys: string[]) =>
      keys
        .map((k) => r[k])
        .find((v) => v !== undefined && v !== null && String(v).trim() !== "");
    const rawDate = find(["交易日期", "日期", "记账日期", "date"]);
    let date =
      rawDate instanceof Date
        ? rawDate.toISOString().slice(0, 10)
        : String(rawDate ?? "")
            .trim()
            .replace(/[/.]/g, "-")
            .slice(0, 10);
    if (/^\d{8}$/.test(date))
      date = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      throw new Error(`第 ${index + 2} 行交易日期无效，请使用 YYYY-MM-DD`);
    const amount = find(["交易金额", "金额", "amount"]);
    const direction = String(find(["借贷标志", "收支方向", "direction"]) ?? "");
    const amountCents =
      amount !== undefined
        ? money(amount) *
          (["支出", "借", "借方", "付款", "out"].includes(direction) ? -1 : 1)
        : money(find(["收入", "收入金额", "贷方发生额", "credit"])) -
          money(find(["支出", "支出金额", "借方发生额", "debit"]));
    if (!amountCents) throw new Error(`第 ${index + 2} 行交易金额为空或为零`);
    const counterparty = String(
        find(["对方户名", "交易对手", "对方名称", "counterparty"]) ??
          "未提供交易对手",
      ).slice(0, 200),
      memo = String(find(["摘要", "用途", "备注", "memo"]) ?? "").slice(0, 500),
      serial = String(find(["流水号", "交易流水号", "reference"]) ?? "");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([date, counterparty, amountCents, memo, serial]))
      .digest("hex");
    return { date, counterparty, amountCents, memo, fingerprint };
  });
}
export async function parseBank(buffer: Buffer, filename: string) {
  let rows: Record<string, unknown>[];
  if (filename.toLowerCase().endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount > 10001)
      throw new Error("Excel 为空或超过 10000 行");
    const headers = (sheet.getRow(1).values as any[])
      .slice(1)
      .map((v) => String(v ?? "").trim());
    rows = [];
    sheet.eachRow((row, i) => {
      if (i === 1) return;
      const record: Record<string, unknown> = {};
      headers.forEach((h, j) => {
        record[h] = row.getCell(j + 1).value;
      });
      rows.push(record);
    });
  } else {
    const text =
      buffer[0] === 0xff && buffer[1] === 0xfe
        ? buffer.toString("utf16le")
        : new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    rows = parse(text, {
      columns: (h: string[]) => h.map((x) => x.trim()),
      bom: true,
      skip_empty_lines: true,
      trim: true,
    });
    if (rows.length > 10000) throw new Error("CSV 超过 10000 行");
  }
  if (!rows.length) throw new Error("文件没有交易记录");
  return normalizeBankRows(rows);
}
