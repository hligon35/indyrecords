import {mkdir,writeFile} from 'node:fs/promises';
import {buildSampleDataset} from '../packages/operations/sample.js';
import {buildDocument,documentPdf,documentHtml,documentCsv} from '../packages/operations/documents.js';
const sample=await buildSampleDataset('c2'),outputs=[new URL('../dist/sample/documents/',import.meta.url),new URL('../fixtures/sample-data/documents/',import.meta.url)];
for(const out of outputs)await mkdir(out,{recursive:true});
for(const [type,id] of [['invoice',sample.commercial.invoices[0].id],['certificate',sample.field.certificates[0].id],['operations','']]){
 const doc=await buildDocument(sample,type,id,'2026-11-15T15:00:00.000Z');
 for(const out of outputs){
  await writeFile(new URL(type+'.pdf',out),await documentPdf(doc));
  await writeFile(new URL(type+'.html',out),documentHtml(doc));
  await writeFile(new URL(type+'.csv',out),documentCsv(doc));
 }
}
console.log('Invoice, sample certificate and operations documents written in PDF, HTML and CSV to dist/sample/documents and fixtures/sample-data/documents. No records or deliveries changed.');
