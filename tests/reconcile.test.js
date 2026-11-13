import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRecord,reconcileRecords} from '../packages/integrations/reconcile.js';
test('normalizes fictional vendor export rows',()=>{const row=normalizeRecord({barcode:' irm-bx-1002 ',customer:'Demo Medical'},'andrew');assert.equal(row.barcode,'IRM-BX-1002');assert.equal(row.source,'andrew')});
test('rejects invalid source and barcode',()=>{assert.throws(()=>normalizeRecord({barcode:'abc'},'unknown'));assert.throws(()=>normalizeRecord({barcode:'../../bad'},'andrew'))});
test('reports matches, missing records, and differences',()=>{const source=[{barcode:'A',customer:'Demo',location:'L1',status:'Stored'},{barcode:'B',customer:'Demo',location:'L2',status:'Stored'},{barcode:'C',customer:'Demo',location:'L3',status:'Stored'}];const comparison=[{...source[0]},{...source[1],location:'L9'}];const result=reconcileRecords(source,comparison);assert.equal(result.matched,1);assert.deepEqual(result.differences.map(x=>x.kind),['mismatch','missing'])});
test('flags ambiguous duplicate barcodes',()=>{const row={barcode:'A',customer:'Demo',location:'L1',status:'Stored'};assert.equal(reconcileRecords([row],[row,row]).differences[0].kind,'ambiguous')});
