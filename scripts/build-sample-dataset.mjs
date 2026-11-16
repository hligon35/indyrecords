import {mkdir,writeFile} from 'node:fs/promises';
import {buildSampleDataset,DATASET_VERSION} from '../packages/operations/sample.js';
const outputs=[new URL('../dist/sample/',import.meta.url),new URL('../fixtures/sample-data/',import.meta.url)];
for(const out of outputs)await mkdir(out,{recursive:true});
const manifests=[];
for(const tenant of ['c1','c2','c3','c4']){
 const sample=await buildSampleDataset(tenant);manifests.push(sample.manifest);
 for(const out of outputs){
  await writeFile(new URL(tenant+'.json',out),JSON.stringify(sample,null,2)+'\n');
  await writeFile(new URL(tenant+'-settlements-matched.csv',out),sample.fixtures.settlements.matchedCsv);
  await writeFile(new URL(tenant+'-settlements-mismatch.csv',out),sample.fixtures.settlements.mismatchedCsv);
 }
}
for(const out of outputs)await writeFile(new URL('manifest.json',out),JSON.stringify({datasetVersion:DATASET_VERSION,synthetic:true,customers:manifests},null,2)+'\n');
console.log('Complete fictional feature-testing dataset written to dist/sample and fixtures/sample-data. No database or identity provider modified.');
