import './public-path.js';
import React, {lazy, Suspense, useEffect, useState, useSyncExternalStore} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import type {MicroAppProps, PlatformBridge} from '../../../packages/contracts/index.js';
import './style.css';
const Details=lazy(()=>import('./details.js'));
let root:Root|undefined;
function Workspace({platform}:{platform:PlatformBridge}){
  const context=useSyncExternalStore(platform.subscribe,platform.getContext);
  const [route,setRoute]=useState(location.pathname);
  useEffect(()=>{const listener=()=>setRoute(location.pathname);window.addEventListener('popstate',listener);return()=>window.removeEventListener('popstate',listener);},[]);
  return <section className="sample-scope" data-testid="sample-workspace">
    <div className="sample-kicker">CONNECTED WORKSPACE</div><h1>集成示例</h1>
    <p>一个独立的业务空间，共用平台的登录、公司选择和访问权限。</p>
    <nav aria-label="示例导航"><button onClick={()=>platform.navigate('/sample')}>应用概览</button><button onClick={()=>platform.navigate('/sample/details')}>查看接入说明</button></nav>
    {route.endsWith('/details')?<Suspense fallback={<p>正在加载说明…</p>}><Details/></Suspense>:<div className="sample-grid">
      <article><span>当前用户</span><strong>{context.user.displayName}</strong><p>身份由统一平台提供。</p></article>
      <article><span>当前公司标识</span><strong data-testid="sample-company">{context.companyId}</strong><p>切换顶部公司后，此处随之更新。</p></article>
      <article><span>应用权限</span><strong>{context.permissionCodes.length} 项</strong><p>本示例展示接入方式，暂不产生业务记录。</p></article>
    </div>}
  </section>;
}
export async function bootstrap(){}
export async function mount(props:MicroAppProps){
  const target=props.container.querySelector<HTMLElement>('#sample-root');
  if(!target||!props.platform)throw new Error('请从统一平台进入');
  root=createRoot(target);root.render(<Workspace platform={props.platform}/>);
}
export async function unmount(){root?.unmount();root=undefined;}
export async function update(){}
if(!window.__POWERED_BY_QIANKUN__){const target=document.getElementById('sample-root');if(target)createRoot(target).render(<p>请从<a href="/platform">统一工作台</a>进入集成示例。</p>);}
