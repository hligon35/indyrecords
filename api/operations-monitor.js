const audit=(DB,p,action,id)=>DB.prepare('INSERT INTO access_audit(id,actor_id,action,resource_type,resource_id,decision) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),p.id,action,'operations',id,'allow');
export async function refreshAlerts(DB,customerId,now=Date.now()){
 const tasks=(await DB.prepare('SELECT status,COUNT(*) AS n FROM backend_tasks WHERE customer_id=? GROUP BY status').bind(customerId).all()).results||[];
 const stalled=await DB.prepare("SELECT COUNT(*) AS n FROM backend_tasks WHERE customer_id=? AND status IN ('pending','retry','running') AND updated_at<?").bind(customerId,now-15*60000).first();
 const reports=await DB.prepare("SELECT COUNT(*) AS n FROM report_exports WHERE customer_id=? AND (status='blocked' OR (status IN ('pending','running') AND updated_at<?))").bind(customerId,now-15*60000).first();
 const reconciliation=await DB.prepare("SELECT COUNT(*) AS n FROM finance_reconciliations WHERE customer_id=? AND status='open' AND json_extract(report,'$.exceptions')>0").bind(customerId).first();
 const row=await DB.prepare('SELECT payload FROM commercial_workspaces WHERE customer_id=?').bind(customerId).first();
 const providerFailures=row?JSON.parse(row.payload).outbox.filter(o=>o.status==='failed').length:0;
 const count=s=>tasks.find(t=>t.status===s)?.n||0;
 const observed=[['task-review','warning',count('review'),'Review failed processing'],['access-blocked','warning',count('blocked'),'Review revoked access or disabled sources'],['stalled-processing','warning',stalled.n,'Inspect due jobs and scheduler'],['report-processing','warning',reports.n,'Inspect report processing'],['finance-exceptions','warning',reconciliation.n,'Review settlement differences'],['provider-failures','warning',providerFailures,'Inspect synthetic provider failures']];
 await DB.batch(observed.map(([key,severity,total,message])=>DB.prepare(`INSERT INTO operation_alerts(customer_id,alert_key,severity,detail,status,first_seen,last_seen) VALUES(?,?,?,?,?,?,?) ON CONFLICT(customer_id,alert_key) DO UPDATE SET detail=excluded.detail,last_seen=excluded.last_seen,status=CASE WHEN ?=0 THEN 'resolved' WHEN operation_alerts.status='resolved' THEN 'open' ELSE operation_alerts.status END,acknowledged_by=CASE WHEN operation_alerts.status='resolved' AND ?>0 THEN NULL ELSE operation_alerts.acknowledged_by END,reason=CASE WHEN operation_alerts.status='resolved' AND ?>0 THEN NULL ELSE operation_alerts.reason END,version=operation_alerts.version+1`).bind(customerId,key,severity,JSON.stringify({count:total,message,synthetic:true}),total?'open':'resolved',now,now,total,total,total)));
 return monitoring(DB,customerId);
}
export async function monitoring(DB,customerId){
 const alerts=(await DB.prepare('SELECT * FROM operation_alerts WHERE customer_id=? ORDER BY alert_key').bind(customerId).all()).results||[];
 const taskCounts=(await DB.prepare('SELECT status,COUNT(*) AS total FROM backend_tasks WHERE customer_id=? GROUP BY status').bind(customerId).all()).results||[];
 const exportCounts=(await DB.prepare('SELECT status,COUNT(*) AS total,SUM(row_count) AS rows FROM report_exports WHERE customer_id=? GROUP BY status').bind(customerId).all()).results||[];
 return {synthetic:true,productionReady:false,alerts:alerts.map(a=>({...a,detail:JSON.parse(a.detail),history:JSON.parse(a.history||'[]')})),taskCounts,exportCounts,outboundNotificationsEnabled:false};
}
export async function acknowledgeAlert(DB,p,customerId,x){
 if(!x||!Number.isInteger(x.expectedVersion)||typeof x.reason!=='string'||!x.reason.trim()||x.reason.length>200)throw Object.assign(Error('Version and acknowledgment reason required'),{status:400});
 const r=await DB.batch([DB.prepare("UPDATE operation_alerts SET status='acknowledged',acknowledged_by=?,reason=?,history=json_insert(history,'$[#]',json_object('actor',?,'reason',?,'at',?,'kind','acknowledged')),version=version+1 WHERE customer_id=? AND alert_key=? AND version=? AND status='open'").bind(p.id,x.reason,p.id,x.reason,Date.now(),customerId,x.alertKey,x.expectedVersion),audit(DB,p,'ALERT_ACKNOWLEDGE',String(x.alertKey).slice(0,100))]);
 if(r[0].meta?.changes!==1)throw Object.assign(Error('Alert changed or is no longer open'),{status:409});return {acknowledged:true};
}
export async function maintainOperations(DB,p,customerId,x,now=Date.now()){
 const days=x.retentionDays??90;if(!Number.isInteger(days)||days<30||days>3650)throw Object.assign(Error('Retention must be 30-3650 days'),{status:400});
 const cutoff=now-days*86400000;
 const tasks=await DB.prepare("SELECT COUNT(*) AS n FROM backend_tasks WHERE customer_id=? AND status IN ('succeeded','cancelled') AND updated_at<?").bind(customerId,cutoff).first();
 const reports=await DB.prepare("SELECT COUNT(*) AS n FROM report_exports WHERE customer_id=? AND status IN ('complete','cancelled') AND updated_at<?").bind(customerId,cutoff).first();
 const preview={synthetic:true,retentionDays:days,cutoff,terminalTasks:tasks.n,completedExports:reports.n,businessRecordsDeleted:false,auditDeleted:false,archivesDeleted:false};
 if(x.confirm!=='DELETE_TERMINAL_SYNTHETIC_JOBS')return {...preview,dryRun:true};
 await DB.batch([
  DB.prepare("DELETE FROM backend_task_history WHERE task_id IN (SELECT id FROM backend_tasks WHERE customer_id=? AND status IN ('succeeded','cancelled') AND updated_at<?)").bind(customerId,cutoff),
  DB.prepare("DELETE FROM backend_tasks WHERE customer_id=? AND status IN ('succeeded','cancelled') AND updated_at<?").bind(customerId,cutoff),
  DB.prepare("DELETE FROM report_exports WHERE customer_id=? AND status IN ('complete','cancelled') AND updated_at<?").bind(customerId,cutoff),
  audit(DB,p,'SYNTHETIC_RETENTION',customerId+':'+days)
 ]);return {...preview,dryRun:false};
}
