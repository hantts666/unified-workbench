import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import {privateConfig,databaseUrl} from "../scripts/lib/private-config.mjs";
const config=privateConfig();
Object.assign(process.env,{PLATFORM_DATABASE_URL:databaseUrl('platform'),FINANCE_DATABASE_URL:databaseUrl('finance'),MASTER_KEY:config.MASTER_KEY,ERP_ORIGIN:'http://127.0.0.1:28180'});
const {db}=await import('../apps/finance-api/src/db.js');
const {db:platformDb}=await import('../apps/platform-api/src/db.js');
const {passwordHash}=await import('../apps/platform-api/src/security.js');
const {ERPNext}=await import('../packages/erpnext-adapter/index.js');
import { pdfFixture } from "./pdf-fixture.js";
const base = process.env.DEPLOYED_TEST_BASE;
assert.ok(base,'DEPLOYED_TEST_BASE required');
const loginPath=process.env.TEST_LOGIN_FILE;
assert.ok(loginPath,'Private TEST_LOGIN_FILE required');
const credentials=JSON.parse(fs.readFileSync(loginPath,'utf8'));
let cookie = "";
const results: { name: string; ok: boolean; detail?: string }[] = [];
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  session = cookie,
) {
  const r = await fetch(`${base}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: session, Origin: base },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json();
  return { r, json };
}
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log("PASS", name);
  } catch (e: any) {
    results.push({ name, ok: false, detail: e.message });
    console.error("FAIL", name, e.message);
  }
}
const login = await request(
  "/platform/auth/login",
  "POST",
  { account: credentials.account ?? credentials.email, password: credentials.password },
  "",
);
assert.ok(login.r.ok, "admin login");
cookie = login.r.headers.get("set-cookie")!.split(";")[0];
const tenants = (await request("/platform/companies")).json;
const a = tenants.find((t: any) => t.id === "demo-a"),
  b = tenants.find((t: any) => t.id === "demo-b");
assert.ok(a && b);
for(const company of [a,b]){const ledger=await db.ledgerBinding.findUniqueOrThrow({where:{id:company.id}});assert.match(ledger.siteName,/^unified-migration-[ab]\.localhost$/,'Regression must only write isolated restored sites');}
const beforeJournals=await new ERPNext(await db.ledgerBinding.findUniqueOrThrow({where:{id:a.id}})).journals();
const ab = `/finance/companies/${a.id}`,
  bb = `/finance/companies/${b.id}`;
const accounts = (await request(`${ab}/accounts`)).json;
const bank = accounts.find((x: any) => x.account_name === "银行存款-测试"),
  expense = accounts.find((x: any) => x.account_name === "管理费用-测试"),
  income = accounts.find((x: any) => x.account_name === "主营业务收入-测试");
assert.ok(bank && expense && income, "test accounts");
const date = "2026-10-15";
const newDoc = async () => {
  const result = await request(`${ab}/manual-document`, "POST", {});
  assert.ok(result.r.ok, JSON.stringify(result.json));
  return result.json;
};
function suggestion(doc: any, amount = 12345) {
  return {
    ...doc.suggestion,
    transactionDate: date,
    counterparty: "虚构测试供应商",
    amountCents: amount,
    taxCents: 0,
    entries: [
      { account: expense.name, debitCents: amount, creditCents: 0 },
      { account: bank.name, debitCents: 0, creditCents: amount },
    ],
    reasoningSummary: "自动化隔离测试 · 仅虚构测试账套",
  };
}
let submittedName = "",
  sourceId = "";
await check("无登录无法读取业务数据", async () =>
  assert.equal(
    (await request(`${ab}/documents`, "GET", undefined, "")).r.status,
    401,
  ),
);
const restrictedPassword = randomBytes(20).toString("hex");
const restricted=await platformDb.user.create({data:{account:'qa-regression-'+randomBytes(12).toString('hex'),displayName:'回归审核员',passwordHash:await passwordHash(restrictedPassword)}});
await platformDb.userCompany.create({data:{userId:restricted.id,companyId:a.id}});
await platformDb.roleAssignment.create({data:{userId:restricted.id,roleId:'legacy-finance-reviewer',applicationId:'finance',scopeType:'company',companyId:a.id}});
const restrictedLogin = await request(
  "/platform/auth/login",
  "POST",
  { account: restricted.account, password: restrictedPassword },
  "",
);
const restrictedCookie = restrictedLogin.r.headers
  .get("set-cookie")!
  .split(";")[0];
await check("公司隔离：只列出获授权公司", async () => {
  const r = await request("/platform/companies", "GET", undefined, restrictedCookie);
  assert.deepEqual(
    r.json.map((t: any) => t.id),
    [a.id],
  );
  await check("跨站写请求拒绝", async () => {
    const response = await fetch(base + "/api" + ab + "/manual-document", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://untrusted.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(response.status, 403);
  });
});
await check("公司隔离：越权读取和写入均拒绝", async () => {
  for (const route of [
    "/documents",
    "/accounts",
    "/bank",
    "/audit",
    "/projects",
  ])
    assert.equal(
      (await request(bb + route, "GET", undefined, restrictedCookie)).r.status,
      403,
    );
  assert.equal(
    (await request(`${bb}/manual-document`, "POST", {}, restrictedCookie)).r
      .status,
    403,
  );
});
await check("审核更正 → ERP 草稿 → 正式提交和重试幂等", async () => {
  const doc = await newDoc();
  sourceId = doc.id;
  const s = suggestion(doc);
  assert.ok((await request(`${ab}/documents/${doc.id}`, "PATCH", s)).r.ok);
  const results = await Promise.all([
    request(`${ab}/documents/${doc.id}/draft`, "POST", {}),
    request(`${ab}/documents/${doc.id}/draft`, "POST", {}),
  ]);
  const created = results.find((r) => r.r.ok);
  assert.ok(created, JSON.stringify(results.map((r) => r.json)));
  submittedName = created.json.name;
  const repeat = await request(`${ab}/documents/${doc.id}/draft`, "POST", {});
  assert.equal(repeat.json.name, submittedName);
  assert.equal(
    (await request(`${ab}/documents/${doc.id}/submit`, "POST", {})).r.status,
    400,
  );
  assert.equal(
    (
      await request(
        `${ab}/documents/${doc.id}/submit`,
        "POST",
        { confirmation: "确认提交正式账务" },
        restrictedCookie,
      )
    ).r.status,
    403,
  );
  const submit = await request(`${ab}/documents/${doc.id}/submit`, "POST", {
    confirmation: "确认提交正式账务",
  });
  assert.ok(submit.r.ok, JSON.stringify(submit.json));
  assert.equal(
    (
      await request(`${ab}/documents/${doc.id}/submit`, "POST", {
        confirmation: "确认提交正式账务",
      })
    ).json.name,
    submittedName,
  );
  const journals = await request(`${ab}/journals`);
  assert.equal(
    journals.json.filter((j: any) => j.name === submittedName).length,
    1,
  );
  assert.equal(
    journals.json.find((j: any) => j.name === submittedName).docstatus,
    1,
  );
});
await check("公司隔离：其他公司的原件不可读取", async () => {
  assert.equal(
    (await request(`${bb}/documents/${sourceId}/draft`, "POST", {})).r.status,
    404,
  );
  const r = await fetch(`${base}/api${bb}/documents/${sourceId}/file`, {
    headers: { Cookie: cookie, Origin: base },
  });
  assert.equal(r.status, 404);
});
await check("不平衡分录与锁定期间拒绝创建草稿", async () => {
  const doc = await newDoc();
  const s = suggestion(doc);
  s.entries[1].creditCents--;
  assert.ok((await request(`${ab}/documents/${doc.id}`, "PATCH", s)).r.ok);
  const result = await request(`${ab}/documents/${doc.id}/draft`, "POST", {});
  assert.equal(result.r.status, 400);
  assert.match(result.json.message, /借贷/);
  const locked = await db.ledgerBinding.findUniqueOrThrow({ where: { id: a.id } });
  try {
    await db.ledgerBinding.update({
      where: { id: a.id },
      data: { lockedThrough: date },
    });
    assert.ok(
      (await request(`${ab}/documents/${doc.id}`, "PATCH", suggestion(doc))).r
        .ok,
    );
    const r = await request(`${ab}/documents/${doc.id}/draft`, "POST", {});
    assert.equal(r.r.status, 400);
    assert.match(r.json.message, /期间/);
  } finally {
    await db.ledgerBinding.update({
      where: { id: a.id },
      data: { lockedThrough: locked.lockedThrough },
    });
  }
});
await check("不同文件登记相同发票号码拒绝重复", async () => {
  const one = await newDoc(),
    two = await newDoc(),
    invoiceNumber = "TEST-" + randomBytes(8).toString("hex");
  assert.ok(
    (
      await request(`${ab}/documents/${one.id}`, "PATCH", {
        ...suggestion(one),
        documentType: "invoice",
        invoiceNumber,
      })
    ).r.ok,
  );
  assert.equal(
    (
      await request(`${ab}/documents/${two.id}`, "PATCH", {
        ...suggestion(two),
        documentType: "invoice",
        invoiceNumber,
      })
    ).r.status,
    409,
  );
});
await check("ERP 已写入但平台响应中断后可安全恢复", async () => {
  const doc = await newDoc();
  const s = suggestion(doc, 789);
  assert.ok((await request(`${ab}/documents/${doc.id}`, "PATCH", s)).r.ok);
  const erp = new ERPNext(
    await db.ledgerBinding.findUniqueOrThrow({ where: { id: a.id } }),
  );
  const remote = await erp.draft(s, doc.id);
  const recover = await request(`${ab}/documents/${doc.id}/draft`, "POST", {});
  assert.ok(recover.r.ok, JSON.stringify(recover.json));
  assert.equal(recover.json.name, remote.name);
  await erp.submit(remote.name);
  const submit = await request(`${ab}/documents/${doc.id}/submit`, "POST", {
    confirmation: "确认提交正式账务",
  });
  assert.ok(submit.r.ok, JSON.stringify(submit.json));
  assert.equal(submit.json.name, remote.name);
  const journalList = await erp.list(
    "Journal Entry",
    ["name"],
    [["custom_platform_reference", "=", doc.id]],
    5,
  );
  assert.equal(journalList.length, 1);
});
await check("上传去重、后台解析与银行金额匹配", async () => {
  const data = `交易日期,对方户名,收入,支出,摘要,流水号\n${date},虚构测试供应商,0,123.45,自动化测试费用,${sourceId}\n`;
  async function upload() {
    const fd = new FormData();
    fd.append(
      "file",
      new Blob(["\ufeff" + data], { type: "text/csv" }),
      "integration-bank.csv",
    );
    const r = await fetch(`${base}/api${ab}/documents`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: base },
      body: fd,
    });
    const json: any = await r.json();
    assert.ok(r.ok, JSON.stringify(json));
    return json;
  }
  const first = await upload(),
    second = await upload();
  assert.equal(second.id, first.id);
  assert.equal(second.duplicate, true);
  let doc: any;
  for (let i = 0; i < 40; i++) {
    doc = (await request(`${ab}/documents`)).json.find(
      (d: any) => d.id === first.id,
    );
    if (doc.status === "ARCHIVED" || doc.status === "FAILED") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(doc.status, "ARCHIVED", JSON.stringify(doc));
  const bankRows = (await request(`${ab}/bank`)).json;
  const row = bankRows.find((r: any) => r.sourceDocumentId === first.id);
  assert.ok(row);
  const match = await request(`${ab}/bank/${row.id}/match`, "POST", {
    erpName: submittedName,
  });
  assert.ok(match.r.ok, JSON.stringify(match.json));
  assert.equal(
    (await request(`${ab}/bank`)).json.find((r: any) => r.id === row.id)
      .matchedErpName,
    submittedName,
  );
});
await check("PDF 上传、后台文本提取与人工审核状态", async () => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(pdfFixture())], { type: "application/pdf" }),
    "test-invoice.pdf",
  );
  const response = await fetch(base + "/api" + ab + "/documents", {
    method: "POST",
    headers: { Cookie: cookie, Origin: base },
    body: form,
  });
  const uploaded: any = await response.json();
  assert.ok(response.ok);
  let doc: any;
  for (let i = 0; i < 40; i++) {
    doc = (await request(ab + "/documents")).json.find(
      (d: any) => d.id === uploaded.id,
    );
    if (["REVIEW", "FAILED"].includes(doc.status)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(doc.status, "REVIEW", JSON.stringify(doc));
  assert.match(
    doc.suggestion.supportingEvidence.join(" "),
    /Test invoice CNY 88\.88/,
  );
  assert.equal(doc.suggestion.confidence, 0);
});
await check("项目权责利润与现金视图区分", async () => {
  const p = await request(`${ab}/projects`, "POST", {
    name: "测试项目-" + randomBytes(3).toString("hex"),
    customer: "虚构客户",
    manager: "测试负责人",
    contractCents: 100000,
    budgetCents: 40000,
  });
  assert.ok(p.r.ok, JSON.stringify(p.json));
  const doc = await newDoc();
  const s = suggestion(doc, 10000);
  s.entries = [
    {
      account: expense.name,
      debitCents: 10000,
      creditCents: 0,
      project: p.json.erpProject,
    },
    {
      account: bank.name,
      debitCents: 0,
      creditCents: 10000,
      project: p.json.erpProject,
    },
  ];
  assert.ok((await request(`${ab}/documents/${doc.id}`, "PATCH", s)).r.ok);
  assert.ok(
    (await request(`${ab}/documents/${doc.id}/draft`, "POST", {})).r.ok,
  );
  const r = await request(`${ab}/documents/${doc.id}/submit`, "POST", {
    confirmation: "确认提交正式账务",
  });
  assert.ok(r.r.ok, JSON.stringify(r.json));
  const accrued = accounts.find(
    (item: any) => item.root_type === "Asset" && !item.account_type,
  );
  assert.ok(
    accrued,
    "A normal non-cash asset account exists in the standard chart",
  );
  const record = async (amount: number, debit: string, credit: string) => {
    const source = await newDoc();
    const entry = suggestion(source, amount);
    entry.entries = [
      {
        account: debit,
        debitCents: amount,
        creditCents: 0,
        project: p.json.erpProject,
      },
      {
        account: credit,
        debitCents: 0,
        creditCents: amount,
        project: p.json.erpProject,
      },
    ];
    assert.ok(
      (await request(`${ab}/documents/${source.id}`, "PATCH", entry)).r.ok,
    );
    const draft = await request(
      `${ab}/documents/${source.id}/draft`,
      "POST",
      {},
    );
    assert.ok(draft.r.ok, JSON.stringify(draft.json));
    const result = await request(
      `${ab}/documents/${source.id}/submit`,
      "POST",
      { confirmation: "确认提交正式账务" },
    );
    assert.ok(result.r.ok, JSON.stringify(result.json));
  };
  await record(50000, accrued.name, income.name);
  await record(30000, bank.name, accrued.name);
  const project = (await request(`${ab}/projects`)).json.find(
    (item: any) => item.id === p.json.id,
  );
  assert.equal(project.metrics.cost, 100);
  assert.equal(project.metrics.paid, 100);
  assert.equal(project.metrics.income, 500);
  assert.equal(project.metrics.received, 300);
  assert.equal(project.metrics.income - project.metrics.cost, 400);
  assert.equal(project.metrics.received - project.metrics.paid, 200);
  assert.equal(project.contractCents, 100000);
});
for (const type of ["balance", "profit", "ledger", "receivable", "payable"])
  await check("ERPNext 原生报表可读取：" + type, async () => {
    const r = await request(
      `${ab}/reports/${type}?from=2026-10-01&to=2026-10-31`,
    );
    assert.ok(r.r.ok, JSON.stringify(r.json));
    assert.ok(Array.isArray(r.json.result));
  });
await check("平台利润表与 ERPNext 原生结果逐项一致", async () => {
  const platform = (
    await request(`${ab}/reports/profit?from=2026-10-01&to=2026-10-31`)
  ).json;
  const erp = new ERPNext(
    await db.ledgerBinding.findUniqueOrThrow({ where: { id: a.id } }),
  );
  const native = await erp.report("Profit and Loss Statement", {
    from_date: "2026-10-01",
    to_date: "2026-10-31",
    from_fiscal_year: "2026",
    to_fiscal_year: "2026",
    period_start_date: "2026-10-01",
    period_end_date: "2026-10-31",
    filter_based_on: "Date Range",
    periodicity: "Monthly",
    accumulated_values: 1,
    presentation_currency: "CNY",
    fiscal_year: "2026",
  });
  // Compare the JSON representation used by both HTTP interfaces; JSON serializes -0 as 0.
  assert.deepEqual(platform.result, JSON.parse(JSON.stringify(native.result)));
  assert.ok(platform.result.some((r: any) => r?.account === expense.name));
});
await check("两个真实 Site 的科目与总账互相隔离", async () => {
  const erpB = new ERPNext(
    await db.ledgerBinding.findUniqueOrThrow({ where: { id: b.id } }),
  );
  const bAccounts = await erpB.accounts();
  assert.ok(bAccounts.every((x: any) => x.name.endsWith(" - YS")));
  assert.ok(!bAccounts.some((x: any) => x.name === bank.name));
  const bJournals = await erpB.journals();
  assert.ok(!bJournals.some((x: any) => x.user_remark?.includes(sourceId)));
});
await check("审计记录包含审核修改与正式提交", async () => {
  const logs = (await request(`${ab}/audit`)).json;
  assert.ok(
    logs.some(
      (l: any) => l.resourceId === sourceId && l.action === "SUGGESTION_EDITED",
    ),
  );
  assert.ok(
    logs.some(
      (l: any) => l.resourceId === sourceId && l.action === "ERP_SUBMITTED",
    ),
  );
});
await check("云端模型默认关闭且无密钥回传", async () => {
  const p = (await request(`${ab}/processors`)).json;
  assert.equal(p.find((r: any) => r.id === "llm").enabled, false);
  assert.ok(!JSON.stringify(p).includes("apiSecret"));
});
await check('新增凭证总账借贷平衡且历史凭证保留',async()=>{
  const erp=new ERPNext(await db.ledgerBinding.findUniqueOrThrow({where:{id:a.id}}));
  const after=await erp.journals();
  assert.ok(beforeJournals.every(old=>after.some(current=>current.name===old.name&&current.docstatus===old.docstatus)));
  const fresh=after.filter(current=>!beforeJournals.some(old=>old.name===current.name)&&current.docstatus===1);
  assert.equal(fresh.length,5);
  assert.equal(fresh.reduce((n,j)=>n+Math.round(j.total_debit*100),0),fresh.reduce((n,j)=>n+Math.round(j.total_credit*100),0));
});
await platformDb.roleAssignment.deleteMany({where:{userId:restricted.id}});
await platformDb.userCompany.deleteMany({where:{userId:restricted.id}});
await platformDb.session.deleteMany({where:{userId:restricted.id}});
await platformDb.platformAudit.deleteMany({where:{actorId:restricted.id}});
await platformDb.user.delete({where:{id:restricted.id}});
await platformDb.$disconnect();await db.$disconnect();
fs.mkdirSync('test-results',{recursive:true});
fs.writeFileSync('test-results/T12-finance-regression.json',JSON.stringify({executedAt:new Date().toISOString(),result:results.every(r=>r.ok)?'passed':'failed',transport:'deployed Docker API and worker',erp:'two restored isolated ERPNext sites',checks:results.map(r=>({name:r.name,passed:r.ok}))},null,2)+'\n');
console.log(
  JSON.stringify(
    {
      results,
      passed: results.filter((r) => r.ok).length,
      total: results.length,
    },
    null,
    2,
  ),
);
if (results.some((r) => !r.ok)) process.exitCode = 1;
