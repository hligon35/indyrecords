import {can} from '../packages/security/permissions.js';
import {extendedOperations,runReportExports} from './operations-extended.js';
import {buildSampleDataset,DATASET_VERSION,sampleDriver} from '../packages/operations/sample.js';
import {PROVIDERS} from '../packages/operations/providers.js';
import {enqueueTask,listTasks,runTasks,controlTask} from './operations-tasks.js';
import {buildDocument,documentHtml,documentCsv,documentPdf} from '../packages/operations/documents.js';
import {seedCommercial} from '../packages/commercial/workflows.js';
import {seedField} from '../packages/field/workflows.js';
import {seedWarehouse} from '../packages/warehouse/workflows.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
export async function operationsRoute(request,env,principal,readBody){
 const url=new URL(request.url);
 if(!['localhost','127.0.0.1'].includes(url.hostname)||env.SYNTHETIC_OPERATIONS_ENABLED!=='true'||principal.id==='demo-api-user')return json({error:'Verified local synthetic operations required'},403);
 let body,customerId=url.searchParams.get('customerId');
 if(request.method==='POST'){try{body=await readBody(request,url.pathname==='/v1/operations/reconciliation'?131072:4096);customerId=body?.customerId}catch(e){return json({error:'Invalid operations payload'},e.status||400)}}
 if(!['c1','c2','c3','c4'].includes(customerId))return json({error:'Synthetic customer required'},400);
 if(!can(principal,request.method==='GET'?'operations:read':'operations:manage',{customerId}))return json({error:'Forbidden'},403);
 const DB=env.DB;
 try{
  if(request.method==='POST'&&!['/v1/operations/control','/v1/operations/exports/control','/v1/operations/monitor/acknowledge','/v1/operations/maintenance'].includes(url.pathname)){
   const profile=await DB.prepare('SELECT active FROM customer_profiles WHERE customer_id=?').bind(customerId).first();if(profile?.active===0)return json({error:'Customer profile archived'},409);
  }
  const extended=await extendedOperations(request,env,principal,customerId,body);if(extended)return extended;
  if(request.method==='GET'&&url.pathname==='/v1/operations/document'){
   if(!['SYNTHETIC_COMMERCIAL_ENABLED','SYNTHETIC_FIELD_ENABLED','SYNTHETIC_WORKFLOWS_ENABLED'].every(k=>env[k]==='true'))return json({error:'Document workspaces are disabled'},403);
   const type=url.searchParams.get('type'),id=url.searchParams.get('id')||'',format=url.searchParams.get('format')||'json';
   if(!['json','html','csv','pdf'].includes(format)||id.length>200)return json({error:'Invalid document format or reference'},400);
   const states=[];
   for(const [table,seed] of [['commercial_workspaces',seedCommercial],['field_workspaces',seedField],['sandbox_workspaces',seedWarehouse]]){const row=await DB.prepare(`SELECT payload FROM ${table} WHERE customer_id=?`).bind(customerId).first();states.push(row?JSON.parse(row.payload):seed(customerId))}
   const document=await buildDocument({commercial:states[0],field:states[1],warehouse:states[2]},type,id);
   if(format==='json')return json(document);
   let content,bytes,encoding='utf8';
   if(format==='pdf'){bytes=await documentPdf(document);let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);content=btoa(binary);encoding='base64'}
   else content=format==='html'?documentHtml(document):documentCsv(document);
   bytes??=new TextEncoder().encode(content);
   const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
   return json({synthetic:true,filename:'irm-sample-'+type+'.'+format,contentType:{pdf:'application/pdf',html:'text/html; charset=utf-8',csv:'text/csv; charset=utf-8'}[format],encoding,content,sha256});
  }
  if(request.method==='GET'&&url.pathname==='/v1/operations/status'){
   const dataset=await DB.prepare('SELECT dataset_version,manifest,installed_at FROM sample_datasets WHERE customer_id=?').bind(customerId).first();
   const counts=(await DB.prepare('SELECT status,COUNT(*) AS total FROM backend_tasks WHERE customer_id=? GROUP BY status').bind(customerId).all()).results||[];
   return json({synthetic:true,productionReady:false,providers:PROVIDERS,dataset:dataset?{...dataset,manifest:JSON.parse(dataset.manifest)}:null,taskCounts:counts});
  }
  if(request.method==='GET'&&url.pathname==='/v1/operations/sample')return json((await buildSampleDataset(customerId)).manifest);
  if(request.method==='GET'&&url.pathname==='/v1/operations/tasks'){
   const cursor=url.searchParams.get('cursor')||'';if(cursor.length>100||!/^[a-zA-Z0-9-]*$/.test(cursor))return json({error:'Invalid task cursor'},400);
   return json(await listTasks(DB,customerId,cursor));
  }
  if(request.method==='GET'&&url.pathname==='/v1/operations/history'){
   const id=url.searchParams.get('taskId'), task=await DB.prepare('SELECT id FROM backend_tasks WHERE id=? AND customer_id=?').bind(id,customerId).first();
   if(!task)return json({error:'Task not found'},404);
   const rows=(await DB.prepare('SELECT id,attempt,actor_id,outcome,detail,occurred_at FROM backend_task_history WHERE task_id=? ORDER BY occurred_at DESC,id DESC LIMIT 101').bind(id).all()).results||[];
   return json({items:rows.slice(0,100),limited:rows.length>100});
  }
  if(request.method!=='POST')return json({error:'Not found'},404);
  const profile=await DB.prepare('SELECT active FROM customer_profiles WHERE customer_id=?').bind(customerId).first();
  if(profile?.active===0&&url.pathname!=='/v1/operations/control')return json({error:'Customer profile archived'},409);
  if(url.pathname==='/v1/operations/sample'){
   if(body.datasetVersion!==DATASET_VERSION)return json({error:'Preview and confirm the current dataset version'},400);
   if(!['SYNTHETIC_COMMERCIAL_ENABLED','SYNTHETIC_FIELD_ENABLED','SYNTHETIC_WORKFLOWS_ENABLED'].every(k=>env[k]==='true'))return json({error:'Enable all local synthetic workspace flags before sample installation'},403);
   const existing=await DB.prepare('SELECT manifest FROM sample_datasets WHERE customer_id=?').bind(customerId).first();
   if(existing)return json({status:'already_installed',manifest:JSON.parse(existing.manifest)});
   for(const table of ['commercial_workspaces','field_workspaces','sandbox_workspaces'])if(await DB.prepare(`SELECT customer_id FROM ${table} WHERE customer_id=?`).bind(customerId).first())return json({error:'Sample installation requires empty workspaces; existing work is preserved'},409);
   const sample=await buildSampleDataset(customerId), driverId=sampleDriver(customerId);
   if(await DB.prepare('SELECT id FROM app_users WHERE id=?').bind(driverId).first())return json({error:'Sample driver identifier already exists; no account was changed'},409);
   try{await DB.batch([
    DB.prepare('INSERT INTO app_users(id,external_subject,display_name,role,active) VALUES(?,?,?,?,0)').bind(driverId,'synthetic:'+driverId,'Demo sample driver '+customerId,'warehouse'),
    DB.prepare('INSERT INTO user_customer_access(user_id,customer_id) VALUES(?,?)').bind(driverId,customerId),
    ...[['commercial_workspaces',sample.commercial],['field_workspaces',sample.field],['sandbox_workspaces',sample.warehouse]].map(([table,state])=>DB.prepare(`INSERT INTO ${table}(customer_id,version,payload) VALUES(?,?,?)`).bind(customerId,state.version,JSON.stringify(state))),
    DB.prepare('INSERT INTO sample_datasets(customer_id,dataset_version,manifest,installed_by) VALUES(?,?,?,?)').bind(customerId,DATASET_VERSION,JSON.stringify(sample.manifest),principal.id),
    DB.prepare('INSERT INTO access_audit(id,actor_id,action,resource_type,resource_id,decision) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),principal.id,'SAMPLE_INSTALL','synthetic_customer',customerId,'allow')
   ])}catch{return json({error:'Concurrent installation or storage failure; no partial installation committed'},409)}
   return json({status:'installed',manifest:sample.manifest},201);
  }
  if(url.pathname==='/v1/operations/tasks')return json(await enqueueTask(DB,customerId,principal.id,body.task),201);
  if(url.pathname==='/v1/operations/run'){const tasks=await runTasks(env,customerId,{limit:body.limit??5}),reports=await runReportExports(env,customerId,{limit:body.limit??5});return json({...tasks,reports})}
  if(url.pathname==='/v1/operations/control'){
   if(body.action==='retry'){
    const target=await DB.prepare('SELECT kind FROM backend_tasks WHERE id=? AND customer_id=?').bind(body.taskId,customerId).first();
    if(target&&env[['commercial_delivery','recurrence'].includes(target.kind)?'SYNTHETIC_COMMERCIAL_ENABLED':'SYNTHETIC_FIELD_ENABLED']!=='true')return json({error:'Source workspace is disabled'},403);
   }
   return json(await controlTask(DB,customerId,principal.id,body));
  }
  return json({error:'Not found'},404);
 }catch(e){return json({error:e.status?e.message:'Operations storage unavailable'},e.status||503)}
}
