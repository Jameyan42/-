// Freeze before generating or running HOLDOUT. Re-running never silently replaces a frozen baseline.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';import {createHash} from 'node:crypto';
const path='docs/s002/freeze.json',old=JSON.parse(readFileSync(path,'utf8'));
const files=['src/r001/rule.ts','src/r001/types.ts','src/r001/standards.ts','src/r002/invoiceDuplicateRule.ts','src/s001/rules.ts','src/s001/rule-config.ts','src/s001/types.ts','src/s002/types.ts','src/s002/data.ts','src/s002/engine.ts','src/s002/model.ts','src/s002/metrics.ts','src/s002/ui.js','scripts/create_s002_data.py'];
const sources=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(f)).digest('hex')]));
if(old.status==='FROZEN'){if(JSON.stringify(old.sources)!==JSON.stringify(sources))throw Error('冻结源已变化；不得用同一独立集继续调参。先记录污染并另行设计未使用的验收集。');console.log('Frozen sources unchanged',old.codeVersion);process.exit(0);}
if(existsSync('docs/s002/holdout-facts.json'))throw Error('已存在独立集，拒绝事后冻结');
const manifest={status:'FROZEN',frozenAt:new Date().toISOString(),codeVersion:createHash('sha256').update(JSON.stringify(sources)).digest('hex'),sources,policy:'Reuse original R001/R002/R003 and R008 selections; no new hard block for R001 REVIEW',goldConfirmed:0,holdoutUsedForTuning:false};
writeFileSync(path,JSON.stringify(manifest,null,2)+'\n');console.log('FROZEN',manifest.codeVersion);
