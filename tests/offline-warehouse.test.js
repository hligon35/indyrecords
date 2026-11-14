import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOfflineWarehouseStore} from '../packages/warehouse/offline-store.js';
import {createSyncCoordinator} from '../packages/api-client/sync.js';
function factory(file,handles){return createOfflineWarehouseStore({openDatabase:async()=>{
 const db=new DatabaseSync(file);handles.push(db);
 const adapter={execAsync:async sql=>db.exec(sql),getFirstAsync:async(sql,...args)=>db.prepare(sql).get(...args),getAllAsync:async(sql,...args)=>db.prepare(sql).all(...args),runAsync:async(sql,...args)=>{const result=db.prepare(sql).run(...args);return {changes:Number(result.changes)}},async withExclusiveTransactionAsync(callback){db.exec('BEGIN IMMEDIATE');try{await callback(adapter);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}}};return adapter;
}})}
test('SQLite offline workflows survive restart, recover interrupted sends and isolate users',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'irm-offline-')),handles=[];const file=join(folder,'queue.db');
 try{
  const first=factory(file,handles);const command={type:'create_order',clientEventId:'offline-order',orderId:'demo-offline-order',operation:'Retrieval',barcodes:['IRM-BX-1002']};
  await first.stageCommand('user-1','c2',command);
  const repository=first.workflowRepository('user-1','c2');let queue=await repository.read();assert.equal(queue.length,1);queue[0].status='sending';await repository.write(queue);
  for(const db of handles.splice(0))db.close();
  const restarted=factory(file,handles),repo=restarted.workflowRepository('user-1','c2');
  assert.equal((await restarted.loadWorkspace('user-1','c2')).records[0].status,'Reserved');
  assert.equal((await restarted.workflowRepository('user-2','c2').read()).length,0);
  await createSyncCoordinator({repository:repo,api:restarted.syntheticWorkflowReceiver()}).synchronize();assert.equal((await repo.read())[0].status,'confirmed');
  assert.equal((await createSyncCoordinator({repository:repo,api:restarted.syntheticWorkflowReceiver()}).synchronize()).processed,0);
  await assert.rejects(restarted.stageCommand('user-1','c2',{type:'pick',clientEventId:'stale',orderId:'demo-offline-order',orderVersion:0,barcode:'IRM-BX-1002',expectedVersion:0}),/changed/);
  assert.equal((await repo.read()).length,1);
 }finally{for(const db of handles)db.close();assert.ok(folder.startsWith(join(tmpdir(),'irm-offline-')));rmSync(folder,{recursive:true,force:true})}
});
test('conflict replacement is atomic, keeps original evidence and uses a new event identifier',async()=>{
 const handles=[],store=factory(':memory:',handles);
 try{
  const command={type:'move',clientEventId:'original',barcode:'IRM-BX-1002',expectedVersion:0,location:'A01-R02'};
  await store.stageCommand('user-1','c2',command);const repo=store.workflowRepository('user-1','c2');let queue=await repo.read();queue[0].status='conflict';await repo.write(queue);
  await store.stageCommand('user-1','c2',{...command,clientEventId:'replacement',expectedVersion:1,location:'A02-R01'},'original');
  queue=await repo.read();assert.equal(queue[0].status,'conflict');assert.equal(queue[0].supersededBy,'replacement');assert.equal(queue[1].replaces,'original');assert.equal(queue[1].status,'pending');
  await assert.rejects(store.stageCommand('user-1','c2',{...command,clientEventId:'third',expectedVersion:2},'original'),/no longer/);assert.equal((await repo.read()).length,2);
 }finally{for(const db of handles)db.close()}
});
