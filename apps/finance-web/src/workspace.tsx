import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSyncExternalStore } from "react";
import type { PlatformBridge } from "../../../packages/contracts/index.js";
import type { FinanceClient } from "./api.js";
import {
  ConfigProvider,
  App as AntApp,
  Button,
  Select,
  Tag,
  Table,
  Input,
  Space,
  Modal,
  Form,
  InputNumber,
  DatePicker,
  Drawer,
  Upload,
  Alert,
  Checkbox,
  Switch,
  Empty,
  Spin,
  Tabs,
  Tooltip,
  Dropdown,
} from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  AppstoreOutlined,
  InboxOutlined,
  FolderOutlined,
  BankOutlined,
  BookOutlined,
  BarChartOutlined,
  ApartmentOutlined,
  AuditOutlined,
  SettingOutlined,
  PlusOutlined,
  UploadOutlined,
  SearchOutlined,
  ArrowRightOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  LogoutOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  DownOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

import "./style.css";
dayjs.locale("zh-cn");
const currency = (cents: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format((cents || 0) / 100);
const statuses: Record<string, [string, string]> = {
  PROCESSING: ["解析中", "processing"],
  REVIEW: ["待审核", "gold"],
  DRAFTING: ["生成草稿中", "processing"],
  DRAFT: ["待提交", "blue"],
  SUBMITTING: ["提交中", "processing"],
  SUBMITTED: ["已入账", "green"],
  REJECTED: ["已驳回", "red"],
  FAILED: ["处理失败", "red"],
  ARCHIVED: ["已归档", "default"],
};
const badge = (status: string) => {
  const [label, color] = statuses[status] ?? [status, "default"];
  return <Tag color={color}>{label}</Tag>;
};
const nav = [
  ["home", "工作台", AppstoreOutlined],
  ["documents", "单据与审核", InboxOutlined],
  ["projects", "项目与合同", FolderOutlined],
  ["bank", "银行流水", BankOutlined],
  ["journals", "会计凭证", BookOutlined],
  ["reports", "财务报表", BarChartOutlined],
  ["accounts", "会计科目", ApartmentOutlined],
  ["companies", "账套配置", ApartmentOutlined],
  ["audit", "操作日志", AuditOutlined],
  ["settings", "处理器与设置", SettingOutlined],
] as const;
const pagePermissions: Record<string, string> = {
  home: "finance:document:view",
  documents: "finance:document:view",
  projects: "finance:project:manage",
  bank: "finance:bank:manage",
  journals: "finance:voucher:view",
  reports: "finance:report:view",
  accounts: "finance:account:view",
  companies: "finance:ledger:manage",
  audit: "finance:audit:view",
  settings: "finance:processor:manage",
};
export function Workspace({
  platform,
  client,
  popupRoot,
}: {
  platform: PlatformBridge;
  client: FinanceClient;
  popupRoot: HTMLElement;
}) {
  const context = useSyncExternalStore(platform.subscribe, platform.getContext);
  const { api, post, patch } = client;
  const can = (code: string) => context.permissionCodes.includes(code);
  const routePage = () =>
    location.pathname
      .slice(context.basePath.length)
      .split("/")
      .filter(Boolean)[0] || "home";
  const [page, updatePage] = useState(routePage);
  const setPage = (value: string) =>
    platform.navigate(context.basePath + "/" + value);
  const user = { id: context.user.id, name: context.user.displayName };
  const setTenantId = (_id: string) => {};
  useEffect(() => {
    const listener = () => updatePage(routePage());
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, [context.basePath]);
  const services = AntApp.useApp();
  const message = services.message;
  const dialogs = useRef<Array<{ destroy: () => void }>>([]);
  const pendingSwitches = useRef(new Set<(value: boolean) => void>());
  const modal = {
    confirm: (options: Parameters<typeof services.modal.confirm>[0]) => {
      const result = services.modal.confirm({
        ...options,
        getContainer: () => popupRoot,
      });
      dialogs.current.push(result);
      return result;
    },
    info: (options: Parameters<typeof services.modal.info>[0]) => {
      const result = services.modal.info({
        ...options,
        getContainer: () => popupRoot,
      });
      dialogs.current.push(result);
      return result;
    },
  };
  const [tenants, setTenants] = useState<any[]>([]),
    [docs, setDocs] = useState<any[]>([]),
    [accounts, setAccounts] = useState<any[]>([]),
    [projects, setProjects] = useState<any[]>([]),
    [rows, setRows] = useState<any[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("ALL"),
    [selected, setSelected] = useState<React.Key[]>([]),
    [review, setReview] = useState<any>(null),
    [reviewForm] = Form.useForm(),
    [busy, setBusy] = useState(false),
    [dialog, setDialog] = useState(""),
    [form] = Form.useForm(),
    [reportType, setReportType] = useState("balance"),
    [report, setReport] = useState<any>(null),
    [period, setPeriod] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
      dayjs().startOf("month"),
      dayjs().endOf("month"),
    ]);
  const tenant = tenants[0],
    tenantId = tenant?.id ?? "",
    base = `/tenants/${tenantId}`;
  const permission = pagePermissions[page];
  const allowed = !!permission && can(permission);
  const loadTenants = useCallback(async () => {
    const t = await client.context();
    setTenants(t.id ? [t] : []);
    if (!t.id || t.provisionStatus !== "READY")
      setError("当前公司尚未完成财务开账，请在账套配置中连接 ERPNext。");
  }, [client]);
  useEffect(() => {
    loadTenants().catch((e) => {
      if (e.name !== "AbortError") setError(e.message);
    });
  }, [loadTenants]);
  const dirty = useRef(false);
  useEffect(
    () =>
      platform.beforeCompanyChange(async () => {
        if (busy) {
          message.info("操作正在进行，请完成后再切换公司");
          return false;
        }
        if (!dirty.current && !review && !dialog) return true;
        return new Promise<boolean>((resolve) => {
          pendingSwitches.current.add(resolve);
          const finish = (value: boolean) => {
            pendingSwitches.current.delete(resolve);
            resolve(value);
          };
          modal.confirm({
            title: "切换公司会关闭当前编辑",
            content: "尚未保存的内容将被丢弃，是否继续？",
            okText: "放弃编辑并切换",
            cancelText: "留在当前公司",
            onOk: () => finish(true),
            onCancel: () => finish(false),
          });
        });
      }),
    [platform, busy, review, dialog, popupRoot],
  );
  useEffect(
    () => () => {
      for (const resolve of pendingSwitches.current) resolve(false);
      pendingSwitches.current.clear();
      for (const dialog of dialogs.current) dialog.destroy();
      dialogs.current = [];
      message.destroy();
    },
    [],
  );
  const activeScope = useRef("");
  activeScope.current = `${tenantId}|${page}`;
  const refresh = useCallback(async () => {
    if (!tenantId || !allowed) return;
    const scope = `${tenantId}|${page}`;
    const get = async (url: string, setter: (value: any) => void) => {
      const value = await api(url);
      if (activeScope.current === scope) setter(value);
    };
    setLoading(true);
    setError("");
    try {
      if (["home", "documents"].includes(page))
        await get(`${base}/documents`, setDocs);
      if (
        ["documents", "accounts"].includes(page) &&
        can("finance:account:view")
      )
        await get(`${base}/accounts`, setAccounts);
      if (page === "documents" && can("finance:document:review"))
        await get(`${base}/erp-projects`, setProjects);
      if (page === "projects") await get(`${base}/projects`, setProjects);
      if (["bank", "journals", "audit", "settings"].includes(page))
        await get(
          `${base}/${page === "settings" ? "processors" : page}`,
          setRows,
        );
      await loadTenants();
    } catch (e: any) {
      if (activeScope.current === scope) setError(e.message);
    } finally {
      if (activeScope.current === scope) setLoading(false);
    }
  }, [tenantId, page, base, loadTenants, allowed]);
  useEffect(() => {
    dirty.current = false;
    setDialog("");
    setSelected([]);
    setSearch("");
    setReport(null);
    setReview(null);
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (
      !["home", "documents"].includes(page) ||
      !docs.some((d) =>
        ["PROCESSING", "DRAFTING", "SUBMITTING"].includes(d.status),
      )
    )
      return;
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [page, docs, refresh]);
  const run = async (action: () => Promise<any>, success = "操作完成") => {
    setBusy(true);
    try {
      await action();
      message.success(success);
      await refresh();
      return true;
    } catch (e: any) {
      message.error(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const showDialog = (name: string, values: object = {}) => {
    form.resetFields();
    form.setFieldsValue(values);
    setDialog(name);
  };
  const upload = async (file: File) => {
    const data = new FormData();
    data.append("file", file);
    try {
      const result = await api(`${base}/documents`, {
        method: "POST",
        body: data,
      });
      message[result.duplicate ? "warning" : "success"](
        result.duplicate
          ? "此公司已上传过相同文件，已阻止重复处理"
          : "文件已上传，正在排队解析",
      );
      setPage("documents");
      await refresh();
    } catch (e: any) {
      message.error(e.message);
    }
    return false;
  };
  const openReview = (doc: any) => {
    dirty.current = false;
    const target = tenantId;
    Promise.all([
      can("finance:account:view")
        ? api<any[]>(`${base}/accounts`)
        : Promise.resolve([]),
      can("finance:document:review")
        ? api<any[]>(`${base}/erp-projects`)
        : Promise.resolve([]),
    ])
      .then(([a, p]) => {
        if (activeScope.current.startsWith(target + "|")) {
          setAccounts(a);
          setProjects(p);
        }
      })
      .catch((e) => message.error(e.message));
    setReview(doc);
    const s = doc.suggestion ?? {};
    reviewForm.setFieldsValue({
      ...s,
      transactionDate: dayjs(s.transactionDate),
      amount: (s.amountCents || 0) / 100,
      tax: (s.taxCents || 0) / 100,
      entries: (s.entries ?? []).map((e: any) => ({
        ...e,
        debit: e.debitCents / 100,
        credit: e.creditCents / 100,
      })),
    });
  };
  const saveReview = async () => {
    const v = await reviewForm.validateFields();
    const suggestion = {
      ...review.suggestion,
      ...v,
      tenantId,
      sourceDocumentId: review.id,
      transactionDate: v.transactionDate.format("YYYY-MM-DD"),
      amountCents: Math.round(v.amount * 100),
      taxCents: Math.round(v.tax * 100),
      entries: v.entries.map((e: any) => ({
        account: e.account ?? "",
        debitCents: Math.round((e.debit || 0) * 100),
        creditCents: Math.round((e.credit || 0) * 100),
        ...(e.project ? { project: e.project } : {}),
      })),
    };
    delete suggestion.amount;
    delete suggestion.tax;
    await patch(`${base}/documents/${review.id}`, suggestion);
    dirty.current = false;
    return suggestion;
  };
  const approve = async () => {
    if (
      await run(async () => {
        await saveReview();
        const result = await post(`${base}/documents/${review.id}/draft`);
        setReview({ ...review, status: "DRAFT", erpName: result.name });
      }, "审核通过，ERPNext 草稿已创建")
    ) {
    }
  };
  const submit = (doc: any) =>
    modal.confirm({
      title: "确认提交正式账务",
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <p>
            公司：<strong>{tenant?.name}</strong>
          </p>
          <p>凭证：{doc.erpName}</p>
          <p>
            提交后会写入 ERPNext 正式总账。更正需通过 ERPNext 撤销或冲销流程。
          </p>
        </div>
      ),
      okText: "确认提交正式账务",
      cancelText: "返回检查",
      onOk: async () => {
        await post(`${base}/documents/${doc.id}/submit`, {
          confirmation: "确认提交正式账务",
        });
        message.success("已提交至 ERPNext 正式总账");
        setReview(null);
        await refresh();
      },
    });
  const bulk = async (action: string) => {
    let ok = 0;
    const errors: string[] = [];
    setBusy(true);
    for (const id of selected) {
      try {
        await post(
          `${base}/documents/${id}/${action}`,
          action === "reject" ? { reason: "人工批量驳回，请修正后重试" } : {},
        );
        ok++;
      } catch (e: any) {
        errors.push(e.message);
      }
    }
    setBusy(false);
    setSelected([]);
    await refresh();
    modal.info({
      title: `已处理 ${ok} 项，失败 ${errors.length} 项`,
      content: errors.length
        ? errors.slice(0, 5).join("；")
        : "所有选中单据已处理。正式提交仍需逐张确认。",
    });
  };
  const pending = docs.filter((d) => d.status === "REVIEW"),
    drafts = docs.filter((d) => d.status === "DRAFT"),
    failed = docs.filter((d) => d.status === "FAILED");
  const docColumns: any[] = [
    {
      title: "单据 / 原始文件",
      dataIndex: "filename",
      render: (v: string, d: any) => (
        <button className="file-link" onClick={() => openReview(d)}>
          <span className="file-icon">
            <FileTextOutlined />
          </span>
          <span>
            <strong>{v}</strong>
            <small>
              {dayjs(d.createdAt).format("MM-DD HH:mm")} 上传 ·{" "}
              {d.suggestion?.documentType === "bank"
                ? "银行流水"
                : d.suggestion?.documentType === "invoice"
                  ? "发票"
                  : "费用单据"}
            </small>
          </span>
        </button>
      ),
    },
    {
      title: "交易对手",
      render: (_: any, d: any) =>
        d.suggestion?.counterparty || <span className="muted">待填写</span>,
    },
    {
      title: "金额",
      align: "right",
      render: (_: any, d: any) => (
        <span className="amount">
          {d.suggestion?.amountCents ? currency(d.suggestion.amountCents) : "—"}
        </span>
      ),
    },
    { title: "处理状态", dataIndex: "status", render: badge },
    {
      title: "操作",
      width: 130,
      render: (_: any, d: any) => (
        <Button
          type="link"
          size="small"
          onClick={() =>
            can("finance:document:review") &&
            ["FAILED", "REJECTED"].includes(d.status)
              ? run(
                  () => post(`${base}/documents/${d.id}/retry`),
                  "已重新加入队列",
                )
              : openReview(d)
          }
        >
          {d.status === "REVIEW" && can("finance:document:review")
            ? "审核单据"
            : d.status === "DRAFT" && can("finance:voucher:submit")
              ? "检查并提交"
              : d.status === "FAILED" && can("finance:document:review")
                ? "重新解析"
                : "查看详情"}{" "}
          <ArrowRightOutlined />
        </Button>
      ),
    },
  ];
  const visibleDocs = docs.filter(
    (d) =>
      (status === "ALL" || d.status === status) &&
      `${d.filename} ${d.suggestion?.counterparty ?? ""}`.includes(search) &&
      (!d.suggestion?.transactionDate ||
        (d.suggestion.transactionDate >= period[0].format("YYYY-MM-DD") &&
          d.suggestion.transactionDate <= period[1].format("YYYY-MM-DD"))),
  );
  const title = nav.find((n) => n[0] === page)?.[1] ?? "工作台";
  if(context.companyId!==client.companyId)return <Spin/>;
  return (
    <div className="finance-workspace" data-testid="finance-workspace">
      <nav className="finance-tabs" aria-label="财务导航">
        {nav
          .filter(([id]) => can(pagePermissions[id]))
          .map(([id, label, Icon]) => (
            <button
              aria-label={label}
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => setPage(id)}
            >
              <Icon />
              {label}
            </button>
          ))}
      </nav>
      <div className="finance-main">
        <main className="finance-content">
          {!allowed ? (
            <Alert type="warning" message="没有此财务页面的访问权限" />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="breadcrumb">
                    财务工作空间 <span>/</span> {title}
                  </div>
                  <h1>{page === "home" ? "每一笔，都有着落。" : title}</h1>
                  <p>
                    {page === "home"
                      ? `${dayjs().format("YYYY年M月D日 dddd")}，从今天的待办开始。`
                      : (
                          {
                            documents:
                              "从原始单据到正式凭证，逐笔核对、清楚留痕。",
                            projects: "分别查看合同、权责收入与实际现金收支。",
                            bank: "先归集，再匹配。银行流水不会自动生成正式账务。",
                            journals:
                              "实时查询当前公司 ERPNext 的原生会计凭证。",
                            reports:
                              "直接读取 ERPNext 原生报表，未另建会计计算引擎。",
                            accounts: "读取当前账套的可记账科目。",
                            companies:
                              "统一入口，独立账套。每次操作均校验公司权限。",
                            audit:
                              "上传、修改、审核、提交与配置变更的完整记录。",
                            settings: "按公司配置处理器，云端模型默认关闭。",
                          } as any
                        )[page]}
                  </p>
                </div>
                <Space>
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={refresh}
                    loading={loading}
                  >
                    刷新
                  </Button>
                  {["home", "documents", "bank"].includes(page) &&
                    can("finance:document:create") && (
                      <Upload
                        beforeUpload={upload}
                        showUploadList={false}
                        accept=".csv,.xlsx,.pdf,.jpg,.jpeg,.png"
                      >
                        <Button type="primary" icon={<UploadOutlined />}>
                          上传单据
                        </Button>
                      </Upload>
                    )}
                  {page === "projects" && (
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => showDialog("project")}
                    >
                      新建项目
                    </Button>
                  )}
                </Space>
              </div>
              {error && (
                <Alert
                  type="error"
                  showIcon
                  closable
                  message={error}
                  onClose={() => setError("")}
                  style={{ marginBottom: 20 }}
                />
              )}
              {!tenantId && <Empty description="请先配置公司账套" />}
              {page === "home" && (
                <>
                  <div className="welcome-strip">
                    <span className="strip-icon">
                      <SafetyCertificateOutlined />
                    </span>
                    <div>
                      <strong>先审核，再入账</strong>
                      <span>
                        当前为虚构公司测试账套。AI
                        只提供建议，正式账务始终由你确认。
                      </span>
                    </div>
                    <button onClick={() => setPage("settings")}>
                      查看处理设置 <ArrowRightOutlined />
                    </button>
                  </div>
                  <div className="stats-grid">
                    {[
                      {
                        label: "管理中的公司",
                        value: tenants.filter((t) => t.active).length,
                        unit: "家",
                        icon: <ApartmentOutlined />,
                        note: "各公司账套独立隔离",
                        color: "teal",
                      },
                      {
                        label: "当前公司待审核",
                        value: pending.length,
                        unit: "份",
                        icon: <InboxOutlined />,
                        note: pending.length
                          ? "等待人工核对后创建草稿"
                          : "当前没有待审核单据",
                        color: "amber",
                      },
                      {
                        label: "待正式提交",
                        value: drafts.length,
                        unit: "张",
                        icon: <BookOutlined />,
                        note: "已审核 · 尚未写入总账",
                        color: "blue",
                      },
                      {
                        label: "需要关注",
                        value: failed.length,
                        unit: "项",
                        icon: <ExclamationCircleOutlined />,
                        note: `${failed.length} 份解析失败；流水请到银行流水页面核对`,
                        color: "rose",
                      },
                    ].map((s) => (
                      <div className="stat-card" key={s.label}>
                        <div className="stat-top">
                          {s.label}
                          <span className={`stat-icon ${s.color}`}>
                            {s.icon}
                          </span>
                        </div>
                        <div className="stat-value">
                          {s.value}
                          <span>{s.unit}</span>
                        </div>
                        <div className="stat-note">{s.note}</div>
                      </div>
                    ))}
                  </div>
                  <div className="home-grid">
                    <section className="panel todo-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            待办清单{" "}
                            <span className="number-badge">
                              {pending.length + drafts.length + failed.length}
                            </span>
                          </h2>
                          <p>当前公司需要你处理的事项</p>
                        </div>
                        <Button
                          type="link"
                          onClick={() => setPage("documents")}
                        >
                          查看全部 <ArrowRightOutlined />
                        </Button>
                      </div>
                      <Table
                        rowKey="id"
                        size="middle"
                        columns={docColumns.filter((_, i) => i !== 1)}
                        dataSource={[...pending, ...drafts, ...failed].slice(
                          0,
                          5,
                        )}
                        pagination={false}
                        locale={{
                          emptyText: (
                            <div className="empty-todo">
                              <CheckCircleOutlined />
                              <strong>当前待办已处理完毕</strong>
                              <p>
                                上传发票、费用单或银行流水，开始下一批处理。
                              </p>
                            </div>
                          ),
                        }}
                      />
                    </section>
                    <section className="panel workflow-panel">
                      <div className="panel-heading">
                        <h2>本月处理进度</h2>
                        <Tag>{dayjs().format("YYYY-MM")}</Tag>
                      </div>
                      <div className="flow-step">
                        <span>01</span>
                        <div>
                          <strong>收集原始单据</strong>
                          <p>{docs.length} 份文件已归档</p>
                        </div>
                        <Upload
                          disabled={!can("finance:document:create")}
                          beforeUpload={upload}
                          showUploadList={false}
                        >
                          <Button type="text" icon={<PlusOutlined />} />
                        </Upload>
                      </div>
                      <div className="flow-step">
                        <span>02</span>
                        <div>
                          <strong>审核与凭证草稿</strong>
                          <p>
                            {pending.length} 份待审核 · {drafts.length} 张待提交
                          </p>
                        </div>
                      </div>
                      <div className="flow-step">
                        <span>03</span>
                        <div>
                          <strong>凭证提交与核对</strong>
                          <p>
                            {
                              docs.filter((d) => d.status === "SUBMITTED")
                                .length
                            }{" "}
                            张已提交至 ERPNext
                          </p>
                        </div>
                      </div>
                      <div className="closing-note">
                        <ClockCircleOutlined />
                        <div>
                          期间保护
                          <strong>
                            {tenant?.lockedThrough
                              ? `已锁定至 ${tenant.lockedThrough}`
                              : "当前未设置平台期间锁定"}
                          </strong>
                        </div>
                        <button onClick={() => setPage("companies")}>
                          <ArrowRightOutlined />
                        </button>
                      </div>
                    </section>
                  </div>
                  <section className="panel company-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>当前公司账套</h2>
                        <p>当前公司账套状态；切换公司请使用门户顶部选择器</p>
                      </div>
                      <Button type="link" onClick={() => setPage("companies")}>
                        账套配置 <ArrowRightOutlined />
                      </Button>
                    </div>
                    <Table
                      rowKey="id"
                      pagination={false}
                      dataSource={tenants}
                      columns={[
                        {
                          title: "公司名称",
                          dataIndex: "name",
                          render: (v, t) => (
                            <span className="company-name">
                              <span className="small-company">
                                {t.abbreviation.slice(0, 1)}
                              </span>
                              {v}
                              {t.id === tenantId && (
                                <Tag color="cyan">当前</Tag>
                              )}
                            </span>
                          ),
                        },
                        {
                          title: "账套模式",
                          render: () => (
                            <span className="muted">独立 Site</span>
                          ),
                        },
                        {
                          title: "待审核",
                          render: () => `${pending.length} 份`,
                        },
                        {
                          title: "未匹配流水",
                          dataIndex: "unmatchedCount",
                          render: () => "请在银行流水页面查看",
                        },
                        {
                          title: "账套连接",
                          render: (_, t) => (
                            <Tag color={t.connected ? "green" : "default"}>
                              {t.connected ? "已配置" : "未连接"}
                            </Tag>
                          ),
                        },
                        {
                          title: "",
                          render: (_, t) => (
                            <Button
                              type="link"
                              onClick={() => {
                                setTenantId(t.id);
                                setPage("documents");
                              }}
                            >
                              进入处理 <ArrowRightOutlined />
                            </Button>
                          ),
                        },
                      ]}
                    />
                  </section>
                </>
              )}
              {page === "documents" && (
                <section className="panel">
                  <div className="filter-bar">
                    <Space>
                      <Input
                        prefix={<SearchOutlined />}
                        placeholder="搜索文件或交易对手"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        allowClear
                        style={{ width: 260 }}
                      />
                      <Select
                        value={status}
                        onChange={setStatus}
                        style={{ width: 130 }}
                        options={[
                          { value: "ALL", label: "全部状态" },
                          ...Object.entries(statuses).map(
                            ([value, [label]]) => ({
                              value,
                              label,
                            }),
                          ),
                        ]}
                      />
                      <DatePicker.RangePicker
                        value={period}
                        allowClear={false}
                        onChange={(v) =>
                          v && setPeriod(v as [dayjs.Dayjs, dayjs.Dayjs])
                        }
                      />
                    </Space>
                    <Button
                      icon={<PlusOutlined />}
                      loading={busy}
                      disabled={!can("finance:document:create")}
                      onClick={() =>
                        run(async () => {
                          const d = await post(`${base}/manual-document`);
                          openReview(d);
                        }, "已创建手工单据")
                      }
                    >
                      手工录入
                    </Button>
                  </div>
                  <div className="table-caption">
                    <span>
                      共 {visibleDocs.length} 份单据 · 单次最多显示 500 份
                    </span>
                    <Space>
                      {selected.length > 0 &&
                        can("finance:document:review") && (
                          <>
                            <span>已选 {selected.length} 项</span>
                            <Button
                              size="small"
                              danger
                              onClick={() => bulk("reject")}
                            >
                              批量驳回
                            </Button>
                            <Button
                              size="small"
                              loading={busy}
                              onClick={() =>
                                modal.confirm({
                                  title: `审核通过并创建 ${selected.length} 张 ERPNext 草稿？`,
                                  content:
                                    "将逐项执行科目、借贷和期间校验；正式提交仍需逐张确认。",
                                  okText: "创建草稿",
                                  cancelText: "取消",
                                  onOk: () => bulk("draft"),
                                })
                              }
                            >
                              批量创建草稿
                            </Button>
                          </>
                        )}
                    </Space>
                  </div>
                  <Table
                    rowKey="id"
                    columns={docColumns}
                    dataSource={visibleDocs}
                    loading={loading}
                    rowSelection={
                      can("finance:document:review")
                        ? {
                            selectedRowKeys: selected,
                            onChange: setSelected,
                            getCheckboxProps: (d) => ({
                              disabled:
                                d.status !== "REVIEW" ||
                                d.suggestion?.documentType === "bank",
                            }),
                          }
                        : undefined
                    }
                    pagination={{
                      pageSize: 10,
                      showTotal: (total) => `共 ${total} 项`,
                    }}
                    scroll={{ x: 900 }}
                  />
                </section>
              )}
              {page === "projects" && (
                <>
                  <div className="info-line">
                    <FileTextOutlined />{" "}
                    合同与预算保存在工作台；收入、成本、开票及现金收支直接读取
                    ERPNext 项目维度。
                  </div>
                  <div className="project-grid">
                    {projects.map((p) => (
                      <section className="panel project-card" key={p.id}>
                        <div className="project-heading">
                          <span className="project-avatar">
                            <FolderOutlined />
                          </span>
                          <div>
                            <h2>{p.name}</h2>
                            <span className="muted">
                              {p.customer || "未填写客户"} · 负责人{" "}
                              {p.manager || "未填写"}
                            </span>
                          </div>
                          <Tag color="green">进行中</Tag>
                        </div>
                        <div className="project-contract">
                          <div>
                            合同金额<strong>{currency(p.contractCents)}</strong>
                          </div>
                          <div>
                            成本预算<strong>{currency(p.budgetCents)}</strong>
                          </div>
                        </div>
                        <div className="metric-heading">权责发生制</div>
                        <div className="project-metrics">
                          <div>
                            确认收入
                            <strong>
                              {p.metrics
                                ? currency(Math.round(p.metrics.income * 100))
                                : "—"}
                            </strong>
                          </div>
                          <div>
                            已发生成本
                            <strong>
                              {p.metrics
                                ? currency(Math.round(p.metrics.cost * 100))
                                : "—"}
                            </strong>
                          </div>
                          <div>
                            实际利润
                            <strong className="positive">
                              {p.metrics
                                ? currency(
                                    Math.round(
                                      (p.metrics.income - p.metrics.cost) * 100,
                                    ),
                                  )
                                : "—"}
                            </strong>
                          </div>
                        </div>
                        <div className="metric-heading">现金收支</div>
                        <div className="project-metrics">
                          <div>
                            实际收款
                            <strong>
                              {p.metrics
                                ? currency(Math.round(p.metrics.received * 100))
                                : "—"}
                            </strong>
                          </div>
                          <div>
                            实际付款
                            <strong>
                              {p.metrics
                                ? currency(Math.round(p.metrics.paid * 100))
                                : "—"}
                            </strong>
                          </div>
                          <div>
                            现金净额
                            <strong>
                              {p.metrics
                                ? currency(
                                    Math.round(
                                      (p.metrics.received - p.metrics.paid) *
                                        100,
                                    ),
                                  )
                                : "—"}
                            </strong>
                          </div>
                        </div>
                        <div className="project-bottom">
                          <span>
                            已开票{" "}
                            {p.metrics
                              ? currency(Math.round(p.metrics.invoiced * 100))
                              : "—"}
                          </span>
                          <span>
                            应收{" "}
                            {p.metrics
                              ? currency(Math.round(p.metrics.receivable * 100))
                              : "—"}
                          </span>
                        </div>
                        {p.metricsError && (
                          <Alert type="warning" message={p.metricsError} />
                        )}
                        <div className="muted project-note">
                          预计利润（合同 − 预算）：
                          {currency(p.contractCents - p.budgetCents)}
                          <br />
                          ERPNext 项目：{p.erpProject || "未关联"}
                        </div>
                      </section>
                    ))}
                  </div>
                  {!projects.length && (
                    <section className="panel empty-panel">
                      <Empty description="还没有项目。新建项目后，凭证可关联到 ERPNext 项目维度。" />
                      <Button
                        type="primary"
                        onClick={() => showDialog("project")}
                        icon={<PlusOutlined />}
                      >
                        新建项目
                      </Button>
                    </section>
                  )}
                </>
              )}
              {page === "bank" && (
                <section className="panel">
                  <div className="filter-bar">
                    <Input
                      prefix={<SearchOutlined />}
                      placeholder="搜索交易对手 / 摘要"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      style={{ width: 300 }}
                    />
                    <Button
                      onClick={() => {
                        const csv =
                          "交易日期,对方户名,收入,支出,摘要,流水号\n" +
                          dayjs().format("YYYY-MM-DD") +
                          ",虚构客户,1000.00,0,测试收款,TEST-001\n";
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(
                          new Blob(["\ufeff" + csv], {
                            type: "text/csv;charset=utf-8",
                          }),
                        );
                        a.download = "银行流水模板.csv";
                        a.click();
                        URL.revokeObjectURL(a.href);
                      }}
                    >
                      下载 CSV 模板
                    </Button>
                  </div>
                  <Alert
                    type="info"
                    showIcon
                    message="支持 UTF-8 CSV 和标准 XLSX；按公司检测重复。匹配时核对凭证所属公司、提交状态、日期与银行净额。"
                    banner
                  />
                  <Table
                    rowKey="id"
                    loading={loading}
                    dataSource={rows.filter((r) =>
                      `${r.counterparty} ${r.memo}`.includes(search),
                    )}
                    scroll={{ x: 900 }}
                    columns={[
                      { title: "交易日期", dataIndex: "date" },
                      { title: "交易对手", dataIndex: "counterparty" },
                      { title: "摘要", dataIndex: "memo" },
                      {
                        title: "收入 / 支出",
                        dataIndex: "amountCents",
                        align: "right",
                        render: (v) => (
                          <span
                            className={v > 0 ? "positive amount" : "amount"}
                          >
                            {v > 0 ? "+" : ""}
                            {currency(v)}
                          </span>
                        ),
                      },
                      {
                        title: "匹配状态",
                        render: (_, r) =>
                          r.matchedErpName ? (
                            <Tag color="green">{r.matchedErpName}</Tag>
                          ) : (
                            <Tag color="gold">待匹配</Tag>
                          ),
                      },
                      {
                        title: "操作",
                        render: (_, r) => (
                          <Button
                            type="link"
                            disabled={!!r.matchedErpName}
                            onClick={() => showDialog("match", { id: r.id })}
                          >
                            匹配凭证
                          </Button>
                        ),
                      },
                    ]}
                  />
                </section>
              )}
              {page === "accounts" && (
                <section className="panel">
                  <div className="filter-bar">
                    <Input
                      prefix={<SearchOutlined />}
                      placeholder="搜索科目编码 / 名称"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      style={{ width: 300 }}
                    />
                    <span className="muted">
                      来源：ERPNext · 当前公司可记账科目
                    </span>
                  </div>
                  <Table
                    rowKey="name"
                    dataSource={accounts.filter((a) =>
                      `${a.name} ${a.account_number ?? ""}`.includes(search),
                    )}
                    loading={loading}
                    columns={[
                      {
                        title: "科目编码",
                        dataIndex: "account_number",
                        render: (v) => v || "—",
                      },
                      { title: "科目名称", dataIndex: "account_name" },
                      {
                        title: "类型",
                        dataIndex: "root_type",
                        render: (v) =>
                          (
                            ({
                              Asset: "资产",
                              Liability: "负债",
                              Equity: "权益",
                              Income: "收入",
                              Expense: "费用",
                            }) as any
                          )[v] ?? v,
                      },
                      {
                        title: "账户性质",
                        dataIndex: "account_type",
                        render: (v) => v || "普通科目",
                      },
                      { title: "ERPNext 科目 ID", dataIndex: "name" },
                    ]}
                  />
                </section>
              )}
              {page === "journals" && (
                <section className="panel">
                  <div className="filter-bar">
                    <span className="muted">实时查询 · 最近 100 张凭证</span>
                  </div>
                  <Table
                    rowKey="name"
                    dataSource={rows}
                    loading={loading}
                    columns={[
                      { title: "凭证号", dataIndex: "name" },
                      { title: "记账日期", dataIndex: "posting_date" },
                      {
                        title: "借方合计",
                        dataIndex: "total_debit",
                        align: "right",
                        render: (v) => currency(Math.round(v * 100)),
                      },
                      {
                        title: "贷方合计",
                        dataIndex: "total_credit",
                        align: "right",
                        render: (v) => currency(Math.round(v * 100)),
                      },
                      {
                        title: "状态",
                        dataIndex: "docstatus",
                        render: (v) => (
                          <Tag
                            color={v === 1 ? "green" : v === 2 ? "red" : "blue"}
                          >
                            {v === 1 ? "已提交" : v === 2 ? "已撤销" : "草稿"}
                          </Tag>
                        ),
                      },
                      {
                        title: "摘要",
                        dataIndex: "user_remark",
                        ellipsis: true,
                      },
                    ]}
                  />
                </section>
              )}
              {page === "reports" && (
                <section className="panel">
                  <div className="filter-bar">
                    <Space>
                      <Select
                        value={reportType}
                        onChange={(v) => {
                          setReportType(v);
                          setReport(null);
                        }}
                        style={{ width: 180 }}
                        options={[
                          ["balance", "资产负债表"],
                          ["profit", "利润表"],
                          ["ledger", "总账 / 明细账"],
                          ["receivable", "应收账款"],
                          ["payable", "应付账款"],
                        ].map(([value, label]) => ({ value, label }))}
                      />
                      <DatePicker.RangePicker
                        value={period}
                        allowClear={false}
                        onChange={(v) =>
                          v && setPeriod(v as [dayjs.Dayjs, dayjs.Dayjs])
                        }
                      />
                      <Button
                        type="primary"
                        loading={busy}
                        onClick={() =>
                          run(
                            async () =>
                              setReport(
                                await api(
                                  `${base}/reports/${reportType}?from=${period[0].format("YYYY-MM-DD")}&to=${period[1].format("YYYY-MM-DD")}`,
                                ),
                              ),
                            "报表已从 ERPNext 读取",
                          )
                        }
                      >
                        查询报表
                      </Button>
                    </Space>
                  </div>
                  <Alert
                    type="warning"
                    showIcon
                    message="此处展示 ERPNext 原生报表，不代表已验证符合中国法定报表格式、增值税或纳税申报要求。"
                    banner
                  />
                  {report ? (
                    <Table
                      size="small"
                      rowKey={(_, i) => String(i)}
                      scroll={{ x: "max-content" }}
                      dataSource={(report.result ?? []).filter(
                        (r: any) =>
                          r && typeof r === "object" && !Array.isArray(r),
                      )}
                      columns={(report.columns ?? [])
                        .filter((c: any) => typeof c === "object" && !c.hidden)
                        .map((c: any) => ({
                          title: c.label,
                          dataIndex: c.fieldname,
                          width: c.width || 160,
                          render: (v: any) =>
                            typeof v === "number"
                              ? v.toLocaleString("zh-CN", {
                                  minimumFractionDigits: 2,
                                })
                              : typeof v === "object"
                                ? JSON.stringify(v)
                                : v,
                        }))}
                      pagination={{ pageSize: 30 }}
                    />
                  ) : (
                    <div className="empty-panel">
                      <Empty description="选择报表和日期，然后查询" />
                    </div>
                  )}
                </section>
              )}
              {page === "companies" && (
                <section className="panel">
                  <div className="filter-bar">
                    <span className="muted">当前公司的独立财务账套</span>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      disabled={tenant?.provisionStatus === "READY"}
                      onClick={() => showDialog("tenant")}
                    >
                      配置当前公司账套
                    </Button>
                  </div>
                  <Table
                    rowKey="id"
                    dataSource={tenants}
                    pagination={false}
                    scroll={{ x: 1100 }}
                    columns={[
                      { title: "公司", dataIndex: "name" },
                      { title: "税号", dataIndex: "taxId" },
                      { title: "独立 Site", dataIndex: "siteName" },
                      {
                        title: "期间锁定至",
                        dataIndex: "lockedThrough",
                        render: (v) => v || "未锁定",
                      },
                      {
                        title: "状态",
                        render: (_, r) => (
                          <Tag color={r.active ? "green" : "default"}>
                            {r.active ? "启用" : "停用"}
                          </Tag>
                        ),
                      },
                      {
                        title: "操作",
                        render: (_, r) => (
                          <Space>
                            <Button
                              type="link"
                              onClick={() =>
                                showDialog("company", {
                                  ...r,
                                  lockedThrough: r.lockedThrough
                                    ? dayjs(r.lockedThrough)
                                    : undefined,
                                })
                              }
                            >
                              配置
                            </Button>
                            <Button
                              type="link"
                              onClick={() =>
                                run(
                                  () =>
                                    patch(`/tenants/${r.id}`, {
                                      active: !r.active,
                                    }),
                                  r.active ? "公司已停用" : "公司已启用",
                                )
                              }
                            >
                              {r.active ? "停用" : "启用"}
                            </Button>
                          </Space>
                        ),
                      },
                    ]}
                  />
                </section>
              )}
              {page === "audit" && (
                <section className="panel">
                  <div className="filter-bar">
                    <Input
                      prefix={<SearchOutlined />}
                      placeholder="搜索操作或记录 ID"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      style={{ width: 300 }}
                    />
                    <span className="muted">当前公司 · 最近 300 项记录</span>
                  </div>
                  <Table
                    rowKey="id"
                    dataSource={rows.filter((r) =>
                      `${r.action} ${r.resourceId}`.includes(search),
                    )}
                    loading={loading}
                    columns={[
                      {
                        title: "时间",
                        dataIndex: "createdAt",
                        render: (v) => dayjs(v).format("YYYY-MM-DD HH:mm:ss"),
                      },
                      {
                        title: "操作",
                        dataIndex: "action",
                        render: (v) => (
                          <Tag>
                            {(
                              {
                                DOCUMENT_UPLOADED: "上传单据",
                                SUGGESTION_EDITED: "修改建议",
                                ERP_DRAFT_CREATED: "创建 ERPNext 草稿",
                                ERP_SUBMITTED: "正式提交",
                                PROCESS_COMPLETED: "解析完成",
                                REJECTED: "驳回单据",
                                TENANT_UPDATED: "修改账套配置",
                                PROCESSOR_CONFIGURED: "修改处理器",
                                BANK_MATCHED: "匹配流水",
                                PROJECT_CREATED: "创建项目",
                              } as any
                            )[v] ?? v}
                          </Tag>
                        ),
                      },
                      {
                        title: "操作人",
                        dataIndex: "userId",
                        render: (v) =>
                          v === "worker"
                            ? "后台处理器"
                            : v === user.id
                              ? user.name
                              : v,
                      },
                      { title: "关联记录", dataIndex: "resourceId" },
                      {
                        title: "详情",
                        render: (_, r) => (
                          <Button
                            type="link"
                            onClick={() =>
                              modal.info({
                                title: "审计详情",
                                width: 700,
                                content: (
                                  <pre className="json-detail">
                                    {JSON.stringify(r.detail, null, 2)}
                                  </pre>
                                ),
                              })
                            }
                          >
                            查看
                          </Button>
                        ),
                      },
                    ]}
                  />
                </section>
              )}
              {page === "settings" && (
                <>
                  <Alert
                    type="info"
                    showIcon
                    message="当前公司单独配置。未启用云端模型时，文件不会发送给模型供应商。数字长串、手机号与邮箱会在发送前脱敏；名称、业务内容仍可能被发送。"
                    style={{ marginBottom: 20 }}
                  />
                  <div className="processor-grid">
                    {rows.map((r) => (
                      <section className="panel processor-card" key={r.id}>
                        <span className="processor-icon">
                          {r.id === "parser" ? (
                            <FileTextOutlined />
                          ) : r.id === "llm" ? (
                            <AppstoreOutlined />
                          ) : (
                            <SearchOutlined />
                          )}
                        </span>
                        <h2>{r.name}</h2>
                        <p className="muted">版本 {r.version}</p>
                        <Tag color={r.enabled ? "green" : "default"}>
                          {r.enabled ? "已启用" : "未启用"}
                        </Tag>
                        <p>
                          {r.note ??
                            (r.id === "parser"
                              ? "支持 CSV、XLSX 和文字型 PDF。任务失败会自动重试，原始文件保留。"
                              : "结构化 JSON 校验 · 人工审核 · 无自动入账权限")}
                        </p>
                        {r.id === "parser" && (
                          <Switch
                            checked={r.enabled}
                            checkedChildren="启用"
                            unCheckedChildren="停用"
                            onChange={(enabled) =>
                              run(() =>
                                patch(`${base}/processors/parser`, { enabled }),
                              )
                            }
                          />
                        )}{" "}
                        {r.id === "llm" && (
                          <Button
                            onClick={() =>
                              showDialog("llm", {
                                enabled: r.enabled,
                                ...r.config,
                              })
                            }
                          >
                            配置供应商
                          </Button>
                        )}
                      </section>
                    ))}
                  </div>
                  <section className="panel capability-panel">
                    <h2>当前能力与使用边界</h2>
                    <p>
                      ERPNext
                      为唯一正式会计内核。凭证撤销、冲销、更正、原生收付款和会计期间管理通过
                      ERPNext 处理。
                    </p>
                    <p>
                      中国会计科目与法定报表、数电发票验真、增值税处理和纳税申报尚未完成本地化验证。当前仅可用于测试及与现有合规软件并行核对。
                    </p>
                    <p>
                      OCR
                      已预留统一接口，当前未接入实际识别供应商。银行对账暂支持一条流水对应一张凭证；复杂拆分和合并需在
                      ERPNext 原生模块处理。
                    </p>
                  </section>
                </>
              )}
              <footer className="page-footer">
                <span>简账 · 把繁杂留给流程，把判断留给你。</span>
                <span>财务内核 ERPNext 16 · 所有金额为人民币</span>
              </footer>
            </>
          )}
        </main>
      </div>
      <Drawer
        getContainer={() => popupRoot}
        rootStyle={{position:'absolute'}}
        title={<Space>单据审核 {review && badge(review.status)}</Space>}
        open={!!review}
        onClose={() => setReview(null)}
        width="100%"
        destroyOnHidden
        extra={review?.erpName && <Tag color="blue">{review.erpName}</Tag>}
        footer={
          review && (
            <div className="review-footer">
              <span className="muted">
                {tenant?.name} · 原始单据与凭证全程关联
              </span>
              <Space>
                {can("finance:document:review") &&
                  ["FAILED", "REJECTED"].includes(review.status) && (
                    <Button
                      loading={busy}
                      onClick={() =>
                        run(() =>
                          post(`${base}/documents/${review.id}/retry`),
                        ).then((ok) => ok && setReview(null))
                      }
                    >
                      重新解析
                    </Button>
                  )}
                {can("finance:document:review") &&
                  ["REVIEW", "REJECTED"].includes(review.status) &&
                  review.suggestion?.documentType !== "bank" && (
                    <>
                      <Button
                        loading={busy}
                        onClick={() => run(saveReview, "修改已保存")}
                      >
                        保存修改
                      </Button>
                      <Button type="primary" loading={busy} onClick={approve}>
                        审核通过并创建草稿
                      </Button>
                    </>
                  )}
                {can("finance:document:review") &&
                  review.status === "REVIEW" && (
                    <Button
                      danger
                      onClick={() =>
                        modal.confirm({
                          title: "驳回此单据？",
                          content:
                            "原始文件与处理历史会保留，可修正后重新处理。",
                          okText: "驳回",
                          cancelText: "取消",
                          onOk: async () => {
                            await post(
                              `${base}/documents/${review.id}/reject`,
                              {
                                reason: "人工审核驳回",
                              },
                            );
                            setReview(null);
                            await refresh();
                          },
                        })
                      }
                    >
                      驳回
                    </Button>
                  )}
                {can("finance:voucher:submit") && review.status === "DRAFT" && (
                  <Button type="primary" onClick={() => submit(review)}>
                    检查并提交正式账务
                  </Button>
                )}
              </Space>
            </div>
          )
        }
      >
        {review && (
          <div className="review-grid">
            <section className="source-pane">
              <h3>原始单据</h3>
              <p className="muted">{review.filename}</p>
              {/\.(png|jpe?g)$/i.test(review.filename) ? (
                <img className="source-image" src={client.fileUrl(review.id)} />
              ) : review.filename.toLowerCase().endsWith(".pdf") ? (
                <iframe title="原始 PDF" src={client.fileUrl(review.id)} />
              ) : (
                <div className="source-text">
                  <FileTextOutlined />
                  <a
                    href={client.fileUrl(review.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看 / 下载原始文件
                  </a>
                  <pre>
                    {review.suggestion?.supportingEvidence?.join("\n\n") ||
                      "手工录入单据。请保留业务凭据，并核对所有字段。"}
                  </pre>
                </div>
              )}
              <div className="source-id">原始单据 ID：{review.id}</div>
            </section>
            <section>
              <h3>凭证建议</h3>
              {review.error && (
                <Alert
                  type="warning"
                  showIcon
                  message={review.error}
                  style={{ marginBottom: 16 }}
                />
              )}
              <Alert
                type="info"
                showIcon
                message={
                  review.suggestion?.confidence
                    ? `模型置信度 ${Math.round(review.suggestion.confidence * 100)}% · 所有字段仍需人工核对`
                    : "待人工录入 · 未获得有效 AI 识别结果"
                }
                style={{ marginBottom: 18 }}
              />
              {review.suggestion && (
                <Form
                  form={reviewForm}
                  layout="vertical"
                  onValuesChange={() => {
                    dirty.current = true;
                  }}
                  disabled={
                    !can("finance:document:review") ||
                    !["REVIEW", "REJECTED"].includes(review.status)
                  }
                >
                  <div className="form-two">
                    <Form.Item
                      name="transactionDate"
                      label="记账日期"
                      rules={[{ required: true }]}
                    >
                      <DatePicker style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item name="documentType" label="单据类型">
                      <Select
                        options={[
                          { value: "expense", label: "费用报销" },
                          { value: "invoice", label: "发票" },
                          { value: "manual", label: "手工凭证" },
                          { value: "bank", label: "流水批次归档" },
                        ]}
                      />
                    </Form.Item>
                  </div>
                  <Form.Item
                    name="invoiceNumber"
                    label="发票号码（发票必填，公司内唯一）"
                  >
                    <Input placeholder="非发票可留空" />
                  </Form.Item>
                  <Form.Item
                    name="counterparty"
                    label="交易对手"
                    rules={[{ required: true, message: "请输入交易对手" }]}
                  >
                    <Input placeholder="填写客户、供应商或报销人" />
                  </Form.Item>
                  <div className="form-two">
                    <Form.Item
                      name="amount"
                      label="单据金额（元）"
                      rules={[{ required: true }]}
                    >
                      <InputNumber
                        min={0.01}
                        max={20000000}
                        precision={2}
                        style={{ width: "100%" }}
                      />
                    </Form.Item>
                    <Form.Item name="tax" label="其中税额（元）">
                      <InputNumber
                        min={0}
                        max={20000000}
                        precision={2}
                        style={{ width: "100%" }}
                      />
                    </Form.Item>
                  </div>
                  <div className="entry-label">
                    <strong>会计分录</strong>
                    <span className="muted">借贷合计必须相等</span>
                  </div>
                  <Form.List name="entries">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map((field) => (
                          <div className="entry-row" key={field.key}>
                            <Form.Item
                              name={[field.name, "account"]}
                              label={`分录 ${field.name + 1} · 科目`}
                              rules={[
                                { required: true, message: "请选择科目" },
                              ]}
                            >
                              <Select
                                showSearch
                                optionFilterProp="label"
                                placeholder="选择当前公司科目"
                                options={accounts.map((a) => ({
                                  value: a.name,
                                  label: `${a.account_number || ""} ${a.account_name}`,
                                }))}
                              />
                            </Form.Item>
                            <div className="entry-amounts">
                              <Form.Item
                                name={[field.name, "debit"]}
                                label="借方（元）"
                              >
                                <InputNumber
                                  min={0}
                                  precision={2}
                                  style={{ width: "100%" }}
                                />
                              </Form.Item>
                              <Form.Item
                                name={[field.name, "credit"]}
                                label="贷方（元）"
                              >
                                <InputNumber
                                  min={0}
                                  precision={2}
                                  style={{ width: "100%" }}
                                />
                              </Form.Item>
                              {fields.length > 2 && (
                                <Button
                                  type="text"
                                  danger
                                  onClick={() => remove(field.name)}
                                >
                                  删除
                                </Button>
                              )}
                            </div>
                            <Form.Item
                              name={[field.name, "project"]}
                              label="关联项目（可选）"
                            >
                              <Select
                                allowClear
                                showSearch
                                optionFilterProp="label"
                                placeholder="选择当前公司的项目"
                                options={projects.map((p) => ({
                                  value: p.name,
                                  label: p.project_name,
                                }))}
                              />
                            </Form.Item>
                          </div>
                        ))}
                        <Button
                          type="dashed"
                          block
                          icon={<PlusOutlined />}
                          onClick={() => add({ debit: 0, credit: 0 })}
                        >
                          添加分录
                        </Button>
                      </>
                    )}
                  </Form.List>
                  <Form.Item
                    name="reasoningSummary"
                    label="摘要 / 判断依据"
                    style={{ marginTop: 16 }}
                  >
                    <Input.TextArea rows={3} />
                  </Form.Item>
                </Form>
              )}
            </section>
          </div>
        )}
      </Drawer>
      <Modal
        getContainer={() => popupRoot}
        open={!!dialog}
        title={
          (
            {
              project: "新建项目与合同",
              tenant: "新增公司账套映射",
              company: "公司与期间设置",
              match: "匹配正式凭证",
              llm: "配置云端模型",
            } as any
          )[dialog]
        }
        onCancel={() => setDialog("")}
        confirmLoading={busy}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
        onOk={async () => {
          const v = await form.validateFields();
          const ok = await run(async () => {
            if (dialog === "project")
              await post(`${base}/projects`, {
                ...v,
                contractCents: Math.round(v.contract * 100),
                budgetCents: Math.round(v.budget * 100),
              });
            if (dialog === "tenant") await client.provision(v);
            if (dialog === "company")
              await patch(`/tenants/${v.id}`, {
                name: v.name,
                taxId: v.taxId,
                lockedThrough: v.lockedThrough?.format("YYYY-MM-DD") || "",
                ...(v.apiKey
                  ? { apiKey: v.apiKey, apiSecret: v.apiSecret }
                  : {}),
              });
            if (dialog === "match")
              await post(`${base}/bank/${v.id}/match`, { erpName: v.erpName });
            if (dialog === "llm") await patch(`${base}/processors/llm`, v);
          });
          if (ok) setDialog("");
        }}
      >
        <Form
          form={form}
          onValuesChange={() => {
            dirty.current = true;
          }}
          layout="vertical"
          preserve={false}
          initialValues={{ contract: 0, budget: 0, enabled: false }}
        >
          {dialog === "project" && (
            <>
              <Form.Item
                label="项目名称"
                name="name"
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item label="客户" name="customer" initialValue="">
                <Input />
              </Form.Item>
              <Form.Item label="负责人" name="manager" initialValue="">
                <Input />
              </Form.Item>
              <div className="form-two">
                <Form.Item
                  label="合同金额（元）"
                  name="contract"
                  rules={[{ required: true }]}
                >
                  <InputNumber
                    min={0}
                    max={20000000}
                    precision={2}
                    style={{ width: "100%" }}
                  />
                </Form.Item>
                <Form.Item
                  label="成本预算（元）"
                  name="budget"
                  rules={[{ required: true }]}
                >
                  <InputNumber
                    min={0}
                    max={20000000}
                    precision={2}
                    style={{ width: "100%" }}
                  />
                </Form.Item>
              </div>
              <Alert
                message="同时在当前公司 ERPNext 中创建项目，凭证可通过该维度归集收入与成本。"
                type="info"
              />
            </>
          )}
          {["tenant", "company"].includes(dialog) && (
            <>
              <Form.Item name="id" hidden>
                <Input />
              </Form.Item>
              <Form.Item
                name="name"
                label="公司全称"
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              {dialog === "tenant" && (
                <>
                  <Form.Item
                    name="abbreviation"
                    label="简称"
                    rules={[{ required: true }]}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item
                    name="siteName"
                    label="已建立的 ERPNext Site"
                    rules={[{ required: true }]}
                  >
                    <Input placeholder="例如 demo-c.localhost" />
                  </Form.Item>
                  <Form.Item
                    name="erpCompany"
                    label="ERPNext 公司名称"
                    rules={[{ required: true }]}
                  >
                    <Input />
                  </Form.Item>
                </>
              )}
              {dialog === "tenant" && (
                <>
                  <Form.Item
                    name="apiKey"
                    label="ERPNext API Key"
                    rules={[{ required: true }]}
                  >
                    <Input autoComplete="off" />
                  </Form.Item>
                  <Form.Item
                    name="apiSecret"
                    label="ERPNext API Secret"
                    rules={[{ required: true }]}
                  >
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                </>
              )}
              <Form.Item name="taxId" label="税号" initialValue="">
                <Input />
              </Form.Item>
              {dialog === "company" && (
                <>
                  <Form.Item
                    name="lockedThrough"
                    label="锁定至（含该日，不允许界面回退）"
                  >
                    <DatePicker style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item
                    name="apiKey"
                    label="ERPNext API Key（留空则保留）"
                  >
                    <Input autoComplete="off" />
                  </Form.Item>
                  <Form.Item name="apiSecret" label="ERPNext API Secret">
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                </>
              )}
              <Alert
                type="info"
                message="新增映射不会自动建立 Site。请先由管理员在服务器创建独立账套，再配置专用 API 凭证。"
              />
            </>
          )}
          {dialog === "match" && (
            <>
              <Form.Item name="id" hidden>
                <Input />
              </Form.Item>
              <Form.Item
                name="erpName"
                label="当前公司已提交的 ERPNext 凭证号"
                rules={[{ required: true }]}
              >
                <Input placeholder="ACC-JV-2026-00001" />
              </Form.Item>
              <Alert
                type="info"
                message="会校验公司、日期、提交状态和银行净额，一张凭证只能匹配一条流水。"
              />
            </>
          )}
          {dialog === "llm" && (
            <>
              <Form.Item
                name="enabled"
                label="启用云端处理"
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item name="endpoint" label="OpenAI 兼容接口地址">
                <Input placeholder="https://供应商域名/v1/" />
              </Form.Item>
              <Form.Item name="model" label="模型名称">
                <Input />
              </Form.Item>
              <Form.Item name="apiKey" label="API 密钥（留空保留）">
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item name="acknowledgeCloud" valuePropName="checked">
                <Checkbox>
                  我确认将脱敏后的单据文本发送至此供应商，业务名称与内容可能仍包含敏感信息。
                </Checkbox>
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </div>
  );
}
