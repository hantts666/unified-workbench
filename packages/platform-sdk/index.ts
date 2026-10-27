import type {MicroContext,PlatformBridge} from '../contracts/index.js';

export function validateContext(input:MicroContext):Readonly<MicroContext>{
  const keys=['applicationCode','basePath','companyId','contextVersion','user','permissionCodes','theme'];
  if(!input||Object.keys(input).some(key=>!keys.includes(key))||keys.some(key=>!(key in input)))throw new Error('无效的子应用上下文字段');
  if(!/^[a-z][a-z0-9-]*$/.test(input.applicationCode)||!/^\/[a-z][a-z0-9-]*$/.test(input.basePath)||typeof input.companyId!=='string'||!input.companyId)throw new Error('应用、路由或公司标识无效');
  if(!Number.isSafeInteger(input.contextVersion)||input.contextVersion<0||!['light','dark'].includes(input.theme))throw new Error('上下文版本或主题无效');
  if(!input.user||Object.keys(input.user).sort().join(',')!=='displayName,id'||typeof input.user.id!=='string'||!input.user.id||typeof input.user.displayName!=='string'||!input.user.displayName)throw new Error('用户摘要无效');
  if(!Array.isArray(input.permissionCodes)||new Set(input.permissionCodes).size!==input.permissionCodes.length||input.permissionCodes.some(code=>typeof code!=='string'||!new RegExp(`^${input.applicationCode}:[a-z-]+:[a-z-]+$`).test(code)))throw new Error('权限不能跨应用');
  return Object.freeze({...input,user:Object.freeze({...input.user}),permissionCodes:Object.freeze([...input.permissionCodes])});
}

export function createContextStore(initial:MicroContext){
  let current=validateContext(initial),revision=0,disposed=false;
  const listeners=new Set<()=>void>(),guards=new Set<(context:Readonly<MicroContext>)=>boolean|Promise<boolean>>();
  return {
    getContext:()=>current,
    subscribe(listener:()=>void){if(disposed)throw new Error('上下文已销毁');listeners.add(listener);return()=>{listeners.delete(listener);};},
    beforeCompanyChange(guard:(context:Readonly<MicroContext>)=>boolean|Promise<boolean>){if(disposed)throw new Error('上下文已销毁');guards.add(guard);return()=>{guards.delete(guard);};},
    async change(next:Omit<MicroContext,'contextVersion'>){
      if(disposed)throw new Error('上下文已销毁');
      const ticket=++revision,candidate=validateContext({...next,contextVersion:current.contextVersion+1});
      for(const guard of guards){if(!await guard(candidate)||ticket!==revision||disposed)return false;}
      if(ticket!==revision||disposed)return false;
      current=candidate;for(const listener of listeners)listener();return true;
    },
    dispose(){disposed=true;revision++;listeners.clear();guards.clear();},
  };
}

export function createScopedClient(bridge:Pick<PlatformBridge,'getContext'|'subscribe'|'sessionExpired'>,fetcher:typeof fetch=fetch){
  const requests=new Set<AbortController>();
  let disposed=false;
  const cancel=()=>{for(const controller of requests)controller.abort();requests.clear();};
  const unsubscribe=bridge.subscribe(cancel);
  return {
    async request<T=unknown>(resource:string,options:RequestInit={}):Promise<T>{
      if(disposed)throw new DOMException('子应用已卸载','AbortError');
      if(!resource||resource.startsWith('/')||resource.split('/').includes('..')||resource.includes('\\')||resource.includes('#'))throw new Error('无效的业务资源路径');
      const context=bridge.getContext(),controller=new AbortController();requests.add(controller);
      const signals=[controller.signal,...(options.signal?[options.signal]:[])];
      try{
        const response=await fetcher(`/api/${context.applicationCode}/companies/${encodeURIComponent(context.companyId)}/${resource}`,{...options,credentials:'same-origin',signal:AbortSignal.any(signals),headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...options.headers}});
        const result=response.status===204?undefined:await response.json();
        if(disposed||controller.signal.aborted||context.contextVersion!==bridge.getContext().contextVersion)throw new DOMException('公司上下文已改变','AbortError');
        if(response.status===401)bridge.sessionExpired();
        if(!response.ok)throw new Error(result?.message??'请求失败');
        return result as T;
      }finally{requests.delete(controller);}
    },
    dispose(){if(disposed)return;disposed=true;cancel();unsubscribe();},
  };
}
