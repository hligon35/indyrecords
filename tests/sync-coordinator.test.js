import test from 'node:test';
import assert from 'node:assert/strict';
import {enqueue} from '../src/sync-queue.js';
import {ApiError} from '../packages/api-client/index.js';
import {createSyncCoordinator} from '../packages/api-client/sync.js';
function fixture(){let queue=enqueue([],{clientEventId:'uuid-1',barcode:'IRM-BX-1002',operation:'Box Retrieval',mode:'outbound',occurredAt:'2026-11-13T00:00:00Z'});return {read:async()=>structuredClone(queue),write:async value=>{queue=structuredClone(value)},snapshot:()=>queue}}
test('successful sync confirms only after server acknowledgement',async()=>{const store=fixture();const sync=createSyncCoordinator({repository:store,api:{submitScan:async()=>({status:'accepted'})},clock:()=>100});assert.deepEqual(await sync.synchronize(),{status:'complete',processed:1});assert.equal(store.snapshot()[0].status,'confirmed')});
test('server duplicate acknowledgement confirms idempotent retry',async()=>{const store=fixture();const sync=createSyncCoordinator({repository:store,api:{submitScan:async()=>({status:'already_accepted'})},clock:()=>100});await sync.synchronize();assert.equal(store.snapshot()[0].status,'confirmed')});
test('network failure schedules retry without confirming',async()=>{const store=fixture();const sync=createSyncCoordinator({repository:store,api:{submitScan:async()=>{throw Error('offline')}},clock:()=>100});await sync.synchronize();assert.equal(store.snapshot()[0].status,'pending');assert.equal(store.snapshot()[0].nextAttemptAt,1100)});
test('validation conflict requires manual resolution',async()=>{const store=fixture();const sync=createSyncCoordinator({repository:store,api:{submitScan:async()=>{throw new ApiError('Conflict',409)}},clock:()=>100});await sync.synchronize();assert.equal(store.snapshot()[0].status,'conflict')});
test('expired authentication stops further processing',async()=>{const store=fixture();const sync=createSyncCoordinator({repository:store,api:{submitScan:async()=>{throw new ApiError('Unauthorized',401)}},clock:()=>100});assert.equal((await sync.synchronize()).status,'auth-required');assert.equal(store.snapshot()[0].status,'pending')});
test('concurrent sync requests do not duplicate uploads',async()=>{const store=fixture();let release;const pending=new Promise(resolve=>{release=resolve});let count=0;const sync=createSyncCoordinator({repository:store,api:{submitScan:async()=>{count++;await pending;return {status:'accepted'}}},clock:()=>100});const first=sync.synchronize();const second=await sync.synchronize();assert.equal(second.status,'busy');release();await first;assert.equal(count,1)});

test('workflow commands retain customer, actor and expected versions across synchronization',async()=>{
 const command={type:'pick',clientEventId:'workflow-1',barcode:'IRM-BX-1002',orderId:'demo-order',expectedVersion:3,orderVersion:2};
 let queue=[{clientEventId:'workflow-1',customerId:'c2',actorId:'user-1',command,status:'pending',attempts:0,nextAttemptAt:0}];
 const coordinator=createSyncCoordinator({repository:{read:async()=>queue,write:async value=>{queue=value}},api:{submitScan:async event=>{assert.deepEqual(event,{clientEventId:'workflow-1',customerId:'c2',actorId:'user-1',command});throw new ApiError('Record changed',409)}}});
 await coordinator.synchronize();assert.equal(queue[0].status,'conflict');assert.equal(queue[0].lastError,'Record changed');assert.equal(queue[0].lastStatus,409);
});
