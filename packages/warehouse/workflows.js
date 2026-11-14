// Shared synthetic-only workflow engine. Operational inventory is never modified.
export const LOCATIONS=Object.freeze([{id:'A01-R01',kind:'storage'},{id:'A01-R02',kind:'storage'},{id:'A02-R01',kind:'storage'},{id:'RECEIVING',kind:'receiving'},{id:'STAGE-01',kind:'staging'}]);
export const COMMAND_PERMISSIONS=Object.freeze({register_record:'orders:manage',create_order:'orders:manage',cancel_order:'orders:manage',pick:'scans:create',stage:'scans:create',receive:'scans:create',refile:'scans:create',move:'scans:create',dispatch:'orders:manage',deliver:'orders:manage'});
export class WorkflowError extends Error {constructor(message,status=409){super(message);this.status=status}}
const reject=(message,status)=>{throw new WorkflowError(message,status)};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/.test(value);
export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
async function hash(value,hashDigest){if(hashDigest)return hashDigest(canonical(value));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))].map(x=>x.toString(16).padStart(2,'0')).join('')}
export function seedWarehouse(customerId='c2'){
 const source=[['IRM-FL-1001','File','c1'],['IRM-BX-1002','Box','c2'],['IRM-BX-1003','Box','c3'],['IRM-BX-1004','Box','c4']];
 return {schema:1,synthetic:true,customerId,version:0,records:source.filter(x=>x[2]===customerId).map(([barcode,kind])=>({barcode,kind,customerId,status:'Stored',location:'A01-R01',custodian:'warehouse',version:0})),orders:[],custody:[],receipts:[]};
}
export async function verifyCustody(events,hashDigest){
 let previous='genesis';
 for(const {hash:stored,...event} of events){if(event.previousHash!==previous||await hash(event,hashDigest)!==stored)return false;previous=stored}
 return true;
}
export async function applyWarehouseCommand(previous,command,actor,now=new Date().toISOString(),hashDigest){
 if(previous?.synthetic!==true||!id(previous.customerId))reject('Synthetic dataset required',403);
 if(!command||!id(command.clientEventId)||!Object.hasOwn(COMMAND_PERMISSIONS,command.type))reject('Invalid command',400);
 const fingerprint=canonical(command);
 const receipt=previous.receipts.find(x=>x.clientEventId===command.clientEventId);
 if(receipt){if(receipt.fingerprint!==fingerprint||receipt.actor!==actor)reject('Event identifier reused with different payload or actor');return {state:previous,status:'already_accepted'}}
 if(previous.receipts.length>=2000)reject('Synthetic workspace limit reached; create a new test dataset',409);
 if(typeof actor!=='string'||!actor)reject('Actor required',401);
 const state=JSON.parse(JSON.stringify(previous));
 const record=command.barcode?state.records.find(x=>x.barcode===command.barcode):null;
 const order=command.orderId?state.orders.find(x=>x.id===command.orderId):null;
 const events=[];
 function mutate(item,status,location,custodian,action){
  events.push({id:command.clientEventId+':'+events.length,commandId:command.clientEventId,customerId:state.customerId,barcode:item.barcode,orderId:command.type==='create_order'?command.orderId:['move','register_record'].includes(command.type)?null:order?.id||null,action,actor,occurredAt:now,from:{status:item.status,location:item.location,custodian:item.custodian},to:{status,location,custodian}});
  Object.assign(item,{status,location,custodian,version:item.version+1});
 }
 function requireRecord(){if(!record)reject('Record not found',404);if(!Number.isInteger(command.expectedVersion)||record.version!==command.expectedVersion)reject('Record changed; refresh before retrying')}
 function requireOrder(){if(!order)reject('Order not found',404);if(!Number.isInteger(command.orderVersion)||order.version!==command.orderVersion)reject('Order changed; refresh before retrying')}
 function itemFor(){requireRecord();requireOrder();const item=order.items.find(x=>x.barcode===record.barcode);if(!item)reject('Record is not on this pick list');return item}
 function location(kind){const loc=LOCATIONS.find(x=>x.id===command.location&&x.kind===kind);if(!loc)reject('Select a valid '+kind+' location',400);return loc.id}
 switch(command.type){
  case 'register_record':{
   if(record||!/^DEMO-(BX|FL)-[0-9]{4,10}$/.test(command.barcode||'')||!['Box','File'].includes(command.kind)||command.barcode.split('-')[1]!==({Box:'BX',File:'FL'})[command.kind])reject('Use a distinct DEMO-BX/FL numeric barcode and matching kind',400);
   const created={barcode:command.barcode,kind:command.kind,customerId:state.customerId,status:'New',location:null,custodian:'demo-origin',version:0};
   state.records.push(created);mutate(created,'Expected',null,'demo-origin','expected_receipt_registered');break;
  }
  case 'create_order':{
   if(!id(command.orderId)||state.orders.some(x=>x.id===command.orderId)||!['Retrieval','Withdrawal','Refile','Receiving'].includes(command.operation))reject('Invalid or duplicate work order',400);
   if(!Array.isArray(command.barcodes)||!command.barcodes.length||command.barcodes.length>100||new Set(command.barcodes).size!==command.barcodes.length)reject('Select distinct records',400);
   const inbound=['Refile','Receiving'].includes(command.operation);
   const records=command.barcodes.map(barcode=>state.records.find(x=>x.barcode===barcode));
   if(records.some(x=>!x))reject('Record not found',404);
   if(records.some(x=>x.status!==(command.operation==='Receiving'?'Expected':inbound?'AtCustomer':'Stored')))reject('Records are unavailable for this operation');
   const created={id:command.orderId,customerId:state.customerId,operation:command.operation,direction:inbound?'inbound':'outbound',status:inbound?'receiving':'picking',version:0,items:records.map(x=>({barcode:x.barcode,status:'pending'})),courier:null,recipient:null};
   state.orders.push(created);for(const r of records)mutate(r,inbound?'Returning':'Reserved',r.location,r.custodian,'order_created');break;
  }
  case 'cancel_order':{
   requireOrder();if(!['picking','receiving'].includes(order.status)||order.items.some(x=>x.status!=='pending'))reject('Only unprocessed orders may be cancelled');
   for(const item of order.items){const r=state.records.find(x=>x.barcode===item.barcode);mutate(r,order.operation==='Receiving'?'Expected':order.direction==='inbound'?'AtCustomer':'Stored',r.location,r.custodian,'order_cancelled')}
   order.status='cancelled';order.version++;break;
  }
  case 'pick':{
   const item=itemFor();if(order.direction!=='outbound'||order.status!=='picking'||item.status!=='pending'||record.status!=='Reserved')reject('Record is not awaiting picking');
   mutate(record,'Picked',record.location,'warehouse','picked');item.status='picked';order.version++;break;
  }
  case 'receive':{
   const item=itemFor();if(order.direction!=='inbound'||order.status!=='receiving'||item.status!=='pending'||record.status!=='Returning')reject('Record is not awaiting receipt');
   mutate(record,'Received',location('receiving'),'warehouse','received');item.status='received';order.version++;break;
  }
  case 'stage':{
   const item=itemFor();const expected=order.direction==='outbound'?'picked':'received';
   if(!['picking','receiving'].includes(order.status)||item.status!==expected)reject('Record must be picked or received before staging');
   mutate(record,'Staged',location('staging'),'warehouse','staged');item.status='staged';order.version++;
   if(order.items.every(x=>x.status==='staged'))order.status='staged';break;
  }
  case 'dispatch':{
   requireOrder();if(order.direction!=='outbound'||order.status!=='staged'||!order.items.every(x=>x.status==='staged'))reject('All outbound items must be staged');
   if(!id(command.courier)||!command.courier.startsWith('demo-'))reject('Synthetic courier identifier required',400);
   for(const item of order.items){mutate(state.records.find(x=>x.barcode===item.barcode),'InTransit',null,command.courier,'courier_handoff');item.status='dispatched'}
   order.courier=command.courier;order.status='dispatched';order.version++;break;
  }
  case 'deliver':{
   requireOrder();if(order.direction!=='outbound'||order.status!=='dispatched')reject('Order must be dispatched first');
   if(!id(command.recipient)||!command.recipient.startsWith('demo-'))reject('Synthetic recipient identifier required',400);
   for(const item of order.items){mutate(state.records.find(x=>x.barcode===item.barcode),order.operation==='Withdrawal'?'Withdrawn':'AtCustomer',null,command.recipient,'delivery_handoff');item.status='delivered'}
   order.recipient=command.recipient;order.status='delivered';order.version++;break;
  }
  case 'refile':{
   const item=itemFor();if(order.direction!=='inbound'||!['staged','refiling'].includes(order.status)||item.status!=='staged')reject('Inbound item must be staged before refiling');
   mutate(record,'Stored',location('storage'),'warehouse','refiled');item.status='refiled';order.version++;order.status=order.items.every(x=>x.status==='refiled')?'closed':'refiling';break;
  }
  case 'move':requireRecord();if(record.status!=='Stored')reject('Only stored records may move between storage locations');mutate(record,'Stored',location('storage'),'warehouse','location_changed');break;
 }
 let previousHash=state.custody.at(-1)?.hash||'genesis';
 for(const event of events){event.previousHash=previousHash;event.hash=await hash(event,hashDigest);previousHash=event.hash;state.custody.push(event)}
 state.version++;state.receipts.push({clientEventId:command.clientEventId,fingerprint,actor});
 if(JSON.stringify(state).length>512000)reject('Synthetic workspace storage limit reached',409);
 return {state,status:'accepted'};
}
