import { estimateWeekly, totalize } from '../../packages/time-clock/timecard.js';
import { payPeriodAt, readHolidayDates, workweeksInRange } from '../../packages/time-clock/payroll-calendar.js';
import { attendanceTimelineFor } from './attendance-records.js';

const PAGE_SIZE = 10;

export function scheduleComparison(records, schedule, now) {
 const start = Date.parse(schedule.start_at), end = Date.parse(schedule.end_at);
 const nowMs = Date.parse(now);
 const plannedMinutes = Math.round((end - start) / 60000);
 if (start >= nowMs) return {...schedule, plannedMinutes, workedMinutes:0, arrivalDifferenceMinutes:null, missed:false};
 const cutoff = Math.min(end,nowMs);
 const { paidMinutes:workedMinutes } = totalize(records,start,cutoff);
 let observedIn = null;
 for (const event of records) {
  const at = Date.parse(event.occurred_at);
  if (at >= cutoff) break;
  if (event.event_type === 'IN') {
   observedIn = at;
   if (at >= start) break;
  }
  if (event.event_type === 'OUT' && at <= start) observedIn = null;
 }
 return {...schedule, plannedMinutes, workedMinutes,
  arrivalDifferenceMinutes:observedIn === null ? null : Math.round((observedIn - start) / 60000),
  missed:end <= nowMs && observedIn === null
 };
}

export async function reportEmployee(db, employee, period, now, detailed = false) {
 const week = workweeksInRange(Date.parse(now),Date.parse(now)+1)[0];
 const earliest = new Date(Math.min(Date.parse(period.from)-48*3600000,week.workweekFrom)).toISOString();
 const end = new Date(Math.max(Date.parse(period.to),Date.parse(now)+1)).toISOString();
 const id = employee.id;
 const [records, [scheduleResult, correctionResult, blockedResult, classificationResult]] = await Promise.all([
  attendanceTimelineFor(db,id,earliest,end,now),
  db.batch([
   db.prepare('SELECT id,start_at,end_at FROM work_schedules WHERE employee_id=? AND end_at>? AND start_at<? ORDER BY start_at')
    .bind(id,period.from,period.to),
   db.prepare('SELECT id,event_type,requested_at,source,status FROM correction_requests WHERE employee_id=? AND requested_at>=? AND requested_at<? ORDER BY requested_at DESC')
    .bind(id,period.from,period.to),
   db.prepare(`SELECT id,at,resource_id,CASE WHEN json_valid(detail) THEN json_extract(detail,'$.reason') END AS reason
    FROM audit_log WHERE actor_id=? AND operation='ATTENDANCE_GEOFENCE_REJECTED'
    AND at>=datetime(?) AND at<datetime(?) ORDER BY at DESC`).bind(id,period.from,period.to),
   db.prepare('SELECT classification FROM employment_classifications WHERE employee_id=? AND effective_at<=? ORDER BY effective_at DESC LIMIT 1').bind(id,now)
  ])
 ]);
 const schedules = (scheduleResult.results || []).map(row => scheduleComparison(records,row,now));
 const corrections = correctionResult.results || [];
 const exceptions = blockedResult.results || [];
 const events = records.filter(event => event.occurred_at >= period.from && event.occurred_at < period.to);
 const weekTotals = totalize(records,week.workweekFrom,week.workweekTo);
 const overtime = estimateWeekly(weekTotals.paidMinutes,{classification:classificationResult.results?.[0]?.classification});
 const latest = records.at(-1);
 const state = {IN:'Clocked in',OUT:'Clocked out',LUNCH_START:'At lunch',LUNCH_END:'Clocked in',
  PAID_BREAK_START:'On paid break',PAID_BREAK_END:'Clocked in'};
 return {
  id,name:employee.display_name,
  latest:latest ? {status:state[latest.event_type],at:latest.occurred_at,providerState:latest.provider_state} : null,
  paidMinutes:totalize(records,period.from,period.to).paidMinutes,
  plannedMinutes:Math.round(schedules.reduce((sum,row)=>sum+
   (Math.min(Date.parse(row.end_at),Date.parse(period.to))-Math.max(Date.parse(row.start_at),Date.parse(period.from))),0)/60000),
  missedShifts:schedules.filter(row=>row.missed).length,
  pendingCorrections:corrections.filter(row=>row.status==='PENDING').length,
  geofenceExceptions:exceptions.length,
  workweek:{from:new Date(week.workweekFrom).toISOString(),paidMinutes:weekTotals.paidMinutes,
   overtimeMinutes:overtime.overtimeMinutes,alert35:overtime.alert35,alert40:overtime.alert40},
  ...(detailed ? {events,schedules,corrections,exceptions} : {})
 };
}

export async function attendanceReport(db, actor, role, query, holidaySetting) {
 const employeeId=query.get('employeeId');
 const after=query.get('after') || '';
 const filter=(query.get('filter') || '').trim();
 if ((employeeId?.length || 0)>120 || after.length>120 || filter.length>120) return null;
 const filters = [];
 const args = [];
 if (role !== 'admin') {
  filters.push('EXISTS (SELECT 1 FROM supervisor_assignments a WHERE a.supervisor_id=? AND a.employee_id=e.id)');
  args.push(actor.id);
 }
 if (employeeId !== null) {
  filters.push('e.id=?');
  args.push(employeeId);
 } else {
  filters.push('e.id>?');
  args.push(after);
  if(filter){
   filters.push('instr(lower(e.display_name),lower(?))>0');
   args.push(filter);
  }
 }
 const {results=[]} = await db.prepare(`SELECT e.id,e.display_name FROM employees e WHERE e.active=1
  AND ${filters.join(' AND ')} ORDER BY e.id LIMIT ?`).bind(...args,PAGE_SIZE+1).all();
 if (employeeId !== null && !results.length) return null;
 const now = new Date(Date.now()).toISOString();
 const period = payPeriodAt(Date.parse(now),readHolidayDates(holidaySetting));
 const employees = await Promise.all(results.slice(0,PAGE_SIZE)
  .map(employee => reportEmployee(db,employee,period,now,employeeId !== null)));
 return {asOf:now,payPeriod:period,employees,next:results.length>PAGE_SIZE ? employees.at(-1).id:null};
}
