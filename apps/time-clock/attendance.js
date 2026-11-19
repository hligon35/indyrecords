import {validateEventType,totalize,estimateWeekly} from '../../packages/time-clock/timecard.js';
import {verifyGeofence} from '../../packages/time-clock/policy.js';
import {checkPunchLocation,previewLocationBypass} from '../../packages/time-clock/preview-policy.js';
import {sendTransactional} from './resend.js';
const ok=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const fail=(error,status=400)=>ok({error},status);
const uuid=()=>crypto.randomUUID();
const iso=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&s.length<=40;
async function read(request){if(Number(request.headers.get('content-length')||0)>4096)throw Error('TOO_LARGE');const t=await request.text();if(t.length>4096)throw Error('TOO_LARGE');return JSON.parse(t)}
async function audit(db,actor,action,resource,detail={}){await db.prepare('INSERT INTO audit_log(id,actor_id,operation,resource_id,detail) VALUES(?,?,?,?,?)').bind(uuid(),actor,action,resource,JSON.stringify(detail).slice(0,950)).run()}
async function supervisor(db,actor){return !!(await db.prepare('SELECT employee_id FROM supervisor_roles WHERE employee_id=?').bind(actor.id).first())}
async function canReview(db,actor,target){if(actor.role==='admin')return true;return !!(await db.prepare('SELECT employee_id FROM supervisor_assignments WHERE supervisor_id=? AND employee_id=?').bind(actor.id,target).first())&&await supervisor(db,actor)}
async function notify(db,to,kind,detail,env){
 const id=uuid();
 await db.prepare('INSERT INTO attendance_notifications(id,employee_id,event_kind,detail) VALUES(?,?,?,?)').bind(id,to,kind,detail.slice(0,240)).run();
 if(env.EMAIL_ENABLED==='true'){
  const target=await db.prepare('SELECT email FROM employees WHERE id=?').bind(to).first();
  if(target?.email){try{await sendTransactional(env,{to:target.email,subject:'IRM Time Clock — '+kind,text:detail.slice(0,1000)});await db.prepare("UPDATE attendance_notifications SET email_state='SENT' WHERE id=?").bind(id).run()}catch{await db.prepare("UPDATE attendance_notifications SET email_state='FAILED' WHERE id=?").bind(id).run()}}
 }
}
export async function attendanceRoute(request,env,actor,path){
 if(!path.startsWith('/api/attendance/'))return null;
 const db=env.DB,method=request.method;
 const role=actor.role==='admin'?'admin':await supervisor(db,actor)?'supervisor':'employee';
 if(path==='/api/attendance/profile'&&method==='GET')return ok({role,emailConfigured:!!actor.email,emailEnabled:env.EMAIL_ENABLED==='true',previewLocationBypass:previewLocationBypass(env)});
 if(path==='/api/attendance/notifications'&&method==='GET'){
  const r=await db.prepare('SELECT id,event_kind,detail,created_at,read_at,email_state FROM attendance_notifications WHERE employee_id=? ORDER BY created_at DESC LIMIT 60').bind(actor.id).all();
  return ok({items:r.results||[]});
 }
 if(path==='/api/attendance/requests'&&method==='POST'){
  let data;try{data=await read(request);validateEventType(data.type)}catch{return fail('INVALID_REQUEST')}
  if(!iso(data.requestedAt)||Math.abs(Date.now()-Date.parse(data.requestedAt))>31*86400000||typeof data.reason!=='string'||data.reason.trim().length<10||data.reason.length>500||typeof data.worksiteId!=='string'||typeof data.requestId!=='string'||!/^[\w-]{16,80}$/.test(data.requestId)||!['ONLINE','OFFLINE','GPS_EXCEPTION'].includes(data.source))return fail('INVALID_REQUEST');
  const site=await db.prepare('SELECT worksite_id FROM assignments WHERE employee_id=? AND worksite_id=?').bind(actor.id,data.worksiteId).first();if(!site)return fail('WORKSITE_NOT_ASSIGNED',403);
  const existing=await db.prepare('SELECT id,status FROM correction_requests WHERE employee_id=? AND client_request_id=?').bind(actor.id,data.requestId).first();
  if(existing)return ok({request:existing,duplicate:true});
  const id=uuid();
  await db.prepare('INSERT INTO correction_requests(id,employee_id,worksite_id,event_type,requested_at,reason,source,client_request_id) VALUES(?,?,?,?,?,?,?,?)').bind(id,actor.id,data.worksiteId,data.type,data.requestedAt,data.reason.trim(),data.source,data.requestId).run();
  await audit(db,actor.id,'CORRECTION_REQUESTED',id,{source:data.source});
  const targets=await db.prepare("SELECT e.id FROM employees e WHERE e.active=1 AND (e.role='admin' OR e.id IN (SELECT supervisor_id FROM supervisor_assignments WHERE employee_id=?))").bind(actor.id).all();
  for(const target of targets.results||[])await notify(db,target.id,'Correction requested','An employee has submitted a time correction requiring review.',env);
  return ok({request:{id,status:'PENDING'}},201);
 }
 if(path==='/api/attendance/requests'&&method==='GET'){
  const list=role==='admin'?await db.prepare('SELECT r.*,e.display_name FROM correction_requests r JOIN employees e ON e.id=r.employee_id ORDER BY r.created_at DESC LIMIT 100').all():role==='supervisor'?await db.prepare('SELECT r.*,e.display_name FROM correction_requests r JOIN supervisor_assignments a ON a.employee_id=r.employee_id AND a.supervisor_id=? JOIN employees e ON e.id=r.employee_id ORDER BY r.created_at DESC LIMIT 100').bind(actor.id).all():await db.prepare('SELECT r.*,e.display_name FROM correction_requests r JOIN employees e ON e.id=r.employee_id WHERE r.employee_id=? ORDER BY r.created_at DESC LIMIT 100').bind(actor.id).all();
  return ok({requests:list.results||[]});
 }
 if(path==='/api/attendance/review'&&method==='POST'){
  if(role==='employee')return fail('REVIEW_FORBIDDEN',403);
  let data;try{data=await read(request)}catch{return fail('INVALID_REQUEST')}
  if(typeof data.id!=='string'||!['APPROVED','REJECTED'].includes(data.decision)||typeof data.reason!=='string'||data.reason.trim().length<5||data.reason.length>500)return fail('INVALID_REVIEW');
  const record=await db.prepare('SELECT * FROM correction_requests WHERE id=?').bind(data.id).first();
  if(!record)return fail('NOT_FOUND',404);
  if(!await canReview(db,actor,record.employee_id))return fail('REVIEW_FORBIDDEN',403);
  const result=await db.prepare("UPDATE correction_requests SET status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,review_reason=? WHERE id=? AND status='PENDING'").bind(data.decision,actor.id,data.reason.trim(),data.id).run();
  if(result.meta?.changes!==1)return fail('ALREADY_REVIEWED',409);
  await audit(db,actor.id,'CORRECTION_REVIEWED',data.id,{decision:data.decision,employeeId:record.employee_id});
  await notify(db,record.employee_id,'Correction '+data.decision.toLowerCase(),'Your time correction has been '+data.decision.toLowerCase()+'. Payroll posting is subject to separate ADP verification.',env);
  return ok({id:data.id,status:data.decision,payrollStatus:'NOT_SUBMITTED'});
 }
 if(path==='/api/attendance/schedules'&&method==='GET'){
  const target=new URL(request.url).searchParams.get('employeeId')||actor.id;
  if(target!==actor.id&&!await canReview(db,actor,target))return fail('FORBIDDEN',403);
  const r=await db.prepare('SELECT id,employee_id,start_at,end_at FROM work_schedules WHERE employee_id=? ORDER BY start_at DESC LIMIT 60').bind(target).all();
  return ok({schedules:r.results||[]});
 }
 if(path==='/api/attendance/schedules'&&method==='POST'){
  if(role==='employee')return fail('FORBIDDEN',403);
  let data;try{data=await read(request)}catch{return fail('INVALID_REQUEST')}
  if(typeof data.employeeId!=='string'||!iso(data.startAt)||!iso(data.endAt)||Date.parse(data.endAt)<=Date.parse(data.startAt)||Date.parse(data.endAt)-Date.parse(data.startAt)>48*3600000)return fail('INVALID_SCHEDULE');
  if(!await canReview(db,actor,data.employeeId))return fail('FORBIDDEN',403);
  const id=uuid();await db.prepare('INSERT INTO work_schedules(id,employee_id,start_at,end_at,created_by) VALUES(?,?,?,?,?)').bind(id,data.employeeId,data.startAt,data.endAt,actor.id).run();
  await audit(db,actor.id,'SCHEDULE_CREATED',id,{employeeId:data.employeeId});
  await notify(db,data.employeeId,'Schedule updated','Your work schedule has been updated. Sign in to view it.',env);
  return ok({id},201);
 }
 if(path==='/api/attendance/events'&&method==='POST'){
  let data;try{data=await read(request);validateEventType(data.type)}catch{return fail('INVALID_EVENT')}
  if(typeof data.worksiteId!=='string'||typeof data.requestId!=='string'||!/^[\w-]{16,80}$/.test(data.requestId))return fail('INVALID_EVENT');
  const existing=await db.prepare('SELECT id,event_type,provider_state FROM attendance_events WHERE employee_id=? AND client_request_id=?').bind(actor.id,data.requestId).first();
  if(existing)return existing.event_type===data.type?ok({event:existing,duplicate:true}):fail('IDEMPOTENCY_CONFLICT',409);
  const site=await db.prepare('SELECT s.* FROM worksites s JOIN assignments a ON a.worksite_id=s.id WHERE a.employee_id=? AND s.id=? AND s.enabled=1').bind(actor.id,data.worksiteId).first();
  if(!site)return fail('WORKSITE_NOT_ASSIGNED',403);
  const result=checkPunchLocation({site,location:data.location,env,verify:verifyGeofence});
  if(!result.allowed){await audit(db,actor.id,'ATTENDANCE_GEOFENCE_REJECTED',site.id,{reason:result.reason,distanceFeet:result.distanceFeet??null,accuracyFeet:result.accuracyFeet??null,checkedAt:new Date().toISOString()});return ok({error:result.reason,mayRequestCorrection:true},403)}
  const id=uuid(),occurred=new Date().toISOString();
  await db.prepare('INSERT INTO attendance_events(id,employee_id,worksite_id,event_type,occurred_at,client_request_id,geofence_result,distance_feet,accuracy_feet) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,actor.id,site.id,data.type,occurred,data.requestId,result.reason,result.distanceFeet??null,result.accuracyFeet??null).run();
  await audit(db,actor.id,'ATTENDANCE_EVENT_SIMULATED',id,{type:data.type,worksiteId:site.id});
  return ok({event:{id,type:data.type,occurred_at:occurred,provider_state:'SIMULATED'},notice:result.simulated?'PREVIEW LOCATION BYPASS — SIMULATED, NOT PAYROLL':'SIMULATED — no ADP payroll submission'},201);
 }
 if(path==='/api/attendance/events'&&method==='GET'){
  const target=new URL(request.url).searchParams.get('employeeId')||actor.id;
  if(target!==actor.id&&!await canReview(db,actor,target))return fail('FORBIDDEN',403);
  const r=await db.prepare('SELECT id,event_type,occurred_at,provider_state,geofence_result,distance_feet,accuracy_feet FROM attendance_events WHERE employee_id=? ORDER BY occurred_at DESC LIMIT 250').bind(target).all();
  return ok({events:r.results||[]});
 }
 if(path==='/api/attendance/timecard'&&method==='GET'){
  const url=new URL(request.url),target=url.searchParams.get('employeeId')||actor.id;
  if(target!==actor.id&&!await canReview(db,actor,target))return fail('FORBIDDEN',403);
  // A calendar week boundary remains unconfirmed; client must select explicit 7-day interval.
  const from=url.searchParams.get('from'),to=url.searchParams.get('to');
  if(!iso(from)||!iso(to)||Date.parse(to)-Date.parse(from)!==7*86400000)return fail('SEVEN_DAY_RANGE_REQUIRED');
  const events=await db.prepare('SELECT event_type,occurred_at FROM attendance_events WHERE employee_id=? AND occurred_at<? ORDER BY occurred_at DESC LIMIT 2000').bind(target,to).all();
  const totals=totalize(events.results||[],from,to);
  const cls=await db.prepare('SELECT classification FROM employment_classifications WHERE employee_id=? AND effective_at<=? ORDER BY effective_at DESC LIMIT 1').bind(target,to).first();
  // Never expose wage rates to supervisors merely because they may review attendance.
  const rate=target===actor.id||role==='admin'?await db.prepare('SELECT hourly_cents FROM pay_rate_history WHERE employee_id=? AND effective_at<=? ORDER BY effective_at DESC LIMIT 1').bind(target,to).first():null;
  return ok({from,to,totals,estimates:estimateWeekly(totals.paidMinutes,{classification:cls?.classification||'UNKNOWN',hourlyCents:rate?.hourly_cents??null}),officialPayroll:false,workweekBoundaryUnverified:true});
 }
 if(path==='/api/attendance/admin/classification'&&method==='POST'){
  if(role!=='admin')return fail('ADMIN_REQUIRED',403);
  let data;try{data=await read(request)}catch{return fail('INVALID_REQUEST')}
  if(typeof data.employeeId!=='string'||!['EXEMPT','NONEXEMPT'].includes(data.classification)||!iso(data.effectiveAt))return fail('INVALID_CLASSIFICATION');
  await db.prepare('INSERT INTO employment_classifications(employee_id,effective_at,classification,changed_by) VALUES(?,?,?,?)').bind(data.employeeId,data.effectiveAt,data.classification,actor.id).run();
  await audit(db,actor.id,'CLASSIFICATION_SET',data.employeeId,{effectiveAt:data.effectiveAt});return ok({saved:true},201);
 }
 if(path==='/api/attendance/admin/rate'&&method==='POST'){
  if(role!=='admin')return fail('ADMIN_REQUIRED',403);
  let data;try{data=await read(request)}catch{return fail('INVALID_REQUEST')}
  if(typeof data.employeeId!=='string'||!iso(data.effectiveAt)||!Number.isInteger(data.hourlyCents)||data.hourlyCents<0||data.hourlyCents>100000000)return fail('INVALID_RATE');
  await db.prepare('INSERT INTO pay_rate_history(employee_id,effective_at,hourly_cents,changed_by) VALUES(?,?,?,?)').bind(data.employeeId,data.effectiveAt,data.hourlyCents,actor.id).run();
  await audit(db,actor.id,'RATE_SET',data.employeeId,{effectiveAt:data.effectiveAt});return ok({saved:true},201);
 }

 if(path==='/api/attendance/admin/employees'&&method==='GET'){
  if(role!=='admin')return fail('ADMIN_REQUIRED',403);
  const rows=await db.prepare("SELECT e.id,e.display_name,e.email,e.role,e.active,CASE WHEN sr.employee_id IS NULL THEN 0 ELSE 1 END AS is_supervisor FROM employees e LEFT JOIN supervisor_roles sr ON sr.employee_id=e.id ORDER BY e.display_name LIMIT 200").all();
  return ok({employees:rows.results||[]});
 }
 if(path==='/api/attendance/admin/employees'&&method==='POST'){
  if(role!=='admin')return fail('ADMIN_REQUIRED',403);
  let data;try{data=await read(request)}catch{return fail('INVALID_EMPLOYEE')}
  if(typeof data.name!=='string'||data.name.trim().length<2||data.name.length>120||typeof data.email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)||data.email.length>254||!['employee','supervisor'].includes(data.role)||typeof data.worksiteId!=='string')return fail('INVALID_EMPLOYEE');
  const site=await db.prepare('SELECT id FROM worksites WHERE id=? AND enabled=1').bind(data.worksiteId).first();if(!site)return fail('INVALID_WORKSITE');
  const id=uuid(),sub='pending:'+id;
  try{
   await db.batch([
    db.prepare("INSERT INTO employees(id,identity_sub,display_name,email,role,active) VALUES(?,?,?,?,'employee',0)").bind(id,sub,data.name.trim(),data.email.trim().toLowerCase()),
    db.prepare('INSERT INTO assignments(employee_id,worksite_id) VALUES(?,?)').bind(id,site.id),
    ...(data.role==='supervisor'?[db.prepare('INSERT INTO supervisor_roles(employee_id,granted_by) VALUES(?,?)').bind(id,actor.id)]:[])
   ]);
  }catch{return fail('EMPLOYEE_ALREADY_EXISTS_OR_INVALID',409)}
  await audit(db,actor.id,'EMPLOYEE_CREATED_INACTIVE',id,{role:data.role,worksiteId:site.id});
  return ok({id,status:'INACTIVE_PENDING_IDENTITY_INVITATION',invitationSent:false},201);
 }
 if(path==='/api/attendance/admin/supervisor-assignment'&&method==='POST'){
  if(role!=='admin')return fail('ADMIN_REQUIRED',403);
  let data;try{data=await read(request)}catch{return fail('INVALID_ASSIGNMENT')}
  if(typeof data.supervisorId!=='string'||typeof data.employeeId!=='string'||data.supervisorId===data.employeeId)return fail('INVALID_ASSIGNMENT');
  const superRow=await db.prepare('SELECT employee_id FROM supervisor_roles WHERE employee_id=?').bind(data.supervisorId).first();
  const employeeRow=await db.prepare('SELECT id FROM employees WHERE id=?').bind(data.employeeId).first();
  if(!superRow||!employeeRow)return fail('INVALID_ASSIGNMENT',400);
  await db.prepare('INSERT OR IGNORE INTO supervisor_assignments(supervisor_id,employee_id) VALUES(?,?)').bind(data.supervisorId,data.employeeId).run();
  await audit(db,actor.id,'SUPERVISOR_ASSIGNED',data.employeeId,{supervisorId:data.supervisorId});
  return ok({assigned:true},201);
 }
 return fail('NOT_FOUND',404);
}
