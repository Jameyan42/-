import {auditAll,registry,historyRow} from '../s001/rules';
import {resolveAll} from '../s001/rule-config';
import {defaultEntities} from '../s001/entity-rule';
import type {State,Input} from '../s001/types';
import type {HistoryInvoice} from '../r002/invoiceTypes';
export function previewInvoiceRules(s:State,input:Input,history:HistoryInvoice[]|null,at:string){
 const known=history===null?null:[...history,...s.claims.filter(d=>d.id!==input.id).flatMap(d=>{const b=[...d.batches].reverse().find(b=>b.results.some(r=>r.ruleId==='R002'&&!['ERROR','INSUFFICIENT_DATA'].includes(r.status)));return b?b.input.invoices.flatMap(i=>historyRow(b.input,i,b.at,b.review?.decision==='approved'?'已通过':b.review?.decision==='rejected'?'已驳回':'审核中')||[]):[];})];
 return auditAll(structuredClone(input),{at,standards:null,invoiceHistory:known,entityConfig:structuredClone(s.entityConfig||defaultEntities()),ruleSelections:resolveAll(s,input,at)},registry.filter(r=>['R002','R003','R004'].includes(r.ruleId)));
}
