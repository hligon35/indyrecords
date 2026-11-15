import {parseCsv} from '../packages/integrations/adapters.js';
import {digest} from './auth.js';
const fail=(m,status=400)=>{throw Object.assign(Error(m),{status})};
export async function reconcileFinance(DB,p,customerId,x,now=Date.now()){
 const parsed=parseCsv(x?.csv,{maxRows:1000});
 if(parsed.header.join(',')!=='ExternalID,Kind,Reference,AmountCents,Currency')fail('Use ExternalID,Kind,Reference,AmountCents,Currency');
 const hash=await digest(x.csv),old=await DB.prepare('SELECT * FROM finance_reconciliations WHERE customer_id=? AND source_hash=?').bind(customerId,hash).first();
 if(old)return {status:'already_accepted',run:view(old)};
 if((await DB.prepare('SELECT COUNT(*) AS n FROM finance_reconciliations WHERE customer_id=?').bind(customerId).first()).n>=500)fail('Synthetic reconciliation retention limit reached',413);
 const row=await DB.prepare('SELECT payload FROM commercial_workspaces WHERE customer_id=?').bind(customerId).first();if(!row)fail('Commercial workspace not found',404);
 const state=JSON.parse(row.payload),expected=[];
 for(const payment of state.payments.filter(p=>p.status==='captured')){
  expected.push({kind:'capture',reference:payment.id,amountCents:payment.amountCents});
  for(const refund of payment.refunds.filter(r=>r.status==='refunded'))expected.push({kind:'refund',reference:refund.id,amountCents:refund.amountCents});
 }
 const results=[],seen=new Set(),references=new Set();
 for(const [i,r] of parsed.rows.entries()){
  if(!/^demo-[A-Za-z0-9-]{1,100}$/.test(r.ExternalID)||!['capture','refund'].includes(r.Kind)||!/^demo-[A-Za-z0-9-]{1,100}$/.test(r.Reference)||!/^\d{1,9}$/.test(r.AmountCents)||r.Currency!=='USD')fail('Invalid synthetic settlement row '+(i+2));
  const key=r.Kind+':'+r.Reference;
  if(seen.has(r.ExternalID)||references.has(key))fail('Duplicate external ID or settlement reference at row '+(i+2));
  seen.add(r.ExternalID);references.add(key);
  const match=expected.find(e=>e.kind===r.Kind&&e.reference===r.Reference),amountCents=Number(r.AmountCents);
  results.push({externalId:r.ExternalID,kind:r.Kind,reference:r.Reference,amountCents,expectedCents:match?.amountCents??null,status:!match?'unknown':match.amountCents===amountCents?'matched':'mismatch'});
 }
 for(const e of expected)if(!references.has(e.kind+':'+e.reference))results.push({...e,status:'missing'});
 const id=crypto.randomUUID(),report={schemaVersion:1,synthetic:true,currency:'USD',asOf:now,sourceWorkspaceVersion:state.version,results,matched:results.filter(r=>r.status==='matched').length,exceptions:results.filter(r=>r.status!=='matched').length,ledgerModified:false};
 await DB.batch([
  DB.prepare('INSERT INTO finance_reconciliations(id,customer_id,created_by,source_hash,report,created_at) VALUES(?,?,?,?,?,?)').bind(id,customerId,p.id,hash,JSON.stringify(report),now),
  DB.prepare('INSERT INTO access_audit(id,actor_id,action,resource_type,resource_id,decision) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),p.id,'FINANCE_RECONCILE','reconciliation',id,'allow')
 ]);
 return {status:'accepted',run:view(await DB.prepare('SELECT * FROM finance_reconciliations WHERE id=?').bind(id).first())};
}
const view=r=>({...r,report:JSON.parse(r.report)});
export async function listReconciliations(DB,customerId,cursor=''){
 const rows=(await DB.prepare('SELECT * FROM finance_reconciliations WHERE customer_id=? AND id>? ORDER BY id LIMIT 51').bind(customerId,cursor).all()).results||[];
 return {items:rows.slice(0,50).map(view),nextCursor:rows.length>50?rows[49].id:null};
}
export async function reviewReconciliation(DB,p,customerId,x,now=Date.now()){
 if(!Number.isInteger(x.expectedVersion)||typeof x.reason!=='string'||!x.reason.trim()||x.reason.length>300)fail('Version and review reason required');
 const r=await DB.batch([
  DB.prepare("UPDATE finance_reconciliations SET status='reviewed',reviewed_by=?,review_reason=?,reviewed_at=?,version=version+1 WHERE id=? AND customer_id=? AND version=? AND status='open'").bind(p.id,x.reason,now,x.reconciliationId,customerId,x.expectedVersion),
  DB.prepare('INSERT INTO access_audit(id,actor_id,action,resource_type,resource_id,decision) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),p.id,'FINANCE_REVIEW','reconciliation',String(x.reconciliationId).slice(0,100),'allow')
 ]);if(r[0].meta?.changes!==1)fail('Reconciliation changed or already reviewed',409);
 return {status:'reviewed',ledgerModified:false};
}
