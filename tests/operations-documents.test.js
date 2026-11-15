import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {buildSampleDataset} from '../packages/operations/sample.js';
import {buildDocument,documentHtml,documentCsv,documentPdf} from '../packages/operations/documents.js';
import {estimatePrice} from '../packages/commercial/workflows.js';
test('measured weight/hour pricing uses fixed-point thousandths and rounds cents half up',()=>{
 const base={quantity:1,unit:'weight',measuredQuantity:'1.005',unitCents:100,minimumCents:0,discountBps:0,fuelBps:0,taxBps:0};
 assert.equal(estimatePrice(base).totalCents,101);assert.equal(estimatePrice(base).quantityMilli,1005);
 assert.equal(estimatePrice({...base,unit:'hour',measuredQuantity:'0.125',unitCents:8000}).totalCents,1000);
 for(const value of ['0','1.0001','1e2','-1','1,5','10000.001'])assert.throws(()=>estimatePrice({...base,measuredQuantity:value}));
 assert.throws(()=>estimatePrice({...base,unit:'container'}));assert.throws(()=>estimatePrice({...base,unit:'fixed'}));
});
test('sample invoice renders immutable billing snapshots, refunds, credits and balances',async()=>{
 const s=await buildSampleDataset('c2'),i=s.commercial.invoices[0],doc=await buildDocument(s,'invoice',i.id);
 assert.match(JSON.stringify(doc),/Café/);assert.match(doc.title,/SAMPLE/);
 assert.ok(doc.sections.find(s=>s.title==='Totals').rows.some(r=>r.label==='Outstanding'&&r.value==='$0.00 USD'));
 const bytes=await documentPdf(doc),pdf=await PDFDocument.load(bytes);assert.ok(pdf.getPageCount()>=1);
 assert.match(documentHtml(doc),/Café/);assert.match(documentCsv(doc),/Café/);
});
test('certificate output preserves sample and void labels and rejects broken custody',async()=>{
 const s=await buildSampleDataset('c2'),cert=s.field.certificates[0];cert.voided=true;cert.voidReason='<script>alert(1)</script>';
 const doc=await buildDocument(s,'certificate',cert.id),html=documentHtml(doc);
 assert.match(doc.title,/NOT PROOF/);assert.match(html,/VOIDED SAMPLE/);assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);
 s.field.custody[0].hash='tampered';await assert.rejects(buildDocument(s,'certificate',cert.id),/integrity/);
});
test('embedded PDF supports Latin, Greek and Cyrillic and explicitly rejects unsupported glyphs',async()=>{
 const s=await buildSampleDataset('c2'),doc=await buildDocument(s,'operations');
 doc.sections.push({title:'Language fixtures',rows:[{label:'Names',value:'Café — Αθήνα — Москва'}]});
 const bytes=await documentPdf(doc);assert.ok(bytes.length>10000);
 doc.sections[0].rows[0].value='漢字';await assert.rejects(documentPdf(doc),/font does not support/);
});
test('long operational output paginates without four-line truncation and CSV escapes formulas',async()=>{
 const s=await buildSampleDataset('c2'),doc=await buildDocument(s,'operations');
 const text='Full values remain present '.repeat(250);doc.sections.push({title:'Long details',rows:[{label:'Long value',value:text},{label:'Formula',value:'=1+1'}]});
 assert.ok(documentHtml(doc).includes(text));assert.match(documentCsv(doc),/'=1\+1/);
 assert.ok((await PDFDocument.load(await documentPdf(doc))).getPageCount()>1);
 const other=await buildSampleDataset('c3');await assert.rejects(buildDocument({...s,field:other.field},'operations'),/match/);
});
