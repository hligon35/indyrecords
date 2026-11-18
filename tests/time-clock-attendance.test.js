import test from 'node:test';
import assert from 'node:assert/strict';
import {totalize,estimateWeekly,validateEventType} from '../packages/time-clock/timecard.js';
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
