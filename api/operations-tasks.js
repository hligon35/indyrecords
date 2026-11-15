import {loadPrincipal} from './auth.js';
import {can} from '../packages/security/permissions.js';
import {applyCommercial} from '../packages/commercial/workflows.js';
import {applyField} from '../packages/field/workflows.js';
import {canonical} from '../packages/warehouse/workflows.js';
import {validateTaskInput} from '../packages/operations/providers.js';

const fail=(m,status=409)=>{throw Object.assign(Error(m),{status})};
const tableFor=kind=>['commercial_delivery','recurrence'].includes(kind)?'commercial_workspaces':'field_workspaces';
const visible=row=>{const {fingerprint,lease_token,policy,...rest}=row;return {...rest,policy:JSON.parse(policy),synthetic:true}};
async function source(DB,customerId,kind,sourceId){
 const table=tableFor(kind), row=await DB.prepare(`SELECT version,payload FROM ${table} WHERE customer_id=?`).bind(customerId).first();
 if(!row)fail('Workspace is missing',404);
 const state=JSON.parse(row.payload), collection={commercial_delivery:'outbox',certificate_delivery:'batches',recurrence:'plans',field_export:'exports'}[kind];
 const item=state[collection]?.find(i=>i.id===sourceId);
 if(!item)fail('Source not found in this customer workspace',404);
 return {table,row,state,item};
}
export async function enqueueTask(DB,customerId,actor,input,now=Date.now()){
 const x=validateTaskInput(input), fingerprint=canonical({kind:x.kind,sourceId:x.sourceId,policy:x.policy,actor});
 const old=await DB.prepare('SELECT * FROM backend_tasks WHERE customer_id=? AND request_key=?').bind(customerId,x.requestKey).first();
 if(old){if(old.fingerprint!==fingerprint)fail('Request key belongs to different content or actor');return {status:'already_accepted',task:visible(old)}}
 const {item}=await source(DB,customerId,x.kind,x.sourceId);
 if(x.kind==='commercial_delivery'&&(!['pending','failed'].includes(item.status)||item.attempts>=3))fail('Commercial delivery is terminal or needs review');
 if(x.kind==='certificate_delivery'&&(!['draft','failed'].includes(item.status)||item.attempts>=3))fail('Certificate delivery is terminal or needs review');
 if(x.kind==='field_export'&&item.status==='complete')fail('Export already complete');
 if((await DB.prepare('SELECT COUNT(*) AS n FROM backend_tasks WHERE customer_id=?').bind(customerId).first()).n>=2000)fail('Synthetic task retention limit reached',413);
 const id=crypto.randomUUID(), due=Math.max(now,item.nextAttemptAt?Date.parse(item.nextAttemptAt):now);
 try{await DB.batch([
  DB.prepare('INSERT INTO backend_tasks(id,customer_id,created_by,request_key,fingerprint,kind,source_id,policy,status,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,customerId,actor,x.requestKey,fingerprint,x.kind,x.sourceId,JSON.stringify(x.policy),'pending',due,now,now),
  DB.prepare('INSERT INTO backend_task_history(id,task_id,attempt,actor_id,outcome,detail,occurred_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,0,actor,'queued','Synthetic work queued',now),
  DB.prepare('INSERT INTO access_audit(id,actor_id,action,resource_type,resource_id,decision) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),actor,'TASK_ENQUEUE','backend_task',id,'allow')
 ])}catch{
  const concurrent=await DB.prepare('SELECT * FROM backend_tasks WHERE customer_id=? AND request_key=?').bind(customerId,x.requestKey).first();
  if(concurrent?.fingerprint===fingerprint)return {status:'already_accepted',task:visible(concurrent)};
  fail('An active task already targets this source, or atomic queue storage failed');
 }
 return {status:'accepted',task:visible(await DB.prepare('SELECT * FROM backend_tasks WHERE id=?').bind(id).first())};
}
export async function listTasks(DB,customerId,cursor=''){
 const rows=(await DB.prepare('SELECT * FROM backend_tasks WHERE customer_id=? AND id>? ORDER BY id LIMIT 101').bind(customerId,cursor).all()).results||[];
 return {items:rows.slice(0,100).map(visible),nextCursor:rows.length>100?rows[99].id:null};
}
async function stopTask(DB,task,token,status,detail,now){
 await DB.batch([
  DB.prepare('UPDATE backend_tasks SET status=?,last_error=?,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND lease_token=?').bind(status,detail,now,task.id,token),
  DB.prepare('INSERT INTO backend_task_history(id,task_id,attempt,actor_id,outcome,detail,occurred_at) SELECT ?,id,attempts,created_by,?,?,? FROM backend_tasks WHERE id=? AND version=?').bind(crypto.randomUUID(),status,detail,now,task.id,task.version+1),
  DB.prepare('INSERT INTO access_audit(id,actor_id,action,resource_type,resource_id,decision) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),task.created_by,'TASK_'+status.toUpperCase(),'backend_task',task.id,'deny')
 ]);
}
export async function runTasks(env,customerId,{limit=5,now=Date.now()}={}){
 if(env.SYNTHETIC_OPERATIONS_ENABLED!=='true')return {disabled:true,processed:0,results:[]};
 if(!Number.isInteger(limit)||limit<1||limit>10)fail('Run limit must be 1 to 10',400);
 const DB=env.DB, due=(await DB.prepare("SELECT id FROM backend_tasks WHERE customer_id=? AND ((status IN ('pending','retry') AND next_attempt_at<=?) OR (status='running' AND lease_until<=?)) ORDER BY next_attempt_at,id LIMIT ?").bind(customerId,now,now,limit).all()).results||[];
 const results=[];
 for(const candidate of due){
  const token=crypto.randomUUID();
  const claim=await DB.prepare("UPDATE backend_tasks SET attempts=CASE WHEN status='running' THEN attempts ELSE attempts+1 END,status='running',lease_token=?,lease_until=?,version=version+1,updated_at=? WHERE id=? AND customer_id=? AND ((status IN ('pending','retry') AND next_attempt_at<=?) OR (status='running' AND lease_until<=?))").bind(token,now+60000,now,candidate.id,customerId,now,now).run();
  if(claim.meta?.changes!==1)continue;
  const task=await DB.prepare('SELECT * FROM backend_tasks WHERE id=? AND lease_token=?').bind(candidate.id,token).first();
  const owner=await loadPrincipal(DB,task.created_by,{byId:true});
  const feature=tableFor(task.kind)==='commercial_workspaces'?'SYNTHETIC_COMMERCIAL_ENABLED':'SYNTHETIC_FIELD_ENABLED';
  const profile=await DB.prepare('SELECT active FROM customer_profiles WHERE customer_id=?').bind(customerId).first();
  if(!can(owner,'operations:manage',{customerId})||profile?.active===0||env[feature]!=='true'){await stopTask(DB,task,token,'blocked','Owner access revoked, customer archived or workspace disabled',now);results.push({id:task.id,status:'blocked'});continue}
  try{
   const {table,row,state,item}=await source(DB,customerId,task.kind,task.source_id), policy=JSON.parse(task.policy);
   const outcome=policy.outcomes[Math.min(task.attempts-1,policy.outcomes.length-1)];
   const eventId=`demo-task-${task.id}-${task.generation}-${task.attempts}`;
   let updated, status='succeeded', next=now, detail='Synthetic processing succeeded';
   if(['commercial_delivery','certificate_delivery'].includes(task.kind)){
    // Another authorized UI may have completed the delivery while this job waited.
    if(['succeeded','simulated_sent'].includes(item.status)){updated=state;detail='Source already delivered; no duplicate effect'}
    else{
     if(item.nextAttemptAt&&Date.parse(item.nextAttemptAt)>now){await DB.prepare("UPDATE backend_tasks SET status='retry',attempts=attempts-1,next_attempt_at=?,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND lease_token=?").bind(Date.parse(item.nextAttemptAt),now,task.id,token).run();results.push({id:task.id,status:'deferred'});continue}
     if(task.kind==='commercial_delivery')updated=applyCommercial(state,{id:eventId,type:'process_outbox',input:{outboxId:item.id,outcome:outcome==='success'?'success':'failure'},expectedVersion:state.version},owner.id,new Date(now).toISOString()).state;
     else updated=(await applyField(state,{clientEventId:eventId,type:'deliver_batch',input:{batchId:item.id,outcome:outcome==='success'?'success':'failure'},expectedVersion:state.version},owner.id,new Date(now).toISOString())).state;
     if(outcome!=='success'){
      const changed=updated[task.kind==='commercial_delivery'?'outbox':'batches'].find(i=>i.id===item.id);
      status=outcome==='permanent'||changed.attempts>=3?'review':'retry';next=Date.parse(changed.nextAttemptAt);detail='Synthetic provider '+outcome+' failure';
     }
    }
   }else if(task.kind==='recurrence')updated=applyCommercial(state,{id:eventId,type:'generate_jobs',input:{planId:item.id,...policy.options},expectedVersion:state.version},owner.id,new Date(now).toISOString()).state;
   else{
    updated=item.status==='complete'?state:(await applyField(state,{clientEventId:eventId,type:'advance_export',input:{exportId:item.id},expectedVersion:state.version},owner.id,new Date(now).toISOString())).state;
    if(updated.exports.find(e=>e.id===item.id).status!=='complete'){status='retry';next=now;detail='Export chunk saved; more work remains'}
   }
   const payload=JSON.stringify(updated);
   // D1 batch is transactional: workspace, task checkpoint, history and audit commit together.
   const committed=await DB.batch([
    DB.prepare(`UPDATE ${table} SET payload=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE customer_id=? AND version=? AND EXISTS(SELECT 1 FROM backend_tasks WHERE id=? AND lease_token=? AND lease_until>?)`).bind(payload,customerId,row.version,task.id,token,now),
    DB.prepare(`UPDATE backend_tasks SET status=?,next_attempt_at=?,last_error=?,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND lease_token=? AND EXISTS(SELECT 1 FROM ${table} WHERE customer_id=? AND version=? AND payload=?)`).bind(status,next,status==='succeeded'?null:detail,now,task.id,token,customerId,row.version+1,payload),
    DB.prepare('INSERT INTO backend_task_history(id,task_id,attempt,actor_id,outcome,detail,occurred_at) SELECT ?,id,attempts,created_by,?,?,? FROM backend_tasks WHERE id=? AND version=?').bind(crypto.randomUUID(),status,detail,now,task.id,task.version+1),
    DB.prepare('INSERT INTO access_audit(id,actor_id,action,resource_type,resource_id,decision) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),owner.id,'TASK_ATTEMPT','backend_task',task.id,'allow')
   ]);
   if(committed[1].meta?.changes!==1){
    await DB.prepare("UPDATE backend_tasks SET status='retry',attempts=attempts-1,next_attempt_at=?,lease_token=NULL,lease_until=NULL,last_error='Concurrent workspace update; retry',version=version+1,updated_at=? WHERE id=? AND lease_token=?").bind(now+1000,now,task.id,token).run();
    results.push({id:task.id,status:'conflict'});
   }else results.push({id:task.id,status});
  }catch(e){
   // Storage faults leave the lease/checkpoint recoverable; domain validation needs a human decision.
   if(e.status&&e.status<500){await stopTask(DB,task,token,'review',String(e.message).slice(0,300),now);results.push({id:task.id,status:'review'})}
   else results.push({id:task.id,status:'recoverable',error:'Storage or processing unavailable; lease will expire'});
  }
 }
 return {synthetic:true,processed:results.length,results};
}
export async function controlTask(DB,customerId,actor,input,now=Date.now()){
 if(!input||!['cancel','retry'].includes(input.action)||!Number.isInteger(input.expectedVersion)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>200)fail('Action, version and review reason required',400);
 const task=await DB.prepare('SELECT * FROM backend_tasks WHERE id=? AND customer_id=?').bind(input.taskId,customerId).first();
 if(!task)fail('Task not found',404);
 if(task.version!==input.expectedVersion||task.status==='running'||['succeeded','cancelled'].includes(task.status))fail('Task changed, is running or is terminal');
 if(input.action==='retry'&&!['review','blocked'].includes(task.status))fail('Only reviewed or blocked tasks can be resumed');
 if(input.action==='retry'&&task.created_by!==actor)fail('Only the original authorized owner can resume this task',403);
 if(input.action==='cancel'){
  const saved=await DB.batch([
   DB.prepare("UPDATE backend_tasks SET status='cancelled',lease_token=NULL,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND customer_id=? AND version=? AND status NOT IN ('running','succeeded','cancelled')").bind(now,task.id,customerId,task.version),
   DB.prepare('INSERT INTO backend_task_history(id,task_id,attempt,actor_id,outcome,detail,occurred_at) SELECT ?,id,attempts,?,?,?,? FROM backend_tasks WHERE id=? AND version=?').bind(crypto.randomUUID(),actor,'cancelled',input.reason,now,task.id,task.version+1),
   DB.prepare('INSERT INTO access_audit(id,actor_id,action,resource_type,resource_id,decision) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),actor,'TASK_CANCEL','backend_task',task.id,'allow')
  ]);
  if(saved[0].meta?.changes!==1)fail('Task changed; refresh before cancellation');
  return {task:visible(await DB.prepare('SELECT * FROM backend_tasks WHERE id=?').bind(task.id).first())};
 }
 const {table,row,state,item}=await source(DB,customerId,task.kind,task.source_id);
 let updated=state;
 if(input.action==='retry'&&item.attempts>=3){
  const key=`demo-review-${task.id}-${task.generation+1}`;
  if(task.kind==='commercial_delivery')updated=applyCommercial(state,{id:key,type:'review_delivery',input:{outboxId:item.id,reason:input.reason},expectedVersion:state.version},actor,new Date(now).toISOString()).state;
  if(task.kind==='certificate_delivery')updated=(await applyField(state,{clientEventId:key,type:'review_batch',input:{batchId:item.id,reason:input.reason},expectedVersion:state.version},actor,new Date(now).toISOString())).state;
 }
 const status=input.action==='cancel'?'cancelled':'pending', payload=JSON.stringify(updated);
 const results=await DB.batch([
  DB.prepare(`UPDATE ${table} SET payload=?,version=version+1 WHERE customer_id=? AND version=? AND EXISTS(SELECT 1 FROM backend_tasks WHERE id=? AND version=?)`).bind(payload,customerId,row.version,task.id,task.version),
  DB.prepare(`UPDATE backend_tasks SET status=?,generation=generation+1,attempts=0,next_attempt_at=?,last_error=NULL,version=version+1,updated_at=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM ${table} WHERE customer_id=? AND version=? AND payload=?)`).bind(status,now,now,task.id,task.version,customerId,row.version+1,payload),
  DB.prepare('INSERT INTO backend_task_history(id,task_id,attempt,actor_id,outcome,detail,occurred_at) SELECT ?,id,0,?,?,?,? FROM backend_tasks WHERE id=? AND version=?').bind(crypto.randomUUID(),actor,status,input.reason,now,task.id,task.version+1),
  DB.prepare('INSERT INTO access_audit(id,actor_id,action,resource_type,resource_id,decision) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),actor,'TASK_REVIEW','backend_task',task.id,'allow')
 ]);
 if(results[1].meta?.changes!==1)fail('Task or source changed; refresh before review');
 return {task:visible(await DB.prepare('SELECT * FROM backend_tasks WHERE id=?').bind(task.id).first())};
}
