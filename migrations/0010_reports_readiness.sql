CREATE TABLE report_exports (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
 created_by TEXT NOT NULL REFERENCES app_users(id), request_key TEXT NOT NULL,
 kind TEXT NOT NULL, fingerprint TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','running','complete','blocked','cancelled')),
 row_count INTEGER NOT NULL DEFAULT 0 CHECK(row_count BETWEEN 0 AND 100000),
 offset INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT, lease_until INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 review_reason TEXT, reviewed_by TEXT REFERENCES app_users(id),
 UNIQUE(customer_id,request_key)
);
CREATE INDEX report_exports_pending ON report_exports(status,updated_at);
CREATE TABLE report_export_rows (
 export_id TEXT NOT NULL REFERENCES report_exports(id) ON DELETE CASCADE,
 row_number INTEGER NOT NULL, payload TEXT NOT NULL, rendered TEXT,
 PRIMARY KEY(export_id,row_number)
);
CREATE TABLE document_archive (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
 created_by TEXT NOT NULL REFERENCES app_users(id), request_key TEXT NOT NULL,
 document_type TEXT NOT NULL, source_id TEXT NOT NULL, format TEXT NOT NULL,
 content_type TEXT NOT NULL, encoding TEXT NOT NULL, content TEXT NOT NULL,
 sha256 TEXT NOT NULL, created_at INTEGER NOT NULL, fingerprint TEXT NOT NULL,
 UNIQUE(customer_id,request_key)
);
CREATE TABLE finance_reconciliations (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
 created_by TEXT NOT NULL REFERENCES app_users(id), source_hash TEXT NOT NULL,
 report TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed')),
 reviewed_by TEXT REFERENCES app_users(id), review_reason TEXT, version INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, reviewed_at INTEGER,
 UNIQUE(customer_id,source_hash)
);
CREATE TRIGGER archive_no_update BEFORE UPDATE ON document_archive BEGIN SELECT RAISE(ABORT,'Document archive is append-only'); END;
CREATE TRIGGER archive_no_delete BEFORE DELETE ON document_archive BEGIN SELECT RAISE(ABORT,'Document archive is append-only'); END;
CREATE TABLE operation_alerts (
 customer_id TEXT NOT NULL REFERENCES customers(id), alert_key TEXT NOT NULL,
 severity TEXT NOT NULL, detail TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','acknowledged','resolved')),
 first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
 acknowledged_by TEXT REFERENCES app_users(id), reason TEXT, version INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(customer_id,alert_key)
);
