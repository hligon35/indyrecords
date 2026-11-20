import test from 'node:test';
import assert from 'node:assert/strict';
import {totalize,estimateWeekly,validateEventType} from '../packages/time-clock/timecard.js';
import {payPeriodAt,readHolidayDates,workweeksInRange} from '../packages/time-clock/payroll-calendar.js';
import {attendanceRoute} from '../apps/time-clock/attendance.js';
import {timeClockDatabase} from './helpers/time-clock-db.js';
const stamp=x=>'2026-11-16T'+x+':00.000Z';
test('counts paid breaks and excludes actual unpaid lunch',()=>{
 const events=[
 {event_type:'IN',occurred_at:stamp('09:00')},
 {event_type:'PAID_BREAK_START',occurred_at:stamp('11:00')},
 {event_type:'PAID_BREAK_END',occurred_at:stamp('11:15')},
 {event_type:'LUNCH_START',occurred_at:stamp('12:00')},
 {event_type:'LUNCH_END',occurred_at:stamp('12:30')},
 {event_type:'OUT',occurred_at:stamp('17:30')}
 ];
 const x=totalize(events,'2026-11-16T00:00:00.000Z','2026-11-23T00:00:00.000Z');
 assert.equal(x.paidMinutes,480);
 assert.equal(x.unpaidLunchMinutes,30);
});
test('overtime estimate after 40 hours only for nonexempt',()=>{
 const nonexempt=estimateWeekly(2700,{classification:'NONEXEMPT',hourlyCents:2000});
 assert.equal(nonexempt.regularMinutes,2400);
 assert.equal(nonexempt.overtimeMinutes,300);
 assert.equal(nonexempt.estimatedGrossCents,95000);
 assert.equal(nonexempt.alert35,true);
 assert.equal(nonexempt.alert40,true);
 const exempt=estimateWeekly(2700,{classification:'EXEMPT',hourlyCents:2000});
 assert.equal(exempt.overtimeMinutes,0);
 assert.equal(exempt.estimatedGrossCents,null);
});
test('never invent earnings when classification or rate is missing',()=>{
 assert.equal(estimateWeekly(2300,{}).estimatedGrossCents,null);
 assert.equal(estimateWeekly(2300,{classification:'NONEXEMPT'}).estimatedGrossCents,null);
});
test('rejects malformed attendance inputs',()=>{
 assert.throws(()=>validateEventType('BREAK_START'));
 assert.throws(()=>totalize([],'bad','2026-11-23T00:00:00.000Z'));
 assert.throws(()=>estimateWeekly(-2));
});

test('open shifts are flagged rather than inflated to range end',()=>{
 const result=totalize([{event_type:'IN',occurred_at:'2026-11-16T09:00:00.000Z'}],'2026-11-16T00:00:00.000Z','2026-11-23T00:00:00.000Z');
 assert.equal(result.incompleteShift,true);
 assert.equal(result.paidMinutes,0);
});

test('pay periods retain the confirmed anchor and move holiday paydays back one calendar day',()=>{
 assert.deepEqual(payPeriodAt(Date.parse('2026-11-19T15:00:00Z')),{
  from:'2026-11-08T05:00:00.000Z',to:'2026-11-22T05:00:00.000Z',
  label:'Nov 8 – Nov 21, 2026',payday:'November 27, 2026',unpaidHolidays:['2026-11-11']
 });
 assert.equal(payPeriodAt(Date.parse('2026-12-10T15:00:00Z')).payday,'December 24, 2026');
 assert.deepEqual(payPeriodAt(Date.parse('2026-11-19T15:00:00Z'),readHolidayDates('2026-11-20')).unpaidHolidays,
  ['2026-11-11','2026-11-20']);
 assert.throws(()=>readHolidayDates('2026-02-30'),/PAYROLL_HOLIDAY_CONFIGURATION_INVALID/);
});

test('the observed federal calendar matches the nationwide 2027 schedule, including the next New Year',()=>{
 const observed=new Set();
 for(let day=1;day<=365;day+=14){
  const period=payPeriodAt(Date.UTC(2027,0,day,15));
  for(const date of period.unpaidHolidays){
   if(date.startsWith('2027-'))observed.add(date);
  }
 }
 assert.deepEqual([...observed].sort(),[
  '2027-01-01','2027-01-18','2027-02-15','2027-05-31','2027-06-18','2027-07-05',
  '2027-09-06','2027-10-11','2027-11-11','2027-11-25','2027-12-24','2027-12-31'
 ]);
});

test('the Monday 9 a.m. Indianapolis boundary stays at 9 after the DST change',()=>{
 const time=Date.parse;
 const weeks=workweeksInRange(time('2027-03-14T05:00:00Z'),time('2027-03-16T04:00:00Z'));
 assert.equal(weeks[0].workweekFrom,time('2027-03-08T14:00:00Z'));
 assert.equal(weeks[0].to,time('2027-03-15T13:00:00Z'));
 assert.equal(weeks[1].from,time('2027-03-15T13:00:00Z'));
});

test('a known shift crossing a workweek boundary counts only the portion within each window',()=>{
 const events=[
  {event_type:'IN',occurred_at:stamp('13:00')},
  {event_type:'OUT',occurred_at:stamp('15:00')}
 ];
 const first=totalize(events,stamp('00:00'),stamp('14:00'));
 const next=totalize(events,stamp('14:00'),stamp('23:00'));
 assert.equal(first.paidMinutes,60);
 assert.equal(next.paidMinutes,60);
 assert.equal(first.incompleteShift,false);
});

test('timecard carries prior-period hours into the first Monday workweek calculation',async t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-11-19T16:00:00Z'));
 const shift=(day,start,end)=>[
  {event_type:'IN',occurred_at:'2026-11-'+day+'T'+start+':00:00.000Z'},
  {event_type:'OUT',occurred_at:'2026-11-'+day+'T'+end+':00:00.000Z'}
 ];
 const records=[...['02','03','04','05','06'].flatMap(day=>shift(day,'14','22')),
  ...shift('08','14','16'),...shift('09','14','22')];
 const {DB,sqlite}=timeClockDatabase(t);
 sqlite.exec(`INSERT INTO employees(id,identity_sub,display_name,role) VALUES('staff','staff-sub','Test Staff','admin');
  INSERT INTO worksites(id,name,latitude,longitude) VALUES('site','Test Worksite',0,0);
  INSERT INTO employment_classifications VALUES('staff','2026-01-01T00:00:00.000Z','NONEXEMPT','staff');`);
 const insert=sqlite.prepare(`INSERT INTO attendance_events(id,employee_id,worksite_id,event_type,occurred_at,client_request_id,geofence_result)
  VALUES(?,'staff','site',?,?,?,'TEST')`);
 records.forEach((event,index)=>insert.run('event-'+index,event.event_type,event.occurred_at,'request-'+index));
 const path='/api/attendance/timecard';
 const response=await attendanceRoute(new Request('https://clock.example.test'+path),{DB},{id:'staff',role:'admin'},path);
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.payPeriod.payday,'November 27, 2026');
 assert.equal(data.weekly[0].priorPaidMinutes,2400);
 assert.equal(data.weekly[1].workweekFrom,'2026-11-09T14:00:00.000Z');
 assert.equal(data.totals.paidMinutes,600);
 assert.equal(data.estimates.regularMinutes,480);
 assert.equal(data.estimates.overtimeMinutes,120);
});
