// No gold labels or human times are generated. HOLDOUT runs only after verified freeze.
import {readFileSync,writeFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
import {empty as unified} from '../src/s001/model';import {createExampleStandards} from '../src/r001/standards';
import {empty,queues} from '../src/s002/types';import {importCSV} from '../src/s002/data';import {makeBatch} from '../src/s002/engine';
import {addSamples,appendBatch} from '../src/s002/model';import {quality,efficiency} from '../src/s002/metrics';
execFileSync(process.execPath,['scripts/freeze_s002.mjs'],{stdio:'inherit'});const manifest=JSON.parse(readFileSync('docs/s002/freeze.json','utf8'));
if(manifest.status!=='FROZEN')throw Error('版本未冻结');const samples=importCSV(readFileSync('S002_TEST_DATA.csv','utf8'));if(samples.length!==60)throw Error('需要完整60事实样本');
let state=addSamples(empty(),samples);for(const split of ['DEV','HOLDOUT']){const selected=samples.filter(s=>s.split===split);const batch=makeBatch(selected,unified(),createExampleStandards(),[],new Date().toISOString(),`ACTUAL-${split}`,manifest.codeVersion,split);state=appendBatch(state,batch);}
const summaries=['DEV','HOLDOUT'].map(split=>{const b=state.batches.find(b=>b.scope===split)!;return {split,count:b.rows.length,elapsedMs:b.elapsedMs,queues:Object.fromEntries(queues.map(q=>[q,b.rows.filter(r=>r.queue===q).length])),quality:quality(state,split)};});
const result={actualMachineRunAt:new Date().toISOString(),codeVersion:manifest.codeVersion,manualLabelsConfirmed:0,humanTimingSessions:0,notice:'仅实际机器运行。没有人工金标准，不计算真实查准率/查全率或效率提升。',summaries,efficiency:efficiency(state),records:state};
writeFileSync('docs/s002/machine-run.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({codeVersion:manifest.codeVersion,summaries},null,2));
