// Preserve punch history. Approved requests add a separate, traceable event to
// the timecard; they remain separate from any external payroll posting.
export const attendanceTimeline = `
 SELECT id,employee_id,event_type,occurred_at,provider_state,geofence_result,'PUNCH' AS source
 FROM attendance_events
 UNION ALL
 SELECT id,employee_id,event_type,requested_at,'NOT_SUBMITTED',NULL,'APPROVED_CORRECTION'
 FROM correction_requests WHERE status='APPROVED'
`;

export function auditStatement(db, actor, action, resource, detail = {}) {
 return db.prepare('INSERT INTO audit_log(id,actor_id,operation,resource_id,detail) VALUES(?,?,?,?,?)')
  .bind(crypto.randomUUID(),actor,action,resource,JSON.stringify(detail));
}

export async function attendanceTimelineFor(db, employeeId, from, to, asOf) {
 const ceiling = new Date(Math.min(Date.parse(to), Date.parse(asOf))).toISOString();
 const [earlier, interval, later] = await db.batch([
  db.prepare(`SELECT * FROM (${attendanceTimeline}) WHERE employee_id=? AND occurred_at<? AND occurred_at<=?
   ORDER BY occurred_at DESC,id DESC LIMIT 1`).bind(employeeId,from,asOf),
  db.prepare(`SELECT * FROM (${attendanceTimeline}) WHERE employee_id=? AND occurred_at>=? AND occurred_at<?
   ORDER BY occurred_at,id`).bind(employeeId,from,ceiling),
  db.prepare(`SELECT * FROM (${attendanceTimeline}) WHERE employee_id=? AND occurred_at>=? AND occurred_at<=?
   ORDER BY occurred_at,id LIMIT 1`).bind(employeeId,ceiling,asOf)
 ]);
 const previous = earlier.results?.[0];
 // The nearest earlier event can be a break. Replay from the last IN/OUT
 // before the range to recover the employee's state at the first boundary.
 let prefix = previous ? [previous] : [];
 if (previous && !['IN','OUT'].includes(previous.event_type)) {
  const anchor = await db.prepare(`SELECT occurred_at FROM (${attendanceTimeline})
   WHERE employee_id=? AND occurred_at<? AND event_type IN ('IN','OUT') ORDER BY occurred_at DESC LIMIT 1`)
   .bind(employeeId,from).first();
  if (anchor) {
   const replay = await db.prepare(`SELECT * FROM (${attendanceTimeline})
    WHERE employee_id=? AND occurred_at>=? AND occurred_at<? ORDER BY occurred_at,id`)
    .bind(employeeId,anchor.occurred_at,from).all();
   prefix = replay.results || [];
  }
 }
 return [...prefix,...(interval.results || []),...(later.results || [])];
}
