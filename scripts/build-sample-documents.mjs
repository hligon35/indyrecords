import {mkdir,writeFile} from 'node:fs/promises';
import {buildSampleDataset} from '../packages/operations/sample.js';
import {buildDocument,documentPdf,documentHtml,documentCsv} from '../packages/operations/documents.js';
const sample=await buildSampleDataset('c2'),out=new URL('../dist/sample/documents/',import.meta.url);await mkdir(out,{recursive:true});
for(const [type,id] of [['invoice',sample.commercial.invoices[0].id],['certificate',sample.field.certificates[0].id],['operations','']]){
 const doc=await buildDocument(sample,type,id,'2026-11-15T15:00:00.000Z');
 await writeFile(new URL(type+'.pdf',out),await documentPdf(doc));
 await writeFile(new URL(type+'.html',out),documentHtml(doc));
 await writeFile(new URL(type+'.csv',out),documentCsv(doc));
}
console.log('Three sample documents generated in PDF, HTML and CSV. No records or deliveries changed.');
