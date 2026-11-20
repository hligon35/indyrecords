import {validateRadius,validateCoordinate,validatePunchType,verifyGeofence} from '../../packages/time-clock/policy.js';
import {attendanceRoute} from './attendance.js';
import {verifyAccess} from './access.js';
import {checkPunchLocation,previewLocationBypass} from '../../packages/time-clock/preview-policy.js';
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const error=(code,status=400)=>response({error:code},status);
const MAX_BODY=4096;
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
 const url=new URL(request.url),path=url.pathname;
 if(path.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(request.method)){
  const origin=request.headers.get('Origin');
  if(origin!==url.origin)return error('SAME_ORIGIN_REQUIRED',403);
 }
 if(!path.startsWith('/api/'))return env.ASSETS?env.ASSETS.fetch(request):error('ASSETS_NOT_CONFIGURED',503);
 if(!env.DB)return error('DATABASE_NOT_CONFIGURED',503);
 const access=await verifyAccess(request,env);
 if(access.error)return error(access.error,access.status);
 const employee=await env.DB.prepare('SELECT * FROM employees WHERE identity_sub=? AND active=1').bind(access.sub).first();
 if(!employee)return error('ACCOUNT_NOT_PROVISIONED',403);
 const canManageWorksites=employee.role==='admin'&&access.sub===env.WORKSITE_OWNER_SUBJECT?.trim();
 if(path==='/'&&request.method==='GET')return new Response('IRM Time Clock API. Serve the PWA from an Access-protected static origin.',{headers:{'content-type':'text/plain','cache-control':'no-store'}});
 if(path.startsWith('/api/attendance/'))return attendanceRoute(request,env,employee,path);
 if(path==='/api/me'&&request.method==='GET')return response({id:employee.id,name:employee.display_name,role:employee.role,canManageWorksites,mode:env.ADP_MODE==='gateway'?'gateway':'simulated',previewLocationBypass:previewLocationBypass(env)});
 if(path==='/api/sites'&&request.method==='GET'){
 const result=await env.DB.prepare('SELECT s.* FROM worksites s JOIN assignments a ON a.worksite_id=s.id WHERE a.employee_id=? AND s.enabled=1 ORDER BY s.name,s.id').bind(employee.id).all();
 return response({sites:result.results||[]});
 }
 if(path==='/api/admin/sites'&&request.method==='GET'){
 if(!canManageWorksites)return error('OWNER_REQUIRED',403);
 const result=await env.DB.prepare('SELECT * FROM worksites WHERE enabled=1 ORDER BY name,id').all();
 return response({sites:result.results||[]});
 }
 if(path.startsWith('/api/punches/')&&path.endsWith('/status')&&request.method==='GET'){
 const punchId=path.slice('/api/punches/'.length,-'/status'.length);
 if(!/^[a-f0-9-]{36}$/i.test(punchId))return error('INVALID_PUNCH_ID');
 const punch=await env.DB.prepare('SELECT * FROM punches WHERE id=? AND employee_id=?').bind(punchId,employee.id).first();
 if(!punch)return error('NOT_FOUND',404);
 if(punch.provider_state!=='PENDING'||env.ADP_MODE!=='gateway')return response({state:punch.provider_state,message:punch.provider_message});
 if(!env.ADP_GATEWAY_URL||!env.ADP_GATEWAY_TOKEN||!env.ADP_GATEWAY_ALLOWED_HOST)return error('ADP_NOT_CONFIGURED',503);
 const endpoint=new URL(env.ADP_GATEWAY_URL);
 if(endpoint.protocol!=='https:'||endpoint.hostname!==env.ADP_GATEWAY_ALLOWED_HOST)return error('ADP_GATEWAY_UNTRUSTED',503);
 endpoint.searchParams.set('eventId',punch.id);
 try{
 const upstream=await fetch(endpoint.toString(),{headers:{authorization:'Bearer '+env.ADP_GATEWAY_TOKEN}});
 if(!upstream.ok)return error('PROVIDER_STATUS_UNAVAILABLE',502);
 const data=await upstream.json();
 if(!['PENDING','CONFIRMED','FAILED'].includes(data.state))return error('INVALID_PROVIDER_STATUS',502);
 if(data.state!=='PENDING'){
  await env.DB.prepare('UPDATE punches SET provider_state=?,provider_message=? WHERE id=? AND provider_state=?').bind(data.state,'Provider status verified by configured gateway.',punch.id,'PENDING').run();
  await audit(env.DB,employee.id,'PUNCH_RECONCILED',punch.id,{state:data.state});
 }
 return response({state:data.state,message:data.state==='PENDING'?'Awaiting ADP processing.':'Gateway reported '+data.state});
 }catch{return error('PROVIDER_STATUS_UNAVAILABLE',502)}
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
 const check=checkPunchLocation({site,location:data.location,env,verify:verifyGeofence});
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
 if(!canManageWorksites)return error('OWNER_REQUIRED',403);
 let data;try{data=await body(request);validateRadius(data.radiusFeet);validateCoordinate(data.latitude,data.longitude);if(typeof data.name!=='string'||!data.name.trim()||data.name.length>120)throw Error('Invalid site');}catch{return error('INVALID_WORKSITE',400)}
 const id=typeof data.id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(data.id)?data.id:crypto.randomUUID();
 const existing=await env.DB.prepare('SELECT * FROM worksites WHERE id=?').bind(id).first();
 await env.DB.prepare('INSERT INTO worksites(id,name,latitude,longitude,radius_feet,geofence_enabled,enabled) VALUES(?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,latitude=excluded.latitude,longitude=excluded.longitude,radius_feet=excluded.radius_feet,geofence_enabled=excluded.geofence_enabled,updated_at=CURRENT_TIMESTAMP').bind(id,data.name.trim(),data.latitude,data.longitude,data.radiusFeet,data.geofenceEnabled===false?0:1).run();
 await audit(env.DB,employee.id,'WORKSITE_SETTINGS_CHANGED',id,{old:existing?{radiusFeet:existing.radius_feet,latitude:existing.latitude,longitude:existing.longitude,enabled:existing.geofence_enabled}:null,new:{radiusFeet:data.radiusFeet,latitude:data.latitude,longitude:data.longitude,enabled:data.geofenceEnabled!==false}});
 return response({id,updated:true});
 }
 if(path==='/api/admin/assignments'&&['POST','PUT'].includes(request.method)){
 if(!canManageWorksites)return error('OWNER_REQUIRED',403);
 let data;try{data=await body(request)}catch{return error('INVALID_ASSIGNMENT')}
 if(!data||typeof data.employeeId!=='string'||typeof data.worksiteId!=='string'||!data.employeeId||!data.worksiteId||data.employeeId.length>120||data.worksiteId.length>120)return error('INVALID_ASSIGNMENT');
 if(request.method==='PUT'){
  const {employeeId,worksiteId}=data;
  const enabledAssignment='SELECT 1 FROM assignments a JOIN worksites s ON s.id=a.worksite_id WHERE a.employee_id=? AND a.worksite_id=? AND s.enabled=1';
  const [, , recorded]=await env.DB.batch([
   env.DB.prepare('INSERT OR IGNORE INTO assignments(employee_id,worksite_id) SELECT e.id,s.id FROM employees e,worksites s WHERE e.id=? AND s.id=? AND s.enabled=1')
    .bind(employeeId,worksiteId),
   env.DB.prepare('DELETE FROM assignments WHERE employee_id=? AND worksite_id<>? AND EXISTS ('+enabledAssignment+')')
    .bind(employeeId,worksiteId,employeeId,worksiteId),
   env.DB.prepare('INSERT INTO audit_log(id,actor_id,operation,resource_id,detail) SELECT ?,?,?,?,? WHERE EXISTS ('+enabledAssignment+')')
    .bind(crypto.randomUUID(),employee.id,'WORKSITE_ASSIGNMENT_CHANGED',employeeId,JSON.stringify({worksiteId}),employeeId,worksiteId)
  ]);
  return recorded.meta?.changes===1?response({assigned:true}):error('INVALID_ASSIGNMENT');
 }
 const result=await env.DB.prepare('INSERT OR IGNORE INTO assignments(employee_id,worksite_id) SELECT e.id,s.id FROM employees e,worksites s WHERE e.id=? AND s.id=?').bind(data.employeeId,data.worksiteId).run();
 await audit(env.DB,employee.id,'ASSIGNMENT_CREATED',data.worksiteId,{employeeId:data.employeeId});
 return response({created:result.meta?.changes===1});
 }
 return error('NOT_FOUND',404);
 }};
