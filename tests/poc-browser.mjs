import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createStaticServer} from '../scripts/lib/static-server.mjs';
const server=createStaticServer('dist/poc/host',{'/micro/poc-finance/':'dist/poc/finance'});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  const page=await browser.newPage();
  const errors=[],failures=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)failures.push(response.url());});
  await page.goto(origin+'/finance/reports');
  await page.getByTestId('finance-poc').waitFor();
  assert.equal(await page.getByTestId('child-route').textContent(),'/finance/reports');
  await page.getByRole('button',{name:'读取分包'}).click();
  await page.getByText('动态资源加载成功',{exact:true}).waitFor();
  await page.reload();
  await page.getByTestId('finance-poc').waitFor();
  for(let i=0;i<20;i++){
    await page.getByRole('button',{name:'平台首页',exact:true}).click();
    await page.getByTestId('finance-poc').waitFor({state:'detached'});
    await page.getByRole('button',{name:'财务子应用',exact:true}).click();
    await page.getByTestId('finance-poc').waitFor();
  }
  await page.getByRole('button',{name:'财务报表路由',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="child-route"]')?.textContent==='/finance/reports');
  await page.goBack();
  await page.waitForFunction(()=>document.querySelector('[data-testid="child-route"]')?.textContent==='/finance/workbench');
  const counters=JSON.parse(await page.locator('#lifecycle').textContent());
  assert.equal(counters.mount,21);assert.equal(counters.unmount,20);assert.equal(counters.bootstrap,1);
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
  fs.mkdirSync('test-results',{recursive:true});
  fs.writeFileSync('test-results/T01-browser.json',JSON.stringify({executedAt:new Date().toISOString(),browser:browser.version(),react:'19.2.0',qiankun:'2.10.16',webpack:'5.112.2',checks:['direct-route','refresh','dynamic-chunk','20-mount-unmount-cycles','back-navigation'],counters,pageErrors:errors,failedResources:failures},null,2)+'\n');
  console.log('T01 browser verification passed');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
