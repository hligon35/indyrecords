-- Schema foundation only. No authentication endpoints or identity provisioning yet.
CREATE TABLE IF NOT EXISTS app_users (
 id TEXT PRIMARY KEY,
 external_subject TEXT NOT NULL UNIQUE,
 display_name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('viewer','warehouse','dispatcher','manager','admin')),
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS user_customer_access (
 user_id TEXT NOT NULL REFERENCES app_users(id),
 customer_id TEXT NOT NULL REFERENCES customers(id),
 PRIMARY KEY(user_id,customer_id)
);
CREATE TABLE IF NOT EXISTS access_audit (
 id TEXT PRIMARY KEY,
 actor_id TEXT,
 action TEXT NOT NULL,
 resource_type TEXT NOT NULL,
 resource_id TEXT,
 decision TEXT NOT NULL CHECK(decision IN ('allow','deny')),
 occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_access_audit_actor_time ON access_audit(actor_id,occurred_at);
CREATE INDEX IF NOT EXISTS idx_access_audit_resource ON access_audit(resource_type,resource_id,occurred_at);
