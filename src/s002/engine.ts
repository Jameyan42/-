import {auditAll,registry,historyRow} from '../s001/rules';
import {resolveAll,applySelection} from '../s001/rule-config';
import {issues} from './data';
import type {State,Context,RuleResult} from '../s001/types';
import type {HistoryInvoice} from '../r002/invoiceTypes';
import type {Sample,Outcome,Queue,Batch} from './types';
export const POLICY_VERSION='S002-routing-v1-preserve-original-status';
export function fingerprint(value:unknown){let h=2166136261;for(const c of JSON.stringify(value))h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0).toString(16);}
export function route(results:RuleResult[],problems:string[]):Queue{
 if(results.some(r=>r.status==='ERROR'))return 'SYSTEM_ERROR';if(results.some(r=>r.status==='BLOCK'))return 'RULE_BLOCK';
 if(problems.length||results.some(r=>r.status==='INSUFFICIENT_DATA'||(r.ruleId==='R001'&&(r.evidence as any)?.reasons?.includes('missing_standard'))))return 'NEED_INFO';
 if(results.length!==3||results.some(r=>r.status!=='PASS'))return 'MANUAL_REVIEW';return 'FAST_CHECK';
}
export function auditSamples(samples:Sample[],state:State,standards:Context['standards'],at:string,extraHistory:HistoryInvoice[]|null=[],rules=registry.filter(r=>['R001','R002','R003'].includes(r.ruleId))):Outcome[]{
 const copies=structuredClone(samples);return copies.map(s=>{
 const history=extraHistory===null?null:[...extraHistory.filter(h=>!h.documentId.startsWith(s.input.id+'::')),...copies.filter(x=>x.caseId!==s.caseId).flatMap(x=>x.input.invoices.flatMap(i=>historyRow(x.input,i,at,'审核中')||[]))];
 const results=auditAll(s.input,{at,standards:structuredClone(standards),invoiceHistory:history,ruleSelections:resolveAll(state,s.input,at)},rules);
 let effective=standards;try{const selection=resolveAll(state,s.input,at)?.find(v=>v.ruleId==='R001');if(selection)effective=applySelection(s.input,{at,standards,invoiceHistory:history},selection).standards;}catch{}
 const problems=issues(s,effective,(state.entityConfig?.companies||[]).filter(c=>c.status==='启用').map(c=>c.companyId));
 return {caseId:s.caseId,revision:s.revision,input:structuredClone(s.input),issues:problems,results,queue:route(results,problems)};
 });
}
export function batchSignature(samples:Sample[],state:State,standards:Context['standards'],history:Context['invoiceHistory'],scope:string,codeVersion:string,at:string){return fingerprint({samples,state:{entityConfig:state.entityConfig,ruleBook:state.ruleBook},standards,history,scope,codeVersion,day:at.slice(0,10),policy:POLICY_VERSION});}
export function makeBatch(samples:Sample[],state:State,standards:Context['standards'],history:Context['invoiceHistory'],at:string,id:string,codeVersion:string,scope:string):Batch{
 if(!samples.length)throw Error('请选择样本');const started=performance.now();const rows=auditSamples(samples,state,standards,at,history);return {id,at,signature:batchSignature(samples,state,standards,history,scope,codeVersion,at),scope,codeVersion,elapsedMs:performance.now()-started,rows,context:{state:{...structuredClone(state),claims:[]},standards:structuredClone(standards),history:structuredClone(history)}};
}

export function evaluationKey(rows:{caseId:string;revision:number;input:Sample['input']}[],state:State,standards:Context['standards'],history:Context['invoiceHistory']){return fingerprint({rows:rows.map(r=>({caseId:r.caseId,revision:r.revision,input:r.input})).sort((a,b)=>a.caseId.localeCompare(b.caseId)),policy:{entityConfig:state.entityConfig,ruleBook:state.ruleBook,standards,history},version:POLICY_VERSION});}
