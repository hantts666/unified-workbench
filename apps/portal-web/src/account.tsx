import React, {useEffect,useState} from 'react';
import {Alert,App,Button,Form,Input,Popconfirm,Space,Table,Tag} from 'antd';
import {api,write} from './api.js';

export function AccountSecurity({user,forced=false,onChanged,onLogout}:{user:any;forced?:boolean;onChanged:()=>void;onLogout:()=>void}){
  const {message}=App.useApp();
  const [form]=Form.useForm();
  const [saving,setSaving]=useState(false),[error,setError]=useState(''),[sessions,setSessions]=useState<any[]>([]),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  useEffect(()=>{let current=true;if(!forced)api('/auth/sessions').then(data=>{if(current)setSessions(data);}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[forced,revision]);
  const revoke=async(path:string,method:string,current=false)=>{
    setBusy(true);setError('');
    try{await write(path,method);if(current)onChanged();else{setRevision(v=>v+1);message.success('登录设备已退出');}}
    catch(e:any){setError(e.message);}finally{setBusy(false);}
  };
  return <div className="portal-account" data-testid="account-security">
    <div className="portal-page-heading"><div><h1>{forced?'请先设置自己的密码':'账号安全'}</h1><p>{user.displayName} · {user.account}</p></div>{forced&&<Button onClick={onLogout}>退出登录</Button>}</div>
    {error&&<Alert type="error" showIcon message={error}/>}
    <section className="portal-card">
      <h2>{forced?'更换初始或重置密码':'修改密码'}</h2>
      <Alert type="info" showIcon message={forced?'当前密码由管理员设置，修改后才能进入工作台。':'修改后所有设备会退出，请使用新密码重新登录。'}/>
      <Form form={form} layout="vertical" className="portal-password-form" onFinish={async values=>{
        if(saving)return;setSaving(true);setError('');
        try{await write('/auth/password','POST',{current:values.current,next:values.next});form.resetFields();message.success('密码已更新，请重新登录');onChanged();}
        catch(e:any){setError(e.message);}finally{setSaving(false);}
      }}>
        <Form.Item name="current" label="当前密码" rules={[{required:true,message:'请输入当前密码'}]}><Input.Password autoComplete="current-password" maxLength={200}/></Form.Item>
        <Form.Item name="next" label="新密码" dependencies={['current']} rules={[{required:true,message:'请输入新密码'},{min:12,message:'密码至少 12 个字符'},({getFieldValue})=>({validator(_,v){return !v||v!==getFieldValue('current')?Promise.resolve():Promise.reject(new Error('新密码不能与当前密码相同'));}})]}><Input.Password autoComplete="new-password" maxLength={200}/></Form.Item>
        <Form.Item name="confirm" label="确认新密码" dependencies={['next']} rules={[{required:true,message:'请再次输入新密码'},({getFieldValue})=>({validator(_,v){return !v||v===getFieldValue('next')?Promise.resolve():Promise.reject(new Error('两次输入的密码不一致'));}})]}><Input.Password autoComplete="new-password" maxLength={200}/></Form.Item>
        <Button type="primary" htmlType="submit" loading={saving}>保存新密码</Button>
      </Form>
    </section>
    {!forced&&<section className="portal-card">
      <div className="portal-page-heading"><div><h2>登录设备</h2><p>最多保留 10 个有效登录；退出设备后，该设备下次请求会要求重新登录。</p></div><Space><Button onClick={()=>setRevision(v=>v+1)} disabled={busy}>刷新设备</Button><Popconfirm title="退出所有其他设备，保留当前登录？" onConfirm={()=>revoke('/auth/sessions/revoke-others','POST')}><Button disabled={busy||sessions.length<2}>退出其他设备</Button></Popconfirm></Space></div>
      <Table rowKey="id" dataSource={sessions} pagination={false} loading={busy} scroll={{x:700}} columns={[
        {title:'设备',render:(_:any,s:any)=><span title={s.userAgent}>{s.current&&<Tag color="green">当前设备</Tag>}{deviceName(s.userAgent)}</span>},
        {title:'登录时间',dataIndex:'createdAt',render:(v:string)=>new Date(v).toLocaleString('zh-CN')},
        {title:'到期时间',dataIndex:'expiresAt',render:(v:string)=>new Date(v).toLocaleString('zh-CN')},
        {title:'操作',render:(_:any,s:any)=><Popconfirm title={s.current?'退出当前设备？':'退出此设备？'} onConfirm={()=>revoke('/auth/sessions/'+encodeURIComponent(s.id),'DELETE',s.current)}><Button type="link" danger disabled={busy}>退出设备</Button></Popconfirm>}
      ]}/>
    </section>}
  </div>;
}
function deviceName(ua:string){const browser=ua.includes('Edg/')?'Edge':ua.includes('Chrome/')?'Chrome':ua.includes('Firefox/')?'Firefox':ua.includes('Safari/')?'Safari':'其他浏览器';const os=ua.includes('Windows')?'Windows':ua.includes('Android')?'Android':/iPhone|iPad/.test(ua)?'iOS':ua.includes('Mac')?'macOS':ua.includes('Linux')?'Linux':'未知设备';return browser+' · '+os;}
