import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {reportPdf} from '../packages/reports/pdf.js';

const report=value=>({schemaVersion:1,synthetic:true,source:'synthetic',type:'inventory',generatedAt:'2026-11-15T12:00:00Z',customerIds:['c1'],filters:{},columns:[['value','Value'],['customer','Customer']],rows:[{value,customer:'Été · Ελληνικά · Кириллица'}]});

test('management PDF embeds supported Unicode and paginates complete long cell values',async()=>{
 const bytes=await reportPdf(report('Été Ελληνικά Кириллица '+'LongValue'.repeat(900)));
 assert.equal(new TextDecoder().decode(bytes.slice(0,5)),'%PDF-');
 const doc=await PDFDocument.load(bytes);
 assert.ok(doc.getPageCount()>1);
});

test('management PDF reports an explicit fallback for unsupported glyphs',async()=>{
 await assert.rejects(reportPdf(report('Box 漢字')),/does not support U\+6F22; use UTF-8 CSV or HTML/);
});
