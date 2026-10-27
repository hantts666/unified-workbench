import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {privateConfig,databaseUrl} from '../scripts/lib/private-config.mjs';
import {createWebServer} from '../scripts/lib/web-server.mjs';
const config=privateConfig(),sites=JSON.parse(fs.readFileSync('.local/erp-test.json','utf8'));
Object.assign(process.env,{PLATFORM_DATABASE_URL:databaseUrl('platform'),FINANCE_DATABASE_URL:databaseUrl('finance'),INTERNAL_SERVICE_SECRET:config.INTERNAL_SERVICE_SECRET,MASTER_KEY:config.MASTER_KEY,COOKIE_SECURE:'false',REDIS_URL:'redis://127.0.0.1:26379',ERP_ORIGIN:'http://127.0.0.1:28180',INTERNAL_AUTH_TIMEOUT_MS:'30000'});
const {db:platformDb}=await import('../apps/platform-api/src/db.ts'),{db:financeDb,encrypt}=await import('../apps/finance-api/src/db.ts');
const {passwordHash}=await import('../apps/platform-api/src/security.ts'),{seedDefinitions}=await import('../apps/platform-api/src/seed.ts');
const {createPlatformApp}=await import('../apps/platform-api/src/main.ts'),{createFinanceApp}=await import('../apps/finance-api/src/main.ts');
const {queue}=await import('../apps/finance-api/src/queue.ts');
const prefix='qa-micro-'+randomUUID(),password=randomUUID()+'Micro',companies=[],ledgers=[],checks=[],errors=[];let user,platform,finance,server,browser;
const record=name=>{checks.push(name);console.log('PASS',name);};
try{
  await seedDefinitions();user=await platformDb.user.create({data:{account:prefix,displayName:'财务验收成员',passwordHash:await passwordHash(password)}});
  for(const [i,site] of sites.entries()){
    const company=await platformDb.company.create({data:{name:`虚构验收公司 ${i===0?'A':'B'} ${prefix}`,abbreviation:i===0?'A':'B'}});companies.push(company);
    await platformDb.userCompany.create({data:{userId:user.id,companyId:company.id}});await platformDb.roleAssignment.create({data:{userId:user.id,roleId:'finance-manager',applicationId:'finance',scopeType:'company',companyId:company.id}});
    const ledger=await financeDb.ledgerBinding.create({data:{platformCompanyId:company.id,name:site.company,abbreviation:site.abbreviation,siteName:site.siteName,erpCompany:site.company,apiCredential:encrypt(site.apiKey+':'+site.apiSecret)}});ledgers.push(ledger);
    const doc=await financeDb.document.create({data:{tenantId:ledger.id,filename:`公司${i===0?'A':'B'}专属验收单据.json`,contentHash:randomUUID(),storagePath:path.resolve('.local','unused-browser-fixture.json'),mimeType:'application/json',status:'REVIEW'}});
    await financeDb.document.update({where:{id:doc.id},data:{suggestion:{tenantId:ledger.id,sourceDocumentId:doc.id,documentType:'manual',transactionDate:new Date().toISOString().slice(0,10),counterparty:`虚构供应商 ${i===0?'A':'B'}`,amountCents:10000,taxCents:0,currency:'CNY',confidence:0,reasoningSummary:'虚构浏览器验收数据',supportingEvidence:[],entries:[{account:'',debitCents:10000,creditCents:0},{account:'',debitCents:0,creditCents:10000}]}}});
  }
  platform=await createPlatformApp();await platform.listen(0,'127.0.0.1');process.env.PLATFORM_INTERNAL_ORIGIN=await platform.getUrl();finance=await createFinanceApp();await finance.listen(0,'127.0.0.1');server=createWebServer({platformOrigin:await platform.getUrl(),financeOrigin:await finance.getUrl()});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});const page=await browser.newPage({viewport:{width:1536,height:1100}});page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/login');await page.getByLabel('账号',{exact:true}).fill(user.account);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'进入工作台'}).click();await page.getByRole('heading',{name:'你好，财务验收成员'}).waitFor();
  const sidebar=page.getByRole('navigation',{name:'平台导航'}),navigation=page.getByRole('navigation',{name:'财务导航'});
  const openFinance=async()=>{await sidebar.getByRole('button',{name:'财务工作台',exact:true}).click();await page.getByTestId('finance-workspace').waitFor();};
  const switchCompany=async(index)=>{await page.locator('.portal-header .ant-select-selector').click();await page.getByRole('option',{name:companies[index].name,exact:true}).click();};
  await openFinance();await navigation.getByRole('button',{name:'单据与审核',exact:true}).click();await page.getByText('公司A专属验收单据.json',{exact:true}).waitFor();
  assert.equal(await page.locator('.portal-sidebar').count(),1);assert.equal(await page.getByRole('combobox',{name:'当前公司'}).count(),1);assert.equal(await page.getByRole('combobox',{name:'切换公司'}).count(),0);record('real qiankun finance mount uses one portal layout and one company selector');
  const headerColor=await page.locator('.portal-header').evaluate(element=>getComputedStyle(element).backgroundColor);
  await navigation.getByRole('button',{name:'财务报表',exact:true}).click();await page.waitForURL('**/finance/reports');await page.goBack();await page.waitForURL('**/finance/documents');await page.getByText('公司A专属验收单据.json',{exact:true}).waitFor();await page.goForward();await page.waitForURL('**/finance/reports');await page.reload();await navigation.getByRole('button',{name:'财务报表',exact:true}).waitFor();record('child route supports back, forward and direct refresh');
  await navigation.getByRole('button',{name:'单据与审核',exact:true}).click();await page.getByText('公司A专属验收单据.json',{exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByLabel('摘要 / 判断依据',{exact:true}).fill('未保存的验收修改');
  await switchCompany(1);await page.getByText('切换公司会关闭当前编辑',{exact:true}).last().waitFor();await page.getByRole('button',{name:'留在当前公司',exact:true}).click();await page.getByText('切换公司会关闭当前编辑',{exact:true}).last().waitFor({state:'hidden'});assert.equal(await page.getByLabel('摘要 / 判断依据',{exact:true}).inputValue(),'未保存的验收修改');assert.ok(await page.locator('.portal-header').innerText().then(text=>text.includes(companies[0].name)));record('cancelling company switch preserves current company and unsaved editor');
  await switchCompany(1);await page.getByRole('button',{name:'放弃编辑并切换',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[role=dialog]').length===0);await page.getByText('公司B专属验收单据.json',{exact:true}).waitFor();assert.equal(await page.getByText('公司A专属验收单据.json',{exact:true}).count(),0);record('accepted switch closes old dialogs and renders only the new company');
  let release,seenResolve;const gate=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>seenResolve=resolve);let delayed=false;
  const pattern=`**/api/finance/companies/${companies[0].id}/documents`;
  await page.route(pattern,async route=>{if(delayed){await route.continue();return;}delayed=true;const response=await route.fetch();seenResolve();await gate;await route.fulfill({response}).catch(()=>{});});
  await switchCompany(0);await seen;await switchCompany(1);await page.getByText('公司B专属验收单据.json',{exact:true}).waitFor();release();await page.unroute(pattern);await page.waitForFunction(()=>!document.querySelector('.finance-scope')?.textContent?.includes('公司A专属验收单据.json'));record('delayed real response from previous company cannot overwrite the active company');
  for(let i=0;i<20;i++){
    await sidebar.getByRole('button',{name:/工作台首页/}).click();await page.getByTestId('finance-workspace').waitFor({state:'detached'});assert.equal(await page.locator('.finance-ant-modal-root,.finance-ant-drawer').count(),0);
    await openFinance();await navigation.getByRole('button',{name:'单据与审核',exact:true}).click();await page.getByText('公司B专属验收单据.json',{exact:true}).waitFor();assert.equal(await page.getByTestId('finance-workspace').count(),1);
  }
  assert.equal(await page.locator('.portal-header').evaluate(element=>getComputedStyle(element).backgroundColor),headerColor);record('20 real mount/unmount cycles preserve one root, clean popups and portal styling');
  await page.getByText('公司B专属验收单据.json',{exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal(await page.locator('body > .finance-ant-modal-root,body > .finance-ant-drawer').count(),0);await sidebar.getByRole('button',{name:/工作台首页/}).click();await page.waitForFunction(()=>document.querySelectorAll('[role=dialog]').length===0);record('open finance dialog is contained in child root and removed on unmount');
  await openFinance();await navigation.getByRole('button',{name:'单据与审核',exact:true}).click();await page.getByText('公司B专属验收单据.json',{exact:true}).waitFor();fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/T07-finance.png',fullPage:true});
  assert.deepEqual(errors,[]);fs.writeFileSync('test-results/T07-finance-browser.json',JSON.stringify({executedAt:new Date().toISOString(),result:'passed',browser:browser.version(),checks,pageErrors:errors,cycles:20,transport:'real platform and finance HTTP; delayed real response for fault injection'},null,2)+'\n');
}catch(error){console.error('T07 failed after',checks.length,'checks:',error.name,error.message?.slice(0,1600));if(browser){fs.mkdirSync('test-results',{recursive:true});await browser.contexts()[0]?.pages()[0]?.screenshot({path:'test-results/T07-failure.png',fullPage:true});}process.exitCode=1;}
finally{
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await finance?.close();await platform?.close();await queue.close();
  const ids=ledgers.map(l=>l.id);await financeDb.document.deleteMany({where:{tenantId:{in:ids}}});await financeDb.audit.deleteMany({where:{tenantId:{in:ids}}});await financeDb.ledgerBinding.deleteMany({where:{id:{in:ids}}});
  if(user){await platformDb.roleAssignment.deleteMany({where:{userId:user.id}});await platformDb.userCompany.deleteMany({where:{userId:user.id}});await platformDb.session.deleteMany({where:{userId:user.id}});await platformDb.platformAudit.deleteMany({where:{actorId:user.id}});await platformDb.user.delete({where:{id:user.id}});}await platformDb.company.deleteMany({where:{id:{in:companies.map(c=>c.id)}}});await platformDb.$disconnect();await financeDb.$disconnect();
}
