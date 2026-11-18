import {validateRadius,validateCoordinate,validatePunchType,verifyGeofence} from '../../packages/time-clock/policy.js';
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const error=(code,status=400)=>response({error:code},status);
const MAX_BODY=4096;
function decode64url(s){const v=s.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(v+'='.repeat((4-v.length%4)%4)),x=>x.charCodeAt(0));}
async function identity(request,env){
 const token=request.headers.get('Cf-Access-Jwt-Assertion');
 if(!token||!env.ACCESS_ISSUER||!env.ACCESS_AUDIENCE)return null;
 const parts=token.split('.');if(parts.length!==3)return null;
 let header,claims;
 try{header=JSON.parse(new TextDecoder().decode(decode64url(parts[0])));claims=JSON.parse(new TextDecoder().decode(decode64url(parts[1])))}catch{return null;}
 const issuer=env.ACCESS_ISSUER.replace(/\/$/,'');
 if(header.alg!=='RS256'||!header.kid||claims.iss!==issuer||!(Array.isArray(claims.aud)?claims.aud.includes(env.ACCESS_AUDIENCE):claims.aud===env.ACCESS_AUDIENCE)||typeof claims.sub!=='string'||!claims.sub||!Number.isFinite(claims.exp)||claims.exp*1000<=Date.now()||!Number.isFinite(claims.iat)||claims.iat*1000>Date.now()+60000||claims.nbf&&claims.nbf*1000>Date.now()+60000)return null;
 // Never accept identity headers without verifying the Access-signed JWT.
 let certs;try{const r=await fetch(issuer+'/cdn-cgi/access/certs');if(!r.ok)return null;certs=await r.json()}catch{return null;}
 const key=certs.keys?.find(k=>k.kid===header.kid&&k.kty==='RSA');
 if(!key)return null;
 try{
 const publicKey=await crypto.subtle.importKey('jwk',key,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',publicKey,decode64url(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
 return valid?claims.sub:null;
 }catch{return null;}
}
async function body(request){if(Number(request.headers.get('content-length'))>MAX_BODY)throw Error('PAYLOAD_TOO_LARGE');const raw=await request.text();if(raw.length>MAX_BODY)throw Error('PAYLOAD_TOO_LARGE');return JSON.parse(raw)}
async function audit(db,actor,operation,id,detail){await db.prepare('INSERT INTO audit_log(id,actor_id,operation,resource_id,detail) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),actor,operation,id,JSON.stringify(detail).slice(0,1000)).run();}
async function sendProvider(env,employee,type,site,punchId){
 if(env.ADP_MODE!=='gateway')return {state:'SIMULATED',message:'Demonstration only. Not sent to ADP.'};
 if(!env.ADP_GATEWAY_URL||!env.ADP_GATEWAY_TOKEN||!employee.adp_worker_id)throw Error('ADP_NOT_CONFIGURED');
 const url=new URL(env.ADP_GATEWAY_URL);
 if(url.protocol!=='https:'||!env.ADP_GATEWAY_ALLOWED_HOST||url.hostname!==env.ADP_GATEWAY_ALLOWED_HOST)throw Error('ADP_GATEWAY_UNTRUSTED');
 const result=await fetch(url.toString(),{method:'POST',headers:{authorization:'Bearer '+env.ADP_GATEWAY_TOKEN,'content-type':'application/json','idempotency-key':punchId},body:JSON.stringify({eventId:punchId,workerId:employee.adp_worker_id,type,worksiteId:site.id})});
 if(!result.ok)throw Error('ADP_GATEWAY_REJECTED');
 const data=await result.json();
 if(!['PENDING','CONFIRMED'].includes(data.state))throw Error('ADP_GATEWAY_INVALID_RESPONSE');
 return {state:data.state,ref:String(data.reference||'').slice(0,120),message:'Submission received; follow-up verification required if pending.'};
}
export default {async fetch(request,env){
 const path=new URL(request.url).pathname;
 if(!env.DB)return error('DATABASE_NOT_CONFIGURED',503);
 const sub=await identity(request,env);if(!sub)return error('SIGN_IN_REQUIRED',401);
 const employee=await env.DB.prepare('SELECT * FROM employees WHERE identity_sub=? AND active=1').bind(sub).first();
 if(!employee)return error('ACCOUNT_NOT_PROVISIONED',403);
 if(path==='/'&&request.method==='GET')return new Response('IRM Time Clock API. Serve the PWA from an Access-protected static origin.',{headers:{'content-type':'text/plain','cache-control':'no-store'}});
 if(path==='/api/me'&&request.method==='GET')return response({id:employee.id,name:employee.display_name,role:employee.role,mode:env.ADP_MODE==='gateway'?'gateway':'simulated'});
 if(path==='/api/sites'&&request.method==='GET'){
 const result=employee.role==='admin'?await env.DB.prepare('SELECT * FROM worksites ORDER BY name').all():await env.DB.prepare('SELECT s.* FROM worksites s JOIN assignments a ON a.worksite_id=s.id WHERE a.employee_id=? AND s.enabled=1 ORDER BY s.name').bind(employee.id).all();
 return response({sites:result.results||[]});
 }
 if(path==='/api/history'&&request.method==='GET'){
 const result=await env.DB.prepare('SELECT p.id,p.worksite_id,p.type,p.submitted_at,p.provider_state,p.provider_message FROM punches p WHERE p.employee_id=? ORDER BY p.submitted_at DESC LIMIT 60').bind(employee.id).all();
 return response({punches:result.results||[]});
 }
 if(path==='/api/punches'&&request.method==='POST'){
 let data;try{data=await body(request);validatePunchType(data.type)}catch{return error('INVALID_PUNCH',400)}
 if(typeof data.requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(data.requestId)||typeof data.worksiteId!=='string'||data.worksiteId.length>120)return error('INVALID_PUNCH',400);
 const old=await env.DB.prepare('SELECT * FROM punches WHERE employee_id=? AND client_request_id=?').bind(employee.id,data.requestId).first();
 if(old)return old.worksite_id===data.worksiteId&&old.type===data.type?response({punch:old,duplicate:true}):error('REQUEST_ID_REUSED',409);
 const site=await env.DB.prepare('SELECT s.* FROM worksites s JOIN assignments a ON a.worksite_id=s.id WHERE a.employee_id=? AND s.id=? AND s.enabled=1').bind(employee.id,data.worksiteId).first();
 if(!site)return error('WORKSITE_NOT_ASSIGNED',403);
 const check=verifyGeofence({site,location:data.location});
 if(!check.allowed){await audit(env.DB,employee.id,'PUNCH_BLOCKED',site.id,{reason:check.reason});return response({error:check.reason,distanceFeet:check.distanceFeet},403)}
 const punchId=crypto.randomUUID(), now=new Date().toISOString();
 // Persist first. A transport failure must never cause an untracked repeated payroll submission.
 await env.DB.prepare('INSERT INTO punches(id,employee_id,worksite_id,type,client_request_id,submitted_at,distance_feet,accuracy_feet,provider_state) VALUES(?,?,?,?,?,?,?,?,?)').bind(punchId,employee.id,site.id,data.type,data.requestId,now,check.distanceFeet??null,check.accuracyFeet??null,'UNKNOWN').run();
 let provider;try{provider=await sendProvider(env,employee,data.type,site,punchId)}catch(e){provider={state:'UNKNOWN',message:'Provider result uncertain. Contact a supervisor before retrying.'}}
 await env.DB.prepare('UPDATE punches SET provider_state=?,provider_ref=?,provider_message=? WHERE id=?').bind(provider.state,provider.ref||null,provider.message,punchId).run();
 await audit(env.DB,employee.id,'PUNCH_SUBMITTED',punchId,{state:provider.state,worksiteId:site.id,type:data.type});
 return response({punch:{id:punchId,type:data.type,provider_state:provider.state,provider_message:provider.message,submitted_at:now}},provider.state==='UNKNOWN'?202:201);
 }
 if(path==='/api/admin/sites'&&request.method==='POST'){
 if(employee.role!=='admin')return error('ADMIN_REQUIRED',403);
 let data;try{data=await body(request);validateRadius(data.radiusFeet);validateCoordinate(data.latitude,data.longitude);if(typeof data.name!=='string'||!data.name.trim()||data.name.length>120)throw Error('Invalid site');}catch{return error('INVALID_WORKSITE',400)}
 const id=typeof data.id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(data.id)?data.id:crypto.randomUUID();
 const existing=await env.DB.prepare('SELECT * FROM worksites WHERE id=?').bind(id).first();
 await env.DB.prepare('INSERT INTO worksites(id,name,latitude,longitude,radius_feet,geofence_enabled,enabled) VALUES(?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,latitude=excluded.latitude,longitude=excluded.longitude,radius_feet=excluded.radius_feet,geofence_enabled=excluded.geofence_enabled,updated_at=CURRENT_TIMESTAMP').bind(id,data.name.trim(),data.latitude,data.longitude,data.radiusFeet,data.geofenceEnabled===false?0:1).run();
 await audit(env.DB,employee.id,'WORKSITE_SETTINGS_CHANGED',id,{old:existing?{radiusFeet:existing.radius_feet,latitude:existing.latitude,longitude:existing.longitude,enabled:existing.geofence_enabled}:null,new:{radiusFeet:data.radiusFeet,latitude:data.latitude,longitude:data.longitude,enabled:data.geofenceEnabled!==false}});
 return response({id,updated:true});
 }
 if(path==='/api/admin/assignments'&&request.method==='POST'){
 if(employee.role!=='admin')return error('ADMIN_REQUIRED',403);
 let data;try{data=await body(request)}catch{return error('INVALID_ASSIGNMENT')}
 if(typeof data.employeeId!=='string'||typeof data.worksiteId!=='string'||data.employeeId.length>120||data.worksiteId.length>120)return error('INVALID_ASSIGNMENT');
 const result=await env.DB.prepare('INSERT OR IGNORE INTO assignments(employee_id,worksite_id) SELECT e.id,s.id FROM employees e,worksites s WHERE e.id=? AND s.id=?').bind(data.employeeId,data.worksiteId).run();
 await audit(env.DB,employee.id,'ASSIGNMENT_CREATED',data.worksiteId,{employeeId:data.employeeId});
 return response({created:result.meta?.changes===1});
 }
 return error('NOT_FOUND',404);
 }};
