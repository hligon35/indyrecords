/**
 * Read-only reconciliation primitives for synthetic or explicitly authorized exports.
 * This module never writes to a vendor system.
 */
export function normalizeRecord(row,source){
 if(!['andrew','qshred'].includes(source))throw Error('Unsupported source');
 if(!row||typeof row!=='object')throw Error('Invalid record');
 const barcode=String(row.barcode??'').trim().toUpperCase();
 if(!/^[A-Z0-9-]{1,100}$/.test(barcode))throw Error('Invalid barcode');
 return {
  source,
  sourceId:String(row.id??barcode).trim(),
  barcode,
  customer:String(row.customer??'').trim(),
  location:String(row.location??'').trim(),
  status:String(row.status??'').trim(),
  updatedAt:row.updatedAt?String(row.updatedAt):null
 };
}
export function reconcileRecords(sourceRows,comparisonRows){
 const byBarcode=new Map();
 for(const row of comparisonRows){
  const barcode=String(row.barcode??'').trim().toUpperCase();
  if(!byBarcode.has(barcode))byBarcode.set(barcode,[]);
  byBarcode.get(barcode).push(row);
 }
 const differences=[];
 let matched=0;
 for(const source of sourceRows){
  const candidates=byBarcode.get(source.barcode)||[];
  if(candidates.length===0){differences.push({barcode:source.barcode,kind:'missing',source});continue}
  if(candidates.length!==1){differences.push({barcode:source.barcode,kind:'ambiguous',count:candidates.length});continue}
  const target=candidates[0];
  const fields=['customer','location','status'].filter(key=>source[key]!==target[key]);
  if(fields.length)differences.push({barcode:source.barcode,kind:'mismatch',fields,source,target});
  else matched++;
 }
 return {matched,differences,total:sourceRows.length};
}
