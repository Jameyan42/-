import {startRecognition,checkOcrFile} from '../ocr.js';
import {startPdfRender,validatePdfPage} from '../pdf-tools.js';
import {renderInvoiceImage} from '../image-tools.js';
import {extractStructuredInvoice} from './extract.js';
// PDF.js reads local bytes. No scripts/actions/XFA and no external upload.
export function startPdfText(file,pageNumber=1){
 let loading,cancelled=false,rejectCancel,timer;
 const cancellation=new Promise((_,reject)=>rejectCancel=reject);
 const cancel=()=>{if(cancelled)return;cancelled=true;clearTimeout(timer);void loading?.destroy().catch(()=>{});rejectCancel(Error('PDF读取已取消'));};
 const promise=(async()=>{try{
  validatePdfPage(pageNumber);checkOcrFile(file);const bytes=new Uint8Array(await file.arrayBuffer());if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('PDF文件头无效');
  const base=new URL('./ocr/pdfjs/',document.baseURI).href,pdfjs=await import(/* @vite-ignore */base+'pdf.mjs');if(cancelled)throw Error('PDF读取已取消');pdfjs.GlobalWorkerOptions.workerSrc=base+'pdf.worker.mjs';
  loading=pdfjs.getDocument({data:bytes,cMapUrl:base+'cmaps/',cMapPacked:true,standardFontDataUrl:base+'standard_fonts/',wasmUrl:base+'wasm/',isEvalSupported:false,enableXfa:false});loading.onPassword=()=>{rejectCancel(Error('PDF已加密，请先自行解密或手工填写'));void loading.destroy().catch(()=>{});};
  const doc=await loading.promise;if(doc.numPages>20||pageNumber>doc.numPages)throw Error('PDF页数超过限制或所选页不存在');const page=await doc.getPage(pageNumber),content=await page.getTextContent(),viewport=page.getViewport({scale:1});
  if(cancelled)throw Error('PDF读取已取消');const lines=content.items.filter(i=>typeof i.str==='string'&&i.str.trim()).map(i=>{const x=i.transform[4],y=viewport.height-i.transform[5],h=Math.max(1,Math.abs(i.height||i.transform[3]||10)),w=Math.max(1,i.width||10);return {text:i.str,score:null,box:[[x,y-h],[x+w,y-h],[x+w,y],[x,y]]};});return {lines,pages:doc.numPages};
 }finally{if(loading)await loading.destroy().catch(()=>{});}})();
 timer=setTimeout(()=>{rejectCancel(Error('PDF文字读取超时'));cancel();},30000);
 return {promise:Promise.race([promise,cancellation]).finally(()=>clearTimeout(timer)),cancel};
}
export function startInvoiceRecognition(file,onProgress=()=>{},{pdfPage=1,...settings}={}){
 let inner,controller,cancelled=false,rejectCancel,canvas,timer;
 const cancelledPromise=new Promise((_,reject)=>rejectCancel=reject);
 const cancel=()=>{if(cancelled)return;cancelled=true;inner?.cancel();controller?.abort();clearTimeout(timer);rejectCancel(Error('识别已取消，原表单保留'));};
 const started=performance.now();
 const promise=(async()=>{checkOcrFile(file);try{
  if(file.type==='application/pdf'){
   onProgress({status:'优先读取PDF文字层'});inner=startPdfText(file,pdfPage);const text=await inner.promise;
   const candidate=extractStructuredInvoice(text.lines,{engine:'PDF.js 5.4.624 文字层',source:'PDF_TEXT',elapsedMs:Math.round(performance.now()-started),page:pdfPage});
   // Conflicting text candidates remain ambiguous; do not OCR just to pick a convenient value.
   if(candidate.text.length>=30&&(/发票号码|Invoice\s*(No|Number)/i.test(candidate.text))&&/价税合计|TOTAL/i.test(candidate.text))return candidate;
  }
  if(cancelled)throw Error('识别已取消');
  if(window.QINGBAO_R010_LOCAL===true&&['127.0.0.1','localhost'].includes(location.hostname)){
   if(file.type==='application/pdf'){inner=startPdfRender(file,{...settings,pdfPage});canvas=(await inner.promise).canvas;}else canvas=await renderInvoiceImage(file,settings);
   if(cancelled)throw Error('识别已取消');onProgress({status:'本机CPU正在运行PP-OCR预训练模型'});controller=new AbortController();
   const response=await fetch('/api/r010/ocr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:canvas.toDataURL('image/png').split(',')[1]}),signal:controller.signal});
   if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.error||'本机OCR服务不可用');}const output=await response.json();if(output.schema!==1||!Array.isArray(output.lines)||typeof output.engine!=='string')throw Error('OCR返回数据格式无效');if(cancelled)throw Error('识别已取消');
   return extractStructuredInvoice(output.lines,{engine:output.engine,source:'LOCAL_CPU_OCR',elapsedMs:Math.round(performance.now()-started),page:pdfPage});
  }
  onProgress({status:'未启用本机服务，使用浏览器Tesseract后备引擎'});
  inner=startRecognition(file,onProgress,{...settings,pdfPage});const output=await inner.promise;
  const lines=output.text.split(/[\r\n]+/).filter(Boolean).map(text=>({text,score:null}));
  const result=extractStructuredInvoice(lines,{engine:'Tesseract.js 7.0.0（浏览器后备）',source:'BROWSER_OCR',elapsedMs:Math.round(performance.now()-started),page:pdfPage});
  result.globalConfidence=output.confidence;result.warnings.push('当前是浏览器后备OCR，不是本机PP-OCR；未提供字段级置信度，须逐字段核对');return result;
 }finally{if(canvas)canvas.width=canvas.height=1;}})();
 timer=setTimeout(()=>{rejectCancel(Error('识别超过90秒，已停止等待'));cancel();},90000);
 return {promise:Promise.race([promise,cancelledPromise]).finally(()=>clearTimeout(timer)),cancel};
}
