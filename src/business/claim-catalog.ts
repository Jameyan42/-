export const mainTypes = {
  TRAVEL: '差旅费', ENTERTAINMENT: '业务招待费', OFFICE: '办公费',
  LOCAL_TRANSPORT: '日常交通费', OTHER: '其他费用',
} as const;
export type MainType = keyof typeof mainTypes;
export const subtypes: Record<MainType, readonly string[]> = {
  TRAVEL: ['住宿费', '机票', '高铁/火车票', '出租车/网约车', '其他差旅交通', '其他差旅费用'],
  ENTERTAINMENT: ['客户餐饮', '商务接待', '其他业务招待'],
  OFFICE: ['办公用品', '打印及耗材', '其他日常办公支出'],
  LOCAL_TRANSPORT: ['出租车/网约车', '公共交通', '停车费', '其他市内交通'],
  OTHER: ['其他费用'],
};
export type BusinessField = { key: string; label: string; type?: 'date'; required?: boolean };
export function lineFields(main: MainType, sub: string): BusinessField[] {
  if (main === 'TRAVEL') {
    if (sub === '住宿费') return [{key:'city',label:'住宿城市',required:true},{key:'hotel',label:'酒店名称',required:true},{key:'checkIn',label:'入住日期',type:'date',required:true},{key:'checkOut',label:'退房日期',type:'date',required:true}];
    if (sub === '机票' || sub === '高铁/火车票') return [
      {key:'origin',label:sub==='机票'?'出发地':'出发站',required:true},
      {key:'destination',label:sub==='机票'?'目的地':'到达站',required:true},
      {key:'transportDate',label:sub==='机票'?'航班日期':'乘车日期',type:'date',required:true},
      {key:'serviceNumber',label:sub==='机票'?'航班号（适用时）':'车次（适用时）'},
    ];
    if(sub==='出租车/网约车')return [{key:'origin',label:'起点',required:true},{key:'destination',label:'终点',required:true},{key:'transportDate',label:'出行日期',type:'date',required:true}];
    return [{key:'itemName',label:'费用名称',required:true}];
  }
  if(main==='ENTERTAINMENT')return [{key:'customer',label:'招待对象/客户公司（按制度）'},{key:'participants',label:'参与人数（按制度）'}];
  if(main==='OFFICE')return [{key:'itemName',label:'物品或用途名称',required:true},{key:'quantity',label:'数量（适用时）'},{key:'unitPrice',label:'单价（元，适用时）'}];
  if(main==='LOCAL_TRANSPORT')return [{key:'origin',label:'起点（适用时）'},{key:'destination',label:'终点（适用时）'}];
  return [{key:'itemName',label:'具体费用名称',required:true}];
}
export function canonicalExpense(main: MainType, sub: string): string {
  if(main==='TRAVEL')return sub==='住宿费'?'住宿费':sub==='其他差旅费用'?'其他费用':'交通费';
  return {ENTERTAINMENT:'业务招待费',OFFICE:'办公用品',LOCAL_TRANSPORT:'交通费',OTHER:'其他费用'}[main];
}
