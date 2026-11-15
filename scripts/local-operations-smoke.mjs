import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createApiClient} from '../packages/api-client/index.js';
import {DATASET_VERSION} from '../packages/operations/sample.js';
const token=process.env.IRM_TEST_SESSION;
if(!token)throw Error('Temporary verified local test session required');
const api=createApiClient({baseUrl:'http://127.0.0.1:8791',getAccessToken:()=>token,readOnly:false}),customerId='c2';
const out=new URL('../dist/readiness/',import.meta.url);await mkdir(out,{recursive:true});
try{
 const before=await api.searchRecords({limit:100});
 const installed=await api.installOperationsSample({customerId,datasetVersion:DATASET_VERSION});assert.equal(installed.status,'installed');
 assert.equal((await api.installOperationsSample({customerId,datasetVersion:DATASET_VERSION})).status,'already_installed');
 let c=await api.getCommercialWorkspace(customerId),f=await api.getFieldWorkspace(customerId);
 const payment=c.payments.find(p=>p.status==='pending'),capture=c.outbox.find(o=>o.entityId===payment.id);
 const task={kind:'commercial_delivery',sourceId:capture.id,requestKey:'demo-local-task-capture',outcomes:['success']};
 await api.enqueueOperation({customerId,task});assert.equal((await api.enqueueOperation({customerId,task})).status,'already_accepted');
 for(const [kind,sourceId] of [['certificate_delivery',f.batches[0].id],['field_export',f.exports[0].id]])await api.enqueueOperation({customerId,task:{kind,sourceId,requestKey:'demo-local-'+kind.replaceAll('_','-')}});
 await api.enqueueOperation({customerId,task:{kind:'recurrence',sourceId:c.plans[0].id,requestKey:'demo-local-recurrence',from:'2026-12-01',through:'2026-12-31'}});
 for(let i=0;i<3;i++)await api.runOperations({customerId,limit:10});
 const tasks=await api.getOperationsTasks(customerId);assert.equal(tasks.items.length,4);assert.ok(tasks.items.every(t=>t.status==='succeeded'));
 c=await api.getCommercialWorkspace(customerId);f=await api.getFieldWorkspace(customerId);
 assert.equal(c.payments.find(p=>p.id===payment.id).status,'captured');assert.equal(f.batches[0].status,'simulated_sent');assert.equal(f.exports[0].status,'complete');
 const pdf=await api.getOperationsDocument({customerId,type:'invoice',id:c.invoices[0].id,format:'pdf'});assert.equal(Buffer.from(pdf.content,'base64').subarray(0,5).toString(),'%PDF-');
 await writeFile(new URL('operations-local-invoice.pdf',out),Buffer.from(pdf.content,'base64'));
 assert.deepEqual(await api.searchRecords({limit:100}),before);
 await assert.rejects(api.getOperationsStatus('c3'),e=>e.status===403);
 const history=await api.getOperationsHistory(customerId,tasks.items[0].id);assert.ok(history.items.some(h=>h.outcome==='succeeded'));
 const command=(resource,input={})=>api.operationsResourceCommand({resource,customerId,...input});
 const created=[];for(const kind of ['inventory','invoices','custody','payments','field','field_custody','warehouse'])created.push(await command('exports',{kind,requestKey:'demo-local-report-'+kind.replaceAll('_','-')}));
 await api.runOperations({customerId,limit:10});
 for(const x of created){const file=await api.getOperationsResource('exports/chunk',{customerId,exportId:x.export.id,offset:0});assert.ok(file.content.startsWith('\uFEFF'));assert.equal(file.nextOffset,null)}
 const index=await api.getOperationsResource('entities',{customerId,domain:'commercial',collection:'accounts',q:'Café'});assert.equal(index.items.length,1);
 const archive=await command('archive',{type:'invoice',id:c.invoices[0].id,format:'html',requestKey:'demo-local-immutable-invoice'});
 const retained=await api.getOperationsResource('archive',{customerId,documentId:archive.id});assert.match(retained.content,/SAMPLE INVOICE/);
 assert.equal((await command('archive',{type:'invoice',id:c.invoices[0].id,format:'html',requestKey:'demo-local-immutable-invoice'})).status,'already_accepted');
 const settlement=[['ExternalID','Kind','Reference','AmountCents','Currency']];let n=0;
 for(const p of c.payments.filter(p=>p.status==='captured')){settlement.push(['demo-local-settlement-'+(++n),'capture',p.id,p.amountCents,'USD']);for(const r of p.refunds.filter(r=>r.status==='refunded'))settlement.push(['demo-local-settlement-'+(++n),'refund',r.id,r.amountCents,'USD'])}
 const finance=await command('reconciliation',{csv:settlement.map(r=>r.join(',')).join('\n')});assert.equal(finance.run.report.exceptions,0);
 await command('reconciliation/review',{reconciliationId:finance.run.id,expectedVersion:finance.run.version,reason:'Demo settlement comparison reviewed'});
 const monitor=await command('monitor');assert.equal(monitor.outboundNotificationsEnabled,false);
 const alert=monitor.alerts.find(a=>a.status==='open');if(alert)await command('monitor/acknowledge',{alertKey:alert.alert_key,expectedVersion:alert.version,reason:'Demo operator acknowledgment'});
 const retention=await command('maintenance',{retentionDays:90});assert.equal(retention.dryRun,true);
 await writeFile(new URL('operations-local.json',out),JSON.stringify({passed:true,synthetic:true,generatedAt:new Date().toISOString(),installedManifest:installed.manifest,tasks:tasks.items.map(t=>({kind:t.kind,status:t.status,attempts:t.attempts})),allTaskKindsVerified:true,sampleReplaySafe:true,queueReplaySafe:true,sourceInventoryUnchanged:true,foreignScopeDenied:true,pdfGeneratedByWorker:true,pdfSha256:pdf.sha256,productionReady:false},null,2)+'\n');
 await writeFile(new URL('complete-backend-local.json',out),JSON.stringify({passed:true,synthetic:true,generatedAt:new Date().toISOString(),datasetVersion:DATASET_VERSION,normalizedReportKinds:created.map(x=>x.export.kind),allReportsComplete:true,indexedSearchVerified:true,archiveReplaySafe:true,financeMatched:finance.run.report.matched,financeExceptions:0,alertsAcknowledged:!!alert,retentionPreviewOnly:true,sourceInventoryUnchanged:true,productionReady:false},null,2)+'\n');
 console.log('PASS: actual local D1 tasks, all seven normalized exports, indexed search, immutable archive, settlement review, alerts and retention preview.');
}finally{await api.endSession()}
