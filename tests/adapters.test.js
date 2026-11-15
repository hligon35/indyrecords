import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACTS,parseCsv,stageExport} from '../packages/integrations/adapters.js';
import {reconcileRecords} from '../packages/integrations/reconcile.js';
function input(source='andrew',lines=[]){return {source,schemaVersion:CONTRACTS[source].version,customerId:'c2',filename:'demo-export.csv',sourceTimestamp:new Date().toISOString(),csv:CONTRACTS[source].columns.join(',')+'\r\n'+(lines.length?lines:[['id-1','IRM-BX-1002','c2','Sample Legal','A01-R02','Stored',new Date().toISOString()].join(',')]).join('\r\n')}}
test('strict CSV supports BOM, quoted delimiters, escaped quotes and multiline fields',()=>{
 const parsed=parseCsv('\uFEFFA,B\r\n"one, two","say ""hello"""\r\n"multi\nline",x\r\n');assert.equal(parsed.rows[0].A,'one, two');assert.equal(parsed.rows[0].B,'say "hello"');assert.equal(parsed.rows[1].A,'multi\nline');
 for(const text of ['A,A\nx,y','A,B\n"unclosed,x','A,B\n"a"x,b','A,B\nx','A,B\n"'+('x'.repeat(1001))+'",b'])assert.throws(()=>parseCsv(text));
});
test('both synthetic contracts stage provenance without fetching any vendor endpoint',async()=>{
 const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('Network access prohibited')};
 try{for(const source of ['andrew','qshred']){const result=await stageExport(input(source));assert.equal(result.accepted.length,1);assert.equal(result.rejected.length,0);assert.match(result.sourceHash,/^[a-f0-9]{64}$/);assert.equal(result.accepted[0].customerId,'c2')}}finally{globalThis.fetch=original}
});
test('foreign customer rows and duplicate source identifiers are rejected with row references only',async()=>{
 const timestamp=new Date().toISOString();const result=await stageExport(input('andrew',[
  ['id-1','IRM-BX-1002','c2','Sample Legal','L1','Stored',timestamp].join(','),
  ['id-1','IRM-BX-1003','c2','Sample Legal','L1','Stored',timestamp].join(','),
  ['id-2','IRM-FL-1001','c1','Foreign customer','L1','Stored',timestamp].join(',')
 ]));assert.equal(result.accepted.length,1);assert.equal(result.rejected.length,2);assert.ok(result.rejected.every(x=>Number.isInteger(x.row)));assert.ok(!JSON.stringify(result.rejected).includes('Foreign customer'));
 await assert.rejects(stageExport({...input(),schemaVersion:'vendor-production-v1'}),/contract/);
});
test('reconciliation handles duplicate source barcodes, target-only records and customer-qualified keys',()=>{
 const row={barcode:'A',customerId:'c2',customer:'Demo',location:'L1',status:'Stored'};
 const result=reconcileRecords([row,row],[row,{...row,barcode:'B'},{...row,customerId:'c1'}]);assert.equal(result.matched,0);assert.equal(result.differences[0].kind,'ambiguous');assert.equal(result.differences.filter(x=>x.kind==='target_only').length,2);
 assert.equal(reconcileRecords([row],[{...row,customerId:'c1'}]).matched,0);
});
