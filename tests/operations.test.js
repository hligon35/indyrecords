import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {buildSampleDataset,DATASET_VERSION} from '../packages/operations/sample.js';
import {verifyCustody} from '../packages/warehouse/workflows.js';
import {verifyFieldCustody} from '../packages/field/workflows.js';
import {enqueueTask,runTasks,controlTask} from '../api/operations-tasks.js';
import {digest} from '../api/auth.js';
import {handler} from '../api/worker.js';
import {scheduledOperations} from '../api/operations-scheduler.js';
const now=Date.parse('2026-11-15T16:00:00Z');
async function fixture(){
 const db=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('../scripts/seed-demo.sql',import.meta.url),'utf8'));
 db.exec("INSERT INTO app_users(id,external_subject,display_name,role,active) VALUES('u1','sample-manager','Demo manager','manager',1); INSERT INTO user_customer_access VALUES('u1','c2');");
 let failAudit=false;
 const DB={prepare(sql){let args=[];const q={bind(...values){args=values;return q},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){if(failAudit&&sql.startsWith('INSERT INTO access_audit'))throw Error('Injected audit outage');const r=db.prepare(sql).run(...args);return {success:true,meta:{changes:Number(r.changes)}}}};return q},async batch(statements){db.exec('BEGIN');try{const r=[];for(const q of statements)r.push(await q.run());db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}};
 const token='irm_session_operations';db.prepare('INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await digest(token),'u1',Date.now()+600000);
 const env={DB,SYNTHETIC_OPERATIONS_ENABLED:'true',SYNTHETIC_COMMERCIAL_ENABLED:'true',SYNTHETIC_FIELD_ENABLED:'true',SYNTHETIC_WORKFLOWS_ENABLED:'true'};
 const request=(path,body,origin='http://localhost')=>handler(new Request(origin+'/v1/operations/'+path+(body?'':(path.includes('?')?'&':'?')+'customerId=c2'),{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body?JSON.stringify({customerId:'c2',...body}):undefined}),env);
 const install=async()=>{const r=await request('sample',{datasetVersion:DATASET_VERSION});assert.equal(r.status,201,JSON.stringify(await r.clone().json()))};
 return {db,env,request,install,auditOutage(v){failAudit=v}};
}
test('complete sample is deterministic across four isolated tenants with valid custody and financial references',async()=>{
 for(const tenant of ['c1','c2','c3','c4']){
  const sample=await buildSampleDataset(tenant);
  assert.deepEqual(sample,await buildSampleDataset(tenant));
  assert.ok(await verifyCustody(sample.warehouse.custody));assert.ok(await verifyFieldCustody(sample.field.custody));
  assert.equal(sample.commercial.accounts.length,4);assert.equal(sample.commercial.invoices.length,2);
  assert.equal(sample.field.certificates[0].title,'SAMPLE / NOT PROOF OF DESTRUCTION');
  assert.ok(sample.field.jobs.every(j=>j.customerId===tenant));
  for(const j of sample.field.jobs)assert.ok(sample.commercial.jobs.some(c=>c.id===j.commercialJobId));
  assert.deepEqual(new Set(sample.field.jobs.map(j=>j.status)),new Set(['completed','exception','unassigned','assigned']));
  assert.equal(sample.warehouse.orders.find(o=>o.direction==='outbound').status,'delivered');
 }
});
test('sample install is atomic, idempotent, scoped and refuses to replace existing work',async()=>{
 const f=await fixture();try{
  const before=f.db.prepare('SELECT * FROM records').all();
  await f.install();assert.equal((await f.request('sample',{datasetVersion:DATASET_VERSION})).status,200);
  assert.deepEqual(f.db.prepare('SELECT * FROM records').all(),before);
  assert.equal(f.db.prepare("SELECT active FROM app_users WHERE id='demo-user-sample-c2-driver'").get().active,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sample_datasets').get().n,1);
  assert.equal((await f.request('sample',{customerId:'c3',datasetVersion:DATASET_VERSION})).status,403);
  assert.equal((await f.request('status',null,'https://public.example')).status,403);
  f.db.exec("UPDATE app_users SET role='dispatcher' WHERE id='u1'");assert.equal((await f.request('status')).status,403);
 }finally{f.db.close()}
 const other=await fixture();try{
  other.db.prepare('INSERT INTO commercial_workspaces(customer_id,payload) VALUES(?,?)').run('c2','{}');
  assert.equal((await other.request('sample',{datasetVersion:DATASET_VERSION})).status,409);
  assert.equal(other.db.prepare('SELECT COUNT(*) AS n FROM field_workspaces').get().n,0);
 }finally{other.db.close()}
});
test('sample installation rolls back all workspace and account inserts when its audit fails',async()=>{
 const f=await fixture();try{f.auditOutage(true);assert.equal((await f.request('sample',{datasetVersion:DATASET_VERSION})).status,503);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM commercial_workspaces').get().n,0);assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM app_users WHERE id LIKE 'demo-user-sample-%'").get().n,0)}finally{f.db.close()}
});
test('durable deliveries retry after backoff and update real synthetic payment state exactly once',async()=>{
 const f=await fixture();try{
  await f.install();const state=JSON.parse(f.db.prepare('SELECT payload FROM commercial_workspaces').get().payload), payment=state.payments.find(p=>p.status==='pending'), outbox=state.outbox.find(o=>o.entityId===payment.id);
  const input={kind:'commercial_delivery',sourceId:outbox.id,requestKey:'demo-payment-test',outcomes:['transient','success']};
  const queued=await enqueueTask(f.env.DB,'c2','u1',input,now);
  assert.equal((await enqueueTask(f.env.DB,'c2','u1',input,now)).status,'already_accepted');
  await assert.rejects(enqueueTask(f.env.DB,'c2','u1',{...input,outcomes:['success']},now),/different/);
  const attempt=await runTasks(f.env,'c2',{now});assert.equal(attempt.results[0].status,'retry');
  assert.equal((await runTasks(f.env,'c2',{now:now+1000})).processed,0);
  assert.equal((await runTasks(f.env,'c2',{now:now+120000})).results[0].status,'succeeded');
  const final=JSON.parse(f.db.prepare('SELECT payload FROM commercial_workspaces').get().payload);
  assert.equal(final.payments.find(p=>p.id===payment.id).status,'captured');
  assert.equal(final.outbox.find(o=>o.id===outbox.id).attempts,2);
  assert.equal((await runTasks(f.env,'c2',{now:now+999999})).processed,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM backend_task_history WHERE task_id=?').get(queued.task.id).n,3);
 }finally{f.db.close()}
});
test('expired worker leases recover without consuming an extra provider attempt and concurrent runners do not duplicate',async()=>{
 const f=await fixture();try{
  await f.install();const s=JSON.parse(f.db.prepare('SELECT payload FROM field_workspaces').get().payload);
  const queued=await enqueueTask(f.env.DB,'c2','u1',{kind:'certificate_delivery',sourceId:s.batches[0].id,requestKey:'demo-mail-recovery'},now);
  f.db.prepare("UPDATE backend_tasks SET status='running',attempts=1,lease_token='crashed',lease_until=? WHERE id=?").run(now-1,queued.task.id);
  await Promise.all([runTasks(f.env,'c2',{now}),runTasks(f.env,'c2',{now})]);
  const final=JSON.parse(f.db.prepare('SELECT payload FROM field_workspaces').get().payload);
  assert.equal(final.batches[0].status,'simulated_sent');assert.equal(final.batches[0].attempts,1);
 }finally{f.db.close()}
});
test('revoked grants and feature flags block queued work; explicit authorized review resumes it',async()=>{
 const f=await fixture();try{
  await f.install();const s=JSON.parse(f.db.prepare('SELECT payload FROM field_workspaces').get().payload);
  const q=await enqueueTask(f.env.DB,'c2','u1',{kind:'field_export',sourceId:s.exports[0].id,requestKey:'demo-export-revocation'},now);
  f.db.exec("DELETE FROM user_customer_access WHERE user_id='u1'");
  assert.equal((await runTasks(f.env,'c2',{now})).results[0].status,'blocked');
  f.db.exec("INSERT INTO user_customer_access VALUES('u1','c2')");
  const task=f.db.prepare('SELECT * FROM backend_tasks WHERE id=?').get(q.task.id);
  await controlTask(f.env.DB,'c2','u1',{taskId:task.id,action:'retry',expectedVersion:task.version,reason:'Demo access restored'},now);
  assert.equal((await runTasks(f.env,'c2',{now})).results[0].status,'succeeded');
 }finally{f.db.close()}
});
test('audit outages roll back provider effects and task checkpoints; recovering the lease safely retries',async()=>{
 const f=await fixture();try{
  await f.install();const s=JSON.parse(f.db.prepare('SELECT payload FROM field_workspaces').get().payload);
  await enqueueTask(f.env.DB,'c2','u1',{kind:'certificate_delivery',sourceId:s.batches[0].id,requestKey:'demo-audit-recovery'},now);
  f.auditOutage(true);assert.equal((await runTasks(f.env,'c2',{now})).results[0].status,'recoverable');
  assert.equal(JSON.parse(f.db.prepare('SELECT payload FROM field_workspaces').get().payload).batches[0].attempts,0);
  f.auditOutage(false);assert.equal((await runTasks(f.env,'c2',{now:now+61000})).results[0].status,'succeeded');
  assert.equal(JSON.parse(f.db.prepare('SELECT payload FROM field_workspaces').get().payload).batches[0].attempts,1);
 }finally{f.db.close()}
});
test('permanent failures require review; source uniqueness and tenant-scoped history are enforced',async()=>{
 const f=await fixture();try{
  await f.install();const s=JSON.parse(f.db.prepare('SELECT payload FROM field_workspaces').get().payload);
  const input={kind:'certificate_delivery',sourceId:s.batches[0].id,requestKey:'demo-permanent-mail',outcomes:['permanent']};
  const q=await enqueueTask(f.env.DB,'c2','u1',input,now);
  await assert.rejects(enqueueTask(f.env.DB,'c2','u1',{...input,requestKey:'demo-duplicate-mail'},now),/active task/);
  assert.equal((await runTasks(f.env,'c2',{now})).results[0].status,'review');
  assert.equal((await runTasks(f.env,'c2',{now:now+999999})).processed,0);
  const task=f.db.prepare('SELECT * FROM backend_tasks WHERE id=?').get(q.task.id);
  await controlTask(f.env.DB,'c2','u1',{taskId:task.id,action:'cancel',expectedVersion:task.version,reason:'Demo cancel after review'},now);
  assert.equal(f.db.prepare('SELECT status FROM backend_tasks WHERE id=?').get(task.id).status,'cancelled');
  assert.equal((await f.request('history?taskId='+task.id+'&customerId=c3')).status,403);
 }finally{f.db.close()}
});
test('recurrence and chunked exports run through the opt-in scheduler and remain deduplicated',async()=>{
 const f=await fixture();try{
  await f.install();const c=JSON.parse(f.db.prepare('SELECT payload FROM commercial_workspaces').get().payload),field=JSON.parse(f.db.prepare('SELECT payload FROM field_workspaces').get().payload);
  await enqueueTask(f.env.DB,'c2','u1',{kind:'recurrence',sourceId:c.plans[0].id,requestKey:'demo-december-generation',from:'2026-12-01',through:'2026-12-31'},now);
  await enqueueTask(f.env.DB,'c2','u1',{kind:'field_export',sourceId:field.exports[0].id,requestKey:'demo-scheduled-export'},now);
  assert.equal((await scheduledOperations(f.env,now)).disabled,true);
  f.env.SYNTHETIC_OPERATIONS_SCHEDULER_ENABLED='true';
  await scheduledOperations(f.env,now);await scheduledOperations(f.env,now);
  const after=JSON.parse(f.db.prepare('SELECT payload FROM commercial_workspaces').get().payload);
  assert.equal(new Set(after.jobs.map(j=>j.occurrence)).size,after.jobs.length);assert.ok(after.jobs.length>c.jobs.length);
  assert.equal(JSON.parse(f.db.prepare('SELECT payload FROM field_workspaces').get().payload).exports[0].status,'complete');
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM backend_tasks WHERE status='succeeded'").get().n,2);
 }finally{f.db.close()}
});
test('document API enforces verified role and customer scope and serves backend PDF envelopes',async()=>{
 const f=await fixture();try{
  await f.install();const c=JSON.parse(f.db.prepare('SELECT payload FROM commercial_workspaces').get().payload),id=c.invoices[0].id;
  const response=await f.request('document?type=invoice&id='+id+'&format=pdf');assert.equal(response.status,200);
  const pdf=await response.json(),bytes=Buffer.from(pdf.content,'base64');assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  assert.equal(pdf.sha256,Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'));
  assert.equal((await f.request('document?type=invoice&id=missing')).status,404);
  assert.equal((await f.request('document?type=operations&customerId=c3')).status,403);
  f.db.exec("UPDATE app_users SET role='warehouse' WHERE id='u1'");assert.equal((await f.request('document?type=operations')).status,403);
 }finally{f.db.close()}
});
test('large task exports checkpoint repeatedly, survive an interrupted lease and preserve every source row',async()=>{
 const f=await fixture();try{
  await f.install();const field=JSON.parse(f.db.prepare('SELECT payload FROM field_workspaces').get().payload);
  field.exports[0].source=Array.from({length:1205},(_,i)=>({id:'demo-job-'+i,status:'assigned',date:'2026-11-15',driverId:'demo-driver',production:0}));
  f.db.prepare('UPDATE field_workspaces SET payload=?').run(JSON.stringify(field));
  const q=await enqueueTask(f.env.DB,'c2','u1',{kind:'field_export',sourceId:field.exports[0].id,requestKey:'demo-large-export'},now);
  for(let n=0;n<13;n++){
   if(n===4)f.db.prepare("UPDATE backend_tasks SET status='running',attempts=attempts+1,lease_until=? WHERE id=?").run(now-1,q.task.id);
   await runTasks(f.env,'c2',{now});
  }
  const done=JSON.parse(f.db.prepare('SELECT payload FROM field_workspaces').get().payload).exports[0];
  assert.equal(done.rows.length,1205);assert.deepEqual(done.rows,field.exports[0].source);
  assert.equal(f.db.prepare('SELECT status FROM backend_tasks WHERE id=?').get(q.task.id).status,'succeeded');
 }finally{f.db.close()}
});
test('concurrent workspace edits checkpoint no provider effects and safely retry the same attempt',async()=>{
 const f=await fixture();try{
  await f.install();const state=JSON.parse(f.db.prepare('SELECT payload FROM commercial_workspaces').get().payload),o=state.outbox.find(o=>o.status==='pending');
  const q=await enqueueTask(f.env.DB,'c2','u1',{kind:'commercial_delivery',sourceId:o.id,requestKey:'demo-cas-retry'},now);
  const batch=f.env.DB.batch;let raced=false;
  f.env.DB.batch=async statements=>{if(!raced){raced=true;const changed=JSON.parse(f.db.prepare('SELECT payload FROM commercial_workspaces').get().payload);changed.version++;f.db.prepare('UPDATE commercial_workspaces SET version=version+1,payload=?').run(JSON.stringify(changed))}return batch(statements)};
  assert.equal((await runTasks(f.env,'c2',{now})).results[0].status,'conflict');
  assert.equal(JSON.parse(f.db.prepare('SELECT payload FROM commercial_workspaces').get().payload).outbox.find(x=>x.id===o.id).attempts,0);
  assert.equal(f.db.prepare('SELECT attempts FROM backend_tasks WHERE id=?').get(q.task.id).attempts,0);
  assert.equal((await runTasks(f.env,'c2',{now:now+1001})).results[0].status,'succeeded');
 }finally{f.db.close()}
});
test('disabled domain flags block queued processing and cannot be bypassed through task review',async()=>{
 const f=await fixture();try{
  await f.install();const s=JSON.parse(f.db.prepare('SELECT payload FROM field_workspaces').get().payload);
  const q=await enqueueTask(f.env.DB,'c2','u1',{kind:'certificate_delivery',sourceId:s.batches[0].id,requestKey:'demo-domain-disabled'},now);
  f.env.SYNTHETIC_FIELD_ENABLED='false';assert.equal((await runTasks(f.env,'c2',{now})).results[0].status,'blocked');
  assert.equal((await f.request('document?type=operations')).status,403);
  const t=f.db.prepare('SELECT version FROM backend_tasks WHERE id=?').get(q.task.id);
  assert.equal((await f.request('control',{taskId:q.task.id,action:'retry',expectedVersion:t.version,reason:'Demo disabled retry'})).status,403);
  assert.equal(JSON.parse(f.db.prepare('SELECT payload FROM field_workspaces').get().payload).batches[0].attempts,0);
 }finally{f.db.close()}
});
