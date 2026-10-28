export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api/platform" + path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const result = response.status === 204 ? undefined : await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/login"))
      window.dispatchEvent(new Event("platform-session-expired"));
    if(result?.code==='PASSWORD_CHANGE_REQUIRED')window.dispatchEvent(new Event('platform-password-required'));
    throw new HttpError(response.status, result?.message ?? "请求失败",result?.code);
  }
  return result;
}
export const write = async (path: string, method: string, body?: unknown) => {
  const result=await api(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if(!path.startsWith('/auth/'))window.dispatchEvent(new Event('platform-access-updated'));
  return result;
};
export function signalSessionChange(){
  try{localStorage.setItem('platform-session-event',String(Date.now()));}catch{}
}
export function safeReturnPath(value:string|null){
  if(!value||!/^\/(platform|finance|sample)(\/|$|\?)/.test(value)||value.includes('\\'))return '/platform';
  try{const url=new URL(value,location.origin);return url.origin===location.origin&&/^\/(platform|finance|sample)(\/|$)/.test(url.pathname)?url.pathname+url.search:'/platform';}catch{return '/platform';}
}
export function navigate(path: string) {
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error("无效页面");
  history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
export const appNames: Record<string, string> = {
  platform: "平台管理",
  finance: "财务工作台",
  sample: "集成示例",
};
export const permissionNames: Record<string, string> = {
  "platform:user:manage": "管理用户",
  "platform:company:manage": "管理公司",
  "platform:application:manage": "管理应用",
  "platform:role:manage": "管理角色",
  "platform:authorization:manage": "分配授权",
  "platform:audit:view": "查看平台日志",
  "finance:document:view": "查看单据",
  "finance:document:create": "上传单据",
  "finance:document:review": "审核与生成草稿",
  "finance:voucher:view": "查看凭证",
  "finance:voucher:submit": "正式入账",
  "finance:project:manage": "管理项目",
  "finance:bank:manage": "管理银行流水",
  "finance:report:view": "查看报表",
  "finance:account:view": "查看科目",
  "finance:ledger:manage": "管理账套",
  "finance:processor:manage": "管理处理器",
  "finance:audit:view": "查看财务日志",
  "sample:overview:view": "查看集成示例",
};
