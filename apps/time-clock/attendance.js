import {validateEventType,totalize,estimateWeekly} from '../../packages/time-clock/timecard.js';
import {daysInRange,payPeriodAt,readHolidayDates,workweeksInRange} from '../../packages/time-clock/payroll-calendar.js';
import {verifyGeofence} from '../../packages/time-clock/policy.js';
import {checkPunchLocation,previewLocationBypass} from '../../packages/time-clock/preview-policy.js';
import {attendanceTimelineFor,auditStatement} from './attendance-records.js';
import {attendanceReport} from './attendance-report.js';
import {noticeStatements} from './attendance-notices.js';
import {attendanceGateway,reconcileAttendancePunch,recordProviderState,submitAttendancePunch} from './punch-provider.js';
const ok=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const fail=(error,status=400)=>ok({error},status);
const uuid=()=>crypto.randomUUID();
const iso=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&s.length<=40;
async function read(request){if(Number(request.headers.get('content-length')||0)>4096)throw Error('TOO_LARGE');const t=await request.text();if(t.length>4096)throw Error('TOO_LARGE');return JSON.parse(t)}
async function audit(db,actor,action,resource,detail={}){await db.prepare('INSERT INTO audit_log(id,actor_id,operation,resource_id,detail) VALUES(?,?,?,?,?)').bind(uuid(),actor,action,resource,JSON.stringify(detail).slice(0,950)).run()}
async function supervisor(db,actor){return !!(await db.prepare('SELECT employee_id FROM supervisor_roles WHERE employee_id=?').bind(actor.id).first())}
async function canReview(db,actor,target){if(actor.role==='admin')return true;return !!(await db.prepare('SELECT employee_id FROM supervisor_assignments WHERE supervisor_id=? AND employee_id=?').bind(actor.id,target).first())&&await supervisor(db,actor)}
export async function attendanceRoute(request,env,actor,path){
 if(!path.startsWith('/api/attendance/'))return null;
 const db=env.DB,method=request.method;
 const role=actor.role==='admin'?'admin':await supervisor(db,actor)?'supervisor':'employee';
 const previewRates=env.APP_ENV!=='production'&&env.ADP_MODE!=='gateway';
 if(path==='/api/attendance/profile'&&method==='GET')return ok({role,emailConfigured:!!actor.email,emailEnabled:env.EMAIL_ENABLED==='true',previewLocationBypass:previewLocationBypass(env),previewRates});
 if(path==='/api/attendance/report'&&method==='GET'){
  if(role==='employee')return fail('FORBIDDEN',403);
  const report=await attendanceReport(db,actor,role,new URL(request.url).searchParams,env.PAYROLL_HOLIDAYS);
  return report?ok(report):fail('REPORT_NOT_FOUND',404);
 }
 if(path==='/api/attendance/email-preference'){
  if(method==='GET'){
   const row=await db.prepare('SELECT enabled FROM attendance_email_preferences WHERE employee_id=?').bind(actor.id).first();
   return ok({enabled:row?.enabled!==0});
  }
  if(method==='PUT'){
   let data;try{data=await read(request)}catch{return fail('INVALID_PREFERENCE')}
   if(typeof data?.enabled!=='boolean')return fail('INVALID_PREFERENCE');
   await db.batch([
    db.prepare(`INSERT INTO attendance_email_preferences(employee_id,enabled) VALUES(?,?)
     ON CONFLICT(employee_id) DO UPDATE SET enabled=excluded.enabled`).bind(actor.id,Number(data.enabled)),
    auditStatement(db,actor.id,'ATTENDANCE_EMAIL_PREFERENCE_CHANGED',actor.id,{enabled:data.enabled})
   ]);
   return ok({enabled:data.enabled});
  }
 }
 if(path==='/api/attendance/admin/delivery'&&method==='GET'){
  if(role!=='admin')return fail('FORBIDDEN',403);
  const {results}=await db.prepare(`SELECT state,count(*) AS count FROM attendance_email_outbox GROUP BY state`).all();
  return ok({states:results || []});
 }
 if(path==='/api/attendance/notifications'&&method==='GET'){
  const r=await db.prepare('SELECT id,event_kind,detail,created_at,read_at,email_state FROM attendance_notifications WHERE employee_id=? ORDER BY created_at DESC LIMIT 60').bind(actor.id).all();
  return ok({items:r.results||[]});
 }
 if(method==='DELETE'&&path.startsWith('/api/attendance/notifications/')){
  const id=path.slice('/api/attendance/notifications/'.length);
  if(!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))return fail('INVALID_NOTIFICATION');
  await db.prepare('DELETE FROM attendance_notifications WHERE employee_id=? AND id=?').bind(actor.id,id).run();
  return ok({deleted:true});
 }
 if(path==='/api/attendance/requests'&&method==='POST'){
  let data;try{data=await read(request);validateEventType(data.type)}catch{return fail('INVALID_REQUEST')}
  if(!iso(data.requestedAt)||typeof data.reason!=='string'||data.reason.trim().length<10||data.reason.length>500||typeof data.worksiteId!=='string'||typeof data.requestId!=='string'||!/^[\w-]{16,80}$/.test(data.requestId)||!['ONLINE','OFFLINE','GPS_EXCEPTION'].includes(data.source))return fail('INVALID_REQUEST');
  if(data.source==='OFFLINE'&&data.employeeId!==actor.id)return fail('OFFLINE_OWNER_MISMATCH',403);
  const scheduleId=data.scheduleId??null;
  if(scheduleId!==null&&(typeof scheduleId!=='string'||!scheduleId||scheduleId.length>120))return fail('INVALID_SCHEDULE');
  const requestedAt=new Date(data.requestedAt).toISOString(),reason=data.reason.trim();
  const findRequest=()=>db.prepare('SELECT id,status,event_type,requested_at,reason,source,worksite_id,schedule_id FROM correction_requests WHERE employee_id=? AND client_request_id=?').bind(actor.id,data.requestId).first();
  const duplicate=existing=>existing?.event_type===data.type&&Date.parse(existing.requested_at)===Date.parse(requestedAt)&&
   existing.reason===reason&&existing.source===data.source&&existing.worksite_id===data.worksiteId&&existing.schedule_id===scheduleId?
   ok({request:{id:existing.id,status:existing.status},duplicate:true}):fail('IDEMPOTENCY_CONFLICT',409);
  const existing=await findRequest();
  if(existing)return duplicate(existing);
  if(Math.abs(Date.now()-Date.parse(requestedAt))>31*86400000)return fail('INVALID_REQUEST');
  const site=await db.prepare('SELECT worksite_id FROM assignments WHERE employee_id=? AND worksite_id=?').bind(actor.id,data.worksiteId).first();if(!site)return fail('WORKSITE_NOT_ASSIGNED',403);
  if(scheduleId&&!await db.prepare('SELECT 1 FROM work_schedules WHERE id=? AND employee_id=?').bind(scheduleId,actor.id).first()){
   return fail('SCHEDULE_NOT_FOUND',404);
  }
  const id=uuid();
  const targets=await db.prepare(`SELECT e.id FROM employees e WHERE e.active=1 AND
   (e.role='admin' OR e.id IN (SELECT a.supervisor_id FROM supervisor_assignments a JOIN supervisor_roles s
    ON s.employee_id=a.supervisor_id WHERE a.employee_id=?))`).bind(actor.id).all();
  const guard='EXISTS(SELECT 1 FROM correction_requests WHERE id=?)';
  const [inserted]=await db.batch([
   db.prepare('INSERT OR IGNORE INTO correction_requests(id,employee_id,worksite_id,event_type,requested_at,reason,source,client_request_id,schedule_id) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(id,actor.id,data.worksiteId,data.type,requestedAt,reason,data.source,data.requestId,scheduleId),
   db.prepare(`INSERT INTO audit_log(id,actor_id,operation,resource_id,detail) SELECT ?,?,'CORRECTION_REQUESTED',?,? WHERE ${guard}`)
    .bind(uuid(),actor.id,id,JSON.stringify({source:data.source}),id),
   ...(targets.results || []).flatMap(target=>noticeStatements(env,target.id,'Correction requested',
    'An employee submitted a time correction for review.',{guard,args:[id]}))
  ]);
  if(inserted.meta?.changes!==1)return duplicate(await findRequest());
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
  const receipt=uuid();
  const [result]=await db.batch([
   db.prepare("UPDATE correction_requests SET status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,review_reason=? WHERE id=? AND status='PENDING'")
    .bind(data.decision,actor.id,data.reason.trim(),data.id),
   db.prepare(`INSERT INTO audit_log(id,actor_id,operation,resource_id,detail) SELECT ?,?,'CORRECTION_REVIEWED',?,? WHERE changes()=1`)
    .bind(receipt,actor.id,data.id,JSON.stringify({decision:data.decision,employeeId:record.employee_id})),
   ...noticeStatements(env,record.employee_id,'Correction '+data.decision.toLowerCase(),
    'Review the correction decision in Time Clock. Payroll posting requires separate ADP verification.',
    {guard:'EXISTS(SELECT 1 FROM audit_log WHERE id=?)',args:[receipt]})
  ]);
  if(result.meta?.changes!==1)return fail('ALREADY_REVIEWED',409);
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
  const id=uuid();
  await db.batch([
   db.prepare('INSERT INTO work_schedules(id,employee_id,start_at,end_at,created_by) VALUES(?,?,?,?,?)')
    .bind(id,data.employeeId,new Date(data.startAt).toISOString(),new Date(data.endAt).toISOString(),actor.id),
   auditStatement(db,actor.id,'SCHEDULE_CREATED',id,{employeeId:data.employeeId}),
   ...noticeStatements(env,data.employeeId,'Schedule updated','Your work schedule changed. Sign in to view it.')
  ]);
  return ok({id},201);
 }
 if(path==='/api/attendance/events'&&method==='POST'){
  const live=env.ADP_MODE==='gateway';
  if(env.APP_ENV==='production'&&!live)return fail('LIVE_ATTENDANCE_NOT_CONFIGURED',503);
  let data;try{data=await read(request);validateEventType(data.type)}catch{return fail('INVALID_EVENT')}
  if(typeof data.worksiteId!=='string'||typeof data.requestId!=='string'||!/^[\w-]{16,80}$/.test(data.requestId))return fail('INVALID_EVENT');
  const findEvent=()=>db.prepare('SELECT id,event_type,provider_state,provider_message,worksite_id FROM attendance_events WHERE employee_id=? AND client_request_id=?').bind(actor.id,data.requestId).first();
  const duplicate=event=>event?.event_type===data.type&&event.worksite_id===data.worksiteId?ok({event,duplicate:true}):fail('IDEMPOTENCY_CONFLICT',409);
  const existing=await findEvent();
  if(existing)return duplicate(existing);
  const site=await db.prepare('SELECT s.* FROM worksites s JOIN assignments a ON a.worksite_id=s.id WHERE a.employee_id=? AND s.id=? AND s.enabled=1').bind(actor.id,data.worksiteId).first();
  if(!site)return fail('WORKSITE_NOT_ASSIGNED',403);
  // Enforce punch order on the server; a client confirmation cannot substitute
  // for an authenticated, authoritative attendance state check.
  const last=await db.prepare('SELECT event_type FROM attendance_events WHERE employee_id=? ORDER BY occurred_at DESC, rowid DESC LIMIT 1').bind(actor.id).first();
  const prior=last?.event_type??null;
  const active=prior!==null&&prior!=='OUT';
  const invalidOrder=(
    (data.type==='IN'&&active) ||
    (data.type==='OUT'&&!active) ||
    (data.type==='LUNCH_START'&&(!active||prior==='LUNCH_START'||prior==='PAID_BREAK_START')) ||
    (data.type==='LUNCH_END'&&prior!=='LUNCH_START') ||
    (data.type==='PAID_BREAK_START'&&(!active||prior==='LUNCH_START'||prior==='PAID_BREAK_START')) ||
    (data.type==='PAID_BREAK_END'&&prior!=='PAID_BREAK_START')
  );
  if(invalidOrder)return fail('INVALID_PUNCH_SEQUENCE',409);
  const result=checkPunchLocation({site,location:data.location,env,verify:verifyGeofence});
  if(!result.allowed){await audit(db,actor.id,'ATTENDANCE_GEOFENCE_REJECTED',site.id,{reason:result.reason,distanceFeet:result.distanceFeet??null,accuracyFeet:result.accuracyFeet??null,checkedAt:new Date().toISOString()});return ok({error:result.reason,mayRequestCorrection:true},403)}
  let gateway;
  if(live){
   if(!actor.adp_worker_id)return fail('ADP_EMPLOYEE_NOT_LINKED',503);
   try{gateway=attendanceGateway(env)}catch{return fail('ADP_NOT_CONFIGURED',503)}
  }
  const id=uuid(),occurred=new Date(Date.now()).toISOString();
  const state=live?'UNKNOWN':'SIMULATED';
  const message=live?'Awaiting provider verification. Check status before retrying.':'Recorded in simulation.';
  const guard='EXISTS(SELECT 1 FROM attendance_events WHERE id=?)';
  const [inserted]=await db.batch([
   db.prepare(`INSERT OR IGNORE INTO attendance_events(id,employee_id,worksite_id,event_type,occurred_at,client_request_id,
    geofence_result,distance_feet,accuracy_feet,provider_state,provider_message) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id,actor.id,site.id,data.type,occurred,data.requestId,result.reason,result.distanceFeet??null,result.accuracyFeet??null,state,message),
   db.prepare(`INSERT INTO audit_log(id,actor_id,operation,resource_id,detail) SELECT ?,?,?,?,? WHERE ${guard}`)
    .bind(uuid(),actor.id,live?'ATTENDANCE_EVENT_CAPTURED':'ATTENDANCE_EVENT_SIMULATED',id,
     JSON.stringify({type:data.type,worksiteId:site.id,state}),id),
   ...noticeStatements(env,actor.id,'Attendance event recorded','Sign in to Time Clock to review your attendance event.',{guard,args:[id]})
  ]);
  if(inserted.meta?.changes!==1)return duplicate(await findEvent());
  const event={id,type:data.type,occurred_at:occurred,provider_state:state,provider_message:message};
  if(!live)return ok({event,notice:result.simulated?'PREVIEW LOCATION BYPASS — SIMULATED, NOT PAYROLL':'SIMULATED — no ADP payroll submission'},201);
  let provider;
  try{provider=await submitAttendancePunch(gateway,{...event,worksiteId:site.id},actor)}catch{return ok({event},202)}
  const providerMessage=provider.state==='PENDING'?'Awaiting provider confirmation.':'Confirmed by the configured payroll gateway.';
  const recorded=await recordProviderState(db,actor.id,id,provider.state,providerMessage,provider.reference);
  return ok({event:{...event,...recorded}},recorded.provider_state==='PENDING'?202:201);
 }
 if(path.startsWith('/api/attendance/events/')&&path.endsWith('/status')&&method==='POST'){
  const id=path.slice('/api/attendance/events/'.length,-'/status'.length);
  if(!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))return fail('INVALID_EVENT');
  const event=await db.prepare('SELECT provider_state,provider_message FROM attendance_events WHERE id=? AND employee_id=?')
   .bind(id,actor.id).first();
  if(!event)return fail('NOT_FOUND',404);
  if(!['PENDING','UNKNOWN'].includes(event.provider_state)||env.ADP_MODE!=='gateway')return ok({event});
  let state;
  try{state=await reconcileAttendancePunch(attendanceGateway(env),id)}catch{return fail('PROVIDER_STATUS_UNAVAILABLE',502)}
  const recorded=await recordProviderState(db,actor.id,id,state,'Configured gateway reported '+state.toLowerCase()+'.');
  return ok({event:recorded});
 }
 if(path==='/api/attendance/events'&&method==='GET'){
  const target=new URL(request.url).searchParams.get('employeeId')||actor.id;
  if(target!==actor.id&&!await canReview(db,actor,target))return fail('FORBIDDEN',403);
  const r=await db.prepare(`SELECT id,worksite_id,event_type,occurred_at,provider_state,geofence_result,distance_feet,accuracy_feet,
   CASE WHEN employee_id=? THEN client_request_id END AS client_request_id
   FROM attendance_events WHERE employee_id=? ORDER BY occurred_at DESC LIMIT 250`).bind(actor.id,target).all();
  return ok({events:r.results||[]});
 }
 if(path==='/api/attendance/timecard'&&method==='GET'){
  const url=new URL(request.url),target=url.searchParams.get('employeeId')||actor.id;
  if(target!==actor.id&&!await canReview(db,actor,target))return fail('FORBIDDEN',403);
  let holidays;
  try{holidays=readHolidayDates(env.PAYROLL_HOLIDAYS)}catch{return fail('PAYROLL_HOLIDAY_CONFIGURATION_INVALID',503)}
  const current=payPeriodAt(Date.now(),holidays);
  const useCurrent=!url.searchParams.has('from')&&!url.searchParams.has('to');
  const from=useCurrent?current.from:url.searchParams.get('from');
  const to=useCurrent?current.to:url.searchParams.get('to');
  const fromMs=Date.parse(from),toMs=Date.parse(to),duration=toMs-fromMs;
  const DAY_MS=86400000;
  if(!iso(from)||!iso(to)||!Number.isFinite(duration)||
     Math.abs(duration-14*DAY_MS)>3600000)return fail('FOURTEEN_DAY_RANGE_REQUIRED');
  const period=useCurrent?current:payPeriodAt(fromMs,holidays);
  const calendar=Date.parse(period.from)===fromMs&&Date.parse(period.to)===toMs?period:null;
  const end=new Date(toMs).toISOString();
  const windows=workweeksInRange(fromMs,toMs);
  const records=await attendanceTimelineFor(db,target,new Date(windows[0].workweekFrom).toISOString(),end,new Date(Date.now()).toISOString());
  const totals=totalize(records,from,to);
  const unpaidDays=new Set(calendar?.unpaidHolidays || []);
  const daily=daysInRange(fromMs,toMs).map(window=>({
   date:window.date,...totalize(records,window.from,window.to),unpaidHoliday:unpaidDays.has(window.date)
  }));
  const cls=await db.prepare('SELECT classification FROM employment_classifications WHERE employee_id=? AND effective_at<=? ORDER BY effective_at DESC LIMIT 1').bind(target,end).first();
  const rate=previewRates&&(target===actor.id||role==='admin')?await db.prepare('SELECT hourly_cents FROM pay_rate_history WHERE employee_id=? AND effective_at<=? ORDER BY effective_at DESC LIMIT 1').bind(target,end).first():null;
  // The first workweek can start before the selected pay period. Earlier hours
  // use up part of that week's regular hours without being paid in this period.
  const weekly=windows.map(window=>{
   const week=totalize(records,window.from,window.to);
   const priorPaidMinutes=window.workweekFrom<window.from?totalize(records,window.workweekFrom,window.from).paidMinutes:0;
   return {...week,workweekFrom:new Date(window.workweekFrom).toISOString(),
    workweekTo:new Date(window.workweekTo).toISOString(),priorPaidMinutes};
  });
  const weeklyEstimates=weekly.map(week=>estimateWeekly(week.paidMinutes,{
   classification:cls?.classification||'UNKNOWN',hourlyCents:rate?.hourly_cents??null,
   priorPaidMinutes:week.priorPaidMinutes
  }));
  const gross=weeklyEstimates.every(week=>week.estimatedGrossCents!==null)?weeklyEstimates.reduce((sum,week)=>sum+week.estimatedGrossCents,0):null;
  return ok({from,to,payPeriod:calendar,totals,daily,weekly,estimates:{
    overtimeMinutes:weeklyEstimates.reduce((sum,week)=>sum+week.overtimeMinutes,0),
    regularMinutes:weeklyEstimates.reduce((sum,week)=>sum+week.regularMinutes,0),
    estimatedGrossCents:gross,classification:cls?.classification||'UNKNOWN',
    unofficial:true
  },officialPayroll:false,workweekBoundaryUnverified:false});
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
  if(!previewRates)return fail('PAY_RATES_SYNC_FROM_ADP',409);
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
