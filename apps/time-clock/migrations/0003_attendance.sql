-- Dedicated attendance extension. Existing payroll punch evidence is preserved.
-- Employee.role remains employee/admin in 0001; supervisor authorization is in supervisor_roles.
CREATE TABLE IF NOT EXISTS supervisor_assignments (
 supervisor_id TEXT NOT NULL REFERENCES employees(id),
 employee_id TEXT NOT NULL REFERENCES employees(id),
 PRIMARY KEY(supervisor_id,employee_id),
 CHECK(supervisor_id <> employee_id)
);
CREATE TABLE IF NOT EXISTS supervisor_roles (
 employee_id TEXT PRIMARY KEY REFERENCES employees(id),
 granted_by TEXT NOT NULL REFERENCES employees(id),
 granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS attendance_events (
 id TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id),
 worksite_id TEXT NOT NULL REFERENCES worksites(id),
 event_type TEXT NOT NULL CHECK(event_type IN ('IN','OUT','LUNCH_START','LUNCH_END','PAID_BREAK_START','PAID_BREAK_END')),
 occurred_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 client_request_id TEXT NOT NULL,geofence_result TEXT NOT NULL,
 distance_feet INTEGER,accuracy_feet INTEGER,
 provider_state TEXT NOT NULL DEFAULT 'SIMULATED' CHECK(provider_state IN ('SIMULATED','UNKNOWN','PENDING','CONFIRMED','FAILED')),
 UNIQUE(employee_id,client_request_id)
);
CREATE INDEX IF NOT EXISTS attendance_events_employee_time ON attendance_events(employee_id,occurred_at);
CREATE TABLE IF NOT EXISTS correction_requests (
 id TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id),
 worksite_id TEXT NOT NULL REFERENCES worksites(id),
 event_type TEXT NOT NULL CHECK(event_type IN ('IN','OUT','LUNCH_START','LUNCH_END','PAID_BREAK_START','PAID_BREAK_END')),
 requested_at TEXT NOT NULL,reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_by TEXT REFERENCES employees(id),reviewed_at TEXT,review_reason TEXT,
 source TEXT NOT NULL DEFAULT 'ONLINE' CHECK(source IN ('ONLINE','OFFLINE','GPS_EXCEPTION')),
 client_request_id TEXT NOT NULL,UNIQUE(employee_id,client_request_id)
);
CREATE INDEX IF NOT EXISTS correction_status ON correction_requests(status,created_at);
CREATE TABLE IF NOT EXISTS work_schedules (
 id TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id),
 start_at TEXT NOT NULL,end_at TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES employees(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(end_at > start_at)
);
CREATE INDEX IF NOT EXISTS work_schedule_employee_start ON work_schedules(employee_id,start_at);
CREATE TABLE IF NOT EXISTS attendance_notifications (
 id TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employees(id),
 event_kind TEXT NOT NULL,detail TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 read_at TEXT,
 email_state TEXT NOT NULL DEFAULT 'NOT_SENT'
 CHECK(email_state IN ('NOT_SENT','SENT','FAILED','DISABLED'))
);
CREATE INDEX IF NOT EXISTS notifications_recipient ON attendance_notifications(employee_id,created_at);
CREATE TABLE IF NOT EXISTS employment_classifications (
 employee_id TEXT NOT NULL REFERENCES employees(id),
 effective_at TEXT NOT NULL,classification TEXT NOT NULL CHECK(classification IN ('EXEMPT','NONEXEMPT')),
 changed_by TEXT NOT NULL REFERENCES employees(id),
 PRIMARY KEY(employee_id,effective_at)
);
CREATE TABLE IF NOT EXISTS pay_rate_history (
 employee_id TEXT NOT NULL REFERENCES employees(id),
 effective_at TEXT NOT NULL,hourly_cents INTEGER NOT NULL CHECK(hourly_cents BETWEEN 0 AND 100000000),
 changed_by TEXT NOT NULL REFERENCES employees(id),
 PRIMARY KEY(employee_id,effective_at)
);
CREATE TABLE IF NOT EXISTS kiosk_devices (
 id TEXT PRIMARY KEY,worksite_id TEXT NOT NULL REFERENCES worksites(id),
 display_name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
 created_by TEXT NOT NULL REFERENCES employees(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Kiosk registration is intentionally not sufficient to bypass location checks.
-- Before enabling kiosk punch flow, add a separately security-reviewed proof of device possession.
