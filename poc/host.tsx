import React from 'react';
import {createRoot} from 'react-dom/client';
import {registerMicroApps, start} from 'qiankun';

function navigate(url: string) { history.pushState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate')); }
createRoot(document.getElementById('root')!).render(<main><h1>统一平台 · 接入验证</h1><nav><button onClick={()=>navigate('/')}>平台首页</button><button onClick={()=>navigate('/finance/workbench')}>财务子应用</button><button onClick={()=>navigate('/finance/reports')}>财务报表路由</button></nav><p>这是乾坤接入验证页面，业务功能按后续任务接入。</p></main>);
const counters = {mount:0,unmount:0,bootstrap:0};
registerMicroApps([{
  name:'finance-poc', entry:'/micro/poc-finance/', container:'#micro-container',
  activeRule: location=>location.pathname.startsWith('/finance/'),
  props:{onLifecycle:(event:keyof typeof counters)=>{counters[event]++;document.getElementById('lifecycle')!.textContent=JSON.stringify(counters);}},
}]);
start({prefetch:false,sandbox:{experimentalStyleIsolation:true}});
