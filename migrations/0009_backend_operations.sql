-- Synthetic operations only. No production provider credentials or tokens.
CREATE TABLE sample_datasets (
 customer_id TEXT PRIMARY KEY REFERENCES customers(id),
 dataset_version TEXT NOT NULL,
 manifest TEXT NOT NULL,
 installed_by TEXT NOT NULL REFERENCES app_users(id),
 installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE backend_tasks (
 id TEXT PRIMARY KEY,
 customer_id TEXT NOT NULL REFERENCES customers(id),
 created_by TEXT NOT NULL REFERENCES app_users(id),
 request_key TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('commercial_delivery','certificate_delivery','recurrence','field_export')),
 source_id TEXT NOT NULL,
 policy TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','running','retry','succeeded','review','cancelled','blocked')),
 attempts INTEGER NOT NULL DEFAULT 0,
 generation INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL,
 lease_token TEXT,
 lease_until INTEGER,
 version INTEGER NOT NULL DEFAULT 0,
 last_error TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(customer_id,request_key)
);
CREATE INDEX backend_tasks_due ON backend_tasks(status,next_attempt_at,lease_until);
CREATE UNIQUE INDEX backend_tasks_active_source ON backend_tasks(customer_id,kind,source_id)
 WHERE status IN ('pending','running','retry','review','blocked');
CREATE TABLE backend_task_history (
 id TEXT PRIMARY KEY,
 task_id TEXT NOT NULL REFERENCES backend_tasks(id),
 attempt INTEGER NOT NULL,
 actor_id TEXT NOT NULL REFERENCES app_users(id),
 outcome TEXT NOT NULL,
 detail TEXT NOT NULL,
 occurred_at INTEGER NOT NULL
);
CREATE INDEX backend_task_history_task ON backend_task_history(task_id,occurred_at,id);
