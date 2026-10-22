export const defaultBudgets={销售部:20000,产品部:15000,运营部:10000};
export function budgetRows(items,limits,month){
 return Object.entries(limits).map(([department,limit])=>{
 const rows=items.filter(x=>x.department===department&&x.date.startsWith(month)&&!['已退回','草稿'].includes(x.status));
 const paid=rows.filter(x=>x.status==='已付款').reduce((s,x)=>s+x.amount,0);
 const reserved=rows.filter(x=>x.status!=='已付款').reduce((s,x)=>s+x.amount,0);
 return {department,limit,paid,reserved,available:limit-paid-reserved,ratio:limit?((paid+reserved)/limit):rows.length?1:0};
 });
}
