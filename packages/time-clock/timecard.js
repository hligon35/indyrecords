// Preview calculations only. ISO UTC instants; caller must provide verified workweek bounds.
export const EVENTS=['IN','OUT','LUNCH_START','LUNCH_END','PAID_BREAK_START','PAID_BREAK_END'];
export function validateEventType(v){if(!EVENTS.includes(v))throw Error('INVALID_EVENT_TYPE');return v;}
export function totalize(events,start,end){
 const begin=Date.parse(start),finish=Date.parse(end);
 if(!Number.isFinite(begin)||!Number.isFinite(finish)||finish<=begin)throw Error('INVALID_RANGE');
 const ordered=[...events].filter(e=>Number.isFinite(Date.parse(e.occurred_at))).sort((a,b)=>Date.parse(a.occurred_at)-Date.parse(b.occurred_at));
 let active=false,lunch=false,paidBreak=false,paidMs=0,lunchMs=0,previous=begin;
 // Replay events before the requested range to derive initial state.
 for(const e of ordered){const t=Date.parse(e.occurred_at);if(t>=begin)break;[active,lunch,paidBreak]=transition(active,lunch,paidBreak,e.event_type)}
 for(const e of ordered){const t=Date.parse(e.occurred_at);if(t<begin)continue;if(t>=finish)break;
  const elapsed=Math.max(0,t-previous);
  if(active&&!lunch)paidMs+=elapsed;
  if(active&&lunch)lunchMs+=elapsed;
  [active,lunch,paidBreak]=transition(active,lunch,paidBreak,e.event_type);previous=t;
 }
 const tail=finish-previous;if(active&&!lunch)paidMs+=tail;if(active&&lunch)lunchMs+=tail;
 return {paidMinutes:Math.round(paidMs/60000),unpaidLunchMinutes:Math.round(lunchMs/60000),paidHours:Math.round(paidMs/36000)/100};
}
function transition(active,lunch,paidBreak,type){
 if(type==='IN')return [true,false,false];
 if(type==='OUT')return [false,false,false];
 if(type==='LUNCH_START'&&active)return [true,true,false];
 if(type==='LUNCH_END'&&active)return [true,false,false];
 if(type==='PAID_BREAK_START'&&active&&!lunch)return [true,false,true];
 if(type==='PAID_BREAK_END'&&active)return [true,false,false];
 return [active,lunch,paidBreak];
}
export function estimateWeekly(earnedMinutes,{classification='UNKNOWN',hourlyCents=null}={}){
 if(!Number.isFinite(earnedMinutes)||earnedMinutes<0)throw Error('INVALID_HOURS');
 const regularMinutes=Math.min(earnedMinutes,2400);
 const overtimeMinutes=classification==='NONEXEMPT'?Math.max(0,earnedMinutes-2400):0;
 const eligibilityKnown=['NONEXEMPT','EXEMPT'].includes(classification);
 const grossCents=eligibilityKnown&&Number.isInteger(hourlyCents)&&hourlyCents>=0&&classification==='NONEXEMPT'?
 Math.round(regularMinutes*hourlyCents/60+overtimeMinutes*hourlyCents*1.5/60):null;
 return {regularMinutes,overtimeMinutes,classification,estimatedGrossCents:grossCents,
  alert35:earnedMinutes>=2100,alert40:earnedMinutes>=2400,unofficial:true};
}
