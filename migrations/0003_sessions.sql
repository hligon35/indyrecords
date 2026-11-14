CREATE TABLE app_sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES app_users(id),
 expires_at INTEGER NOT NULL,
 revoked_at INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_sessions_user ON app_sessions(user_id,expires_at);
