import {test,expect} from '@playwright/test';
// Native tests are opt-in because static CI/Pages cannot start a Python model.
test.skip(!process.env.R010_LOCAL_URL,'设置R010_LOCAL_URL并启动实际CPU服务后执行');
test.use({baseURL:process.env.R010_LOCAL_URL||'http://127.0.0.1:8766'});
test.describe.configure({mode:'serial',timeout:90000});
const invoice=(p,key)=>p.locator(`[data-invoice] [data-field="${key}"]`).first();
async function create(p){await p.goto('/?view=claims');await p.locator('#s001-new').click();await p.locator('[name=employee]').fill('模拟员工');await p.locator('[name=department]').fill('财务部');await p.locator('#s001-add-invoice').click();}
async function upload(p,file){await p.locator('[data-file]').first().setInputFiles('public/samples/r010/'+file);await expect(p.locator('[data-r010-json]').first()).toBeAttached({timeout:60000});}
test('实际CPU图片自动识别、三规则预审、修正后保存刷新保留原始值',async({page:p})=>{
 await create(p);await p.locator('[name=amountYuan]').fill('1060.00');await upload(p,'01.png');
 await expect(invoice(p,'number')).toHaveValue('00000000000000000001');await expect(invoice(p,'netAmountYuan')).toHaveValue('1000.00');
 await expect(p.locator('[data-r010-rule]')).toHaveCount(3);await expect(p.locator('[data-r010-rule=R003]')).toContainText('通过');
 await invoice(p,'amountYuan').fill('1061.00');await expect(p.locator('[data-r010-rule=R003]')).not.toContainText('通过');
 await p.locator('[data-ocr-confirm]').click();await p.locator('#s001-draft').click();
 const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('qingbao-s001-v1')));const i=saved.claims.at(-1).input.invoices[0];
 expect(i.ocrRecords[0].result.fields.amount.value).toBe('1060.00');expect(i.ocrRecords[0].corrected.values.amount).toBe('1061.00');expect(i.recognitionStatus).toBe('已人工核对');
 await p.reload();await p.locator('[data-edit-s001]').first().click();await expect(invoice(p,'amountYuan')).toHaveValue('1061.00');await expect(p.locator('[data-r010-json]')).toContainText('1060.00');
 await invoice(p,'amountYuan').fill('1062.00');await expect(invoice(p,'recognitionStatus')).toHaveValue('待核对');
 await p.setViewportSize({width:390,height:844});expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('PDF文字层直接提取，不调用模型；扫描PDF调用实际模型',async({page:p})=>{
 let calls=0;p.on('request',r=>{if(r.url().endsWith('/api/r010/ocr'))calls++;});await create(p);await upload(p,'02.pdf');
 expect(calls).toBe(0);await expect(p.locator('[data-r010-json]')).toContainText('PDF_TEXT');await expect(invoice(p,'number')).toHaveValue('00000000000000000002');
 await p.locator('[data-file]').setInputFiles('public/samples/r010/08.pdf');await expect(invoice(p,'number')).toHaveValue('00000000000000000008',{timeout:60000});expect(calls).toBe(1);
});
test('两张相同票OCR后触发既有重复规则、未替代税务验真',async({page:p})=>{
 await create(p);await upload(p,'01.png');await p.locator('#s001-add-invoice').click();await p.locator('[data-file]').last().setInputFiles('public/samples/r010/01.png');
 await expect(p.locator('[data-r010-json]')).toHaveCount(2,{timeout:60000});await expect(p.locator('[data-r010-rule=R002]')).toContainText('人工复核');
 await p.locator('[data-ocr-confirm]').first().click();await p.locator('[data-ocr-confirm]').last().click();await expect(p.locator('[data-r010-rule=R002]')).toContainText('人工复核');
 await expect(p.locator('#r010-rule-preview')).toContainText('OCR成功不代表税务验真通过');
});
test('故意缺失字段不补零；坏PDF失败保留原有手工输入',async({page:p})=>{
 await create(p);await upload(p,'11.png');await expect(invoice(p,'netAmountYuan')).toHaveValue('');await expect(invoice(p,'taxAmountYuan')).toHaveValue('');
 await invoice(p,'sellerName').fill('手工修正的模拟酒店');await p.locator('[data-file]').setInputFiles({name:'broken.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-invalid')});
 await expect(p.locator('#s001-error')).toContainText(/Invalid|PDF|无效/,{timeout:30000});await expect(invoice(p,'sellerName')).toHaveValue('手工修正的模拟酒店');
});
