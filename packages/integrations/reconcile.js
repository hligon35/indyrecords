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
 const key=row=>(row.customerId===undefined?'':String(row.customerId)+':')+String(row.barcode??'').trim().toUpperCase();
 const group=rows=>{const map=new Map();for(const row of rows){const k=key(row);if(!map.has(k))map.set(k,[]);map.get(k).push(row)}return map};
 const sources=group(sourceRows),targets=group(comparisonRows),differences=[];let matched=0;
 for(const [id,rows] of sources){
  const source=rows[0],candidates=targets.get(id)||[];
  if(rows.length!==1||candidates.length>1){differences.push({barcode:source.barcode,customerId:source.customerId,kind:'ambiguous',sourceCount:rows.length,count:candidates.length});continue}
  if(!candidates.length){differences.push({barcode:source.barcode,customerId:source.customerId,kind:'missing',source});continue}
  const target=candidates[0],fields=['customer','location','status'].filter(field=>source[field]!==target[field]);
  if(fields.length)differences.push({barcode:source.barcode,customerId:source.customerId,kind:'mismatch',fields,source,target});else matched++;
 }
 for(const [id,rows] of targets)if(!sources.has(id))differences.push({barcode:rows[0].barcode,customerId:rows[0].customerId,kind:'target_only',count:rows.length});
 return {matched,differences,total:sourceRows.length,comparisonTotal:comparisonRows.length};
}
