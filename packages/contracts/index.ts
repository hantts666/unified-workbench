export type Theme = 'light' | 'dark';
export interface UserSummary { id:string; displayName:string; }
export interface CompanySummary { id:string; name:string; active:boolean; }
export interface MicroContext {
  applicationCode:string;
  basePath:string;
  companyId:string;
  contextVersion:number;
  user:UserSummary;
  permissionCodes:readonly string[];
  theme:Theme;
}
export interface PlatformBridge {
  getContext:()=>Readonly<MicroContext>;
  subscribe:(listener:()=>void)=>()=>void;
  beforeCompanyChange:(guard:(next:Readonly<MicroContext>)=>boolean|Promise<boolean>)=>()=>void;
  navigate:(path:string)=>void;
  sessionExpired:()=>void;
}
export interface MicroAppProps { container:HTMLElement; platform:PlatformBridge; }
export interface ApiError { code:string; message:string; }
export interface AuthorizationDecision {
  active:boolean; allowed:boolean; subjectId?:string; companyId?:string;
  applicationCode?:string; authzVersion?:number; sessionExpiresAt?:string;
}
export function canDisplay(context:MicroContext,permission:string):boolean {
  return permission.startsWith(context.applicationCode+':') && context.permissionCodes.includes(permission);
}
