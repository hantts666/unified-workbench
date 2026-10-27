export const trustedApplications = {
  platform:{code:'platform',name:'平台管理',activeRule:'/platform',entryKey:'portal',entry:'/micro/platform/',scopeType:'instance'},
  finance:{code:'finance',name:'财务工作台',activeRule:'/finance',entryKey:'finance',entry:'/micro/finance/',scopeType:'company'},
  sample:{code:'sample',name:'集成示例',activeRule:'/sample',entryKey:'sample',entry:'/micro/sample/',scopeType:'company'},
} as const;
export type ApplicationCode=keyof typeof trustedApplications;
