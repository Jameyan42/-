import {calculateNights,calendarOrdinal,isGrade,parseYuan,normalizeCity} from '../r001/rule';
import type {StandardsCatalog} from '../r001/types';
import type {Sample} from './types';
export const columns=['caseId','split','group','reimbursementId','employee','companyId','grade','city','checkIn','checkOut','hotelAmountYuan','amountYuan','invoiceAmounts','invoiceNumbers','description','partialReason','currency','status'];
export function parseCSV(text:string):string[][]{
 if(text.length>500000)throw Error('CSV超过500KB');text=text.replace(/^\uFEFF/,'');const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){const ch=text[i]!;if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
 if(ch==='"'){if(cell||closed)throw Error('CSV引号位置错误');quoted=true;}else if(ch===','){row.push(cell);cell='';closed=false;}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x!==''))rows.push(row);row=[];cell='';closed=false;}else{if(closed)throw Error('CSV引号后必须是分隔符');cell+=ch;}}
 if(quoted)throw Error('CSV引号未闭合');if(cell||row.length){row.push(cell);rows.push(row);}if(rows.length>201)throw Error('一次最多200条样本');return rows;
}
export function csv(rows:unknown[][]):string{return '\uFEFF'+rows.map(row=>row.map(v=>{let x=String(v??'');if(/^[=+@-]/.test(x))x="'"+x;return '"'+x.replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
export function importCSV(text:string):Sample[]{
 const [header,...rows]=parseCSV(text);if(!header||new Set(header).size!==header.length||columns.some(c=>!header.includes(c))||header.some(c=>!columns.includes(c)))throw Error('CSV必须使用完整模板表头，不能有重复或未知列');
 return rows.map((row,index)=>{if(row.length!==header.length)throw Error(`第${index+2}行列数错误`);const d=Object.fromEntries(header.map((k,i)=>[k,row[i]!]));if(Object.values(d).some(v=>v.length>500))throw Error('字段超过500字符');
 if(!d.caseId||!['DEV','HOLDOUT','LOCAL'].includes(d.split!)||!['A','B'].includes(d.group!))throw Error(`第${index+2}行样本编号/分组无效`);
 const amounts=d.invoiceAmounts!.split('|'),numbers=d.invoiceNumbers!.split('|');if(amounts.length!==numbers.length||amounts.length>5)throw Error(`第${index+2}行发票号码与金额数量不一致（最多5张）`);
 return {caseId:d.caseId!,split:d.split as Sample['split'],group:d.group as Sample['group'],sourceStatus:d.status!,revision:1,input:{id:d.reimbursementId!,employee:d.employee!,companyId:d.companyId!,department:'模拟财务实验部',grade:d.grade!,expenseType:'住宿费',city:d.city!,checkIn:d.checkIn!,checkOut:d.checkOut!,hotel:'虚构实验酒店',hotelAmountYuan:d.hotelAmountYuan!,amountYuan:d.amountYuan!,currency:d.currency!,businessDescription:d.description!,partialReason:d.partialReason!,invoices:amounts.map((amount,i)=>({id:`${d.caseId}-I${i+1}`,type:'数电发票',code:'',number:numbers[i]!,amountYuan:amount,currency:d.currency!,date:d.checkOut!,buyerName:'模拟企业（测试数据）',buyerTaxId:'DEMO-SZ-001',sellerName:'虚构实验酒店',sellerTaxId:'DEMO-HOTEL-001',source:'manual' as const}))}};
 });
}
export function issues(s:Sample,standards:StandardsCatalog|null,companyIds:string[]):string[]{const d=s.input,out:string[]=[];
 for(const [key,name] of [['id','报销编号'],['employee','员工'],['companyId','法人公司'],['grade','职级'],['city','城市'],['checkIn','入住日期'],['checkOut','退房日期']] as const)if(!d[key]?.trim())out.push(`缺少${name}`);
 if(d.grade&&!isGrade(d.grade))out.push('未知职级');if(d.companyId&&!companyIds.includes(d.companyId))out.push('未知或停用法人公司');
 if(d.city&&standards&&!standards.rows.some(r=>normalizeCity(r.city)===normalizeCity(d.city)))out.push('城市未配置住宿标准，需补充信息');
 if(d.currency!=='CNY')out.push('不支持的币种');for(const [key,name] of [['amountYuan','申请金额'],['hotelAmountYuan','住宿金额']] as const){const p=parseYuan(d[key]);if(!p.ok)out.push(`${name}：${p.message}`);}
 if(d.checkIn&&calendarOrdinal(d.checkIn)===null||d.checkOut&&calendarOrdinal(d.checkOut)===null)out.push('日期格式错误');if(d.checkIn&&d.checkOut&&calculateNights(d.checkIn,d.checkOut)===null)out.push('日期冲突：退房必须晚于入住');
 if(!d.invoices.length)out.push('缺少发票');for(const i of d.invoices){if(!parseYuan(i.amountYuan).ok)out.push('发票金额缺失、负数或格式错误');if(!/^\d{20}$/.test(i.number))out.push('模拟数电发票号码需20位数字');}return [...new Set(out)];
}
