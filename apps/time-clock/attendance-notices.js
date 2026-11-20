import { readDeliveryState, sendTransactional } from './resend.js';

const MINUTE = 60_000;
const DAY = 1440 * MINUTE;
const uuid = () => crypto.randomUUID();

export function noticeStatements(env, recipient, kind, detail, options = {}) {
 const db = env.DB;
 const id = uuid();
 const now = Date.now();
 const guard = options.guard || '1';
 const args = options.args || [];
 const statements = [];
 if (options.signal) {
  statements.push(db.prepare(`INSERT OR IGNORE INTO attendance_notice_receipts(employee_id,signal_key,notification_id)
   SELECT ?,?,? WHERE ${guard}`).bind(recipient,options.signal,id,...args));
 }
 const condition = options.signal ?
  'EXISTS(SELECT 1 FROM attendance_notice_receipts WHERE employee_id=? AND signal_key=? AND notification_id=?)' : guard;
 const bindings = options.signal ? [recipient,options.signal,id] : args;
 statements.push(db.prepare(`INSERT INTO attendance_notifications(id,employee_id,event_kind,detail)
  SELECT ?,?,?,? WHERE ${condition}`).bind(id,recipient,kind,detail,...bindings));
 if (env.EMAIL_ENABLED === 'true') {
  statements.push(db.prepare(`INSERT INTO attendance_email_outbox(id,employee_id,event_kind,detail,created_ms,next_ms)
   SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM attendance_notifications WHERE id=?)
   AND EXISTS(SELECT 1 FROM employees WHERE id=? AND active=1 AND email IS NOT NULL)
   AND COALESCE((SELECT enabled FROM attendance_email_preferences WHERE employee_id=?),1)=1`)
   .bind(id,recipient,kind,detail,now,now,id,recipient,recipient));
 }
 return statements;
}

async function finish(db,row,lease,state,reason,now,next=now,providerId=row.provider_id) {
 const receipt = uuid();
 await db.batch([
  db.prepare(`UPDATE attendance_email_outbox SET state=?,next_ms=?,provider_id=?,lease_id=NULL
   WHERE id=? AND lease_id=?`).bind(state,next,providerId,row.id,lease),
  db.prepare(`INSERT INTO attendance_email_history(id,outbox_id,state,reason,occurred_ms)
   SELECT ?,?,?,?,? WHERE changes()=1`).bind(receipt,row.id,state,reason,now),
  db.prepare(`UPDATE attendance_notifications SET email_state=? WHERE id=?
   AND EXISTS (SELECT 1 FROM attendance_email_history WHERE id=?)`)
   .bind({ACCEPTED:'SENT',DELIVERED:'SENT',BOUNCED:'FAILED',FAILED:'FAILED',SUPPRESSED:'DISABLED',UNCONFIRMED:'SENT'}[state] || 'NOT_SENT',row.id,receipt)
 ]);
}

export async function deliverAttendanceEmail(env, now) {
 if (env.EMAIL_ENABLED !== 'true' || !env.RESEND_API_KEY || env.RESEND_VERIFIED_FROM_DOMAIN !== 'alphazonelabs.com') return;
 const db = env.DB;
 const {results=[]} = await db.prepare(`SELECT o.*,e.email,e.active,COALESCE(p.enabled,1) AS enabled
  FROM attendance_email_outbox o JOIN employees e ON e.id=o.employee_id
  LEFT JOIN attendance_email_preferences p ON p.employee_id=o.employee_id
  WHERE o.state IN ('QUEUED','ACCEPTED') AND o.next_ms<=? ORDER BY o.next_ms,o.id LIMIT 12`).bind(now).all();
 for (const row of results) {
  const lease = uuid();
  const claimed = await db.prepare(`UPDATE attendance_email_outbox SET lease_id=?,next_ms=?,
   attempts=attempts+CASE WHEN state='QUEUED' THEN 1 ELSE 0 END
   WHERE id=? AND state=? AND next_ms<=?`).bind(lease,now+5*MINUTE,row.id,row.state,now).run();
  if (claimed.meta?.changes !== 1) continue;
  if (row.state === 'QUEUED') {
   if (!row.active || !row.email || !row.enabled) {
    await finish(db,row,lease,'SUPPRESSED','Recipient unavailable or opted out',now);
    continue;
   }
   // Resend's idempotency window is 24 hours. Never resend a stale or
   // exhausted record under a new key.
   if (now-row.created_ms>=DAY || row.attempts>=5) {
    await finish(db,row,lease,'FAILED','Retry limit reached',now);
    continue;
   }
   let sent;
   try {
    sent = await sendTransactional(env,{to:row.email,subject:'IRM Time Clock — '+row.event_kind,
     text:row.detail,idempotencyKey:row.id});
   } catch (error) {
    const rejected = ['RESEND_REJECTED','INVALID_EMAIL','INVALID_MESSAGE'].includes(error.message);
    const retry = !rejected && row.attempts<4;
    await finish(db,row,lease,retry?'QUEUED':'FAILED',rejected?'Provider rejected request':'Provider temporarily unavailable',
     now,now+5*MINUTE*2**row.attempts);
    continue;
   }
   await finish(db,row,lease,'ACCEPTED',null,now,now+15*MINUTE,sent.id);
   continue;
  }
  let event;
  try { event = await readDeliveryState(env,row.provider_id); } catch { event = null; }
  const state = {delivered:'DELIVERED',bounced:'BOUNCED',complained:'BOUNCED',failed:'FAILED',suppressed:'SUPPRESSED',canceled:'FAILED'}[event];
  const final = state || (now-row.created_ms>=3*DAY ? 'UNCONFIRMED':'ACCEPTED');
  if (final === 'ACCEPTED') {
   await db.prepare('UPDATE attendance_email_outbox SET next_ms=?,lease_id=NULL WHERE id=? AND lease_id=?')
    .bind(now+60*MINUTE,row.id,lease).run();
  } else {
   await finish(db,row,lease,final,state?event:'Provider status unavailable',now);
  }
 }
}
