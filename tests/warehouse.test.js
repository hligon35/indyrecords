import test from 'node:test';
import assert from 'node:assert/strict';
import {seedWarehouse,applyWarehouseCommand,verifyCustody} from '../packages/warehouse/workflows.js';
const actor='synthetic-manager';
function runner(customerId='c2'){
 let state=seedWarehouse(customerId),n=0;
 return {get state(){return state},async send(type,fields={}){
  const order=state.orders.find(x=>x.id===(fields.orderId||'demo-order-1'));
  const record=state.records.find(x=>x.barcode===(fields.barcode||state.records[0].barcode));
  const command={type,clientEventId:'command-'+(++n),orderId:order?.id||'demo-order-1',...(order?{orderVersion:order.version}:{}),...(record?{barcode:record.barcode,expectedVersion:record.version}:{}),...fields};
  const result=await applyWarehouseCommand(state,command,actor);state=result.state;return {result,command};
 }};
}
test('retrieval, courier handoff, return receiving and refiling preserve complete custody',async()=>{
 const r=runner();
 await r.send('create_order',{operation:'Retrieval',barcodes:['IRM-BX-1002']});
 await r.send('pick');await r.send('stage',{location:'STAGE-01'});
 await r.send('dispatch',{courier:'demo-courier-1'});await r.send('deliver',{recipient:'demo-recipient-1'});
 assert.equal(r.state.records[0].status,'AtCustomer');assert.equal(r.state.orders[0].status,'delivered');
 await r.send('create_order',{orderId:'demo-return',operation:'Refile',barcodes:['IRM-BX-1002']});
 await r.send('receive',{orderId:'demo-return',location:'RECEIVING'});
 await r.send('stage',{orderId:'demo-return',location:'STAGE-01'});
 await r.send('refile',{orderId:'demo-return',location:'A01-R02'});
 assert.equal(r.state.records[0].status,'Stored');assert.equal(r.state.records[0].location,'A01-R02');assert.equal(r.state.orders[1].status,'closed');
 assert.equal(r.state.custody.length,9);assert.equal(await verifyCustody(r.state.custody),true);
 const tampered=structuredClone(r.state.custody);tampered[2].to.custodian='tampered';assert.equal(await verifyCustody(tampered),false);
});
test('file withdrawal follows the same workflow and cannot be refiled as a retrieval return',async()=>{
 const r=runner('c1');await r.send('create_order',{operation:'Withdrawal',barcodes:['IRM-FL-1001']});await r.send('pick');await r.send('stage',{location:'STAGE-01'});await r.send('dispatch',{courier:'demo-courier'});await r.send('deliver',{recipient:'demo-recipient'});
 assert.equal(r.state.records[0].status,'Withdrawn');await assert.rejects(r.send('create_order',{orderId:'demo-return',operation:'Refile',barcodes:['IRM-FL-1001']}),/unavailable/);
});
test('duplicate receipts are idempotent and cannot be reused for another action or actor',async()=>{
 const r=runner();const {command}=await r.send('create_order',{operation:'Retrieval',barcodes:['IRM-BX-1002']});
 const duplicate=await applyWarehouseCommand(r.state,command,actor);assert.equal(duplicate.status,'already_accepted');assert.equal(duplicate.state.version,1);
 await assert.rejects(applyWarehouseCommand(r.state,{...command,operation:'Withdrawal'},actor),/reused/);
 await assert.rejects(applyWarehouseCommand(r.state,command,'another-user'),/reused/);
});
test('out-of-order, foreign-record, stale-version and destruction actions fail without mutating state',async()=>{
 const r=runner();await r.send('create_order',{operation:'Retrieval',barcodes:['IRM-BX-1002']});const before=structuredClone(r.state);
 for(const [type,fields] of [['dispatch',{courier:'demo-courier'}],['deliver',{recipient:'demo-recipient'}],['stage',{location:'STAGE-01'}],['pick',{barcode:'IRM-FL-1001'}],['pick',{expectedVersion:0}],['destroy',{}],['toString',{}]])await assert.rejects(r.send(type,fields));
 assert.deepEqual(r.state,before);await r.send('cancel_order');assert.equal(r.state.records[0].status,'Stored');
});
test('location movement validates storage and expected version, then appends custody',async()=>{
 const r=runner();await assert.rejects(r.send('move',{location:'STAGE-01'}),/storage/);await r.send('move',{location:'A02-R01'});assert.equal(r.state.records[0].location,'A02-R01');assert.equal(r.state.custody[0].action,'location_changed');assert.equal(r.state.custody[0].orderId,null);
});

test('new synthetic files receive, stage and refile through a receiving pick list',async()=>{
 const r=runner();await r.send('register_record',{barcode:'DEMO-FL-2001',kind:'File'});
 await assert.rejects(r.send('register_record',{barcode:'REAL-2002',kind:'File'}),/DEMO/);
 await r.send('create_order',{orderId:'demo-receiving',operation:'Receiving',barcodes:['DEMO-FL-2001']});
 await r.send('receive',{orderId:'demo-receiving',barcode:'DEMO-FL-2001',location:'RECEIVING'});
 await r.send('stage',{orderId:'demo-receiving',barcode:'DEMO-FL-2001',location:'STAGE-01'});
 await r.send('refile',{orderId:'demo-receiving',barcode:'DEMO-FL-2001',location:'A02-R01'});
 assert.equal(r.state.records.find(x=>x.barcode==='DEMO-FL-2001').status,'Stored');assert.equal(r.state.orders[0].status,'closed');assert.equal(await verifyCustody(r.state.custody),true);
});

test('idempotent acknowledgements survive the workspace receipt limit',async()=>{
 const r=runner();const {command}=await r.send('move',{location:'A01-R02'});const state=JSON.parse(JSON.stringify(r.state));
 while(state.receipts.length<2000)state.receipts.push({clientEventId:'filler-'+state.receipts.length});
 assert.equal((await applyWarehouseCommand(state,command,actor)).status,'already_accepted');
 await assert.rejects(applyWarehouseCommand(state,{...command,clientEventId:'new-event'},actor),/limit/);
});

test('multi-item pick lists cannot dispatch until every Box and File is staged',async()=>{
 const r=runner();await r.send('register_record',{barcode:'DEMO-FL-2001',kind:'File'});await r.send('create_order',{orderId:'demo-receipt',operation:'Receiving',barcodes:['DEMO-FL-2001']});for(const [type,location] of [['receive','RECEIVING'],['stage','STAGE-01'],['refile','A01-R01']])await r.send(type,{orderId:'demo-receipt',barcode:'DEMO-FL-2001',location});await r.send('create_order',{operation:'Retrieval',barcodes:['IRM-BX-1002','DEMO-FL-2001']});await r.send('pick');await r.send('stage',{location:'STAGE-01'});await assert.rejects(r.send('dispatch',{courier:'demo-courier'}),/staged/);
 await r.send('pick',{barcode:'DEMO-FL-2001'});await r.send('stage',{barcode:'DEMO-FL-2001',location:'STAGE-01'});await r.send('dispatch',{courier:'demo-courier'});assert.ok(r.state.records.every(x=>x.status==='InTransit'));assert.ok(r.state.orders[1].items.every(x=>x.status==='dispatched'));
});
