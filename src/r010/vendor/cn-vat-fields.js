// Adapted/translated from mrliang-github/cn-vat-invoice-ocr, commit
// acc9654e7bdaa0ad13a18dfb54cc598de4d15992 (MIT; see cn-vat-LICENSE.txt).
// Only explicit title and item normalization are ported. No amount inference,
// last-tax-ID assignment, guessed invoice numbers, Apple Vision or server copied.
export function extractInvoiceType(lines) {
  const header=lines.slice(0,10).filter(s=>!s.includes('发票号码')&&!s.includes('开票日期')).join('').replace(/\s/g,'');
  if(header.includes('电子发票')&&(/普通发票|通发票/.test(header)))return '电子发票（普通发票）';
  if(header.includes('电子发票')&&header.includes('专用发票'))return '电子发票（专用发票）';
  for(const line of lines.slice(0,8)){
    const compact=line.replace(/\s/g,'');if(/发票号码|开票日期/.test(compact)||!compact.includes('发票'))continue;
    if(compact.includes('电子')&&compact.includes('普通发票'))return '电子发票（普通发票）';
    if(compact.includes('电子')&&compact.includes('专用发票'))return '电子发票（专用发票）';
    return compact.replace(/山/g,'（').replace(/\(/g,'（').replace(/\)/g,'）').replace(/^[^发票增电普专]*/,'').replace(/[^\u4e00-\u9fff（）A-Za-z0-9]/g,'').trim();
  }return '';
}
export function cleanupItemPart(value){value=value.trim();if(value.startsWith('品')&&value.endsWith('晶振'))value=value.slice(1);return value.replace(/[;；,，。]+$/,'').trim();}
export function cleanupProjectItem(value){
  if(value.includes('*')){const parts=value.split('*').map(s=>s.trim()).filter(Boolean);if(parts.length>=2){const category=cleanupItemPart(parts.at(-2)),item=cleanupItemPart(parts.at(-1));value=item&&category.includes(item)?category:`${category} ${item}`.trim();}else if(parts.length)value=cleanupItemPart(parts.at(-1));}
  value=value.replace(/^[*·\-\s]+/,'').split(/\s{2,}| 单位| 数量| 金额| 税率/)[0];return cleanupItemPart(value).trim();
}
export function isContentCandidate(value){return !!value&& !['服务','代理服务费'].includes(value)&&/[\u4e00-\u9fff]/.test(value)&&!['发票','税务','名称','代码','纳税人','开票人','银行','账号'].some(s=>value.includes(s));}
