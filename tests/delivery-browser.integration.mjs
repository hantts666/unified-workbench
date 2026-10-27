import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {privateConfig} from '../scripts/lib/private-config.mjs';
const base=process.env.DEPLOYED_TEST_BASE;assert.ok(base);
const login=JSON.parse(fs.readFileSync(process.env.TEST_LOGIN_FILE,'utf8')),config=privateConfig(),checks=[],errors=[];
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
try{
  const context=await browser.newContext({viewport:{width:1536,height:1000}}),page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/login');await page.getByLabel('账号',{exact:true}).fill(login.account??login.email);await page.getByLabel('密码',{exact:true}).fill(login.password);await page.getByRole('button',{name:'进入工作台'}).click();await page.getByRole('navigation',{name:'平台导航'}).waitFor();
  const companies=await (await page.request.get(base+'/api/platform/companies')).json(),company=companies.find(c=>c.id==='demo-a');assert.ok(company);
  await page.locator('.portal-header .ant-select-selector').click();await page.getByRole('option',{name:company.name,exact:true}).click();
  const nav=page.getByRole('navigation',{name:'平台导航'});await nav.getByRole('button',{name:'财务工作台',exact:true}).click();await page.getByTestId('finance-workspace').waitFor();
  await page.getByRole('navigation',{name:'财务导航'}).getByRole('button',{name:'单据与审核',exact:true}).click();await page.locator('.finance-ant-table-row').first().waitFor();
  const documents=await (await page.request.get(base+'/api/finance/companies/demo-a/documents')).json();assert.ok(documents.length>0);checks.push('public test URL accepts migrated login and renders existing finance documents');
  const original=documents.find(d=>d.mimeType==='application/pdf');assert.ok(original);const file=await page.request.get(base+'/api/finance/companies/demo-a/documents/'+original.id+'/file');assert.equal(file.status(),200);assert.ok((await file.body()).length>0);checks.push('migrated original attachment remains downloadable through authorized finance API');
  await nav.getByRole('button',{name:'集成示例',exact:true}).click();await page.getByTestId('sample-workspace').waitFor();assert.equal(await page.getByTestId('sample-company').innerText(),'demo-a');await page.getByRole('button',{name:'查看接入说明',exact:true}).click();await page.reload();await page.getByRole('heading',{name:'接入说明',exact:true}).waitFor();checks.push('second application opens independently and refreshes its nested route');
  await nav.getByRole('button',{name:/工作台首页/}).click();fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/T14-home.png',fullPage:true});
  const adminContext=await browser.newContext({viewport:{width:1536,height:1000}}),admin=await adminContext.newPage();admin.setDefaultTimeout(60000);admin.on('pageerror',e=>errors.push(e.message));
  await admin.goto(base+'/login');await admin.getByLabel('账号',{exact:true}).fill(config.BOOTSTRAP_ACCOUNT);await admin.getByLabel('密码',{exact:true}).fill(config.BOOTSTRAP_PASSWORD);await admin.getByRole('button',{name:'进入工作台'}).click();await admin.getByRole('navigation',{name:'平台导航'}).waitFor();
  const users=await admin.request.get(base+'/api/platform/users');assert.equal(users.status(),200);assert.equal((await admin.request.get(base+'/api/finance/companies/demo-a/documents')).status(),403);checks.push('platform owner can manage users and has no implicit finance permission');
  await admin.goto(base+'/platform/users');await admin.getByRole('heading',{name:'用户管理',exact:true}).waitFor();await admin.screenshot({path:'test-results/T14-administration.png',fullPage:true});checks.push('administration page refresh renders the deployed management UI');
  const oldCookie=(await context.cookies()).find(c=>c.name==='platform_session');assert.ok(oldCookie);assert.equal((await page.request.post(base+'/api/platform/auth/logout',{headers:{Origin:base}})).status(),204);assert.equal((await page.request.get(base+'/api/platform/me',{headers:{Cookie:'platform_session='+oldCookie.value}})).status(),401);checks.push('logout invalidates the previous cookie on the deployed platform');
  assert.deepEqual(errors,[]);fs.writeFileSync('test-results/T14-browser.json',JSON.stringify({executedAt:new Date().toISOString(),result:'passed',browser:browser.version(),checks,pageErrors:errors},null,2)+'\n');console.log('Delivery browser checks passed');
}catch(error){for(const [i,context] of browser.contexts().entries()){const page=context.pages()[0];if(page)await page.screenshot({path:`test-results/T14-failure-${i}.png`,fullPage:true});}console.error('Browser errors:',errors);throw error;}finally{await browser.close();}
