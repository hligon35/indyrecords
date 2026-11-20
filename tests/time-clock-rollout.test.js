import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceRoute } from '../apps/time-clock/attendance.js';
import { runAttendanceJobs } from '../apps/time-clock/attendance-jobs.js';
import { deliverAttendanceEmail, noticeStatements } from '../apps/time-clock/attendance-notices.js';
import { reconcilePendingAttendance } from '../apps/time-clock/punch-provider.js';
import { timeClockDatabase } from './helpers/time-clock-db.js';

const now=Date.parse('2026-11-19T21:00:00.000Z');
const staff={id:'staff',role:'employee'},reviewer={id:'supervisor',role:'employee'},admin={id:'admin',role:'admin'};
const base='https://clock.example.test';
const utc=(day,hour)=>'2026-11-'+day+'T'+hour+':00:00.000Z';
function fixture(t){
 t.mock.method(Date,'now',()=>now);
 const {DB,sqlite}=timeClockDatabase(t);
 sqlite.exec(`
  INSERT INTO employees(id,identity_sub,display_name,role,email) VALUES
   ('admin','admin-sub','Admin','admin','admin@example.test'),
   ('supervisor','reviewer-sub','Reviewer','employee','reviewer@example.test'),
   ('staff','staff-sub','Employee','employee','employee@example.test'),
   ('other','other-sub','Other Employee','employee','other@example.test');
  INSERT INTO worksites(id,name,latitude,longitude) VALUES ('site','Test Location',0,0);
  INSERT INTO assignments VALUES('staff','site'),('other','site');
  INSERT INTO supervisor_roles(employee_id,granted_by) VALUES('supervisor','admin');
  INSERT INTO supervisor_assignments VALUES('supervisor','staff');
 `);
 const env={DB,EMAIL_ENABLED:'false'};
 const request=(actor,endpoint,method='GET',body)=>attendanceRoute(new Request(base+'/api/attendance/'+endpoint,{
  method,body:body?JSON.stringify(body):undefined
 }),env,actor,'/api/attendance/'+endpoint.split('?')[0]);
 return {sqlite,DB,env,request};
}

test('offline request retries are scoped and applied to timecards only after authorized review',async t=>{
 const {sqlite,request}=fixture(t);
 const draft={employeeId:'staff',worksiteId:'site',type:'IN',source:'OFFLINE',
  requestId:'offline-request-00001',requestedAt:utc('19','14'),reason:'Network dropped at the start of shift.'};
 assert.equal((await request({id:'other',role:'employee'},'requests','POST',draft)).status,403);
 sqlite.prepare(`INSERT INTO attendance_events(id,employee_id,worksite_id,event_type,occurred_at,client_request_id,geofence_result)
  VALUES('punch','staff','site','OUT',?,'clock-out','TEST')`).run(utc('19','20'));
 const response=await request(staff,'requests','POST',draft);
 assert.equal(response.status,201);
 const {request:{id}}=await response.json();
 assert.equal((await (await request(staff,'requests','POST',draft)).json()).duplicate,true);
 assert.equal((await request(staff,'requests','POST',{...draft,reason:'Changed request with same ID.'})).status,409);
 assert.equal((await (await request(staff,'timecard')).json()).totals.paidMinutes,0);
 const decision={id,decision:'APPROVED',reason:'Verified with employee.'};
 sqlite.exec(`CREATE TRIGGER reject_review_audit BEFORE INSERT ON audit_log
  WHEN NEW.operation='CORRECTION_REVIEWED' BEGIN SELECT RAISE(ABORT,'Test audit outage'); END;`);
 await assert.rejects(request(reviewer,'review','POST',decision),/Test audit outage/);
 assert.equal(sqlite.prepare('SELECT status FROM correction_requests WHERE id=?').get(id).status,'PENDING');
 sqlite.exec('DROP TRIGGER reject_review_audit');
 const reviewed=await request(reviewer,'review','POST',decision);
 assert.equal((await reviewed.json()).payrollStatus,'NOT_SUBMITTED');
 assert.equal((await request(reviewer,'review','POST',decision)).status,409);
 const card=await (await request(staff,'timecard')).json();
 assert.equal(card.totals.paidMinutes,360);
 assert.equal(card.daily.find(row=>row.date==='2026-11-19').paidMinutes,360);
 assert.equal(sqlite.prepare('SELECT count(*) AS count FROM attendance_events').get().count,1);
 assert.equal(sqlite.prepare("SELECT count(*) AS count FROM audit_log WHERE operation='CORRECTION_REVIEWED'").get().count,1);
});

test('attendance reports have server-side scope and detect missing and late attendance',async t=>{
 const {sqlite,request}=fixture(t);
 sqlite.prepare(`INSERT INTO work_schedules(id,employee_id,start_at,end_at,created_by) VALUES
  ('late','staff',?,?,'admin'),('missed','staff',?,?,'admin')`)
  .run(utc('19','14'),utc('19','20'),utc('18','14'),utc('18','20'));
 sqlite.prepare(`INSERT INTO attendance_events(id,employee_id,worksite_id,event_type,occurred_at,client_request_id,geofence_result)
  VALUES('in','staff','site','IN',?,'clock-in','TEST'),('out','staff','site','OUT',?,'clock-out','TEST')`)
  .run(utc('19','15'),utc('19','20'));
 assert.equal((await request(staff,'report')).status,403);
 assert.equal((await request(reviewer,'report?employeeId=other')).status,404);
 const list=await (await request(reviewer,'report')).json();
 assert.deepEqual(list.employees.map(employee=>employee.id),['staff']);
 const report=await (await request(reviewer,'report?employeeId=staff')).json();
 const employee=report.employees[0];
 assert.equal(employee.latest.providerState,'SIMULATED');
 assert.equal(employee.missedShifts,1);
 assert.equal(employee.schedules.find(row=>row.id==='late').arrivalDifferenceMinutes,60);
 assert.equal(employee.schedules.find(row=>row.id==='late').workedMinutes,300);
 assert.equal((await (await request(admin,'report')).json()).employees.length,4);
});

test('scheduled reminders deduplicate after an inbox item is dismissed',async t=>{
 const {sqlite,env}=fixture(t);
 const insert=sqlite.prepare(`INSERT INTO attendance_events(id,employee_id,worksite_id,event_type,occurred_at,client_request_id,geofence_result)
  VALUES(?,'staff','site',?,?,?,'TEST')`);
 for(const day of ['16','17','18','19']){
  insert.run(day+'in','IN',utc(day,day==='16'?'14':'10'),day+'-in');
  insert.run(day+'out','OUT',utc(day,day==='16'?'23':day==='17'?'21':'20'),day+'-out');
 }
 await runAttendanceJobs(env,now);
 let hints=sqlite.prepare("SELECT event_kind FROM attendance_notifications WHERE employee_id='staff' ORDER BY event_kind").all();
 assert.deepEqual(hints.map(row=>row.event_kind),['35 work hours reached','40 work hours reached']);
 sqlite.exec("DELETE FROM attendance_notifications WHERE employee_id='staff'");
 await runAttendanceJobs(env,now+10*60_000);
 hints=sqlite.prepare("SELECT event_kind FROM attendance_notifications WHERE employee_id='staff'").all();
 assert.deepEqual(hints,[]);
});

test('attendance email retries with the same key and keeps bounce history after dismissal',async t=>{
 const {DB,sqlite,env,request}=fixture(t);
 Object.assign(env,{EMAIL_ENABLED:'true',RESEND_API_KEY:'synthetic-test',RESEND_VERIFIED_FROM_DOMAIN:'alphazonelabs.com'});
 await request({id:'other',role:'employee'},'email-preference','PUT',{enabled:false});
 await DB.batch([...noticeStatements(env,'staff','Schedule updated','Sign in to review.'),
  ...noticeStatements(env,'other','Schedule updated','Sign in to review.')]);
 assert.equal(sqlite.prepare('SELECT count(*) AS count FROM attendance_email_outbox').get().count,1);
 let attempts=0;
 const keys=[];
 t.mock.method(globalThis,'fetch',async (url,options)=>{
  if(options.method==='POST'){
   keys.push(options.headers['Idempotency-Key']);
   attempts++;
   return attempts===1?new Response(null,{status:503}):Response.json({id:'synthetic-provider-id'});
  }
  assert.match(url,/synthetic-provider-id$/);
  return Response.json({last_event:'bounced'});
 });
 await deliverAttendanceEmail(env,now);
 await deliverAttendanceEmail(env,now+5*60_000);
 const [id]=keys;
 assert.deepEqual(keys,[id,id]);
 await request(staff,'notifications/'+id,'DELETE');
 await deliverAttendanceEmail(env,now+20*60_000);
 assert.equal(sqlite.prepare('SELECT state FROM attendance_email_outbox WHERE id=?').get(id).state,'BOUNCED');
 assert.deepEqual(sqlite.prepare('SELECT state FROM attendance_email_history ORDER BY occurred_ms').all().map(row=>row.state),
  ['QUEUED','ACCEPTED','BOUNCED']);
});

test('current Clock punches hand off once and reconcile an uncertain response without resubmitting',async t=>{
 const {sqlite,env,request}=fixture(t);
 const employee={...staff,adp_worker_id:'example-worker'};
 const payload={type:'IN',worksiteId:'site',requestId:'pending-punch-0001',
  location:{latitude:0,longitude:0,accuracyMeters:10,capturedAt:now}};
 env.APP_ENV='production';
 assert.equal((await request(employee,'events','POST',payload)).status,503);
 Object.assign(env,{ADP_MODE:'gateway',ADP_GATEWAY_URL:'https://gateway.example.test/punches',
  ADP_GATEWAY_ALLOWED_HOST:'gateway.example.test',ADP_GATEWAY_TOKEN:'synthetic-test'});
 let sent=null,reads=0;
 const upstream=t.mock.method(globalThis,'fetch',async (url,options)=>{
  assert.equal(options.redirect,'manual');
  if(options.method==='POST'){
   sent=JSON.parse(options.body);
   assert.equal(options.headers['Idempotency-Key'],sent.eventId);
   assert.equal(sent.workerId,'example-worker');
   assert.equal(sent.occurredAt,new Date(now).toISOString());
   return new Response(null,{status:502});
  }
  reads++;
  assert.equal(url.searchParams.get('eventId'),sent.eventId);
  return Response.json({state:'CONFIRMED'});
 });
 const submitted=await request(employee,'events','POST',payload);
 assert.equal(submitted.status,202);
 const {event}=await submitted.json();
 assert.equal(event.provider_state,'UNKNOWN');
 assert.equal((await (await request(employee,'events','POST',payload)).json()).duplicate,true);
 assert.equal(upstream.mock.callCount(),1);
 const status='events/'+event.id+'/status';
 assert.equal((await request({id:'other',role:'employee'},status,'POST')).status,404);
 assert.equal((await (await request(employee,status,'POST')).json()).event.provider_state,'CONFIRMED');
 assert.equal((await (await request(employee,status,'POST')).json()).event.provider_state,'CONFIRMED');
 assert.equal(reads,1);
 assert.equal(sqlite.prepare("SELECT count(*) AS count FROM audit_log WHERE operation='ATTENDANCE_PROVIDER_STATE_CHANGED'").get().count,1);
});

test('scheduled gateway reconciliation reads older unresolved events and rate overrides are blocked in production',async t=>{
 const {sqlite,env,request}=fixture(t);
 Object.assign(env,{APP_ENV:'production',ADP_MODE:'gateway',ADP_GATEWAY_URL:'https://gateway.example.test/punches',
  ADP_GATEWAY_ALLOWED_HOST:'gateway.example.test',ADP_GATEWAY_TOKEN:'synthetic-test'});
 assert.equal((await request(admin,'admin/rate','POST',{employeeId:'staff',hourlyCents:4000,effectiveAt:utc('19','14')})).status,409);
 const event=sqlite.prepare(`INSERT INTO attendance_events(id,employee_id,worksite_id,event_type,occurred_at,
  client_request_id,geofence_result,provider_state) VALUES(?,'staff','site','IN',?,?,'PASSED','PENDING')`);
 event.run('older-event',utc('19','14'),'older-request');
 event.run('fresh-event',new Date(now-30_000).toISOString(),'fresh-request');
 const upstream=t.mock.method(globalThis,'fetch',async (url,options)=>{
  assert.equal(url.searchParams.get('eventId'),'older-event');
  assert.equal(options.method,'GET');
  return Response.json({state:'FAILED'});
 });
 await reconcilePendingAttendance(env,now);
 await reconcilePendingAttendance(env,now);
 assert.equal(upstream.mock.callCount(),1);
 assert.equal(sqlite.prepare("SELECT provider_state FROM attendance_events WHERE id='older-event'").get().provider_state,'FAILED');
 assert.equal(sqlite.prepare("SELECT provider_state FROM attendance_events WHERE id='fresh-event'").get().provider_state,'PENDING');
});
