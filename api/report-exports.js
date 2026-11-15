import {loadPrincipal,digest} from './auth.js';
import {can} from '../packages/security/permissions.js';
import {csvCell} from '../packages/reports/report.js';
const fail=(m,status=409)=>{throw Object.assign(Error(m),{status})};
// Static SQL maps only: callers cannot supply SQL, columns, source rows or scope.
export const EXPORTS={
 inventory:{columns:['id','barcode','kind','status','location'],flag:null,sql:"SELECT json_object('id',r.id,'barcode',r.barcode,'kind',r.kind,'status',r.status,'location',l.label) AS payload FROM records r LEFT JOIN locations l ON l.id=r.location_id WHERE r.customer_id=? ORDER BY r.id"},
 warehouse:{columns:['barcode','kind','status','location','custodian'],flag:'SYNTHETIC_WORKFLOWS_ENABLED',table:'sandbox_workspaces',path:'$.records'},
 custody:{columns:['id','barcode','orderId','action','actor','occurredAt','from','to','previousHash','hash'],flag:'SYNTHETIC_WORKFLOWS_ENABLED',table:'sandbox_workspaces',path:'$.custody'},
 invoices:{columns:['id','accountId','status','from','to','due','totalCents','billTo','lines','credits'],flag:'SYNTHETIC_COMMERCIAL_ENABLED',table:'commercial_workspaces',path:'$.invoices'},
 payments:{columns:['id','invoiceId','amountCents','status','refundedCents','refunds'],flag:'SYNTHETIC_COMMERCIAL_ENABLED',table:'commercial_workspaces',path:'$.payments'},
 field:{columns:['id','accountId','commercialJobId','name','address','date','status','driverId','production','bins'],flag:'SYNTHETIC_FIELD_ENABLED',table:'field_workspaces',path:'$.jobs'},
 field_custody:{columns:['id','jobId','action','actor','at','data','previousHash','hash'],flag:'SYNTHETIC_FIELD_ENABLED',table:'field_workspaces',path:'$.custody'}
};
const audit=(DB,actor,action,id)=>DB.prepare('INSERT INTO access_audit(id,actor_id,action,resource_type,resource_id,decision) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),actor,action,'report_export',id,'allow');
export async function createReportExport(env,p,customerId,x,now=Date.now()){
 const spec=EXPORTS[x?.kind];if(!spec||!/^demo-[a-zA-Z0-9-]{1,80}$/.test(x.requestKey||''))fail('Export kind and synthetic request key required',400);
 if(spec.flag&&env[spec.flag]!=='true')fail('Source workspace is disabled',403);
 const DB=env.DB, fingerprint=await digest(JSON.stringify({kind:x.kind,actor:p.id}));
 const old=await DB.prepare('SELECT * FROM report_exports WHERE customer_id=? AND request_key=?').bind(customerId,x.requestKey).first();
 if(old){if(old.fingerprint!==fingerprint)fail('Request key reused with different actor or kind');return {status:'already_accepted',export:visible(old)}}
 if((await DB.prepare('SELECT COUNT(*) AS n FROM report_exports WHERE customer_id=?').bind(customerId).first()).n>=100)fail('Archive or remove completed export fixtures before creating more',413);
 const id=crypto.randomUUID();
 const select=spec.sql||`SELECT j.value AS payload FROM ${spec.table} w,json_each(w.payload,'${spec.path}') j WHERE w.customer_id=? ORDER BY CAST(j.key AS INTEGER)`;
 try{await DB.batch([
  DB.prepare('INSERT INTO report_exports(id,customer_id,created_by,request_key,kind,fingerprint,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,customerId,p.id,x.requestKey,x.kind,fingerprint,'pending',now,now),
  DB.prepare(`INSERT INTO report_export_rows(export_id,row_number,payload) SELECT ?,ROW_NUMBER() OVER ()-1,payload FROM (${select})`).bind(id,customerId),
  DB.prepare('UPDATE report_exports SET row_count=(SELECT COUNT(*) FROM report_export_rows WHERE export_id=?) WHERE id=?').bind(id,id),
  audit(DB,p.id,'REPORT_EXPORT_CREATE',id)
 ])}catch(e){const replay=await DB.prepare('SELECT * FROM report_exports WHERE customer_id=? AND request_key=?').bind(customerId,x.requestKey).first();if(replay?.fingerprint===fingerprint)return {status:'already_accepted',export:visible(replay)};if(/CHECK constraint failed.*row_count/is.test(e.message))fail('Snapshot exceeds 100,000 rows',413);fail('Atomic snapshot storage unavailable; retry unchanged',503)}
 return {status:'accepted',export:visible(await DB.prepare('SELECT * FROM report_exports WHERE id=?').bind(id).first())};
}
function visible(row){const {fingerprint,lease_token,...v}=row;return {...v,synthetic:true}}
export async function listReportExports(DB,customerId,cursor=''){
 const rows=(await DB.prepare('SELECT * FROM report_exports WHERE customer_id=? AND id>? ORDER BY id LIMIT 51').bind(customerId,cursor).all()).results||[];
 return {items:rows.slice(0,50).map(visible),nextCursor:rows.length>50?rows[49].id:null,kinds:Object.keys(EXPORTS)};
}
export async function runReportExports(env,customerId,{limit=5,now=Date.now()}={}){
 if(env.SYNTHETIC_OPERATIONS_ENABLED!=='true')return {processed:0,disabled:true};
 if(!Number.isInteger(limit)||limit<1||limit>10)fail('Export processing limit must be 1 to 10',400);
 const DB=env.DB,rows=(await DB.prepare("SELECT id FROM report_exports WHERE customer_id=? AND (status='pending' OR (status='running' AND lease_until<=?)) ORDER BY updated_at,id LIMIT ?").bind(customerId,now,limit).all()).results||[],results=[];
 for(const item of rows){
  const token=crypto.randomUUID(),claimed=await DB.prepare("UPDATE report_exports SET status='running',lease_token=?,lease_until=?,version=version+1 WHERE id=? AND customer_id=? AND (status='pending' OR (status='running' AND lease_until<=?))").bind(token,now+60000,item.id,customerId,now).run();if(claimed.meta?.changes!==1)continue;
  const job=await DB.prepare('SELECT * FROM report_exports WHERE id=? AND lease_token=?').bind(item.id,token).first(),owner=await loadPrincipal(DB,job.created_by,{byId:true}),spec=EXPORTS[job.kind];
  const profile=await DB.prepare('SELECT active FROM customer_profiles WHERE customer_id=?').bind(customerId).first();
  if(!can(owner,'operations:manage',{customerId})||profile?.active===0||(spec.flag&&env[spec.flag]!=='true')){
   await DB.batch([DB.prepare("UPDATE report_exports SET status='blocked',lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND lease_token=?").bind(now,job.id,token),audit(DB,job.created_by,'REPORT_EXPORT_BLOCKED',job.id)]);results.push({id:job.id,status:'blocked'});continue;
  }
  const chunk=(await DB.prepare('SELECT row_number,payload FROM report_export_rows WHERE export_id=? AND row_number>=? ORDER BY row_number LIMIT 200').bind(job.id,job.offset).all()).results||[];
  const next=job.offset+chunk.length,status=next>=job.row_count?'complete':'pending';
  try{
   const rendered=chunk.map(r=>{const row=JSON.parse(r.payload);return {number:r.row_number,line:spec.columns.map(k=>csvCell(typeof row[k]==='object'?JSON.stringify(row[k]):row[k]??'')).join(',')+'\r\n'}});
   const encoded=JSON.stringify(rendered);
   const changes=await DB.batch([
    DB.prepare("UPDATE report_export_rows SET rendered=(SELECT json_extract(j.value,'$.line') FROM json_each(?) j WHERE json_extract(j.value,'$.number')=row_number) WHERE export_id=? AND row_number>=? AND row_number<? AND EXISTS(SELECT 1 FROM report_exports WHERE id=? AND lease_token=? AND offset=?)").bind(encoded,job.id,job.offset,next,job.id,token,job.offset),
    DB.prepare('UPDATE report_exports SET offset=?,status=?,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND lease_token=? AND offset=?').bind(next,status,now,job.id,token,job.offset),audit(DB,owner.id,'REPORT_EXPORT_CHUNK',job.id)
   ]);
   results.push({id:job.id,status:changes[1].meta?.changes===1?status:'lease-changed',offset:next});
  }catch{results.push({id:job.id,status:'recoverable'})}
 }
 return {processed:results.length,results};
}
export async function exportChunk(env,p,customerId,id,offset=0,limit=1000){
 if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>1000)fail('Invalid export page',400);
 const DB=env.DB,job=await DB.prepare('SELECT * FROM report_exports WHERE id=? AND customer_id=?').bind(id,customerId).first();if(!job)fail('Export not found',404);
 if(job.status!=='complete')fail('Export is not complete');
 const spec=EXPORTS[job.kind];if(spec.flag&&env[spec.flag]!=='true')fail('Source workspace is disabled',403);
 const rows=(await DB.prepare('SELECT rendered FROM report_export_rows WHERE export_id=? AND row_number>=? ORDER BY row_number LIMIT ?').bind(id,offset,limit).all()).results||[];
 const content=(offset===0?'\uFEFF'+spec.columns.map(csvCell).join(',')+'\r\n':'')+rows.map(r=>r.rendered).join('');
 return {filename:'irm-sample-'+job.kind+'.csv',contentType:'text/csv; charset=utf-8',content,sha256:await digest(content),offset,rowCount:job.row_count,nextOffset:offset+rows.length<job.row_count?offset+rows.length:null};
}
export async function controlReportExport(DB,p,customerId,x,now=Date.now()){
 if(!x||!['resume','cancel','delete'].includes(x.action)||!Number.isInteger(x.expectedVersion)||typeof x.reason!=='string'||!x.reason.trim()||x.reason.length>200)fail('Action, version and reason required',400);
 const job=await DB.prepare('SELECT * FROM report_exports WHERE id=? AND customer_id=?').bind(x.exportId,customerId).first();if(!job)fail('Export not found',404);
 if(job.version!==x.expectedVersion||job.status==='running')fail('Export changed or is running');
 if(x.action==='cancel'&&!['pending','blocked'].includes(job.status))fail('Only queued or blocked exports can be cancelled');
 if(x.action==='resume'&&(job.status!=='blocked'||job.created_by!==p.id))fail('Only the original owner can resume blocked work',403);
 if(x.action==='delete'&&!['complete','cancelled'].includes(job.status))fail('Cancel or complete export before deleting it');
 const query=x.action==='delete'?DB.prepare('DELETE FROM report_exports WHERE id=? AND version=?').bind(job.id,job.version):DB.prepare('UPDATE report_exports SET status=?,review_reason=?,reviewed_by=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(x.action==='resume'?'pending':'cancelled',x.reason,p.id,now,job.id,job.version);
 const r=await DB.batch([query,audit(DB,p.id,'REPORT_EXPORT_'+x.action.toUpperCase(),job.id)]);if(r[0].meta?.changes!==1)fail('Export changed');return {status:x.action,reason:x.reason};
}
