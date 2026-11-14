// Keyboard-wedge (DataWedge keystroke output + Enter) and demo sync only.
export const SYNTHETIC_INVENTORY=Object.freeze([
 {barcode:'IRM-BX-1002',type:'Box',location:'A01-R02'},
 {barcode:'IRM-FL-1001',type:'File',location:'A01-R01'},
 {barcode:'IRM-BX-1003',type:'Box',location:'A02-R01'}
]);
export function normalizeScannerInput(value){
 if(typeof value!=='string')throw Error('Invalid barcode');
 const barcode=value.trim().toUpperCase();
 if(!/^[A-Z0-9][A-Z0-9-]{0,99}$/.test(barcode))throw Error('Invalid barcode');
 return barcode;
}
export function validateSyntheticScan(event){
 const barcode=normalizeScannerInput(event.barcode);
 const record=SYNTHETIC_INVENTORY.find(x=>x.barcode===barcode);
 if(!record)throw Error('Barcode not found in synthetic inventory');
 const allowed=event.mode==='inbound'?['Box Refile','File Refile']:event.mode==='outbound'?['Box Retrieval','Box Withdrawal','File Retrieval','File Withdrawal']:[];
 if(!allowed.includes(event.operation)||!event.operation.startsWith(record.type))throw Error('Operation does not match synthetic record');
 if(typeof event.clientEventId!=='string'||!event.clientEventId||!Number.isFinite(Date.parse(event.occurredAt)))throw Error('Invalid event');
 return {...event,barcode};
}
