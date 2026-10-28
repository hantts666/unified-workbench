import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert,
  App as AntApp,
  Avatar,
  Button,
  ConfigProvider,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Result,
  Select,
  Space,
  Spin,
  Tag,
} from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  ApartmentOutlined,
  AppstoreOutlined,
  ArrowRightOutlined,
  AuditOutlined,
  CheckCircleOutlined,
  DownOutlined,
  LockOutlined,
  LogoutOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { api, write, navigate, signalSessionChange, safeReturnPath } from "./api.js";
import {AccountSecurity} from "./account.js";
import { adminPages, Management } from "./management.js";
import { MicroWorkspace, type MicroHandle } from "./micro.js";
import "./style.css";
function Login({ onLogin }: { onLogin: () => void }) {
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="portal-login">
      <section className="portal-login-story">
        <div className="portal-brand">
          <span className="portal-brand-mark">合</span>
          <div>
            合一工作台<small>UNIFIED WORKSPACE</small>
          </div>
        </div>
        <div>
          <span className="portal-kicker">
            ONE WORKSPACE. ALL YOUR BUSINESS.
          </span>
          <h1>
            一个入口，
            <br />
            让协作井然有序。
          </h1>
          <p>
            公司、成员和业务应用，在同一个工作台连接。
            <br />
            清晰的权限，让每个人专注自己的工作。
          </p>
          <div className="portal-login-points">
            <span>
              <CheckCircleOutlined /> 统一身份
            </span>
            <span>
              <CheckCircleOutlined /> 多公司协作
            </span>
            <span>
              <CheckCircleOutlined /> 独立业务应用
            </span>
          </div>
        </div>
        <small>面向日常经营的统一业务门户</small>
      </section>
      <section className="portal-login-panel">
        <span className="portal-kicker">WELCOME BACK</span>
        <h2>欢迎回来</h2>
        <p>登录你的统一工作台</p>
        {error && <Alert type="error" message={error} showIcon />}
        <Form
          layout="vertical"
          onFinish={async (values) => {
            setLoading(true);
            setError("");
            try {
              await write("/auth/login", "POST", values);
              signalSessionChange();
              onLogin();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setLoading(false);
            }
          }}
        >
          <Form.Item
            name="account"
            label="账号"
            rules={[{ required: true, message: "请输入账号" }]}
          >
            <Input
              size="large"
              prefix={<UserOutlined />}
              autoComplete="username"
              placeholder="输入你的账号"
            />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password
              size="large"
              prefix={<LockOutlined />}
              autoComplete="current-password"
              placeholder="输入密码"
            />
          </Form.Item>
          <Button
            htmlType="submit"
            type="primary"
            size="large"
            block
            loading={loading}
          >
            进入工作台 <ArrowRightOutlined />
          </Button>
        </Form>
        <p>忘记密码或登录受限？请联系平台管理员重置密码或解除限制。</p>
        <p className="portal-login-note">
          <SafetyCertificateOutlined /> 根据你的角色与公司范围开放业务权限
        </p>
      </section>
    </main>
  );
}
function Portal() {
  const { message, modal } = AntApp.useApp();
  const [user, setUser] = useState<any>(),
    [companies, setCompanies] = useState<any[]>([]),
    [applications, setApplications] = useState<any[]>([]),
    [permissions, setPermissions] = useState<string[]>([]),
    [companyId, setCompanyId] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [path, setPath] = useState(location.pathname),
    [switching, setSwitching] = useState(false);
  const micro = useRef<MicroHandle>(null),
    loadVersion = useRef(0);
  const refresh = useCallback(async (quiet = false) => {
    const version = ++loadVersion.current;
    if(!quiet)setLoading(true);
    setError("");
    try {
      const me = await api("/me");
      if(version!==loadVersion.current)return;
      if(me.mustChangePassword){setUser(me);setCompanies([]);setApplications([]);setPermissions([]);return;}
      const [availableCompanies, availableApps, platformPermissions] =
        await Promise.all([
          api("/companies"),
          api("/applications"),
          api("/permissions?applicationCode=platform&companyId="),
        ]);
      if (version !== loadVersion.current) return;
      setUser(me);
      setCompanies(availableCompanies);
      setApplications(availableApps);
      setPermissions(platformPermissions);
      setCompanyId((previous) =>
        availableCompanies.some((c: any) => c.id === previous)
          ? previous
          : (availableCompanies[0]?.id ?? ""),
      );
      if (location.pathname === "/login") navigate(safeReturnPath(new URLSearchParams(location.search).get("returnTo")));
    } catch (e: any) {
      if (version !== loadVersion.current) return;
      if (e.status === 401) {
        setUser(null);
        if (location.pathname !== "/login") navigate("/login?returnTo="+encodeURIComponent(safeReturnPath(location.pathname+location.search)));
      } else setError(e.message);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const expired = () => {
      loadVersion.current++;
      setUser(null);
      setLoading(false);
      setApplications([]);
      setPermissions([]);
      setCompanies([]);
      setCompanyId("");
      if(location.pathname!=="/login")navigate("/login?returnTo="+encodeURIComponent(safeReturnPath(location.pathname+location.search)));
    };
    const route = () => setPath(location.pathname);
    const sync=()=>{void refresh(true);};
    const storage=(event:StorageEvent)=>{if(event.key==="platform-session-event"||event.key==="platform-access-event")sync();};
    const access=()=>{try{localStorage.setItem("platform-access-event",String(Date.now()));}catch{}sync();};
    const timer=window.setInterval(()=>{if(document.visibilityState==="visible")sync();},30000);
    window.addEventListener("storage",storage);
    window.addEventListener("focus",sync);
    window.addEventListener("platform-access-updated",access);
    window.addEventListener("platform-password-required",sync);
    window.addEventListener("popstate", route);
    window.addEventListener("platform-session-expired", expired);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage",storage);
      window.removeEventListener("focus",sync);
      window.removeEventListener("platform-access-updated",access);
      window.removeEventListener("platform-password-required",sync);
      window.removeEventListener("popstate", route);
      window.removeEventListener("platform-session-expired", expired);
    };
  }, [refresh]);
  const logout = async () => {
    try {
      await write("/auth/logout", "POST");
      loadVersion.current++;
      signalSessionChange();
      setUser(null);
      setApplications([]);
      setPermissions([]);
      setCompanies([]);
      setCompanyId("");
      navigate("/login");
    } catch (e: any) {
      message.error(e.message);
    }
  };
  if (loading)
    return (
      <div className="portal-loading-screen">
        <Spin size="large" />
        <p>正在准备你的工作台…</p>
      </div>
    );
  if (error)
    return (
      <Result
        status="warning"
        title="工作台暂时无法连接"
        subTitle={error}
        extra={
          <Button type="primary" onClick={() => void refresh()}>
            重试
          </Button>
        }
      />
    );
  if (!user) return <Login onLogin={() => void refresh()} />;
  const signedOut=()=>{signalSessionChange();window.dispatchEvent(new Event("platform-session-expired"));};
  if(user.mustChangePassword)return <main className="portal-forced-password"><AccountSecurity user={user} forced onChanged={signedOut} onLogout={()=>void logout()}/></main>;
  const visibleApplications=applications.filter(app=>!app.companyIds||app.companyIds.includes(companyId));
  const allowedPages = adminPages.filter((page) =>
    permissions.includes(page.permission),
  );
  const admin = adminPages.find((page) => path === "/platform/" + page.key);
  const application = visibleApplications.find(
    (app) => path === app.activeRule || path.startsWith(app.activeRule + "/"),
  );
  const denied =
    (admin && !permissions.includes(admin.permission)) ||
    (!application && !path.startsWith("/platform") && path !== "/");
  const company = companies.find((c) => c.id === companyId);
  const changeCompany = async (id: string) => {
    if (id === companyId) return;
    setSwitching(true);
    try {
      if (
        application &&
        micro.current &&
        !(await micro.current.changeCompany(id))
      )
        return;
      setCompanyId(id);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSwitching(false);
    }
  };
  return (
    <div className="portal-shell">
      <aside className="portal-sidebar">
        <a
          className="portal-brand"
          href="/platform"
          onClick={(event) => {
            event.preventDefault();
            navigate("/platform");
          }}
        >
          <span className="portal-brand-mark">合</span>
          <div>
            合一工作台<small>UNIFIED WORKSPACE</small>
          </div>
        </a>
        <nav aria-label="平台导航">
          <button
            className={path === "/platform" ? "active" : ""}
            onClick={() => navigate("/platform")}
          >
            <AppstoreOutlined /> 工作台首页
          </button>
          <div className="portal-nav-label">我的应用</div>
          {visibleApplications.length ? (
            visibleApplications.map((app) => (
              <button
                aria-label={app.name}
                key={app.code}
                className={application?.code === app.code ? "active" : ""}
                onClick={() => navigate(app.activeRule)}
              >
                <ApartmentOutlined />
                {app.name}
              </button>
            ))
          ) : (
            <p className="portal-nav-empty">暂无已授权的应用</p>
          )}
          {allowedPages.length > 0 && (
            <>
              <div className="portal-nav-label">平台管理</div>
              {allowedPages.map((page) => (
                <button
                  aria-label={page.title}
                  key={page.key}
                  className={admin?.key === page.key ? "active" : ""}
                  onClick={() => navigate("/platform/" + page.key)}
                >
                  {page.key === "users" || page.key === "access" ? (
                    <TeamOutlined />
                  ) : page.key === "audit" ? (
                    <AuditOutlined />
                  ) : (
                    <SettingOutlined />
                  )}
                  {page.title}
                </button>
              ))}
            </>
          )}
        </nav>
        <div className="portal-sidebar-footer">
          <SafetyCertificateOutlined />
          <span>权限明确 · 操作留痕</span>
        </div>
      </aside>
      <div className="portal-main">
        <header className="portal-header">
          <div>
            <span className="portal-header-label">当前公司</span>
            <Select
              aria-label="当前公司"
              value={companyId || undefined}
              loading={switching}
              disabled={switching || !companies.length}
              placeholder="暂无公司成员资格"
              onChange={changeCompany}
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              style={{ minWidth: 240 }}
            />
          </div>
          <Space>
            <Button
              type="text"
              icon={<ReloadOutlined />}
              onClick={() => void refresh()}
              aria-label="刷新权限"
            />
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  {
                    key: "password",
                    icon: <LockOutlined />,
                    label: "账号安全",
                  },
                  { type: "divider" },
                  {
                    key: "logout",
                    icon: <LogoutOutlined />,
                    label: "退出登录",
                  },
                ],
                onClick: ({ key }) =>
                  key === "logout" ? void logout() : navigate("/platform/account"),
              }}
            >
              <Button type="text">
                <Avatar size="small" icon={<UserOutlined />} />
                {user.displayName}
                <DownOutlined />
              </Button>
            </Dropdown>
          </Space>
        </header>
        <main className="portal-content">
          {denied ? (
            <Result
              status="403"
              title="没有此页面的访问权限"
              subTitle="请联系管理员检查你的应用角色和公司范围。"
              extra={
                <Button onClick={() => navigate("/platform")}>
                  返回工作台
                </Button>
              }
            />
          ) : path === "/platform/account" ? (<AccountSecurity user={user} onChanged={signedOut} onLogout={()=>void logout()}/>) : admin ? (
            <Management key={admin.key} section={admin.key} />
          ) : application ? (
            companyId ? (
              <MicroWorkspace
                key={user.id+":"+user.authzVersion+":"+application.version+":"+company?.version}
                ref={micro}
                application={application}
                companyId={companyId}
                user={user}
              />
            ) : (
              <Empty description="请先加入一家公司" />
            )
          ) : path === "/platform" || path === "/" ? (
            <>
              <section className="portal-welcome">
                <div>
                  <span className="portal-kicker">YOUR WORKSPACE</span>
                  <h1>你好，{user.displayName}</h1>
                  <p>
                    {company
                      ? `当前正在 ${company.name} 工作`
                      : "从这里管理成员、公司与业务应用"}
                  </p>
                </div>
                <div className="portal-welcome-symbol">
                  <ApartmentOutlined />
                </div>
              </section>
              <div className="portal-section-heading">
                <div>
                  <h2>我的业务应用</h2>
                  <p>选择应用，开始今天的工作</p>
                </div>
                <Tag color="green">{visibleApplications.length} 个已授权应用</Tag>
              </div>
              <div className="portal-app-grid">
                {visibleApplications.map((app, index) => (
                  <button
                    className="portal-app-card"
                    key={app.code}
                    onClick={() => navigate(app.activeRule)}
                  >
                    <span className={"portal-app-icon color-" + index}>
                      <ApartmentOutlined />
                    </span>
                    <h3>{app.name}</h3>
                    <p>
                      {app.code === "finance"
                        ? "单据审核、项目收支与财务报表"
                        : "查看已接入的业务功能"}
                    </p>
                    <span className="portal-card-action">
                      打开应用 <ArrowRightOutlined />
                    </span>
                  </button>
                ))}
              </div>
              {!visibleApplications.length && (
                <section className="portal-card">
                  <Empty description="暂无业务应用权限" />
                  <p className="portal-centered-note">
                    管理员需要同时分配公司成员资格和应用角色。
                  </p>
                </section>
              )}
              {allowedPages.length > 0 && (
                <section className="portal-management-summary">
                  <div>
                    <h2>平台管理</h2>
                    <p>维护成员、角色与各业务系统的使用范围。</p>
                  </div>
                  <Space wrap>
                    {allowedPages.map((page) => (
                      <Button
                        key={page.key}
                        onClick={() => navigate("/platform/" + page.key)}
                      >
                        {page.title}
                      </Button>
                    ))}
                  </Space>
                </section>
              )}
            </>
          ) : (
            <Result
              status="404"
              title="页面不存在"
              extra={
                <Button onClick={() => navigate("/platform")}>
                  返回工作台
                </Button>
              }
            />
          )}
        </main>
        <footer className="portal-footer">
          合一工作台 · 让业务各司其职，让协作连接起来
        </footer>
      </div>

    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <ConfigProvider
    virtual={false}
    locale={zhCN}
    theme={{
      token: {
        colorPrimary: "#28675b",
        borderRadius: 7,
        fontFamily: "Segoe UI, Microsoft YaHei, sans-serif",
      },
      components: {
        Button: { controlHeight: 36 },
        Input: { controlHeight: 38 },
        Select: { controlHeight: 38 },
      },
    }}
  >
    <AntApp>
      <Portal />
    </AntApp>
  </ConfigProvider>,
);
