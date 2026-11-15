import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {buildReport,reportCsv,reportFilters,csvCell} from '../packages/reports/report.js';
import {reportPdf} from '../packages/reports/pdf.js';
import {validateCustomerProfile} from '../packages/management/customers.js';
test('customer profile input is synthetic, versioned and bounded',()=>{
 assert.equal(validateCustomerProfile({customerId:'c2',displayName:' Demo office ',contactAlias:'demo-office',active:true,expectedVersion:0}).displayName,'Demo office');
 for(const change of [{customerId:'real-company'},{contactAlias:'real@example.com'},{expectedVersion:-1},{displayName:'bad\nname'}])assert.throws(()=>validateCustomerProfile({customerId:'c2',displayName:'Demo',contactAlias:'',active:true,expectedVersion:0,...change}));
});
test('reports isolate customers and validate UTC ranges before producing rows',()=>{
 const records=[{barcode:'A',customerId:'c1',kind:'File',status:'Stored',createdAt:'2026-11-10T00:00:00Z'},{barcode:'B',customerId:'c2',kind:'Box',status:'Stored',createdAt:'2026-11-11T00:00:00Z'}];
 const report=buildReport({records},{customerIds:['c2'],filters:{from:'2026-11-11',to:'2026-11-11',kind:'Box'}});assert.equal(report.rows.length,1);assert.equal(report.rows[0].barcode,'B');assert.equal(report.summary.inventory,1);
 for(const filters of [{from:'2026-02-30'},{from:'2026-12-01',to:'2026-11-01'},{kind:'Other'}])assert.throws(()=>reportFilters(filters));
 assert.throws(()=>buildReport({records:Array(1001).fill(records[0])},{customerIds:['c1']}),/1,000/);
});
test('CSV neutralizes spreadsheet formulas and preserves escaped text and row endings',()=>{
 for(const value of ['=SUM(A1)','+cmd','-cmd','@cmd',' \t=cmd','\tordinary'])assert.ok(csvCell(value).startsWith('"\''));
 assert.equal(csvCell('Demo, "office"'),'"Demo, ""office"""');
 const report=buildReport({records:[{barcode:'DEMO-BX-2001',customerId:'c2',kind:'Box',customer:'=formula',status:'Stored'}]},{customerIds:['c2']});
 const csv=reportCsv(report);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.endsWith('\r\n'));assert.ok(csv.includes("'="));
});
test('PDF export paginates long scoped reports with metadata and standard landscape pages',async()=>{
 const report=buildReport({records:Array.from({length:100},(_,i)=>({barcode:'DEMO-BX-'+(2000+i),kind:'Box',customerId:'c2',customer:'Demo office with a long synthetic name',status:'Stored',location:'A01-R01',custodian:'warehouse'}))},{customerIds:['c2']});
 const bytes=await reportPdf(report);const pdf=await PDFDocument.load(bytes);assert.ok(pdf.getPageCount()>1);assert.equal(pdf.getPage(0).getWidth(),792);assert.match(pdf.getTitle(),/inventory/);assert.ok(bytes.length>1000);
});
