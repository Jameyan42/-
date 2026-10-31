// Actual end-to-end recognition through local app; expected values never enter OCR/parser.
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
const cases=JSON.parse(readFileSync('docs/r010/samples.json','utf8'));
const browser=await chromium.launch({executablePath:process.env.QINGBAO_BROWSER_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const results=[];
try{for(const c of cases){const context=await browser.newContext(),page=await context.newPage();let calls=0;
 page.on('request',r=>{if(r.url().endsWith('/api/r010/ocr'))calls++;});
 await page.goto(process.env.R010_LOCAL_URL||'http://127.0.0.1:8766/?view=claims');
 await page.locator('#s001-new').click();await page.locator('#s001-add-invoice').click();
 await page.locator('[data-file]').setInputFiles('public/'+c.file);
 try{
 await page.waitForFunction(()=>document.querySelector('[data-r010-json]')||/Error|失败|超时|无法|错误/.test(document.querySelector('#s001-error')?.textContent||''),{},{timeout:100000});
 const raw=await page.locator('[data-r010-json]').first().textContent().catch(()=>null);
 if(!raw)throw Error(await page.locator('#s001-error').textContent());
 const recognition=JSON.parse(raw).at(-1).result;
 const fields=Object.entries(c.expected).map(([key,expected])=>{const f=recognition.fields[key];return {key,expected,actual:f.value,correct:f.value===expected,status:f.status,confidence:f.confidence,reason:f.value===expected?(expected?'匹配':'按预期保留空值'):f.reason};});
 results.push({id:c.id,file:c.file,mode:c.mode,engine:recognition.engine,source:recognition.source,elapsedMs:recognition.elapsedMs,nativeRequests:calls,fields,warnings:recognition.warnings});
 console.log(c.id,recognition.source,recognition.elapsedMs+'ms',fields.filter(f=>f.correct).length+'/'+fields.length);
 }catch(error){results.push({id:c.id,file:c.file,mode:c.mode,error:String(error),nativeRequests:calls});console.log(c.id,String(error));}
 await context.close();}}
finally{await browser.close();}
const report={at:new Date().toISOString(),samplePolicy:'12份明确标注DEMO ONLY的虚构非税务样票。仅验证合成布局；尚未完成真实脱敏发票准确率验证。',results};
writeFileSync('docs/r010/evaluation.json',JSON.stringify(report,null,2)+'\n');
writeFileSync('docs/r010/evaluation.csv','样票,格式,字段,期望值,实际值,是否匹配,状态,置信度,耗时ms,引擎,失败或提示\n'+results.flatMap(r=>r.fields?r.fields.map(f=>[r.id,r.mode,f.key,f.expected,f.actual,f.correct?'是':'否',f.status,f.confidence??'未知',r.elapsedMs,r.engine,f.reason]):[[r.id,r.mode,'识别失败','','','否','','','','',r.error]]).map(row=>row.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
