-- Isolated synthetic workspace; no updates to the source records table.
CREATE TABLE sandbox_workspaces (
 customer_id TEXT PRIMARY KEY REFERENCES customers(id),
 version INTEGER NOT NULL DEFAULT 0,
 payload TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE login_attempts (
 state_hash TEXT PRIMARY KEY,
 challenge TEXT NOT NULL,
 return_origin TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 code_hash TEXT UNIQUE,
 user_id TEXT REFERENCES app_users(id),
 identity_expires_at INTEGER,
 consumed_at INTEGER
);
CREATE INDEX idx_login_expiry ON login_attempts(expires_at);
