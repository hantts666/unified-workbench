import './public-path';
import React, {useEffect,useState} from 'react';
import {createRoot, Root} from 'react-dom/client';
type Props = {container:HTMLElement;onLifecycle:(event:'bootstrap'|'mount'|'unmount')=>void};
let root:Root|undefined;
function Child(){
  const [route,setRoute]=useState(location.pathname),[chunk,setChunk]=useState('');
  useEffect(()=>{const listener=()=>setRoute(location.pathname);window.addEventListener('popstate',listener);return()=>window.removeEventListener('popstate',listener);},[]);
  return <section data-testid="finance-poc"><h2>财务接入验证</h2><p data-testid="child-route">{route}</p><button onClick={async()=>setChunk((await import('./lazy')).message)}>读取分包</button><p data-testid="lazy-result">{chunk}</p></section>;
}
export async function bootstrap(props:Props){props.onLifecycle('bootstrap');}
export async function mount(props:Props){root=createRoot(props.container.querySelector('#finance-root')!);root.render(<Child/>);props.onLifecycle('mount');}
export async function unmount(props:Props){root?.unmount();root=undefined;props.onLifecycle('unmount');}
