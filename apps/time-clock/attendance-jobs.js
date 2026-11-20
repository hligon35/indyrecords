import { deliverAttendanceEmail, noticeStatements } from './attendance-notices.js';
import { reportEmployee } from './attendance-report.js';
import { payPeriodAt } from '../../packages/time-clock/payroll-calendar.js';
import { reconcilePendingAttendance } from './punch-provider.js';

const PAGE_SIZE=10;
const DAY=86_400_000;

async function attendanceSignals(env,time) {
 const db=env.DB,now=new Date(time).toISOString();
 const period=payPeriodAt(time);
 period.from=new Date(Math.min(Date.parse(period.from),time-2*DAY)).toISOString();
 const row=await db.prepare("SELECT cursor FROM attendance_job_state WHERE job='signals'").first();
 const {results=[]}=await db.prepare('SELECT id,display_name FROM employees WHERE active=1 AND id>? ORDER BY id LIMIT ?')
  .bind(row?.cursor || '',PAGE_SIZE).all();
 const configured=env.ATTENDANCE_DEVIATION_MINUTES;
 const threshold=configured?.trim() && /^\d+$/.test(configured) ? Number(configured) : null;
 for(const employee of results){
  const report=await reportEmployee(db,employee,period,now,true);
  const signals=[];
  const {workweek}=report;
  if(workweek.alert35)signals.push(['week:'+workweek.from+':35','35 work hours reached']);
  if(workweek.alert40)signals.push(['week:'+workweek.from+':40','40 work hours reached']);
  for(const shift of report.schedules){
   if(Date.parse(shift.end_at)<time-2*DAY)continue;
   if(shift.missed)signals.push(['shift:'+shift.id+':missed','Scheduled shift needs review']);
   const minutes=shift.arrivalDifferenceMinutes;
   if(threshold!==null&&minutes!==null&&minutes!==0&&Math.abs(minutes)>=threshold){
    const direction=minutes>0?'late':'early';
    signals.push(['shift:'+shift.id+':'+direction,minutes>0?'Late arrival':'Early arrival']);
   }
  }
  if(!signals.length)continue;
  const reviewers=await db.prepare(`SELECT id FROM employees e WHERE e.active=1 AND (e.id=? OR e.role='admin' OR EXISTS(
   SELECT 1 FROM supervisor_assignments a JOIN supervisor_roles r ON r.employee_id=a.supervisor_id
   WHERE a.supervisor_id=e.id AND a.employee_id=?))`).bind(employee.id,employee.id).all();
  for(const [key,kind] of signals){
   await db.batch((reviewers.results || []).flatMap(({id})=>noticeStatements(env,id,kind,
    'An attendance reminder is available. Sign in to review the relevant timecard or shift.',
    {signal:employee.id+':'+key})));
  }
 }
 await db.prepare(`INSERT INTO attendance_job_state(job,cursor) VALUES('signals',?)
  ON CONFLICT(job) DO UPDATE SET cursor=excluded.cursor`).bind(results.length===PAGE_SIZE?results.at(-1).id:'').run();
}

export async function runAttendanceJobs(env,time) {
 const outcomes=await Promise.allSettled([attendanceSignals(env,time),deliverAttendanceEmail(env,time),reconcilePendingAttendance(env,time)]);
 const names=['ATTENDANCE_SIGNAL_JOB_FAILED','ATTENDANCE_EMAIL_JOB_FAILED','ATTENDANCE_PROVIDER_JOB_FAILED'];
 for(const [index,result] of outcomes.entries()){
  if(result.status==='rejected')console.error(names[index]);
 }
 if(outcomes.some(result=>result.status==='rejected'))throw Error('ATTENDANCE_JOBS_FAILED');
}
