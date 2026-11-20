export function attendanceGateway(env) {
 if(!env.ADP_GATEWAY_URL||!env.ADP_GATEWAY_ALLOWED_HOST||!env.ADP_GATEWAY_TOKEN)throw Error('ADP_NOT_CONFIGURED');
 const url=new URL(env.ADP_GATEWAY_URL);
 if(url.protocol!=='https:'||url.hostname!==env.ADP_GATEWAY_ALLOWED_HOST||url.username||url.password)throw Error('ADP_GATEWAY_UNTRUSTED');
 return {url,token:env.ADP_GATEWAY_TOKEN};
}

async function providerResponse(gateway,url,options) {
 const result=await fetch(url,{
  ...options,redirect:'manual',signal:AbortSignal.timeout(10000),
  headers:{...options.headers,Authorization:'Bearer '+gateway.token}
 });
 if(!result.ok)throw Error('ADP_GATEWAY_UNAVAILABLE');
 return result.json();
}

export async function submitAttendancePunch(gateway,event,employee) {
 const {state,reference}=await providerResponse(gateway,gateway.url,{
  method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':event.id},
  body:JSON.stringify({eventId:event.id,workerId:employee.adp_worker_id,type:event.type,
   worksiteId:event.worksiteId,occurredAt:event.occurred_at})
 });
 if(!['PENDING','CONFIRMED'].includes(state)||typeof reference!=='string'||!reference.trim())throw Error('ADP_GATEWAY_INVALID_RESPONSE');
 return {state,reference:reference.slice(0,120)};
}

export async function reconcileAttendancePunch(gateway,eventId) {
 const url=new URL(gateway.url);
 url.searchParams.set('eventId',eventId);
 const {state}=await providerResponse(gateway,url,{method:'GET'});
 if(!['PENDING','CONFIRMED','FAILED'].includes(state))throw Error('ADP_GATEWAY_INVALID_RESPONSE');
 return state;
}

export async function recordProviderState(db,employeeId,eventId,state,message,reference=null){
 await db.batch([
  db.prepare(`UPDATE attendance_events SET provider_state=?,provider_message=?,provider_ref=COALESCE(?,provider_ref)
   WHERE id=? AND employee_id=? AND provider_state IN ('UNKNOWN','PENDING') AND provider_state<>?`)
   .bind(state,message,reference,eventId,employeeId,state),
  db.prepare(`INSERT INTO audit_log(id,actor_id,operation,resource_id,detail)
   SELECT ?,?,'ATTENDANCE_PROVIDER_STATE_CHANGED',?,? WHERE changes()=1`)
   .bind(crypto.randomUUID(),employeeId,eventId,JSON.stringify({state}))
 ]);
 return db.prepare('SELECT provider_state,provider_message FROM attendance_events WHERE id=? AND employee_id=?')
  .bind(eventId,employeeId).first();
}

export async function reconcilePendingAttendance(env,time){
 if(env.ADP_MODE!=='gateway')return;
 const gateway=attendanceGateway(env),db=env.DB;
 const retryBefore=time-10*60_000;
 const delayBefore=new Date(time-2*60_000).toISOString();
 const {results=[]}=await db.prepare(`SELECT id,employee_id FROM attendance_events WHERE provider_state IN ('UNKNOWN','PENDING')
  AND (provider_checked_ms IS NULL OR provider_checked_ms<=?) AND occurred_at<=?
  ORDER BY provider_checked_ms,occurred_at LIMIT 10`).bind(retryBefore,delayBefore).all();
 for(const event of results){
  const claimed=await db.prepare(`UPDATE attendance_events SET provider_checked_ms=? WHERE id=?
   AND provider_state IN ('UNKNOWN','PENDING') AND (provider_checked_ms IS NULL OR provider_checked_ms<=?)`)
   .bind(time,event.id,retryBefore).run();
  if(claimed.meta?.changes!==1)continue;
  let state;
  try{state=await reconcileAttendancePunch(gateway,event.id)}
  catch{console.warn('ATTENDANCE_PROVIDER_STATUS_UNAVAILABLE');continue}
  await recordProviderState(db,event.employee_id,event.id,state,'Configured gateway reported '+state.toLowerCase()+'.');
 }
}
