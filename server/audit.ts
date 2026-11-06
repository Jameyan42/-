import type {PoolClient} from 'pg';import {auditAll,registry} from '../src/s001/rules';import {policyOutcome} from '../src/s001/rule-config';
import type {Input,RuleResult} from '../src/s001/types';import type {Payload} from './schema';import {yuan} from './schema';
export async function audit(c:PoolClient,claim:any,owner:any,company:any):Promise<RuleResult[]>{
 const p:Payload=claim.payload,at=new Date().toISOString(),settings=company.policy;
 const old=await c.query(`SELECT i.*,cl.owner_id,cl.status,cl.submitted_at,u.name FROM invoices i JOIN claims cl ON cl.id=i.claim_id JOIN users u ON u.id=cl.owner_id WHERE cl.id<>$1 AND cl.submitted_at IS NOT NULL`,[claim.id]);
 const history=old.rows.map(h=>({id:h.id,documentId:h.claim_id+'::'+h.id.replaceAll('-',''),employeeName:h.name,department:'',submittedAt:new Date(h.submitted_at).toISOString(),businessStatus:['REJECTED','CANCELLED'].includes(h.status)?'已驳回':'已通过',updatedAt:at,invoice:{...h.metadata,id:h.id,type:h.metadata.type,code:h.metadata.code,number:h.number,issueDate:h.metadata.date,sellerName:h.metadata.sellerName,sellerTaxId:h.metadata.sellerTaxId,buyerName:h.metadata.buyerName,amountCents:Number(h.amount_cents),remark:''}}));
 const entity={version:company.policy_version,companies:[{companyId:'1',companyName:company.name,taxpayerId:company.taxpayer_id,companyAliases:[],status:'启用' as const,effectiveFrom:settings.effectiveFrom,effectiveTo:null}],minimumConfidence:90,policies:['数电发票','增值税电子普通发票','增值税电子专用发票','纸质发票'].map(invoiceType=>({invoiceType,applicable:true,requireTaxId:true,reason:'单公司已维护的抬头及税号核对要求'}))};
 const results:RuleResult[]=[];
 for(const line of p.lines){const invoices=p.allocations.filter(a=>a.lineId===line.id).map(a=>{const i=p.invoices.find(i=>i.id===a.invoiceId)!;return {...i,amountYuan:yuan(a.amountCents),currency:'CNY',source:'manual' as const,recognitionStatus:'已人工核对' as const,buyerTaxStatus:'已确认' as const};});
 const input:Input={id:claim.id,employee:owner.name,department:owner.department_name||'',companyId:'1',grade:claim.payload.ownerSnapshot?.grade||owner.grade,expenseType:line.expenseType,amountYuan:yuan(line.amountCents),currency:'CNY',city:line.city,checkIn:line.checkIn,checkOut:line.checkOut,hotel:line.business?.hotel||'',hotelAmountYuan:yuan(line.amountCents),partialReason:p.modelVersion===2?line.partialReason:line.description,businessDate:line.businessDate,invoices};
 const context:any={at,standards:settings.standards,invoiceHistory:history,entityConfig:entity};
 const current=auditAll(input,context,registry.filter(r=>['R001','R002','R003','R004'].includes(r.ruleId))).map(r=>{
 if(r.ruleId==='R003')r=policyOutcome(input,context,r,{ruleId:'R003',date:line.businessDate,basis:'单公司服务端已保存政策',version:{ruleId:'R003',parameters:{expenseTypes:settings.expenseTypes,allowPartial:true,requirePartialReason:true,partialAction:'REVIEW',allowNoInvoice:false}} as any});
 if(p.modelVersion===2&&r.ruleId==='R003'){
 if(r.status==='NOT_APPLICABLE')r={...r,status:'INSUFFICIENT_DATA',severity:'high',message:'当前费用类型尚未纳入公司已保存的票额支持政策，不能借其他费用绕过金额控制'};
 const partial=p.allocations.filter(a=>a.lineId===line.id).some(a=>{const invoice=p.invoices.find(i=>i.id===a.invoiceId)!;return p.allocations.filter(x=>x.invoiceId===a.invoiceId).reduce((n,x)=>n+x.amountCents,0)<invoice.amountCents;});
 if(partial&&r.status==='PASS')r={...r,status:line.partialReason?.trim()?'REVIEW':'INSUFFICIENT_DATA',severity:'medium',message:line.partialReason?.trim()?'本次仅使用部分票额，需财务核对部分报销原因':'本次仅使用部分票额，请填写独立的部分报销原因',suggestedAction:'核实票面总额、实际分摊及部分报销原因；不开放跨单余额复用'};
 }
 return {...r,evidence:{lineId:line.id,policyVersion:company.policy_version,original:r.evidence}};});results.push(...current);
 if(p.modelVersion===2&&line.expenseType==='其他费用')results.push({ruleId:'CLASSIFICATION',ruleKey:'claim.manual-classification',ruleName:'其他费用分类复核',status:'REVIEW',severity:'medium',message:'其他费用需财务核实具体业务分类，不表示已完成R005科目确认',suggestedAction:'核对费用名称、用途及公司适用制度后填写复核意见',evidence:{lineId:line.id,subtype:line.subtype,itemName:line.business?.itemName}});
 }
 return results;
}
