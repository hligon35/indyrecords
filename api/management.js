import {can} from '../packages/security/permissions.js';
import {DEMO_CUSTOMERS,defaultProfile,validateCustomerProfile} from '../packages/management/customers.js';
import {seedWarehouse} from '../packages/warehouse/workflows.js';
import {buildReport,reportCsv,reportFilters} from '../packages/reports/report.js';
import {reportPdf} from '../packages/reports/pdf.js';
import {stageExport} from '../packages/integrations/adapters.js';
import {reconcileRecords} from '../packages/integrations/reconcile.js';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const local=request=>['localhost','127.0.0.1'].includes(new URL(request.url).hostname);
async function profile(DB,customer){const row=await DB.prepare('SELECT * FROM customer_profiles WHERE customer_id=?').bind(customer.id).first();return row?{customerId:row.customer_id,displayName:row.display_name,contactAlias:row.contact_alias,active:row.active===1,version:row.version}:defaultProfile(customer)}
export async function reportData(env,principal,source,customerId,filters={}){
 if(!can(principal,'reports:read',{customerId}))throw Object.assign(Error('Forbidden'),{status:403});
 if(source==='inventory'){
  const clauses=[],args=[customerId,principal.id];
  for(const [key,column] of [['kind','r.kind'],['status','r.status'],['location','l.label']])if(filters[key]){clauses.push(column+'=?');args.push(filters[key])}
  for(const [key,operator] of [['from','>='],['to','<=']])if(filters[key]){clauses.push('date(r.created_at)'+operator+'?');args.push(filters[key])}
  if(filters.q){const pattern='%'+filters.q.replace(/[\\%_]/g,'\\$&')+'%';clauses.push("(r.barcode LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR l.label LIKE ? ESCAPE '\\' OR r.status LIKE ? ESCAPE '\\' OR r.kind LIKE ? ESCAPE '\\')");args.push(pattern,pattern,pattern,pattern,pattern)}
  const result=await env.DB.prepare(`SELECT r.barcode,r.kind,r.status,r.customer_id AS customerId,c.name AS customer,l.label AS location,r.created_at AS createdAt FROM records r JOIN customers c ON c.id=r.customer_id LEFT JOIN locations l ON l.id=r.location_id WHERE r.customer_id=? AND EXISTS(SELECT 1 FROM user_customer_access a WHERE a.customer_id=r.customer_id AND a.user_id=?) ${clauses.length?'AND '+clauses.join(' AND '):''} ORDER BY r.id LIMIT 1001`).bind(...args).all();
  return {records:result.results||[],orders:[],custody:[]};
 }
 if(source!=='synthetic')throw Object.assign(Error('Invalid report source'),{status:400});
 if(!DEMO_CUSTOMERS.some(x=>x.id===customerId))throw Object.assign(Error('Synthetic customer required'),{status:400});
 const row=await env.DB.prepare('SELECT payload FROM sandbox_workspaces WHERE customer_id=?').bind(customerId).first();const state=row?JSON.parse(row.payload):seedWarehouse(customerId);
 const customer=DEMO_CUSTOMERS.find(x=>x.id===customerId).name;
 return {...state,records:state.records.map(x=>({...x,customer,updatedAt:state.custody.filter(e=>e.barcode===x.barcode).at(-1)?.occurredAt||''}))};
}
export async function managementRoute(request,env,principal,readBody){
 if(principal.id==='demo-api-user')return json({error:'Verified user session required'},403);
 const url=new URL(request.url),path=url.pathname;
 if(request.method==='POST'&&(!local(request)||env.SYNTHETIC_MANAGEMENT_ENABLED!=='true'))return json({error:'Management writes require the local synthetic sandbox'},403);
 if(path==='/v1/management/customers'&&request.method==='GET'){
  const permitted=DEMO_CUSTOMERS.filter(x=>can(principal,'customers:manage',{customerId:x.id}));if(!permitted.length)return json({error:'Forbidden'},403);
  return json({items:await Promise.all(permitted.map(x=>profile(env.DB,x)))});
 }
 if(path==='/v1/management/customers'&&request.method==='POST'){
  let input;try{input=validateCustomerProfile(await readBody(request))}catch(error){return json({error:error.message},400)}
  if(!can(principal,'customers:manage',{customerId:input.customerId}))return json({error:'Forbidden'},403);
  const customer=DEMO_CUSTOMERS.find(x=>x.id===input.customerId);
  await env.DB.prepare('INSERT OR IGNORE INTO customer_profiles(customer_id,display_name) VALUES(?,?)').bind(customer.id,customer.name).run();
  const result=await env.DB.prepare('UPDATE customer_profiles SET display_name=?,contact_alias=?,active=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE customer_id=? AND version=?').bind(input.displayName,input.contactAlias,input.active?1:0,input.customerId,input.expectedVersion).run();
  return result.meta?.changes===1?json(await profile(env.DB,customer)):json({error:'Customer changed; refresh before saving'},409);
 }
 if(path==='/v1/management/report'&&request.method==='GET'){
  const customerId=url.searchParams.get('customerId')||'',source=url.searchParams.get('source')||'synthetic',type=url.searchParams.get('type')||'inventory',format=url.searchParams.get('format')||'json';
  if(!can(principal,'reports:read',{customerId}))return json({error:'Forbidden'},403);
  if((type==='orders'&&!can(principal,'orders:read',{customerId}))||(type==='custody'&&!can(principal,'audit:read',{customerId})))return json({error:'Forbidden'},403);
  if(source==='synthetic'&&!local(request))return json({error:'Synthetic workspaces are local-only'},403);
  if(!['json','csv','pdf'].includes(format))return json({error:'Invalid report format'},400);
  let report;try{const filters=reportFilters(Object.fromEntries(url.searchParams));report=buildReport(await reportData(env,principal,source,customerId,filters),{type,filters,customerIds:[customerId],source})}catch(error){return json({error:error.message},error.status||400)}
  if(format==='json')return json(report);
  const headers={'content-type':format==='csv'?'text/csv; charset=utf-8':'application/pdf','cache-control':'no-store','content-disposition':'attachment; filename="irm-rms-'+type+'.'+format+'"','x-content-type-options':'nosniff'};
  return new Response(format==='csv'?reportCsv(report):await reportPdf(report),{headers});
 }
 if(path==='/v1/management/integrations'&&request.method==='GET'){
  const customerId=url.searchParams.get('customerId');if(!local(request)||!can(principal,'integrations:read',{customerId}))return json({error:'Forbidden'},403);
  const jobs=await env.DB.prepare('SELECT id,source,schema_version,filename,source_hash,source_timestamp,accepted_count,rejected_count,created_at FROM integration_jobs WHERE customer_id=? ORDER BY created_at DESC,id LIMIT 50').bind(customerId).all();return json({items:jobs.results||[]});
 }
 if(path.startsWith('/v1/management/integrations/')&&request.method==='GET'){
  const customerId=url.searchParams.get('customerId'),id=path.slice('/v1/management/integrations/'.length);
  if(!local(request)||!can(principal,'integrations:read',{customerId}))return json({error:'Forbidden'},403);
  if(!/^[a-f0-9-]{36}$/.test(id))return json({error:'Invalid job identifier'},400);
  const row=await env.DB.prepare('SELECT result FROM integration_jobs WHERE id=? AND customer_id=?').bind(id,customerId).first();return row?json(JSON.parse(row.result)):json({error:'Job not found'},404);
 }
 if(path==='/v1/management/integrations'&&request.method==='POST'){
  let input;try{input=await readBody(request,300000)}catch{return json({error:'Invalid export payload'},400)}
  if(!can(principal,'integrations:stage',{customerId:input?.customerId}))return json({error:'Forbidden'},403);
  let staged;try{staged=await stageExport(input)}catch(error){return json({error:error.message},400)}
  const target=await reportData(env,principal,'inventory',input.customerId);if(target.records.length>1000)return json({error:'Comparison exceeds the 1,000-row synthetic limit'},413);const reconciliation=reconcileRecords(staged.accepted,target.records);
  const id=crypto.randomUUID();const result={...staged,reconciliation,id};
  await env.DB.prepare('INSERT INTO integration_jobs(id,actor_id,customer_id,source,schema_version,filename,source_hash,source_timestamp,accepted_count,rejected_count,result) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,principal.id,input.customerId,input.source,input.schemaVersion,input.filename,staged.sourceHash,input.sourceTimestamp,staged.accepted.length,staged.rejected.length,JSON.stringify(result)).run();
  return json(result,201);
 }
 return json({error:'Not found'},404);
}
