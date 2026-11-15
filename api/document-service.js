import {buildDocument,documentHtml,documentCsv,documentPdf} from '../packages/operations/documents.js';
import {seedCommercial} from '../packages/commercial/workflows.js';
import {seedField} from '../packages/field/workflows.js';
import {seedWarehouse} from '../packages/warehouse/workflows.js';
import {digest} from './auth.js';
const fail=(m,status=400)=>{throw Object.assign(Error(m),{status})};
export async function renderDocument(env,customerId,{type,id='',format='json'}){
 if(!['SYNTHETIC_COMMERCIAL_ENABLED','SYNTHETIC_FIELD_ENABLED','SYNTHETIC_WORKFLOWS_ENABLED'].every(k=>env[k]==='true'))fail('Document workspaces are disabled',403);
 if(!['json','html','csv','pdf'].includes(format)||typeof id!=='string'||id.length>200)fail('Invalid document format or reference');
 const states=[];
 for(const [table,seed] of [['commercial_workspaces',seedCommercial],['field_workspaces',seedField],['sandbox_workspaces',seedWarehouse]]){const row=await env.DB.prepare(`SELECT payload FROM ${table} WHERE customer_id=?`).bind(customerId).first();states.push(row?JSON.parse(row.payload):seed(customerId))}
 const doc=await buildDocument({commercial:states[0],field:states[1],warehouse:states[2]},type,id);
 if(format==='json')return doc;
 let content,bytes,encoding='utf8';
 if(format==='pdf'){bytes=await documentPdf(doc);let binary='';for(const b of bytes)binary+=String.fromCharCode(b);content=btoa(binary);encoding='base64'}else content=format==='html'?documentHtml(doc):documentCsv(doc);
 bytes??=new TextEncoder().encode(content);
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 return {synthetic:true,filename:'irm-sample-'+type+'.'+format,contentType:{pdf:'application/pdf',html:'text/html; charset=utf-8',csv:'text/csv; charset=utf-8'}[format],encoding,content,sha256};
}
export async function archiveDocument(env,p,customerId,x,now=Date.now()){
 if(!x||!/^demo-[A-Za-z0-9-]{1,80}$/.test(x.requestKey)||!['pdf','html','csv'].includes(x.format))fail('Request key and PDF/HTML/CSV format required');
 const DB=env.DB,fingerprint=await digest(JSON.stringify({type:x.type,id:x.id||'',format:x.format,actor:p.id}));
 const old=await DB.prepare('SELECT * FROM document_archive WHERE customer_id=? AND request_key=?').bind(customerId,x.requestKey).first();
 if(old){if(old.fingerprint!==fingerprint)fail('Archive key reused with different content',409);return {status:'already_accepted',id:old.id,sha256:old.sha256}}
 if((await DB.prepare('SELECT COUNT(*) AS n FROM document_archive WHERE customer_id=?').bind(customerId).first()).n>=1000)fail('Synthetic document archive limit reached',413);
 const file=await renderDocument(env,customerId,x);if(new TextEncoder().encode(file.content).length>1500000)fail('Archived document exceeds 1.5 MiB',413);
 const id=crypto.randomUUID();
 await DB.batch([
  DB.prepare('INSERT INTO document_archive(id,customer_id,created_by,request_key,document_type,source_id,format,content_type,encoding,content,sha256,created_at,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,customerId,p.id,x.requestKey,x.type,x.id||'',x.format,file.contentType,file.encoding,file.content,file.sha256,now,fingerprint),
  DB.prepare('INSERT INTO access_audit(id,actor_id,action,resource_type,resource_id,decision) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),p.id,'DOCUMENT_ARCHIVE','document',id,'allow')
 ]);return {status:'accepted',id,sha256:file.sha256};
}
export async function readArchive(DB,customerId,id){
 const row=await DB.prepare('SELECT id,document_type,source_id,format,content_type,encoding,content,sha256,created_at FROM document_archive WHERE customer_id=? AND id=?').bind(customerId,id).first();if(!row)fail('Archived document not found',404);
 return {...row,contentType:row.content_type,filename:'irm-archived-sample-'+row.document_type+'.'+row.format,synthetic:true};
}
export async function listArchive(DB,customerId,cursor=''){
 const rows=(await DB.prepare('SELECT id,document_type,source_id,format,sha256,created_at FROM document_archive WHERE customer_id=? AND id>? ORDER BY id LIMIT 51').bind(customerId,cursor).all()).results||[];
 return {items:rows.slice(0,50),nextCursor:rows.length>50?rows[49].id:null};
}
