CREATE INDEX IF NOT EXISTS correction_requests_employee_time ON correction_requests(employee_id,requested_at);
ALTER TABLE correction_requests ADD COLUMN schedule_id TEXT REFERENCES work_schedules(id);
CREATE INDEX IF NOT EXISTS attendance_audit_actor_operation_time ON audit_log(actor_id,operation,at);
ALTER TABLE attendance_events ADD COLUMN provider_ref TEXT;
ALTER TABLE attendance_events ADD COLUMN provider_message TEXT;
ALTER TABLE attendance_events ADD COLUMN provider_checked_ms INTEGER;
CREATE INDEX attendance_provider_unresolved ON attendance_events(provider_state,provider_checked_ms,occurred_at);

CREATE TABLE attendance_email_preferences (
 employee_id TEXT PRIMARY KEY REFERENCES employees(id),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
);

-- Email records outlive a dismissible inbox entry. Provider payloads and
-- employee email addresses do not belong in the delivery audit.
CREATE TABLE attendance_email_outbox (
 id TEXT PRIMARY KEY,
 employee_id TEXT NOT NULL REFERENCES employees(id),
 event_kind TEXT NOT NULL,
 detail TEXT NOT NULL,
 created_ms INTEGER NOT NULL,
 next_ms INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'QUEUED'
  CHECK(state IN ('QUEUED','ACCEPTED','DELIVERED','BOUNCED','FAILED','SUPPRESSED','UNCONFIRMED')),
 attempts INTEGER NOT NULL DEFAULT 0,
 lease_id TEXT,
 provider_id TEXT
);
CREATE INDEX attendance_email_due ON attendance_email_outbox(state,next_ms);
CREATE TABLE attendance_email_history (
 id TEXT PRIMARY KEY,
 outbox_id TEXT NOT NULL REFERENCES attendance_email_outbox(id),
 state TEXT NOT NULL,
 reason TEXT,
 occurred_ms INTEGER NOT NULL
);

CREATE TABLE attendance_notice_receipts (
 employee_id TEXT NOT NULL REFERENCES employees(id),
 signal_key TEXT NOT NULL,
 notification_id TEXT NOT NULL,
 PRIMARY KEY(employee_id,signal_key)
);
CREATE TABLE attendance_job_state (
 job TEXT PRIMARY KEY,
 cursor TEXT NOT NULL
);
