import test from 'node:test';import assert from 'node:assert/strict';
import {operationsFixture} from './helpers/operations-db.js';
import {reconcileFinance,reviewReconciliation} from '../api/finance-reconciliation.js';
import {archiveDocument,readArchive} from '../api/document-service.js';
import {refreshAlerts,acknowledgeAlert,maintainOperations} from '../api/operations-monitor.js';
test('settlement reconciliation reports matched/mismatched/missing entries without changing money and retains review history',async()=>{
 const f=await operationsFixture();try{
  const before=f.db.prepare('SELECT payload FROM commercial_workspaces').get().payload,s=JSON.parse(before),p=s.payments.find(p=>p.status==='captured');
  const csv='ExternalID,Kind,Reference,AmountCents,Currency\n'+`demo-settlement-1,capture,${p.id},${p.amountCents},USD\n`;
  const q=await reconcileFinance(f.env.DB,f.p,'c2',{csv},1000);assert.equal(q.run.report.matched,1);assert.equal(q.run.report.exceptions,1);assert.equal((await reconcileFinance(f.env.DB,f.p,'c2',{csv},1000)).status,'already_accepted');
  await reviewReconciliation(f.env.DB,f.p,'c2',{reconciliationId:q.run.id,expectedVersion:0,reason:'Demo missing refund reviewed'},2000);
  assert.equal(f.db.prepare('SELECT payload FROM commercial_workspaces').get().payload,before);
  await assert.rejects(reconcileFinance(f.env.DB,f.p,'c2',{csv:csv+`demo-settlement-2,capture,${p.id},${p.amountCents},USD\n`}),/Duplicate/);
  const mismatch=await reconcileFinance(f.env.DB,f.p,'c2',{csv:csv.replace(`,${p.amountCents},`,`,${p.amountCents-1},`)});assert.equal(mismatch.run.report.results[0].status,'mismatch');
 }finally{f.db.close()}
});
test('document archives remain unchanged after source edits, reject SQL mutation and replay safely',async()=>{
 const f=await operationsFixture();try{
  const s=JSON.parse(f.db.prepare('SELECT payload FROM commercial_workspaces').get().payload),x={type:'invoice',id:s.invoices[0].id,format:'html',requestKey:'demo-archive-invoice'};
  const a=await archiveDocument(f.env,f.p,'c2',x,1000),first=await readArchive(f.env.DB,'c2',a.id);
  s.accounts[0].name='Demo changed';f.db.prepare('UPDATE commercial_workspaces SET payload=?').run(JSON.stringify(s));
  assert.equal((await readArchive(f.env.DB,'c2',a.id)).content,first.content);assert.equal((await archiveDocument(f.env,f.p,'c2',x)).status,'already_accepted');
  assert.throws(()=>f.db.prepare("UPDATE document_archive SET content='tampered'").run(),/append-only/);
  assert.throws(()=>f.db.exec('DELETE FROM document_archive'),/append-only/);
  await assert.rejects(readArchive(f.env.DB,'c3',a.id),/not found/);
 }finally{f.db.close()}
});
test('monitor alerts acknowledge and resolve without outbound messages; retention preserves business/audit/archives',async()=>{
 const f=await operationsFixture();try{
  let m=await refreshAlerts(f.env.DB,'c2',1000),alert=m.alerts.find(a=>a.alert_key==='provider-failures');assert.equal(alert.status,'open');
  await acknowledgeAlert(f.env.DB,f.p,'c2',{alertKey:alert.alert_key,expectedVersion:alert.version,reason:'Demo failure being reviewed'});
  m=await refreshAlerts(f.env.DB,'c2',2000);assert.equal(m.alerts.find(a=>a.alert_key===alert.alert_key).status,'acknowledged');
  const s=JSON.parse(f.db.prepare('SELECT payload FROM commercial_workspaces').get().payload);s.outbox.forEach(o=>{if(o.status==='failed')o.status='succeeded'});f.db.prepare('UPDATE commercial_workspaces SET payload=?').run(JSON.stringify(s));
  m=await refreshAlerts(f.env.DB,'c2',3000);assert.equal(m.alerts.find(a=>a.alert_key===alert.alert_key).status,'resolved');assert.equal(m.outboundNotificationsEnabled,false);
  s.outbox[0].status='failed';f.db.prepare('UPDATE commercial_workspaces SET payload=?').run(JSON.stringify(s));m=await refreshAlerts(f.env.DB,'c2',4000);const reopened=m.alerts.find(a=>a.alert_key===alert.alert_key);assert.equal(reopened.status,'open');assert.equal(reopened.history.length,1);assert.equal(reopened.history[0].actor,'u1');
  const preview=await maintainOperations(f.env.DB,f.p,'c2',{retentionDays:30},Date.now());assert.equal(preview.dryRun,true);
  assert.equal((await maintainOperations(f.env.DB,f.p,'c2',{retentionDays:30,confirm:'DELETE_TERMINAL_SYNTHETIC_JOBS'},Date.now())).auditDeleted,false);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM records').get().n,4);
 }finally{f.db.close()}
});
