-- Synthetic profile/staging data only; never overwrite source inventory.
CREATE TABLE customer_profiles (
 customer_id TEXT PRIMARY KEY REFERENCES customers(id),
 display_name TEXT NOT NULL,
 contact_alias TEXT NOT NULL DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 version INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE integration_jobs (
 id TEXT PRIMARY KEY,
 actor_id TEXT NOT NULL REFERENCES app_users(id),
 customer_id TEXT NOT NULL REFERENCES customers(id),
 source TEXT NOT NULL CHECK(source IN ('andrew','qshred')),
 schema_version TEXT NOT NULL,
 filename TEXT NOT NULL,
 source_hash TEXT NOT NULL,
 source_timestamp TEXT NOT NULL,
 accepted_count INTEGER NOT NULL,
 rejected_count INTEGER NOT NULL,
 result TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_integration_customer_time ON integration_jobs(customer_id,created_at,id);
CREATE TABLE auth_rate_limits (
 bucket TEXT PRIMARY KEY,
 window_start INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_auth_rate_window ON auth_rate_limits(window_start);
