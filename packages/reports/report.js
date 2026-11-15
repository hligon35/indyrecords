const TYPES=new Set(['inventory','orders','custody']);
export function reportFilters(input={}){
 const filters={};
 for(const key of ['q','kind','status','location','from','to']){
  const value=String(input[key]??'').trim();if(value.length>100||/[\u0000-\u001f\u007f]/.test(value))throw Error('Invalid '+key+' filter');filters[key]=value;
 }
 if(filters.kind&&!['Box','File'].includes(filters.kind))throw Error('Invalid record kind');
 for(const key of ['from','to'])if(filters[key]&&(!/^\d{4}-\d{2}-\d{2}$/.test(filters[key])||!Number.isFinite(Date.parse(filters[key]))||new Date(filters[key]).toISOString().slice(0,10)!==filters[key]))throw Error('Invalid UTC date filter');
 if(filters.from&&filters.to&&filters.from>filters.to)throw Error('Start date must precede end date');
 return filters;
}
export function buildReport({records=[],orders=[],custody=[]},{type='inventory',filters={},customerIds=[],source='synthetic',generatedAt=new Date().toISOString()}={}){
 if(!TYPES.has(type))throw Error('Invalid report type');
 filters=reportFilters(filters);const scopes=new Set(customerIds);
 if(type==='orders'&&(filters.kind||filters.location))throw Error('Kind/location filters apply to inventory and custody reports');
 if(records.length>1000)throw Error('Report source exceeds 1,000 rows; narrow the server-side filters');
 const permitted=records.filter(x=>scopes.has(x.customerId));
 const byBarcode=new Map(permitted.map(x=>[x.customerId+':'+x.barcode,x]));
 function matches(row){
  const q=filters.q.toLowerCase();const time=row.occurredAt||row.updatedAt||row.createdAt||'';
  return (!q||Object.values(row).some(x=>typeof x==='string'&&x.toLowerCase().includes(q)))&&(!filters.kind||row.kind===filters.kind)&&(!filters.status||row.status===filters.status)&&(!filters.location||row.location===filters.location)&&(!filters.from||(time&&time.slice(0,10)>=filters.from))&&(!filters.to||(time&&time.slice(0,10)<=filters.to));
 }
 let rows,columns;
 if(type==='inventory'){
  columns=[['barcode','Barcode'],['kind','Kind'],['customer','Customer'],['status','Status'],['location','Location'],['custodian','Custodian']];
  rows=permitted.filter(matches).map(x=>Object.fromEntries(columns.map(([key])=>[key,x[key]??''])));
 }else if(type==='orders'){
  columns=[['id','Work order'],['customerId','Customer'],['operation','Operation'],['status','Status'],['items','Items'],['courier','Courier']];
  rows=orders.filter(x=>scopes.has(x.customerId)).map(x=>({...x,items:x.items.map(i=>i.barcode).join('; '),createdAt:custody.find(e=>e.customerId===x.customerId&&e.orderId===x.id)?.occurredAt||''})).filter(matches).map(x=>Object.fromEntries(columns.map(([key])=>[key,x[key]??''])));
 }else{
  columns=[['occurredAt','Time (UTC)'],['barcode','Barcode'],['customerId','Customer'],['action','Action'],['from','From'],['to','To'],['actor','Actor']];
  rows=custody.filter(x=>scopes.has(x.customerId)&&byBarcode.has(x.customerId+':'+x.barcode)).map(x=>({...x,kind:byBarcode.get(x.customerId+':'+x.barcode).kind,status:x.to.status,location:x.to.location,from:[x.from.status,x.from.location,x.from.custodian].filter(Boolean).join(' / '),to:[x.to.status,x.to.location,x.to.custodian].filter(Boolean).join(' / ')})).filter(matches).map(x=>Object.fromEntries(columns.map(([key])=>[key,x[key]??''])));
 }
 if(rows.length>1000)throw Error('Report exceeds 1,000 rows; narrow the filters');
 const group=(items,key)=>Object.fromEntries([...new Set(items.map(x=>x[key]||'Unknown'))].sort().map(value=>[value,items.filter(x=>(x[key]||'Unknown')===value).length]));
 return {schemaVersion:1,synthetic:source==='synthetic',source,type,generatedAt,customerIds:[...scopes],filters,columns,rows,summary:{rows:rows.length,inventory:permitted.length,byStatus:group(permitted,'status'),byKind:group(permitted,'kind'),orders:orders.filter(x=>scopes.has(x.customerId)).length,custodyEvents:custody.filter(x=>scopes.has(x.customerId)).length}};
}
export function csvCell(value){let text=String(value??'');if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"'}
export function reportCsv(report){return '\uFEFF'+[report.columns.map(([,label])=>label),...report.rows.map(row=>report.columns.map(([key])=>row[key]))].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n'}
