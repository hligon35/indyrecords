import {mkdir,writeFile} from 'node:fs/promises';
import {buildSampleDataset,DATASET_VERSION} from '../packages/operations/sample.js';
const out=new URL('../dist/sample/',import.meta.url);await mkdir(out,{recursive:true});
const manifests=[];
for(const tenant of ['c1','c2','c3','c4']){
 const sample=await buildSampleDataset(tenant);manifests.push(sample.manifest);
 await writeFile(new URL(tenant+'.json',out),JSON.stringify(sample,null,2)+'\n');
 await writeFile(new URL(tenant+'-settlements-matched.csv',out),sample.fixtures.settlements.matchedCsv);
 await writeFile(new URL(tenant+'-settlements-mismatch.csv',out),sample.fixtures.settlements.mismatchedCsv);
}
await writeFile(new URL('manifest.json',out),JSON.stringify({datasetVersion:DATASET_VERSION,synthetic:true,customers:manifests},null,2)+'\n');
console.log('Complete synthetic dataset written to dist/sample. No database or identity provider modified.');
