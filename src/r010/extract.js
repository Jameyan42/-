import {parseYuan,centsToYuan,calendarOrdinal} from '../r001/rule';
import {extractInvoiceType,cleanupProjectItem,isContentCandidate} from './vendor/cn-vat-fields.js';
export const invoiceFields=[['type','发票类型'],['number','发票号码'],['code','发票代码（数电票可无）'],['date','开票日期'],['buyerName','购买方名称'],['buyerTaxId','购买方税号'],['sellerName','销售方名称'],['sellerTaxId','销售方税号'],['netAmount','不含税金额'],['taxAmount','税额'],['amount','价税合计'],['itemName','发票项目名称']];
const norm=s=>String(s??'').normalize('NFKC').trim();
const compact=s=>norm(s).replace(/\s/g,'');
const cleanName=s=>norm(s).split(/纳税人识别号|统一社会信用代码|税号|地址|电话|开户行|账号|销售方|购买方/)[0].replace(/^[：:\s]+/,'').replace(/(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g,'').trim();
export function normalizeLines(input){
 if(!Array.isArray(input)||input.length>1000)throw Error('识别文字条目无效或过多');
 return input.filter(l=>l&&typeof l.text==='string'&&l.text.trim()).map((l,index)=>{
  if(l.text.length>3000||l.score!==null&&l.score!==undefined&&(!Number.isFinite(l.score)||l.score<0||l.score>1))throw Error('识别行内容或置信度无效');
  let box=null;if(l.box!=null){if(!Array.isArray(l.box)||l.box.length!==4||l.box.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n)||Math.abs(n)>100000)))throw Error('文字坐标无效');box=l.box.map(p=>[...p]);}
  return {id:'L'+(index+1),text:norm(l.text),score:l.score??null,box,x:box?Math.min(...box.map(p=>p[0])):0,y:box?Math.min(...box.map(p=>p[1])):index*20,w:box?Math.max(...box.map(p=>p[0]))-Math.min(...box.map(p=>p[0])):1,h:box?Math.max(...box.map(p=>p[1]))-Math.min(...box.map(p=>p[1])):18};
 }).sort((a,b)=>a.y-b.y||a.x-b.x);
}
function rowsFor(lines){const rows=[];for(const l of lines){let r=l.box&&rows.find(r=>r.boxed&&Math.abs((r.y+r.h/2)-(l.y+l.h/2))<=Math.max(3,Math.min(l.h,r.h)*.55));if(!r){r={text:'',parts:[],y:l.y,h:l.h,boxed:!!l.box};rows.push(r);}r.parts.push(l);r.text=r.parts.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' ');}return rows.sort((a,b)=>a.y-b.y);}
const moneyMatches=s=>[...norm(s).matchAll(/(?<![\d.])[-−]?\s*[¥￥]?\s*\d[\d,]*\.\d{2}(?!\d)/g)].map(m=>m[0].replace(/[¥￥,\s]/g,'').replace('−','-'));
export function extractStructuredInvoice(input,{engine='未知引擎',source='LOCAL_CPU_OCR',elapsedMs=0,page=1}={}){
 const lines=normalizeLines(input),rows=rowsFor(lines),hits=Object.fromEntries(invoiceFields.map(([key])=>[key,[]]));
 const add=(key,value,parts)=>{value=norm(value);if(value&&value.length<=500)hits[key].push({value,parts});};
 const rowParts=rows.map(r=>r.parts),texts=rows.map(r=>r.text),all=texts.join('\n');
 const meaningfulTitles=lines.filter(l=>/增值税.*发票|电子发票|数电发票|普通发票|专用发票/.test(compact(l.text))&&!/发票号码|发票代码|开票日期/.test(l.text));
 const upstreamType=extractInvoiceType(meaningfulTitles.map(l=>l.text));
 const titleText=meaningfulTitles.map(l=>compact(l.text)).join('');
 let type='';
 if(/增值税电子普通发票/.test(titleText))type='增值税电子普通发票';else if(/增值税电子专用发票/.test(titleText))type='增值税电子专用发票';else if(/电子发票.*(普通发票|专用发票)|数电发票/.test(titleText))type='数电发票';else if(/增值税(普通|专用)发票/.test(titleText))type='纸质发票';
 if(type)add('type',type,meaningfulTitles);
 for(const r of rows){const s=norm(r.text),c=compact(s);
  const no=c.match(/(?:发票号码|Invoice(?:No\.?|Number))[:：#]?(\d{8,20})(?!\d)/i);if(no)add('number',no[1],r.parts);
  const code=c.match(/(?:发票代码|InvoiceCode)[:：]?(\d{10}(?:\d{2})?)(?!\d)/i);if(code)add('code',code[1],r.parts);
  const date=c.match(/(?:开票日期|InvoiceDate)[:：]?(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?/i);if(date){const value=`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`;if(calendarOrdinal(value)!==null)add('date',value,r.parts);}
  for(const [party,label] of [['buyer','购买方|购方|Buyer'],['seller','销售方|销方|Seller']]){
   const m=s.match(new RegExp(`(?:${label})\\s*(?:名称|Name)\\s*[:：]?\\s*(.+?)(?=购买方|购方|销售方|销方|Buyer|Seller|$)`,'i'));if(m)add(party+'Name',cleanName(m[1]),r.parts);
   const tax=c.match(new RegExp(`(?:${label})(?:统一社会信用代码|纳税人识别号|税号|TaxID)[:：]?([A-Z0-9-]{6,24})(?![A-Z0-9-])`,'i'));if(tax)add(party+'TaxId',tax[1].toUpperCase(),r.parts);
  }
  for(const [key,regex] of [['netAmount',/(?:不含税金额|税前金额|NetAmount)\s*[:：]?\s*(.+)/i],['taxAmount',/(?:^|\s)(?:税额|TaxAmount)\s*[:：]?\s*(.+)/i],['amount',/(?:价税合计|合计金额|总金额|\bTOTAL\b)\s*[:：]?\s*(.*)/i]]){
   const m=s.replace(/(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g,'').match(regex);if(!m)continue;const segment=m[1].split(/(?:不含税金额|税前金额|税额|价税合计|合计金额|总金额|NetAmount|TaxAmount|TOTAL)\s*[:：]/i)[0];const values=moneyMatches(segment);for(const value of values)add(key,value,r.parts);
   if(!values.length){const next=rows[rows.indexOf(r)+1];if(next&&/^(?:\(?小写\)?[:：]?\s*)?[¥￥]?\s*[-−]?\d[\d,]*\.\d{2}$/.test(compact(next.text)))for(const value of moneyMatches(next.text))add(key,value,[...r.parts,...next.parts]);}
  }
  const item=s.match(/^(?:项目名称|货物名称|货物或应税劳务、服务名称)\s*[:：]\s*(.+)$/);if(item){const cleaned=cleanupProjectItem(item[1]);if(isContentCandidate(cleaned))add('itemName',cleaned,r.parts);}else if(/\*[^*]+\*/.test(s)){const cleaned=cleanupProjectItem(s.split(/\s+[-−]?\d+(?:\.\d+)?/)[0]);if(isContentCandidate(cleaned))add('itemName',cleaned,r.parts);}
 }
 // Party-specific regions: same-row buyer/seller columns are split by actual coordinates.
 const anchors=lines.filter(l=>/^(购买方|销售方|购方|销方)(信息)?[:：]?$/.test(compact(l.text)));
 for(const anchor of anchors){const party=/购买|购方/.test(anchor.text)?'buyer':'seller',other=anchors.find(a=>a!==anchor&&Math.abs(a.y-anchor.y)<Math.max(a.h,anchor.h)*1.5&&Math.abs(a.x-anchor.x)>anchor.w);
  const boundary=other?(anchor.x+other.x)/2:null;
  const end=anchors.filter(a=>a.y>anchor.y+anchor.h*2&&a.x<anchor.x+anchor.w*3).reduce((n,a)=>Math.min(n,a.y),Infinity);
  const region=lines.filter(l=>l.y>=anchor.y-anchor.h*.5&&l.y<end&&(boundary===null||(anchor.x<other.x?l.x<boundary:l.x>=boundary)));
  for(const r of rowsFor(region)){const c=compact(r.text),s=r.text;
   const name=s.match(/^名称\s*[:：]?\s*(.+)$/);if(name)add(party+'Name',cleanName(name[1]),r.parts);
   const tax=c.match(/^(?:统一社会信用代码(?:[/(]纳税人识别号[)/]?)?|纳税人识别号|税号)[:：]?([A-Z0-9-]{6,24})(?![A-Z0-9-])/i);if(tax)add(party+'TaxId',tax[1].toUpperCase(),r.parts);
  }
 }
 // Standard VAT subtotal: only use two printed amounts when amount/tax columns are present.
 const netHeader=lines.find(l=>compact(l.text)==='金额'),taxHeader=lines.find(l=>compact(l.text)==='税额');
 if(netHeader&&taxHeader)for(const r of rows.filter(r=>/^合计(?!金额)/.test(compact(r.text)))){
  const values=r.parts.filter(p=>moneyMatches(p.text).length===1);
  if(values.length===2&&netHeader.x<taxHeader.x){const ordered=values.sort((a,b)=>a.x-b.x);add('netAmount',moneyMatches(ordered[0].text)[0],[netHeader,...r.parts]);add('taxAmount',moneyMatches(ordered[1].text)[0],[taxHeader,...r.parts]);}
 }
 const fields={},warnings=[];
 for(const [key,label] of invoiceFields){
  const grouped=new Map();for(const hit of hits[key]){const value=['netAmount','taxAmount','amount'].includes(key)?hit.value.replaceAll(',',''):hit.value;if(!grouped.has(value))grouped.set(value,[]);grouped.get(value).push(...hit.parts);}
  let alternatives=[...grouped.keys()],value=alternatives.length===1?alternatives[0]:'',status=alternatives.length>1?'AMBIGUOUS':value?'CANDIDATE':'MISSING',reason=status==='AMBIGUOUS'?'多处候选冲突，不自动选择':status==='MISSING'?'未可靠提取，请对照原件补充':'候选仍需人工核对';
  if(value&&['netAmount','taxAmount','amount'].includes(key)){const n=parseYuan(value);if(!n.ok){status='INVALID';reason='票面金额为负数或格式超出本期范围，未改成正数或0';}else value=centsToYuan(n.cents);}
  if(value&&key==='number'&&!/^(\d{8}|\d{20})$/.test(value)){status='INVALID';reason='本期支持8位增值税号码或20位数电号码，不自动补位';}
  const parts=[...new Map([...grouped.values()].flat().map(l=>[l.id,l])).values()],scores=parts.map(p=>p.score).filter(x=>x!==null),confidence=scores.length?Math.min(...scores):null;
  if(status==='CANDIDATE'&&confidence!==null&&confidence<.9){status='LOW_CONFIDENCE';reason='关联文字置信度低于0.90，请重点核对；不是正确率';}
  fields[key]={label,value,rawValue:alternatives.length===1?alternatives[0]:'',confidence,status,reason,alternatives,evidence:parts.map(p=>({lineId:p.id,text:p.text,box:p.box}))};
 }
 const amount=fields.amount.value,net=fields.netAmount.value,tax=fields.taxAmount.value;
 if([amount,net,tax].every(x=>parseYuan(x).ok)){if(BigInt(parseYuan(net).cents)+BigInt(parseYuan(tax).cents)!==BigInt(parseYuan(amount).cents))warnings.push('票面不含税金额加税额与价税合计不一致，请核对；未推算或改写任何金额');}
 if(!fields.type.value&&upstreamType)warnings.push('标题不能映射到现有票种，请人工确认，不按号码猜票种');
 return {schema:1,engine,source,page,elapsedMs,text:all,lines:lines.map(({id,text,score,box})=>({id,text,score,box})),fields,rawInvoiceType:upstreamType,warnings,taxVerified:false};
}
