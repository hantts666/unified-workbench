import assert from 'node:assert/strict';

export const ACTION_NAMES = new Set([
  'anonymous-me','login-and-me','reject-cross-origin-logout','logout-and-reject-session',
  'platform-admin-denied-finance','reader-denied-submit','cross-company-denied',
  'cross-company-resource-denied','logged-out-submit-denied',
]);

export const REQUIRED_ENV = {
  platform:['ACCEPTANCE_BASE_URL','ACCEPTANCE_USER','ACCEPTANCE_PASSWORD'],
  finance:['ACCEPTANCE_BASE_URL','ACCEPTANCE_USER','ACCEPTANCE_PASSWORD','ACCEPTANCE_PLATFORM_ADMIN','ACCEPTANCE_ADMIN_PASSWORD','ACCEPTANCE_COMPANY_A','ACCEPTANCE_COMPANY_B','ACCEPTANCE_DRAFT_A','ACCEPTANCE_DOCUMENT_B'],
};

export class Client {
  constructor(base, fetcher = fetch) {
    this.base = new URL(base);
    if (!['http:','https:'].includes(this.base.protocol) || this.base.username || this.base.password || this.base.pathname !== '/' || this.base.search || this.base.hash) throw new Error('验收地址必须是没有凭据或路径的 HTTP(S) 统一入口');
    this.fetcher = fetcher;
    this.cookie = '';
  }
  async request(url, {method='GET', body, origin=this.base.origin} = {}) {
    const target = new URL(url, this.base);
    if (target.origin !== this.base.origin) throw new Error('验收请求不允许跳到其他来源');
    const headers = {Accept:'application/json'};
    if (this.cookie) headers.Cookie = this.cookie;
    if (method !== 'GET') {headers.Origin=origin; headers['Content-Type']='application/json';}
    const response = await this.fetcher(target, {method, headers, body:body === undefined ? undefined : JSON.stringify(body), redirect:'manual', signal:AbortSignal.timeout(10000)});
    let data;
    const text = await response.text();
    try {data = text ? JSON.parse(text) : undefined;} catch {data=undefined;}
    return {status:response.status, headers:response.headers, data};
  }
  async login(account, password) {
    const response = await this.request('/api/platform/auth/login', {method:'POST', body:{account,password}});
    assert.equal(response.status, 200, '登录应该返回 200');
    const cookies = response.headers.getSetCookie();
    const session = cookies.find(value=>value.startsWith('platform_session='));
    assert.ok(session, '登录应该设置统一会话');
    assert.match(session, /;\s*HttpOnly(?:;|$)/i, 'Cookie 应为 HttpOnly');
    assert.match(session, /;\s*SameSite=(Strict|Lax)(?:;|$)/i, 'Cookie 应限制跨站使用');
    if (this.base.protocol === 'https:') assert.match(session, /;\s*Secure(?:;|$)/i);
    this.cookie = session.split(';')[0];
    assert.ok(response.data?.id && response.data?.displayName, '登录应返回用户摘要');
    assert.deepEqual(Object.keys(response.data).sort(), ['displayName','id'], '用户摘要不应含额外身份机密');
    return response;
  }
}

export async function runAction(action, env, client) {
  const companyA = encodeURIComponent(env.ACCEPTANCE_COMPANY_A ?? '');
  const companyB = encodeURIComponent(env.ACCEPTANCE_COMPANY_B ?? '');
  const documentB = encodeURIComponent(env.ACCEPTANCE_DOCUMENT_B ?? '');
  const draftA = encodeURIComponent(env.ACCEPTANCE_DRAFT_A ?? '');
  const documents = company => `/api/finance/companies/${company}/documents`;
  const submit = () => client.request(`${documents(companyA)}/${draftA}/submit`, {method:'POST',body:{confirmation:'确认提交正式账务'}});
  const login = () => client.login(env.ACCEPTANCE_USER, env.ACCEPTANCE_PASSWORD);
  switch (action) {
    case 'anonymous-me':
      assert.equal((await client.request('/api/platform/me')).status, 401); break;
    case 'login-and-me': {
      const loggedIn = await login();
      const me = await client.request('/api/platform/me');
      assert.equal(me.status, 200);
      assert.equal(me.data.id,loggedIn.data.id);assert.equal(me.data.displayName,loggedIn.data.displayName);
      const publicFields=new Set(['id','displayName','account','authzVersion','mustChangePassword','lastLoginAt','sessionExpiresAt']);
      assert.ok(Object.keys(me.data).every(key=>publicFields.has(key)),'用户信息不能暴露身份机密'); break;
    }
    case 'reject-cross-origin-logout':
      await login();
      assert.equal((await client.request('/api/platform/auth/logout',{method:'POST',origin:'https://attacker.invalid'})).status,403);
      assert.equal((await client.request('/api/platform/me')).status,200, '被拒绝请求不能注销当前会话'); break;
    case 'logout-and-reject-session':
      await login();
      assert.equal((await client.request('/api/platform/auth/logout',{method:'POST'})).status,204);
      assert.equal((await client.request('/api/platform/me')).status,401, '旧 Cookie 应已失效'); break;
    case 'platform-admin-denied-finance':
      await client.login(env.ACCEPTANCE_PLATFORM_ADMIN,env.ACCEPTANCE_ADMIN_PASSWORD);
      assert.equal((await client.request(documents(companyA))).status,403); break;
    case 'reader-denied-submit':
      await login();
      assert.equal((await client.request(documents(companyA))).status,200, '只读用户应可正常读取自己公司的数据');
      assert.equal((await submit()).status,403, '权限必须先于财务提交执行'); break;
    case 'cross-company-denied':
      await login();
      assert.equal((await client.request(documents(companyB))).status,403); break;
    case 'cross-company-resource-denied': {
      await login();
      const response = await client.request(`${documents(companyA)}/${documentB}`);
      assert.ok([403,404].includes(response.status),'不能通过 A 公司路由读取 B 公司资源'); break;
    }
    case 'logged-out-submit-denied':
      await login();
      assert.equal((await client.request('/api/platform/auth/logout',{method:'POST'})).status,204);
      assert.equal((await submit()).status,401, '退出后旧 Cookie 不可提交'); break;
    default: throw new Error('没有匹配的验收执行器');
  }
}
