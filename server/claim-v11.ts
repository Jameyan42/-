import { z } from 'zod';
import { calendarOrdinal, parseYuan } from '../src/r001/rule';
import { mainTypes, subtypes, lineFields, canonicalExpense, type MainType } from '../src/business/claim-catalog';

const text = z.string().trim().max(500);
const day = z.string().refine(s => s === '' || calendarOrdinal(s) !== null, '请输入有效日历日期');
const money = z.string().refine(s => s === '' || (parseYuan(s).ok && Number(s) <= 1e10), '金额须为非负人民币，最多两位小数')
  .transform(s => {if(s==='')return null;const p=parseYuan(s);return p.ok?p.cents:null;});
const fields = z.object({
  origin:text.default(''),destination:text.default(''),transportDate:day.default(''),
  serviceNumber:text.default(''),hotel:text.default(''),itemName:text.default(''),
  customer:text.default(''),participants:z.string().refine(s=>s===''||/^[1-9]\d{0,4}$/.test(s),'人数须为正整数').default(''),
  quantity:z.string().refine(s=>s===''||/^\d{1,8}(\.\d{1,4})?$/.test(s),'数量格式无效').default(''),
  unitPrice:z.string().refine(s=>s===''||parseYuan(s).ok,'单价格式无效').default(''),
}).strict();
const line = z.object({
  id:z.uuid(),subtype:text,expenseType:text.optional(),businessDate:day,amountYuan:money,
  description:text,partialReason:text.default(''),city:text.default(''),checkIn:day.default(''),checkOut:day.default(''),
  business:fields.default({origin:'',destination:'',transportDate:'',serviceNumber:'',hotel:'',itemName:'',customer:'',participants:'',quantity:'',unitPrice:''}),
}).strict();
const invoice = z.object({
  id:z.uuid(),type:z.enum(['数电发票','增值税电子普通发票','增值税电子专用发票','纸质发票']),
  code:z.string().max(12).regex(/^\d*$/),number:z.string().max(20).regex(/^\d*$/),
  amountYuan:money,date:day,buyerName:text,buyerTaxId:text,sellerName:text,sellerTaxId:text,
  attachmentId:z.uuid().nullable(),
}).strict();
const schema = z.object({
  modelVersion:z.literal(2),mainType:z.enum(['TRAVEL','ENTERTAINMENT','OFFICE','LOCAL_TRANSPORT','OTHER']),
  description:text,currency:z.literal('CNY'),
  trip:z.object({reason:text,start:day,end:day,destination:text,approvalReference:text}).strict(),
  receivingAccountId:z.uuid().nullable(),
  lines:z.array(line).max(30),invoices:z.array(invoice).max(30),
  allocations:z.array(z.object({lineId:z.uuid(),invoiceId:z.uuid(),amountYuan:money}).strict()).max(100),
}).strict();
export function normalizeV11(raw:unknown) {
  const p=schema.parse(raw);
  p.lines.forEach((l,n)=>{if(l.subtype && !subtypes[p.mainType].includes(l.subtype))throw Object.assign(Error(`lines.${n}.subtype：子类型不属于${mainTypes[p.mainType]}`),{status:400});});
  return {...p,lines:p.lines.map(({amountYuan,...l})=>({...l,expenseType:canonicalExpense(p.mainType,l.subtype),amountCents:amountYuan})),
    invoices:p.invoices.map(({amountYuan,...i})=>({...i,amountCents:amountYuan,recognitionStatus:'MANUAL',verificationStatus:'NOT_VERIFIED'})),
    allocations:p.allocations.map(({amountYuan,...a})=>({...a,amountCents:amountYuan}))};
}
export type V11Payload = ReturnType<typeof normalizeV11>;
export type FieldIssue={path:string;message:string};
export function submissionIssues(p:V11Payload):FieldIssue[]{
  const issues:FieldIssue[]=[];
  const need=(path:string,value:unknown,label:string)=>{if(value===null||value===undefined||String(value).trim()==='')issues.push({path,message:`请填写${label}`});};
  need('description',p.description,'报销事由');
  if(!p.invoices.length)issues.push({path:'invoices',message:'当前制度要求至少一张发票及上传成功的原件'});
  if(!p.lines.length)issues.push({path:'lines',message:'至少添加一条费用明细'});
  if(p.mainType==='TRAVEL'){
    for(const [k,label] of Object.entries({reason:'出差事由',start:'出差开始日期',end:'出差结束日期',destination:'出差目的地'}))need('trip.'+k,p.trip[k as keyof typeof p.trip],label);
    if(p.trip.start&&p.trip.end&&p.trip.end<p.trip.start)issues.push({path:'trip.end',message:'出差结束日不能早于开始日'});
  }
  for(const [n,l]of p.lines.entries()){
    const prefix=`lines.${n}`;need(prefix+'.subtype',l.subtype,'费用子类型');need(prefix+'.businessDate',l.businessDate,'发生日期');need(prefix+'.description',l.description,'用途说明');
    if(l.amountCents===null||l.amountCents<=0)issues.push({path:prefix+'.amountYuan',message:'提交金额必须大于零'});
    for(const f of lineFields(p.mainType,l.subtype))if(f.required)need(prefix+'.'+(['city','checkIn','checkOut'].includes(f.key)?f.key:'business.'+f.key),f.key in l?(l as unknown as Record<string,unknown>)[f.key]:(l.business as Record<string,string>)[f.key],f.label);
    if(l.subtype==='住宿费'&&l.checkIn&&l.checkOut&&l.checkOut<=l.checkIn)issues.push({path:prefix+'.checkOut',message:'退房日期必须晚于入住日期'});
  }
  for(const [n,i]of p.invoices.entries()){
    const prefix=`invoices.${n}`;
    if(i.type==='数电发票'?!/^\d{20}$/.test(i.number):!/^\d{8}$/.test(i.number)||!/^\d{10}(\d{2})?$/.test(i.code))issues.push({path:prefix+'.number',message:'请填写适用票种的完整发票标识'});
    need(prefix+'.date',i.date,'开票日期');need(prefix+'.attachmentId',i.attachmentId,'上传成功的发票原件');need(prefix+'.buyerName',i.buyerName,'票面购买方名称');need(prefix+'.buyerTaxId',i.buyerTaxId,'当前适用制度要求的购买方税号');need(prefix+'.sellerName',i.sellerName,'当前查重规则所需的销售方名称');
    if(i.amountCents===null||i.amountCents<=0)issues.push({path:prefix+'.amountYuan',message:'请填写大于零的票面金额'});
  }
  if(p.allocations.some(a=>a.amountCents===null||a.amountCents<=0))issues.push({path:'allocations',message:'请填写大于零的发票分摊金额'});
  need('receivingAccountId',p.receivingAccountId,'本人有效收款账户');
  return issues;
}
export function v11IssuesError(issues:FieldIssue[]):never {
  throw Object.assign(Error(issues.map(i=>i.path+'：'+i.message).join('；')),{status:400,issues});
}
