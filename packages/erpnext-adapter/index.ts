import { decrypt } from "../../apps/finance-api/src/db.js";
import type { LedgerBinding as Tenant } from "../../.generated/finance/index.js";
import type { Suggestion } from "../finance-contracts/index.js";
export class ERPNext {
  constructor(private tenant: Tenant) {}
  async request(path: string, method = "GET", body?: unknown) {
    if (!this.tenant.apiCredential) throw new Error("当前账套尚未连接 ERPNext");
    const base = process.env.ERP_ORIGIN;
    if (!base) throw new Error("ERP_ORIGIN 未配置");
    const r = await fetch(new URL(path, base), {
      method,
      headers: {
        Authorization: `token ${decrypt(this.tenant.apiCredential)}`,
        "X-Frappe-Site-Name": this.tenant.siteName,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(35000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("ERP request rejected", r.status);
      throw new Error(
        `ERPNext 拒绝请求（${r.status}），请检查期间、科目和账套配置`,
      );
    }
    return data.data ?? data.message;
  }
  list(doctype: string, fields: string[], filters: unknown[], limit = 500) {
    return this.request(
      `/api/resource/${encodeURIComponent(doctype)}?${new URLSearchParams({ fields: JSON.stringify(fields), filters: JSON.stringify(filters), limit_page_length: String(limit), order_by: "modified desc" })}`,
    );
  }
  accounts() {
    return this.list(
      "Account",
      [
        "name",
        "account_name",
        "account_number",
        "root_type",
        "account_type",
        "is_group",
      ],
      [
        ["company", "=", this.tenant.erpCompany],
        ["is_group", "=", 0],
        ["disabled", "=", 0],
      ],
    );
  }
  journals() {
    return this.list(
      "Journal Entry",
      [
        "name",
        "posting_date",
        "total_debit",
        "total_credit",
        "docstatus",
        "user_remark",
      ],
      [["company", "=", this.tenant.erpCompany]],
      100,
    );
  }
  async draft(s: Suggestion, reference: string) {
    const existing = await this.list(
      "Journal Entry",
      ["name", "docstatus"],
      [
        ["company", "=", this.tenant.erpCompany],
        ["custom_platform_reference", "=", reference],
      ],
      2,
    );
    if (existing.length) return existing[0];
    return this.request("/api/resource/Journal%20Entry", "POST", {
      doctype: "Journal Entry",
      company: this.tenant.erpCompany,
      voucher_type: "Journal Entry",
      posting_date: s.transactionDate,
      user_remark: `${s.counterparty} · ${s.reasoningSummary}\n原始单据 ${reference}`,
      custom_platform_reference: reference,
      accounts: s.entries.map((e) => ({
        account: e.account,
        debit_in_account_currency: e.debitCents / 100,
        credit_in_account_currency: e.creditCents / 100,
        ...(e.project ? { project: e.project } : {}),
      })),
    });
  }
  async submit(name: string) {
    const doc = await this.request(
      `/api/resource/Journal%20Entry/${encodeURIComponent(name)}`,
    );
    if (doc.company !== this.tenant.erpCompany)
      throw new Error("凭证公司不匹配");
    if (doc.docstatus === 1) return doc;
    if (doc.docstatus !== 0) throw new Error("凭证已撤销");
    return this.request("/api/method/frappe.client.submit", "POST", { doc });
  }
  report(name: string, filters: object) {
    return this.request("/api/method/frappe.desk.query_report.run", "POST", {
      report_name: name,
      filters: { company: this.tenant.erpCompany, ...filters },
      ignore_prepared_report: true,
    });
  }
  async projectMetrics(project: string) {
    const gl = await this.list(
      "GL Entry",
      ["account", "debit", "credit", "voucher_type", "voucher_no"],
      [
        ["company", "=", this.tenant.erpCompany],
        ["project", "=", project],
        ["is_cancelled", "=", 0],
      ],
      5000,
    );
    const accounts = await this.accounts();
    const kinds = new Map(accounts.map((a: any) => [a.name, a]));
    let income = 0,
      cost = 0,
      received = 0,
      paid = 0;
    for (const e of gl) {
      const a: any = kinds.get(e.account);
      if (a?.root_type === "Income") income += e.credit - e.debit;
      if (a?.root_type === "Expense") cost += e.debit - e.credit;
      if (["Bank", "Cash"].includes(a?.account_type)) {
        received += e.debit;
        paid += e.credit;
      }
    }
    const invoices = await this.list(
      "Sales Invoice",
      ["name", "grand_total", "outstanding_amount"],
      [
        ["company", "=", this.tenant.erpCompany],
        ["project", "=", project],
        ["docstatus", "=", 1],
      ],
      5000,
    );
    return {
      income,
      cost,
      received,
      paid,
      invoiced: invoices.reduce((a: number, b: any) => a + b.grand_total, 0),
      receivable: invoices.reduce(
        (a: number, b: any) => a + b.outstanding_amount,
        0,
      ),
      truncated: gl.length === 5000 || invoices.length === 5000,
    };
  }
}
