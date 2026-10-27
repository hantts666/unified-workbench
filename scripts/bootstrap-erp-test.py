"""Run in bench --site SITE console, only fictional test data is created."""
import json, os, secrets
import frappe
from frappe.utils.password import get_decrypted_password
frappe.local.lang='zh'

site=frappe.local.site
is_a=site=='unified-a.localhost'
company='合一青禾（测试）有限公司' if is_a else '合一远山（测试）有限公司'
abbr='QH' if is_a else 'YS'
from erpnext.setup.setup_wizard.operations import install_fixtures
if not frappe.db.exists('Warehouse Type','Transit'):
    install_fixtures.install('China')
if not frappe.db.exists('Fiscal Year','2026'):
    frappe.get_doc({'doctype':'Fiscal Year','year':'2026','year_start_date':'2026-01-01','year_end_date':'2026-12-31'}).insert(ignore_permissions=True)
if not frappe.db.exists('Company',company):
    frappe.get_doc({'doctype':'Company','company_name':company,'abbr':abbr,'country':'China','default_currency':'CNY','chart_of_accounts':'Standard','create_chart_of_accounts_based_on':'Standard Template'}).insert(ignore_permissions=True)
frappe.defaults.set_global_default('company',company)
frappe.defaults.set_global_default('fiscal_year','2026')
frappe.db.set_single_value('System Settings','language','zh')
frappe.db.set_single_value('System Settings','time_zone','Asia/Shanghai')
frappe.db.set_single_value('System Settings','setup_complete',1)
frappe.db.set_value('User','Administrator','language','zh')
for label,root,kind in [('银行存款-测试','Asset','Bank'),('管理费用-测试','Expense','Expense Account'),('主营业务收入-测试','Income','Income Account')]:
    name=f'{label} - {abbr}'
    if not frappe.db.exists('Account',name):
        parent=frappe.db.get_value('Account',{'company':company,'root_type':root,'is_group':1,'parent_account':['in',['',None]]},'name')
        if not parent:
            parent=frappe.db.get_value('Account',{'company':company,'root_type':root,'is_group':1},'name')
        frappe.get_doc({'doctype':'Account','account_name':label,'company':company,'parent_account':parent,'root_type':root,'account_type':kind,'is_group':0,'account_currency':'CNY'}).insert(ignore_permissions=True)
if not frappe.db.exists('Custom Field',{'dt':'Journal Entry','fieldname':'custom_platform_reference'}):
    frappe.get_doc({'doctype':'Custom Field','dt':'Journal Entry','fieldname':'custom_platform_reference','label':'工作台原始单据 ID','fieldtype':'Data','unique':1,'read_only':1,'no_copy':1,'insert_after':'user_remark'}).insert(ignore_permissions=True)
email='finance-api@example.invalid'
if not frappe.db.exists('User',email):
    roles=[r for r in ['Accounts Manager','Accounts User','Projects Manager','Projects User'] if frappe.db.exists('Role',r)]
    frappe.get_doc({'doctype':'User','email':email,'first_name':'工作台集成','send_welcome_email':0,'user_type':'System User','roles':[{'role':r} for r in roles]}).insert(ignore_permissions=True)
user=frappe.get_doc('User',email)
if not user.api_key:
    user.api_key=frappe.generate_hash(length=15)
    user.api_secret=secrets.token_urlsafe(24)
    user.save(ignore_permissions=True)
secret=get_decrypted_password('User',email,'api_secret')
frappe.db.commit()
filename=frappe.get_site_path('private','unified-credentials.json')
os.makedirs(os.path.dirname(filename),exist_ok=True)
with open(filename,'w') as f:
    json.dump({'id':'unified-a' if is_a else 'unified-b','siteName':site,'company':company,'abbreviation':'青禾' if is_a else '远山','apiKey':user.api_key,'apiSecret':secret},f,ensure_ascii=False)
os.chmod(filename,0o600)
print('BOOTSTRAP_OK',site,company)
