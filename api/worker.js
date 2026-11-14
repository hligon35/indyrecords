import {authRateLimit} from './security.js';
import {managementRoute} from './management.js';
import {loginRoute} from './login.js';
import {warehouseRoute} from './warehouse.js';
import {authenticate,verifyIdentity,digest} from './auth.js';
import {can} from '../packages/security/permissions.js';
// Standalone demo API. Do not deploy publicly with mutation access.
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
const fail=(message,status)=>json({error:message},status);
const allowedOperations=new Set(['Box Retrieval','Box Withdrawal','Box Destruction','File Retrieval','File Withdrawal','File Destruction','Box Refile','Staged Files','File Refile']);
const MAX_SEARCH=100;
const INBOUND_OPERATIONS=new Set(['Box Refile','Staged Files','File Refile']);
const OUTBOUND_OPERATIONS=new Set(['Box Retrieval','Box Withdrawal','Box Destruction','File Retrieval','File Withdrawal','File Destruction']);
async function scanBody(request,maxBytes=4096){
 const reader=request.body?.getReader();if(!reader)throw Error('Invalid JSON');
 const chunks=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxBytes){await reader.cancel();const error=new Error('Scan payload too large');error.status=413;throw error}chunks.push(value)}}finally{reader.releaseLock()}
 const buffer=new Uint8Array(length);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length}
 return JSON.parse(new TextDecoder().decode(buffer));
}
async function routes(request,env,principal,localDemo){
  if(!env.DB)return fail('Database binding unavailable',503);
  const url=new URL(request.url);
  const path=url.pathname;
  if(path==='/health'&&request.method==='GET')return json({status:'ok',service:'irm-rms-demo-api'});
  if(path==='/v1/session'&&request.method==='GET')return json({user:{id:principal.id,role:principal.role},customerIds:principal.customerIds});
  if(path==='/v1/session'&&request.method==='DELETE'){
    const token=request.headers.get('authorization')?.slice(7)||'';
    await env.DB.prepare('UPDATE app_sessions SET revoked_at=? WHERE token_hash=?').bind(Date.now(),await digest(token)).run();
    return json({status:'signed_out'});
  }
  if(path.startsWith('/v1/management/'))return managementRoute(request,env,principal,scanBody);
  if(path.startsWith('/v1/sandbox/'))return warehouseRoute(request,env,principal,scanBody);
  if(!localDemo){
    const permission=path==='/v1/scans'?'scans:create':path==='/v1/reports/summary'?'reports:read':'records:read';
    if(!can(principal,permission))return fail('Forbidden',403);
  }
  const scope=localDemo?'1=1':'EXISTS (SELECT 1 FROM user_customer_access a WHERE a.user_id=? AND a.customer_id=r.customer_id)';
  const scopeArgs=localDemo?[]:[principal.id];
  if(path==='/v1/records'&&request.method==='GET'){
    const q=(url.searchParams.get('q')||'').trim().slice(0,100);
    const requestedLimit=url.searchParams.get('limit')||'25';
    if(!/^[0-9]{1,3}$/.test(requestedLimit)||Number(requestedLimit)<1||Number(requestedLimit)>MAX_SEARCH)return fail('Invalid page limit',400);
    const limit=Number(requestedLimit);
    const cursor=url.searchParams.get('cursor')||'';
    if(cursor.length>100||/[\u0000-\u001f]/.test(cursor))return fail('Invalid pagination cursor',400);
    const pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
    const result=await env.DB.prepare(`SELECT r.id,r.barcode,r.kind,r.status,c.name AS customer,l.label AS location
      FROM records r JOIN customers c ON c.id=r.customer_id LEFT JOIN locations l ON l.id=r.location_id
      WHERE ${scope} AND r.id > ? AND (r.barcode LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR l.label LIKE ? ESCAPE '\\')
      ORDER BY r.id LIMIT ?`).bind(...scopeArgs,cursor,pattern,pattern,pattern,limit+1).all();
    const rows=result.results||[];
    return json({items:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1].id:null});
  }
  if(path.startsWith('/v1/records/')&&request.method==='GET'){
    const barcode=decodeURIComponent(path.slice('/v1/records/'.length));
    if(barcode.length>100)return fail('Invalid barcode',400);
    const row=await env.DB.prepare(`SELECT r.id,r.barcode,r.kind,r.status,c.name AS customer,l.label AS location
      FROM records r JOIN customers c ON c.id=r.customer_id LEFT JOIN locations l ON l.id=r.location_id WHERE r.barcode=? AND ${scope}`).bind(barcode,...scopeArgs).first();
    return row?json(row):fail('Record not found',404);
  }
  if(path==='/v1/scans'&&request.method==='POST'){
    // Fail closed on deployments. Only explicitly enabled local synthetic testing may write.
    if(env.DEMO_WRITES_ENABLED!=='true'||!['localhost','127.0.0.1'].includes(url.hostname))return fail('Demo scan writes are disabled outside local development',403);
    if(Number(request.headers.get('content-length'))>4096)return fail('Scan payload too large',413);
    let body;try{body=await scanBody(request)}catch(error){return fail(error.status===413?'Scan payload too large':'Invalid JSON',error.status||400)}
    const {clientEventId,barcode,operation,mode,occurredAt,workOrderId}=body||{};
    if(![clientEventId,barcode,operation,mode,occurredAt].every(x=>typeof x==='string'&&x.length>0&&x.length<=120))return fail('Missing or invalid scan fields',400);
    if(!allowedOperations.has(operation)||!['inbound','outbound'].includes(mode)||!Number.isFinite(Date.parse(occurredAt)))return fail('Invalid operation or timestamp',400);
    if((mode==='inbound'&&!INBOUND_OPERATIONS.has(operation))||(mode==='outbound'&&!OUTBOUND_OPERATIONS.has(operation)))return fail('Operation not allowed in selected mode',400);
    if(!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/.test(clientEventId)||!/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(barcode))return fail('Invalid event identifier or barcode',400);
    if(Math.abs(Date.now()-Date.parse(occurredAt))>7*24*60*60*1000)return fail('Timestamp outside permitted demo window',400);
    // Destruction is deliberately blocked until approved authorization and custody workflow exists.
    if(operation.includes('Destruction'))return fail('Destruction requires a separately approved workflow',403);
    const record=await env.DB.prepare(`SELECT r.id,r.kind FROM records r WHERE barcode=? AND ${scope}`).bind(barcode,...scopeArgs).first();
    if(!record)return fail('Barcode not found',404);
    if((operation.startsWith('Box')&&record.kind!=='Box')||(operation.startsWith('File')&&record.kind!=='File')||(operation==='Staged Files'&&record.kind!=='File'))return fail('Record type mismatch',409);
    // No work order validation exists yet; reject order-linked mutations rather than pretend to verify them.
    if(workOrderId)return fail('Work-order validation not yet implemented',501);
    const duplicateResponse=async()=>{
      const existing=await env.DB.prepare('SELECT id,record_id,actor_id,operation,mode,occurred_at FROM scan_events WHERE client_event_id=?').bind(clientEventId).first();
      if(!existing)return null;
      if(existing.record_id!==record.id||existing.actor_id!==principal.id||existing.operation!==operation||existing.mode!==mode||existing.occurred_at!==occurredAt)return fail('Event identifier already used for a different scan',409);
      return json({status:'already_accepted',id:existing.id});
    };
    const existing=await duplicateResponse();if(existing)return existing;
    const id=crypto.randomUUID();
    try{
      await env.DB.prepare('INSERT INTO scan_events(id,client_event_id,record_id,operation,mode,actor_id,occurred_at) VALUES(?,?,?,?,?,?,?)')
      .bind(id,clientEventId,record.id,operation,mode,principal.id,occurredAt).run();
    }catch(error){
      const duplicate=await duplicateResponse();if(duplicate)return duplicate;
      throw error;
    }
    return json({status:'accepted',id},201);
  }
  if(path==='/v1/reports/summary'&&request.method==='GET'){
    const [inventory,scans]=await Promise.all([
      env.DB.prepare(`SELECT r.kind,r.status,COUNT(*) AS total FROM records r WHERE ${scope} GROUP BY r.kind,r.status`).bind(...scopeArgs).all(),
      env.DB.prepare(`SELECT s.operation,COUNT(*) AS total FROM scan_events s JOIN records r ON r.id=s.record_id WHERE ${scope} GROUP BY s.operation`).bind(...scopeArgs).all()
    ]);
    return json({inventory:inventory.results||[],scans:scans.results||[]});
  }
  return fail('Not found',404);
}
async function handler(request,env){
 if(!env.DB)return fail('Database binding unavailable',503);
 const url=new URL(request.url);
 if(url.pathname==='/health'&&request.method==='GET')return json({status:'ok',service:'irm-rms-demo-api'});
 const localDemo=['localhost','127.0.0.1'].includes(url.hostname)&&!!env.DEMO_API_TOKEN&&request.headers.get('authorization')==='Bearer '+env.DEMO_API_TOKEN;
 let principal=null,response;
 const requestId=crypto.randomUUID();
 try{
  if(request.headers.has('origin')&&!allowedOrigin(request,env))response=fail('Origin not allowed',403);
  else {
  const rateResponse=await authRateLimit(request,env);
  if(rateResponse)response=rateResponse;
  else if(url.pathname.startsWith('/auth/')){({response,principal}=await loginRoute(request,env,scanBody))}
  else {
  if(localDemo)principal={id:'demo-api-user',active:true,role:'warehouse',customerIds:[]};
  else {try{principal=await authenticate(request,env)}catch{principal=null}}
  if(!principal)response=fail('Sign in required',401);
  else if(url.pathname==='/v1/session'&&request.method==='POST'){
   // Session lifetime cannot outlive the verified upstream token. Sessions cannot renew themselves.
   const token=request.headers.get('authorization')?.slice(7);
   let claims;try{claims=await verifyIdentity(token,env)}catch{}
   if(!claims||localDemo)response=fail('Verified identity token required',401);
   else {
    const accessToken='irm_session_'+crypto.randomUUID()+crypto.randomUUID();
    const expiresAt=Math.min(Date.now()+15*60*1000,claims.exp*1000);
    await env.DB.prepare('INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await digest(accessToken),principal.id,expiresAt).run();
    response=json({accessToken,expiresAt},201);
   }
  }else response=await routes(request,env,principal,localDemo);
  }
  }
 }catch(error){response=fail(error.status===413?'Payload too large':'Internal error',error.status===413?413:500)}
 // Await persistence before disclosing records. Failure to audit fails the request closed.
 try{
  await env.DB.prepare('INSERT INTO access_audit(id,actor_id,action,resource_type,resource_id,decision) VALUES(?,?,?,?,?,?)')
   .bind(requestId,principal?.id||null,request.method,'api',url.pathname.startsWith('/v1/records/')?'barcode-sha256:'+await digest(url.pathname.slice('/v1/records/'.length)):url.pathname.slice(0,120),response.ok?'allow':'deny').run();
 }catch{return fail('Audit storage unavailable',503)}
 response.headers.set('x-request-id',requestId);
 return response;
}
function allowedOrigin(request,env){
 const origin=request.headers.get('origin');
 return origin===new URL(request.url).origin||(env.READONLY_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean).includes(origin);
}
async function fetchHandler(request,env){
 const origin=request.headers.get('origin');
 if(request.method==='OPTIONS'){
  if(!origin||!allowedOrigin(request,env))return fail('Origin not allowed',403);
  return new Response(null,{status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-methods':'GET, POST, DELETE, OPTIONS','access-control-allow-headers':'Authorization, Content-Type','access-control-max-age':'300','vary':'Origin'}});
 }
 const response=await handler(request,env);
 if(origin&&allowedOrigin(request,env))response.headers.set('access-control-allow-origin',origin);
 response.headers.set('vary','Origin');response.headers.set('x-content-type-options','nosniff');
 return response;
}
export default {fetch:fetchHandler};
export {handler};
