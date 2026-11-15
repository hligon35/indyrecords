import {normalizeRecord} from './reconcile.js';
// Versioned fixture/export contracts, not undocumented vendor APIs.
export const CONTRACTS=Object.freeze({
 andrew:{version:'synthetic-andrew-v1',columns:['RecordID','Barcode','CustomerID','Customer','Location','Status','UpdatedAt']},
 qshred:{version:'synthetic-qshred-v1',columns:['ItemID','Barcode','AccountID','Account','StorageLocation','ItemStatus','ModifiedAt']}
});
export function parseCsv(text,{maxRows=500}={}){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>128*1024)throw Error('Export must be at most 128 KiB');
 text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],field='',quoted=false,closed=false;
 for(let i=0;i<=text.length;i++){
  const char=text[i];
  if(quoted){if(char===undefined)throw Error('Unclosed quoted CSV field');if(char==='"'){if(text[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}}else field+=char;if(field.length>1000)throw Error('CSV field exceeds 1,000 characters');continue}
  if(char==='"'){if(field||closed)throw Error('Invalid CSV quoting');quoted=true;continue}
  if(char===','||char==='\n'||char==='\r'||char===undefined){row.push(field);field='';closed=false;if(char!==','){if(char==='\r'&&text[i+1]==='\n')i++;if(row.some(x=>x!==''))rows.push(row);row=[];if(rows.length>maxRows+1)throw Error('Export exceeds '+maxRows+' rows')}continue}
  if(closed)throw Error('Unexpected data after closing quote');field+=char;if(field.length>1000)throw Error('CSV field exceeds 1,000 characters');
 }
 if(!rows.length)throw Error('CSV header required');const header=rows.shift();
 if(new Set(header).size!==header.length||header.some(x=>!x||x.length>100))throw Error('Distinct CSV headers required');
 return {header,rows:rows.map((values,index)=>{if(values.length!==header.length)throw Error('Column count mismatch at row '+(index+2));return Object.fromEntries(header.map((key,i)=>[key,values[i]]))})};
}
export async function stageExport({source,schemaVersion,csv,filename,sourceTimestamp,customerId}){
 const contract=CONTRACTS[source];if(!contract||contract.version!==schemaVersion)throw Error('Unsupported export contract/version');
 if(!['c1','c2','c3','c4'].includes(customerId))throw Error('Synthetic customer required');
 if(typeof filename!=='string'||!/^demo-[a-z0-9_.-]{1,90}\.csv$/i.test(filename))throw Error('Use a demo- CSV filename');
 const sourceTime=Date.parse(sourceTimestamp),now=Date.now();
 if(!Number.isFinite(sourceTime)||now-sourceTime>30*86400000||sourceTime-now>5*60000)throw Error('Source timestamp must be within the synthetic 30-day window and not in the future');
 const parsed=parseCsv(csv);if(parsed.header.length!==contract.columns.length||contract.columns.some(x=>!parsed.header.includes(x)))throw Error('Header does not match the selected synthetic contract');
 const accepted=[],rejected=[],ids=new Set();
 for(const [index,row] of parsed.rows.entries()){
  try{
   const mapped=source==='andrew'?{id:row.RecordID,barcode:row.Barcode,customerId:row.CustomerID,customer:row.Customer,location:row.Location,status:row.Status,updatedAt:row.UpdatedAt}:{id:row.ItemID,barcode:row.Barcode,customerId:row.AccountID,customer:row.Account,location:row.StorageLocation,status:row.ItemStatus,updatedAt:row.ModifiedAt};
   if(mapped.customerId!==customerId)throw Error('Row is outside the requested customer scope');
   if(!/^(IRM-(BX|FL)-10\d\d|DEMO-(BX|FL)-\d{4,10})$/.test(mapped.barcode))throw Error('Synthetic barcode required');
   if(!mapped.id||mapped.id.length>100||ids.has(mapped.id))throw Error('Missing or duplicate source-qualified identifier');
   if([mapped.customer,mapped.location,mapped.status].some(x=>x.length>100||/[\u0000-\u001f\u007f]/.test(x)))throw Error('Invalid text field');
   if(!Number.isFinite(Date.parse(mapped.updatedAt))||Date.parse(mapped.updatedAt)>sourceTime+5*60000)throw Error('Invalid or future row timestamp');
   ids.add(mapped.id);accepted.push({...normalizeRecord(mapped,source),customerId});
  }catch(error){rejected.push({row:index+2,reason:error.message})}
 }
 const sourceHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(csv)))].map(x=>x.toString(16).padStart(2,'0')).join('');
 return {synthetic:true,source,schemaVersion,filename,sourceTimestamp,sourceAgeHours:Math.max(0,(now-sourceTime)/3600000),warnings:now-sourceTime>86400000?['Export is over 24 hours old; review freshness before comparing']:[],customerId,sourceHash,accepted,rejected,total:parsed.rows.length};
}
