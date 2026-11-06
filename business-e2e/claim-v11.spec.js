import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
test.skip(!process.env.S003_BUSINESS_URL,'明确指定隔离业务测试环境');
const accounts=()=>JSON.parse(readFileSync('.data/s003-test-accounts.json','utf8'));
async function login(p,who){await p.goto('/');await p.locator('#business-login [name=username]').fill(who.username);await p.locator('#business-login [name=password]').fill(who.password);await p.locator('#business-login button').click();await expect(p.locator('#business-new')).toBeVisible();}
const dialog=p=>p.once('dialog',d=>d.accept());
const f=(p,n,key)=>p.locator('[data-line]').nth(n).locator(`[data-field="${key}"]`);
test('AC002-006 动态差旅类型、精确金额、取消类型切换与删除明细',async({page:p})=>{
 await login(p,accounts().employee);await p.locator('#business-new').click();dialog(p);await p.locator('#business-main-type').selectOption('TRAVEL');await expect(p.locator('[data-trip=destination]')).toBeVisible();
 await f(p,0,'amountYuan').fill('800.00');await p.locator('#business-add-line').click();await f(p,1,'subtype').selectOption('高铁/火车票');await f(p,1,'amountYuan').fill('450.00');await expect(p.locator('#business-live-total')).toHaveText('1250.00');await expect(f(p,1,'subtype').locator('option',{hasText:'办公用品'})).toHaveCount(0);
 p.once('dialog',d=>d.dismiss());await p.locator('#business-main-type').selectOption('OFFICE');await expect(p.locator('#business-main-type')).toHaveValue('TRAVEL');await expect(p.locator('[data-line]')).toHaveCount(2);
 dialog(p);await p.locator('[data-remove-line]').last().click();await expect(p.locator('#business-live-total')).toHaveText('800.00');await f(p,0,'amountYuan').fill('0.10');await p.locator('#business-add-line').click();await f(p,1,'amountYuan').fill('0.20');await expect(p.locator('#business-live-total')).toHaveText('0.30');
});
test('AC013-014 未填完的草稿跨独立浏览器会话保留，提交定位缺失字段',async({browser})=>{
 const one=await browser.newContext(),two=await browser.newContext(),a=await one.newPage(),b=await two.newPage();const title='未完成草稿-'+randomBytes(4).toString('hex');
 try{await login(a,accounts().employee);await a.locator('#business-new').click();await a.locator('[name=description]').fill(title);await a.locator('#business-editor button[type=submit]').first().click();await expect(a.locator('#business-alert')).toContainText('草稿已保存');await expect(f(a,0,'amountYuan')).toHaveValue('');
 await login(b,accounts().employee);await b.locator('tr').filter({hasText:title}).locator('[data-open]').click();await b.locator('#business-edit').click();await expect(f(b,0,'amountYuan')).toHaveValue('');await b.locator('[name=submitAfterSave]').click();await expect(b.locator('#business-alert')).toContainText('lines.0.amountYuan');await expect(f(b,0,'amountYuan')).toHaveAttribute('aria-invalid','true');await expect(b.locator('#business-editor')).toBeVisible();
 }finally{await one.close();await two.close();}
});
test('AC027 上传网络失败不会显示为已保存，允许重试真实文件',async({page:p})=>{
 await login(p,accounts().employee);await p.locator('#business-new').click();await p.locator('#business-editor button[type=submit]').first().click();await p.route('**/api/claims/*/attachments',route=>route.abort('failed'));
 await p.locator('#business-upload [name=file]').setInputFiles('server/test-fixtures/office-invoice.pdf');await p.locator('#business-upload button').click();await expect(p.locator('#business-alert')).toContainText('文件上传失败');await expect(p.locator('#business-upload-status')).toContainText('上传失败');await expect(p.locator('a[href*="/api/attachments/"]')).toHaveCount(0);
 await p.unroute('**/api/claims/*/attachments');await p.locator('#business-upload button').click();await expect(p.locator('a[href*="/api/attachments/"]')).toHaveCount(1);await expect(p.locator('#business-alert')).toContainText('原始附件已保存');
});
test('收款页普通查看仅展示尾号，敏感账户不是正式报销的localStorage数据',async({page:p})=>{
 await login(p,accounts().employee);await p.locator('#business-accounts').click();await expect(p.locator('main')).toContainText('尾号');await expect(p.locator('main')).not.toContainText('990000000000001234');expect(await p.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('qingbao-')))).toEqual([]);
});
test('员工维护本人账户→待核对→另一财务按企业制度确认，前端始终脱敏',async({browser})=>{
 const e=await browser.newPage(),f=await browser.newPage(),a=accounts();const bank='虚构验证银行-'+randomBytes(3).toString('hex'),number='990000000000'+Array.from(randomBytes(6),x=>x%10).join('');
 try{await login(e,a.employee);await e.locator('#business-accounts').click();await e.locator('#business-account-create [name=bankName]').fill(bank);await e.locator('#business-account-create [name=number]').fill(number);await e.locator('#business-account-create [name=password]').fill(a.employee.password);await e.locator('#business-account-create button').click();await expect(e.locator('p').filter({hasText:bank})).toContainText('待财务核对');await expect(e.locator('main')).not.toContainText(number);
 await f.goto('/');await f.locator('#business-login [name=username]').fill(a.finance.username);await f.locator('#business-login [name=password]').fill(a.finance.password);await f.locator('#business-login button').click();await f.locator('#business-accounts').click();const form=f.locator('[data-verify-account]').filter({hasText:bank});await form.locator('[name=reason]').fill('虚构企业线下本人归属核对，仅合成账户测试');await form.locator('[name=confirmed]').check();await form.locator('button').click();await expect(f.locator('#business-alert')).toContainText('已记录线下人工核对');await e.locator('#business-accounts').click();await expect(e.locator('p').filter({hasText:bank})).toContainText('有效（已线下核对）');await expect(f.locator('main')).not.toContainText(number);
 }finally{await e.close();await f.close();}
});
