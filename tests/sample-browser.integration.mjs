let acceptanceFailed=false;
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {privateConfig,databaseUrl} from '../scripts/lib/private-config.mjs';
import {createWebServer} from '../scripts/lib/web-server.mjs';
const config=privateConfig();
Object.assign(process.env,{PLATFORM_DATABASE_URL:databaseUrl('platform'),FINANCE_DATABASE_URL:databaseUrl('finance'),INTERNAL_SERVICE_SECRET:config.INTERNAL_SERVICE_SECRET,MASTER_KEY:config.MASTER_KEY,COOKIE_SECURE:'false',REDIS_URL:'redis://127.0.0.1:26379',INTERNAL_AUTH_TIMEOUT_MS:'30000'});
const {db}=await import('../apps/platform-api/src/db.ts'),{db:financeDb}=await import('../apps/finance-api/src/db.ts'),{queue}=await import('../apps/finance-api/src/queue.ts');
const {passwordHash}=await import('../apps/platform-api/src/security.ts'),{createPlatformApp}=await import('../apps/platform-api/src/main.ts'),{createFinanceApp}=await import('../apps/finance-api/src/main.ts');
const prefix='qa-sample-'+randomUUID(),password=randomUUID()+'Sample',companies=[],checks=[],errors=[];
let user,platform,finance,server,browser;
const record=name=>{checks.push(name);console.log('PASS',name);};
try{
  user=await db.user.create({data:{account:prefix,displayName:'集成验收成员',passwordHash:await passwordHash(password)}});
  for(const suffix of ['A','B']){
    const company=await db.company.create({data:{name:prefix+' '+suffix,abbreviation:suffix}});companies.push(company);
    await db.userCompany.create({data:{userId:user.id,companyId:company.id}});
    for(const [applicationId,roleId] of [['sample','sample-viewer'],['finance','finance-reader']])await db.roleAssignment.create({data:{userId:user.id,roleId,applicationId,scopeType:'company',companyId:company.id}});
  }
  platform=await createPlatformApp();await platform.listen(0,'127.0.0.1');process.env.PLATFORM_INTERNAL_ORIGIN=await platform.getUrl();finance=await createFinanceApp();await finance.listen(0,'127.0.0.1');
  server=createWebServer({platformOrigin:await platform.getUrl(),financeOrigin:await finance.getUrl()});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});const page=await browser.newPage({viewport:{width:1536,height:1000}});page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/login');await page.getByLabel('账号',{exact:true}).fill(prefix);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'进入工作台'}).click();await page.getByRole('heading',{name:'你好，集成验收成员'}).waitFor();
  const nav=page.getByRole('navigation',{name:'平台导航'});
  const failing='**/micro/sample/**';await page.route(failing,route=>route.fulfill({status:503,contentType:'text/plain',body:'controlled test outage'}));
  await nav.getByRole('button',{name:'集成示例',exact:true}).click();await page.getByRole('button',{name:'重新打开',exact:true}).waitFor();assert.equal(await nav.isVisible(),true);record('unavailable child entry shows recoverable error while portal remains usable');
  await nav.getByRole('button',{name:'财务工作台',exact:true}).click();await page.getByTestId('finance-workspace').waitFor();record('finance remains independently usable during sample outage');
  await nav.getByRole('button',{name:'集成示例',exact:true}).click();await page.getByRole('button',{name:'重新打开',exact:true}).waitFor();await page.unroute(failing);await page.getByRole('button',{name:'重新打开',exact:true}).click();await page.getByTestId('sample-workspace').waitFor();record('retry recovers failed child after its separately served entry is restored');
  await page.getByRole('button',{name:'查看接入说明',exact:true}).click();await page.getByRole('heading',{name:'接入说明',exact:true}).waitFor();await page.reload();await page.getByRole('heading',{name:'接入说明',exact:true}).waitFor();record('sample nested route refresh loads its independent dynamic chunk');
  await page.getByRole('button',{name:'应用概览',exact:true}).click();await page.getByTestId('sample-company').waitFor();
  await page.locator('.portal-header .ant-select-selector').click();await page.getByRole('option',{name:companies[1].name,exact:true}).click();await page.waitForFunction(id=>document.querySelector('[data-testid=sample-company]')?.textContent===id,companies[1].id);record('sample receives the current company without another selector');
  for(let i=0;i<5;i++){await nav.getByRole('button',{name:'财务工作台',exact:true}).click();await page.getByTestId('finance-workspace').waitFor();assert.equal(await page.getByTestId('sample-workspace').count(),0);await nav.getByRole('button',{name:'集成示例',exact:true}).click();await page.getByTestId('sample-workspace').waitFor();assert.equal(await page.getByTestId('finance-workspace').count(),0);}
  assert.deepEqual(errors,[]);record('repeated finance/sample switching releases previous roots with no browser errors');
  fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/T09-sample.png',fullPage:true});fs.writeFileSync('test-results/T09-sample.json',JSON.stringify({executedAt:new Date().toISOString(),result:'passed',checks,pageErrors:errors,builds:['portal','finance','sample'],deployment:'separate built static roots behind real HTTP gateway'},null,2)+'\n');
}catch(error){console.error('T09 failed:',error.message?.slice(0,1000));if(browser)await browser.contexts()[0]?.pages()[0]?.screenshot({path:'test-results/T09-failure.png',fullPage:true});acceptanceFailed=true;process.exitCode=1;}
finally{
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await finance?.close();await platform?.close();await queue.close();
  if(user){await db.roleAssignment.deleteMany({where:{userId:user.id}});await db.userCompany.deleteMany({where:{userId:user.id}});await db.session.deleteMany({where:{userId:user.id}});await db.platformAudit.deleteMany({where:{actorId:user.id}});await db.user.delete({where:{id:user.id}});}await db.company.deleteMany({where:{id:{in:companies.map(c=>c.id)}}});await db.$disconnect();await financeDb.$disconnect();
if(acceptanceFailed)process.exitCode=1;
}
