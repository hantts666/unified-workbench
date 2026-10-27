import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { chromium } from "playwright";
import { databaseUrl } from "../scripts/lib/private-config.mjs";
import { createWebServer } from "../scripts/lib/web-server.mjs";
process.env.PLATFORM_DATABASE_URL = databaseUrl("platform");
process.env.COOKIE_SECURE = "false";
const { db } = await import("../apps/platform-api/src/db.ts");
const { passwordHash } = await import("../apps/platform-api/src/security.ts");
const { seedDefinitions } = await import("../apps/platform-api/src/seed.ts");
const { createPlatformApp } = await import("../apps/platform-api/src/main.ts");
const prefix = "qa-portal-" + randomUUID(),
  password = randomUUID() + "Ui",
  checks = [],
  errors = [];
let app, server, browser;
try {
  await seedDefinitions();
  const admin = await db.user.create({
    data: {
      account: prefix + "-admin",
      displayName: "平台管理员",
      passwordHash: await passwordHash(password),
      assignments: {
        create: {
          roleId: "platform-admin",
          applicationId: "platform",
          scopeType: "instance",
        },
      },
    },
  });
  app = await createPlatformApp();
  await app.listen(0, "127.0.0.1");
  server = createWebServer({ platformOrigin: await app.getUrl() });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(60000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + "/platform/users");
  await page.getByLabel("账号", { exact: true }).fill(admin.account);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("heading", { name: "你好，平台管理员" }).waitFor();
  assert.equal(
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "财务工作台", exact: true })
      .count(),
    0,
  );
  checks.push(
    "unified login and layout; administrator has no implicit finance entry",
  );
  fs.mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/T06-portal.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "用户管理", exact: true })
    .click();
  await page.getByRole("button", { name: "新增用户", exact: true }).click();
  await page.getByLabel("姓名", { exact: true }).fill("门户只读验收成员");
  await page.getByLabel("账号", { exact: true }).fill(prefix + "-reader");
  await page.getByLabel("初始密码", { exact: true }).fill(password);
  await page.getByRole("dialog").getByRole("button", { name: "确 定" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page
    .getByRole("cell", { name: prefix + "-reader", exact: true })
    .waitFor();
  checks.push("create user with real HTTP and database persistence");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "公司管理", exact: true })
    .click();
  await page.getByRole("button", { name: "新增公司", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill(prefix + " 示例公司");
  await page.getByLabel("公司简称", { exact: true }).fill("示例");
  await page.getByRole("dialog").getByRole("button", { name: "确 定" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  checks.push("create company through platform UI");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "角色管理", exact: true })
    .click();
  await page.getByRole("button", { name: "新增角色", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("门户只读验收角色");
  await page.getByLabel("角色标识", { exact: true }).fill(prefix);
  await page.getByRole("checkbox", { name: "查看单据", exact: true }).check();
  await page.getByRole("dialog").getByRole("button", { name: "确 定" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  checks.push("create application-scoped role through platform UI");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "成员授权", exact: true })
    .click();
  await page.getByRole("combobox", { name: "选择用户" }).click();
  await page
    .getByRole("option", { name: `门户只读验收成员 (${prefix}-reader)` })
    .click();
  await page
    .getByRole("checkbox", { name: prefix + " 示例公司", exact: true })
    .check();
  await page.getByRole("button", { name: "保存公司范围" }).click();
  await page.getByText("授权已更新，即时生效").first().waitFor();
  await page.getByRole("combobox", { name: "选择角色" }).click();
  await page
    .getByRole("option", { name: "财务工作台 · 门户只读验收角色", exact: true })
    .click();
  await page.getByRole("combobox", { name: "授权公司" }).click();
  await page
    .getByRole("option", { name: prefix + " 示例公司", exact: true })
    .click();
  await page.getByRole("button", { name: "添加角色授权" }).click();
  await page
    .getByRole("cell", { name: "门户只读验收角色", exact: true })
    .waitFor();
  checks.push(
    "grant company membership and application role through platform UI",
  );
  await page.getByRole("button", { name: "平台管理员", exact: false }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await page.getByLabel("账号", { exact: true }).fill(prefix + "-reader");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("heading", { name: "你好，门户只读验收成员" }).waitFor();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "财务工作台", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "用户管理", exact: true })
      .count(),
    0,
  );
  checks.push(
    "reader sees permitted application and no platform management menus",
  );
  await page.goto(origin + "/platform/users");
  await page.getByText("没有此页面的访问权限", { exact: true }).waitFor();
  const status = await page.evaluate(async () => {
    const r = await fetch("/api/platform/users");
    return r.status;
  });
  assert.equal(status, 403);
  checks.push(
    "direct URL and direct API access both reject unauthorized reader",
  );
  await page.reload();
  await page.getByText("没有此页面的访问权限", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  checks.push(
    "direct route refresh preserves authorization and has no browser errors",
  );
  fs.writeFileSync(
    "test-results/T06-portal.json",
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        result: "passed",
        browser: browser.version(),
        database: "real PostgreSQL",
        api: "real NestJS HTTP",
        checks,
        pageErrors: errors,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`T06 portal passed (${checks.length} checks)`);
} catch (error) {
  console.error(
    "T06 failed after",
    checks.length,
    "checks:",
    error.name,
    error.message?.slice(0, 200),
  );
  if (browser)
    await browser
      .contexts()[0]
      ?.pages()[0]
      ?.screenshot({ path: "test-results/T06-failure.png", fullPage: true });
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await app?.close();
  const users = await db.user.findMany({
    where: { account: { startsWith: prefix } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await db.roleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await db.userCompany.deleteMany({ where: { userId: { in: ids } } });
  await db.session.deleteMany({ where: { userId: { in: ids } } });
  await db.platformAudit.deleteMany({ where: { actorId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.company.deleteMany({ where: { name: { startsWith: prefix } } });
  await db.role.deleteMany({ where: { code: prefix } });
  await db.$disconnect();
}
