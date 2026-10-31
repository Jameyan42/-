import type {RecognitionResult} from './extract.js';
export const captureKeys=['type','number','code','date','buyerName','buyerTaxId','sellerName','sellerTaxId','netAmount','taxAmount','amount','itemName'] as const;
export type RecognitionRecord={id:string;at:string;attachmentId:string;fileName:string;fileSHA256:string;result:RecognitionResult;corrected?:{at:string;actor:string;values:Record<string,string>};confirmed?:{at:string;actor:string;values:Record<string,string>}};
export function valuesOf(invoice:any){return Object.fromEntries(captureKeys.map(key=>[key,String(invoice[key==='amount'?'amountYuan':key==='netAmount'?'netAmountYuan':key==='taxAmount'?'taxAmountYuan':key]??'')]));}
export function appendRecognition(invoice:any,record:RecognitionRecord){
 validateRecognitionRecords(invoice.ocrRecords||[]);validateRecognitionRecords([record]);if((invoice.ocrRecords||[]).length>=3)throw Error('每张票最多保留3次识别原始结果；不覆盖旧记录，请新建票面记录或人工修正');
 const copy=structuredClone(invoice);copy.ocrRecords=[...(copy.ocrRecords||[]),structuredClone(record)];
 for(const key of captureKeys){const f=record.result.fields[key];const target=key==='amount'?'amountYuan':key==='netAmount'?'netAmountYuan':key==='taxAmount'?'taxAmountYuan':key;copy[target]=f?.value&&f.status!=='AMBIGUOUS'&&f.status!=='INVALID'?f.value:'';}
 copy.source='ocr-assisted';copy.recognitionStatus='待核对';copy.buyerTaxStatus='未确认';copy.recognitionConfidence=record.result.globalConfidence??null;return copy;
}
export function recordCorrections(invoice:any,actor:string,at:string,confirm=false){if(!invoice.ocrRecords?.length)return;invalidateConfirmation(invoice);const r=invoice.ocrRecords.at(-1),values=valuesOf(invoice);r.corrected={at,actor,values};if(confirm){r.confirmed={at,actor,values:structuredClone(values)};invoice.recognitionStatus='已人工核对';if(invoice.buyerTaxId.trim())invoice.buyerTaxStatus='已确认';}}
export function validateRecognitionRecords(records:any){
 if(!Array.isArray(records)||records.length>3||new Set(records.map((r:any)=>r.id)).size!==records.length)throw Error('OCR原始记录格式或容量错误');
 for(const r of records){if(!r?.id||!r.attachmentId||typeof r.fileName!=='string'||r.fileName.length>200||!/^[a-f0-9]{64}$/.test(r.fileSHA256)||!Number.isFinite(Date.parse(r.at))||r.result?.schema!==1||r.result.taxVerified!==false||!Array.isArray(r.result.lines)||r.result.lines.length>1000||typeof r.result.text!=='string'||r.result.text.length>30000||typeof r.result.engine!=='string'||!['PDF_TEXT','LOCAL_CPU_OCR','BROWSER_OCR'].includes(r.result.source)||!Number.isInteger(r.result.page)||r.result.page<1||r.result.page>20)throw Error('OCR来源或结果无效');
  const result=r.result;
  if(typeof r.id!=='string'||r.id.length>80||typeof r.attachmentId!=='string'||r.attachmentId.length>80||!Number.isFinite(result.elapsedMs)||result.elapsedMs<0||typeof result.rawInvoiceType!=='string'||result.rawInvoiceType.length>500||!Array.isArray(result.warnings)||result.warnings.length>30||result.warnings.some((w:any)=>typeof w!=='string'||w.length>1000))throw Error('OCR元信息无效');
  const boxValid=(box:any)=>box===null||Array.isArray(box)&&box.length===4&&box.every((p:any)=>Array.isArray(p)&&p.length===2&&p.every((n:any)=>Number.isFinite(n)&&Math.abs(n)<=100000));
  for(const line of result.lines)if(typeof line.id!=='string'||typeof line.text!=='string'||line.text.length>3000||line.score!==null&&(!Number.isFinite(line.score)||line.score<0||line.score>1)||!boxValid(line.box))throw Error('OCR原始文字行无效');
  for(const key of captureKeys){const f=r.result.fields?.[key];if(!f||typeof f.value!=='string'||f.value.length>500||typeof f.rawValue!=='string'||!['MISSING','AMBIGUOUS','CANDIDATE','LOW_CONFIDENCE','INVALID'].includes(f.status)||f.confidence!==null&&(!Number.isFinite(f.confidence)||f.confidence<0||f.confidence>1)||!Array.isArray(f.alternatives)||f.alternatives.length>100||f.alternatives.some((v:any)=>typeof v!=='string'||v.length>500)||typeof f.label!=='string'||typeof f.reason!=='string'||!Array.isArray(f.evidence)||f.evidence.length>1000||f.evidence.some((e:any)=>typeof e?.lineId!=='string'||typeof e.text!=='string'||e.text.length>3000||!boxValid(e.box)))throw Error('OCR字段记录无效');}
  for(const review of [r.corrected,r.confirmed])if(review&&(!review.actor?.trim()||!Number.isFinite(Date.parse(review.at))||captureKeys.some(key=>typeof review.values?.[key]!=='string'||review.values[key].length>500)))throw Error('OCR人工修正记录无效');
 }
 if(JSON.stringify(records).length>150000)throw Error('OCR原始记录过大，未覆盖历史');
}

export function invalidateConfirmation(invoice:any){const r=invoice.ocrRecords?.at(-1);if(r?.confirmed&&JSON.stringify(valuesOf(invoice))!==JSON.stringify(r.confirmed.values)){invoice.recognitionStatus='待核对';invoice.buyerTaxStatus='未确认';}}
