ALTER TABLE app_users ADD COLUMN admin_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE acceptance_observations (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES app_users(id), customer_id TEXT NOT NULL REFERENCES customers(id),
 check_name TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('pass','fail','blocked')), reference TEXT NOT NULL,
 source_commit TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_acceptance_customer ON acceptance_observations(customer_id,created_at,id);
