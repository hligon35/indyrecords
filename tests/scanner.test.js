import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeScannerInput,validateSyntheticScan} from '../packages/integrations/synthetic-scanner.js';
import {createSyncCoordinator} from '../packages/api-client/sync.js';
import {enqueue} from '../src/sync-queue.js';
test('DataWedge Enter suffix normalizes; malformed and foreign records are rejected',()=>{
 assert.equal(normalizeScannerInput(' irm-bx-1002\r\n'),'IRM-BX-1002');
 for(const value of ['ABC\nDEF','../../IRM-BX-1002','',null,'x'.repeat(101)])assert.throws(()=>normalizeScannerInput(value));
 const event={barcode:'IRM-BX-1002',clientEventId:'zebra-1',operation:'Box Retrieval',mode:'outbound',occurredAt:new Date().toISOString()};
 assert.equal(validateSyntheticScan(event).barcode,event.barcode);
 for(const change of [{barcode:'REAL-1'},{operation:'File Retrieval'},{operation:'Box Destruction'},{mode:'inbound'}])assert.throws(()=>validateSyntheticScan({...event,...change}));
});
test('restarted synthetic sync recovers interrupted sends and preserves stable event identifiers',async()=>{
 const event={barcode:'IRM-BX-1002',clientEventId:'zebra-restart',operation:'Box Retrieval',mode:'outbound',occurredAt:new Date().toISOString()};
 let saved=enqueue([],event).map(x=>({...x,status:'sending'}));const receipts=new Set([event.clientEventId]);
 const repository={read:async()=>structuredClone(saved),write:async queue=>{saved=structuredClone(queue)}};
 const api={submitScan:async scan=>{validateSyntheticScan(scan);assert.equal(scan.clientEventId,event.clientEventId);return {status:receipts.has(scan.clientEventId)?'already_accepted':'accepted'}}};
 await createSyncCoordinator({repository,api}).synchronize();assert.equal(saved[0].status,'confirmed');
 assert.equal((await createSyncCoordinator({repository,api}).synchronize()).processed,0);
});
