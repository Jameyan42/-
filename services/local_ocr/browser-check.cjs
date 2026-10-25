// Run from the repository root with the loopback RapidOCR server already running.
const {chromium,expect}=require('@playwright/test');
const fs=require('node:fs');
(async()=>{
const browser=await chromium.launch({executablePath:process.env.QINGBAO_BROWSER_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page=await browser.newPage();const errors=[],posts=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts.push(r.url())});
await page.goto('http://127.0.0.1:8765/');
await page.locator('#role').selectOption('员工');await page.locator('#create').click();
await expect(page.locator('.invoice-data-editor')).toContainText('本机 RapidOCR');
await page.locator('#invoice-image-input').setInputFiles('public/samples/structured-invoice.png');
await page.locator('#invoice-image-read').click();
const expected={number:'22345678901234567890',code:'123456789012',date:'2026-10-24',buyerName:'星河科技',buyerTaxId:'DEMO-BUYER-001',sellerName:'远帆服务有限公司',sellerTaxId:'DEMO-SELLER-001',netAmount:'250.00',taxAmount:'15.00',amount:'265.00'};
for(const [key,value] of Object.entries(expected))await expect(page.locator(`[data-invoice-field="${key}"]`)).toHaveValue(value,{timeout:90000});
await page.locator('#invoice-image-input').setInputFiles('e2e/fixtures/electronic-invoice.pdf');
await page.locator('#invoice-image-read').click();
await expect(page.locator('[data-invoice-field="amount"]')).toHaveValue('106.00',{timeout:90000});
await page.locator('[name=receipt]').setInputFiles('public/samples/demo-invoice.png');
await page.locator('#ocr-start').click();await expect(page.locator('#ocr-invoice')).toHaveValue('12345678901234567890',{timeout:90000});
await expect(page.locator('#ocr-amount')).toHaveValue('268.50');
expect(errors).toEqual([]);expect(posts.length).toBe(3);expect(posts.every(x=>x==='http://127.0.0.1:8765/api/ocr')).toBe(true);
const bad=await page.request.post('http://127.0.0.1:8765/api/ocr',{headers:{Origin:'https://example.invalid'},data:{image:'bad'}});expect(bad.status()).toBe(403);
const malformed=await page.request.post('http://127.0.0.1:8765/api/ocr',{headers:{Origin:'http://127.0.0.1:8765'},data:{image:'invalid-base64'}});expect(malformed.status()).toBe(400);
const proof={structuredImageFields:expected,electronicPdfAmount:'106.00',legacyOcrAmount:'268.50',requests:posts,pageErrors:errors,externalOriginRejected:bad.status(),malformedRejected:malformed.status()};
fs.writeFileSync('/tmp/qingbao-local-ocr-proof.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof,null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
