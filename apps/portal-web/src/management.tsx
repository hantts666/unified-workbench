import React, { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
} from "antd";
import { api, write, appNames, permissionNames } from "./api.js";
export const adminPages = [
  {
    key: "users",
    title: "用户管理",
    description: "统一管理登录账号和使用状态",
    permission: "platform:user:manage",
    endpoint: "/users",
  },
  {
    key: "companies",
    title: "公司管理",
    description: "建立公司档案，再为成员分配应用权限",
    permission: "platform:company:manage",
    endpoint: "/admin/companies",
  },
  {
    key: "roles",
    title: "角色管理",
    description: "按应用组合操作权限，财务入账单独授权",
    permission: "platform:role:manage",
    endpoint: "/roles",
  },
  {
    key: "applications",
    title: "应用管理",
    description: "管理已接入应用的名称和使用状态",
    permission: "platform:application:manage",
    endpoint: "/admin/applications",
  },
  {
    key: "access",
    title: "成员授权",
    description: "先选公司，再分配该公司内的应用角色",
    permission: "platform:authorization:manage",
    endpoint: "/authorization-options",
  },
  {
    key: "audit",
    title: "操作日志",
    description: "查看平台账号、角色和授权的操作记录",
    permission: "platform:audit:view",
    endpoint: "/audit",
  },
] as const;
type PageKey = (typeof adminPages)[number]["key"];
const activeColumn = {
  title: "状态",
  dataIndex: "active",
  render: (active: boolean) => (
    <Tag color={active ? "green" : "default"}>
      {active ? "已启用" : "已停用"}
    </Tag>
  ),
};
export function Management({ section }: { section: PageKey }) {
  const definition = adminPages.find((page) => page.key === section)!;
  const { message } = App.useApp();
  const [data, setData] = useState<any[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<any>(undefined),
    [saving, setSaving] = useState(false),
    [permissions, setPermissions] = useState<any[]>([]),
    [revision, setRevision] = useState(0);
  const [form] = Form.useForm();
  const application = Form.useWatch("applicationId", form);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    Promise.all([
      api(definition.endpoint),
      section === "roles" ? api("/admin/permissions") : Promise.resolve([]),
    ])
      .then(([items, choices]) => {
        if (current) {
          setData(items);
          setPermissions(choices);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [section, revision]);
  if (section === "access") return <AccessManagement />;
  const edit = (item: any) => {
    form.resetFields();
    form.setFieldsValue(
      item
        ? {
            ...item,
            permissionCodes: item.permissions?.map(
              (p: any) => p.permission.code,
            ),
          }
        : { applicationId: "finance", permissionCodes: [] },
    );
    setEditing(item ?? null);
  };
  const toggle = async (item: any) => {
    try {
      await write(
        definition.endpoint + "/" + encodeURIComponent(item.id),
        "PATCH",
        { active: !item.active },
      );
      message.success("状态已更新");
      setRevision((v) => v + 1);
    } catch (e: any) {
      message.error(e.message);
    }
  };
  const operations = {
    title: "操作",
    key: "actions",
    render: (_: any, item: any) => (
      <Space>
        <Button type="link" onClick={() => edit(item)}>
          编辑
        </Button>
        {!(section === "applications" && item.code === "platform") && (
          <Popconfirm
            title={
              item.active
                ? "停用后相关访问权限会立即失效，继续吗？"
                : "重新启用此记录？"
            }
            onConfirm={() => toggle(item)}
          >
            <Button type="link" danger={item.active}>
              {item.active ? "停用" : "启用"}
            </Button>
          </Popconfirm>
        )}
      </Space>
    ),
  };
  const columns: any =
    section === "users"
      ? [
          { title: "姓名", dataIndex: "displayName" },
          { title: "账号", dataIndex: "account" },
          activeColumn,
          operations,
        ]
      : section === "companies"
        ? [
            { title: "公司名称", dataIndex: "name" },
            { title: "简称", dataIndex: "abbreviation" },
            { title: "税号", dataIndex: "taxId" },
            activeColumn,
            operations,
          ]
        : section === "roles"
          ? [
              { title: "角色", dataIndex: "name" },
              {
                title: "应用",
                dataIndex: "applicationId",
                render: (value: string) => appNames[value],
              },
              {
                title: "操作权限",
                render: (_: any, item: any) => (
                  <Space wrap>
                    {item.permissions.map((p: any) => (
                      <Tag key={p.permissionId}>
                        {permissionNames[p.permission.code] ??
                          p.permission.code}
                      </Tag>
                    ))}
                  </Space>
                ),
              },
              activeColumn,
              operations,
            ]
          : section === "applications"
            ? [
                { title: "应用名称", dataIndex: "name" },
                { title: "访问路径", dataIndex: "activeRule" },
                activeColumn,
                operations,
              ]
            : [
                {
                  title: "时间",
                  dataIndex: "createdAt",
                  render: (value: string) =>
                    new Date(value).toLocaleString("zh-CN"),
                },
                { title: "操作", dataIndex: "action" },
                { title: "对象", dataIndex: "resourceType" },
                { title: "操作人 ID", dataIndex: "actorId" },
              ];
  const save = async (values: any) => {
    setSaving(true);
    try {
      let body: any;
      if (section === "users")
        body = {
          displayName: values.displayName,
          ...(!editing
            ? { account: values.account, password: values.password }
            : values.password
              ? { password: values.password }
              : {}),
        };
      else if (section === "roles")
        body = {
          name: values.name,
          permissionCodes: values.permissionCodes ?? [],
          ...(!editing
            ? { code: values.code, applicationId: values.applicationId }
            : {}),
        };
      else if (section === "companies")
        body = {
          name: values.name,
          abbreviation: values.abbreviation,
          taxId: values.taxId ?? "",
        };
      else body = { name: values.name };
      await write(
        definition.endpoint +
          (editing ? "/" + encodeURIComponent(editing.id) : ""),
        editing ? "PATCH" : "POST",
        body,
      );
      message.success("已保存");
      setEditing(undefined);
      setRevision((v) => v + 1);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div className="portal-page-heading">
        <div>
          <h1>{definition.title}</h1>
          <p>{definition.description}</p>
        </div>
        <Space>
          <Button onClick={() => setRevision((v) => v + 1)}>刷新</Button>
          {["users", "companies", "roles"].includes(section) && (
            <Button type="primary" onClick={() => edit(null)}>
              新增
              {section === "users"
                ? "用户"
                : section === "companies"
                  ? "公司"
                  : "角色"}
            </Button>
          )}
        </Space>
      </div>
      {error ? (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            <Button onClick={() => setRevision((v) => v + 1)}>重试</Button>
          }
        />
      ) : (
        <Table
          rowKey="id"
          dataSource={data}
          columns={columns}
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          scroll={{ x: 720 }}
        />
      )}
      <Modal
        title={`${editing ? "编辑" : "新增"}${definition.title.replace("管理", "")}`}
        open={editing !== undefined}
        onCancel={() => setEditing(undefined)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={save} preserve={false}>
          {section === "users" ? (
            <>
              <Form.Item
                name="displayName"
                label="姓名"
                rules={[{ required: true }]}
              >
                <Input maxLength={100} />
              </Form.Item>
              {!editing && (
                <Form.Item
                  name="account"
                  label="账号"
                  rules={[{ required: true }]}
                >
                  <Input maxLength={200} autoComplete="off" />
                </Form.Item>
              )}
              <Form.Item
                name="password"
                label={editing ? "重置密码（留空不修改）" : "初始密码"}
                rules={[
                  { required: !editing },
                  { min: 12, message: "密码至少 12 个字符" },
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
            </>
          ) : (
            <Form.Item name="name" label="名称" rules={[{ required: true }]}>
              <Input maxLength={200} />
            </Form.Item>
          )}
          {section === "companies" && (
            <>
              <Form.Item
                name="abbreviation"
                label="公司简称"
                rules={[{ required: true }]}
              >
                <Input maxLength={30} />
              </Form.Item>
              <Form.Item name="taxId" label="税号">
                <Input maxLength={50} />
              </Form.Item>
            </>
          )}
          {section === "roles" && (
            <>
              <Form.Item
                name="applicationId"
                label="所属应用"
                rules={[{ required: true }]}
              >
                <Select
                  disabled={!!editing}
                  options={Object.entries(appNames).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                  onChange={() => form.setFieldValue("permissionCodes", [])}
                />
              </Form.Item>
              {!editing && (
                <Form.Item
                  name="code"
                  label="角色标识"
                  rules={[
                    { required: true },
                    {
                      pattern: /^[a-z][a-z0-9-]{1,60}$/,
                      message: "使用小写字母、数字和短横线，字母开头",
                    },
                  ]}
                >
                  <Input placeholder="例如 finance-review" />
                </Form.Item>
              )}
              <Form.Item name="permissionCodes" label="允许的操作">
                <Checkbox.Group
                  className="portal-permission-grid"
                  options={permissions
                    .filter((p) => p.applicationId === application)
                    .map((p) => ({
                      value: p.code,
                      label: permissionNames[p.code] ?? p.code,
                    }))}
                />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </>
  );
}
function AccessManagement() {
  const { message } = App.useApp();
  const [options, setOptions] = useState<any>(),
    [selected, setSelected] = useState<string>(),
    [access, setAccess] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [companyIds, setCompanyIds] = useState<string[]>([]),
    [roleId, setRoleId] = useState<string>(),
    [companyId, setCompanyId] = useState<string>(),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    api("/authorization-options")
      .then((v) => {
        if (current) setOptions(v);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [revision]);
  useEffect(() => {
    let current = true;
    setAccess(undefined);
    if (selected)
      api(`/users/${encodeURIComponent(selected)}/access`)
        .then((v) => {
          if (current) {
            setAccess(v);
            setCompanyIds(
              v.memberships
                .filter((m: any) => m.active)
                .map((m: any) => m.companyId),
            );
          }
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [selected, revision]);
  const run = async (action: () => Promise<any>) => {
    setBusy(true);
    try {
      await action();
      message.success("授权已更新，即时生效");
      setRevision((v) => v + 1);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  const role = options?.roles.find((r: any) => r.id === roleId);
  return (
    <>
      <div className="portal-page-heading">
        <div>
          <h1>成员授权</h1>
          <p>公司成员资格与应用角色分别管理，修改立即生效。</p>
        </div>
        <Button
          onClick={() => {
            setError("");
            setRevision((v) => v + 1);
          }}
        >
          刷新
        </Button>
      </div>
      {error && <Alert type="error" message={error} />}
      {!options ? (
        <Spin />
      ) : (
        <>
          <Select
            aria-label="选择用户"
            placeholder="选择需要授权的用户"
            value={selected}
            onChange={setSelected}
            showSearch
            optionFilterProp="label"
            style={{ width: 320 }}
            options={options.users.map((u: any) => ({
              value: u.id,
              label: `${u.displayName} (${u.account})`,
            }))}
          />
          {selected && access ? (
            <div className="portal-access-grid">
              <section className="portal-card">
                <h2>1. 可用公司</h2>
                <p>加入公司后，仍需分配对应的应用角色。</p>
                <Checkbox.Group
                  className="portal-permission-grid"
                  value={companyIds}
                  onChange={setCompanyIds}
                  options={options.companies.map((c: any) => ({
                    value: c.id,
                    label: c.name,
                  }))}
                />
                <Button
                  loading={busy}
                  type="primary"
                  onClick={() =>
                    run(() =>
                      write(`/users/${selected}/companies`, "PUT", {
                        companyIds,
                      }),
                    )
                  }
                >
                  保存公司范围
                </Button>
              </section>
              <section className="portal-card">
                <h2>2. 应用角色</h2>
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Select
                    aria-label="选择角色"
                    placeholder="选择应用角色"
                    value={roleId}
                    onChange={(value) => {
                      setRoleId(value);
                      setCompanyId(undefined);
                    }}
                    style={{ width: "100%" }}
                    options={options.roles.map((r: any) => ({
                      value: r.id,
                      label: `${appNames[r.applicationId]} · ${r.name}`,
                    }))}
                  />
                  {role?.scopeType === "company" && (
                    <Select
                      aria-label="授权公司"
                      placeholder="选择授权公司"
                      value={companyId}
                      onChange={setCompanyId}
                      style={{ width: "100%" }}
                      options={access.memberships
                        .filter((m: any) => m.active && m.company.active)
                        .map((m: any) => ({
                          value: m.companyId,
                          label: m.company.name,
                        }))}
                    />
                  )}
                  <Button
                    disabled={
                      !roleId || (role?.scopeType === "company" && !companyId)
                    }
                    loading={busy}
                    onClick={() =>
                      run(() =>
                        write(`/users/${selected}/assignments`, "POST", {
                          roleId,
                          companyId:
                            role.scopeType === "company" ? companyId : null,
                        }),
                      )
                    }
                  >
                    添加角色授权
                  </Button>
                </Space>
              </section>
              <section className="portal-card portal-access-table">
                <h2>当前角色授权</h2>
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={access.assignments}
                  pagination={false}
                  columns={[
                    { title: "角色", render: (_: any, a: any) => a.role.name },
                    {
                      title: "应用",
                      dataIndex: "applicationId",
                      render: (v: string) => appNames[v],
                    },
                    {
                      title: "范围",
                      render: (_: any, a: any) =>
                        a.companyId
                          ? (options.companies.find(
                              (c: any) => c.id === a.companyId,
                            )?.name ?? "已停用公司")
                          : "整个平台",
                    },
                    {
                      title: "操作",
                      render: (_: any, a: any) => (
                        <Popconfirm
                          title="撤销后该角色权限会立即失效，继续吗？"
                          onConfirm={() =>
                            run(() => write(`/assignments/${a.id}`, "DELETE"))
                          }
                        >
                          <Button type="link" danger>
                            撤销
                          </Button>
                        </Popconfirm>
                      ),
                    },
                  ]}
                />
              </section>
            </div>
          ) : (
            <Empty
              description={selected ? "正在读取授权…" : "先选择一个用户"}
            />
          )}
        </>
      )}
    </>
  );
}
