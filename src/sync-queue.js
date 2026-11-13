// Pure, dependency-free sync state machine. Persistence is the caller's responsibility.
// A production handheld must use durable SQLite, not browser localStorage.
export const STATES=Object.freeze({pending:'pending',sending:'sending',confirmed:'confirmed',conflict:'conflict'});
export function enqueue(queue, event){
 if(!event||typeof event.clientEventId!=='string'||!event.clientEventId)throw Error('clientEventId required');
 if(queue.some(x=>x.clientEventId===event.clientEventId))return queue;
 return [...queue,{...event,status:STATES.pending,attempts:0,nextAttemptAt:0}];
}
export function nextBatch(queue,now=Date.now(),limit=25){
 return queue.filter(x=>x.status===STATES.pending&&x.nextAttemptAt<=now).slice(0,Math.max(0,Math.min(100,limit)));
}
export function markSending(queue,ids){
 const selected=new Set(ids);return queue.map(x=>selected.has(x.clientEventId)&&x.status===STATES.pending?{...x,status:STATES.sending}:x);
}
export function acknowledge(queue,id,result,now=Date.now()){
 return queue.map(x=>{
  if(x.clientEventId!==id||x.status===STATES.confirmed)return x;
  if(result==='accepted'||result==='already_accepted')return {...x,status:STATES.confirmed,confirmedAt:now,nextAttemptAt:0};
  if(result==='conflict')return {...x,status:STATES.conflict,nextAttemptAt:0};
  const attempts=x.attempts+1;
  const delay=Math.min(60000,1000*2**Math.min(attempts-1,6));
  return {...x,status:STATES.pending,attempts,nextAttemptAt:now+delay};
 });
}
export function recoverInterrupted(queue){return queue.map(x=>x.status===STATES.sending?{...x,status:STATES.pending}:x)}
export function queueSummary(queue){return Object.fromEntries(Object.values(STATES).map(status=>[status,queue.filter(x=>x.status===status).length]))}
