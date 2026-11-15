import {createReportExport,listReportExports,runReportExports,exportChunk,controlReportExport} from './report-exports.js';
import {archiveDocument,listArchive,readArchive} from './document-service.js';
import {reconcileFinance,listReconciliations,reviewReconciliation} from './finance-reconciliation.js';
import {monitoring,refreshAlerts,acknowledgeAlert,maintainOperations} from './operations-monitor.js';
import {entitySearch} from './entity-search.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
export async function extendedOperations(request,env,p,customerId,body){
 const url=new URL(request.url),path=url.pathname,DB=env.DB,cursor=url.searchParams.get('cursor')||'';
 if(path!=='/v1/operations/entities'&&(cursor.length>100||!/^[A-Za-z0-9-]*$/.test(cursor)))return json({error:'Invalid pagination cursor'},400);
 if(request.method==='GET'){
  if(path==='/v1/operations/entities')return json(await entitySearch(env,customerId,url.searchParams));
  if(path==='/v1/operations/exports')return json(await listReportExports(DB,customerId,cursor));
  if(path==='/v1/operations/exports/chunk')return json(await exportChunk(env,p,customerId,url.searchParams.get('exportId'),Number(url.searchParams.get('offset')||0),Number(url.searchParams.get('limit')||1000)));
  if(path==='/v1/operations/archive')return json(url.searchParams.has('documentId')?await readArchive(DB,customerId,url.searchParams.get('documentId')):await listArchive(DB,customerId,cursor));
  if(path==='/v1/operations/reconciliation')return json(await listReconciliations(DB,customerId,cursor));
  if(path==='/v1/operations/monitor')return json(await monitoring(DB,customerId));
 }
 if(request.method==='POST'){
  if(path==='/v1/operations/exports')return json(await createReportExport(env,p,customerId,body),201);
  if(path==='/v1/operations/exports/control')return json(await controlReportExport(DB,p,customerId,body));
  if(path==='/v1/operations/archive')return json(await archiveDocument(env,p,customerId,body),201);
  if(path.startsWith('/v1/operations/reconciliation')){
   if(env.SYNTHETIC_COMMERCIAL_ENABLED!=='true')return json({error:'Commercial workspace is disabled'},403);
   if(path==='/v1/operations/reconciliation')return json(await reconcileFinance(DB,p,customerId,body),201);
   if(path==='/v1/operations/reconciliation/review')return json(await reviewReconciliation(DB,p,customerId,body));
  }
  if(path==='/v1/operations/monitor')return json(await refreshAlerts(DB,customerId));
  if(path==='/v1/operations/monitor/acknowledge')return json(await acknowledgeAlert(DB,p,customerId,body));
  if(path==='/v1/operations/maintenance')return json(await maintainOperations(DB,p,customerId,body));
 }
 return null;
}
export {runReportExports};
