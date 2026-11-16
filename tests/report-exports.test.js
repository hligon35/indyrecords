import test from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './helpers/operations-db.js';
import {createReportExport,runReportExports,exportChunk,controlReportExport,EXPORTS} from '../api/report-exports.js';
test('normalized inventory exports snapshot more than 1,000 rows and resume after worker restart without source mutation',async()=>{
 const f=await operationsFixture();try{
  const insert=f.db.prepare("INSERT INTO records(id,barcode,customer_id,kind) VALUES(?,?,'c2','Box')");for(let i=0;i<2005;i++)insert.run('demo-large-'+String(i).padStart(5,'0'),'DEMO-BX-'+(50000+i));
  const x={kind:'inventory',requestKey:'demo-large-inventory'},q=await createReportExport(f.env,f.p,'c2',x,1000);
  assert.equal(q.export.row_count,2006);assert.equal((await createReportExport(f.env,f.p,'c2',x,1000)).status,'already_accepted');
  f.db.exec("UPDATE records SET status='Changed after snapshot' WHERE customer_id='c2'");
  for(let i=0;i<11;i++)await runReportExports(f.env,'c2',{now:1000+i});
  let offset=0,text='',rows=0;do{const part=await exportChunk(f.env,f.p,'c2',q.export.id,offset,500);text+=part.content;rows=part.rowCount;offset=part.nextOffset}while(offset!==null);
  assert.equal(rows,2006);assert.ok(!text.includes('Changed after snapshot'));assert.ok(text.includes('DEMO-BX-52004'));
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM records WHERE customer_id='c2'").get().n,2006);
  await assert.rejects(exportChunk(f.env,f.p,'c3',q.export.id),/not found/);
 }finally{f.db.close()}
});
test('all warehouse, commercial, finance and field exports use scoped snapshots and retain nested values',async()=>{
 const f=await operationsFixture();try{
  for(const kind of Object.keys(EXPORTS))await createReportExport(f.env,f.p,'c2',{kind,requestKey:'demo-'+kind.replaceAll('_','-')},1000);
  for(let i=0;i<10;i++)await runReportExports(f.env,'c2',{limit:10,now:1000+i});
  const jobs=f.db.prepare('SELECT * FROM report_exports').all();assert.equal(jobs.length,Object.keys(EXPORTS).length);assert.ok(jobs.every(j=>j.status==='complete'));
  const invoice=jobs.find(j=>j.kind==='invoices'),part=await exportChunk(f.env,f.p,'c2',invoice.id);
  assert.match(part.content,/Café/);assert.match(part.content,/refunded|credits/);
 }finally{f.db.close()}
});
test('export checkpoint rolls back when audit fails and expired leases resume; revoked owners are blocked',async()=>{
 const f=await operationsFixture();try{
  const q=await createReportExport(f.env,f.p,'c2',{kind:'invoices',requestKey:'demo-audit-export'},1000);
  f.auditOutage(true);assert.equal((await runReportExports(f.env,'c2',{now:1000})).results[0].status,'recoverable');
  assert.equal(f.db.prepare('SELECT offset FROM report_exports').get().offset,0);
  f.auditOutage(false);f.db.exec("DELETE FROM user_customer_access WHERE user_id='u1'");
  assert.equal((await runReportExports(f.env,'c2',{now:62000})).results[0].status,'blocked');
  f.db.exec("INSERT INTO user_customer_access VALUES('u1','c2')");const job=f.db.prepare('SELECT * FROM report_exports').get();
  await controlReportExport(f.env.DB,f.p,'c2',{exportId:q.export.id,action:'resume',expectedVersion:job.version,reason:'Demo reviewed access'},63000);
  assert.equal((await runReportExports(f.env,'c2',{now:64000})).results[0].status,'complete');
 }finally{f.db.close()}
});
