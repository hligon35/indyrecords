CREATE TABLE IF NOT EXISTS employees (
 id TEXT PRIMARY KEY, identity_sub TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
 adp_worker_id TEXT, role TEXT NOT NULL DEFAULT 'employee' CHECK(role IN ('employee','admin')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS worksites (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
 radius_feet INTEGER NOT NULL DEFAULT 500 CHECK(radius_feet BETWEEN 100 AND 2000),
 geofence_enabled INTEGER NOT NULL DEFAULT 1 CHECK(geofence_enabled IN (0,1)),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS assignments (
 employee_id TEXT NOT NULL REFERENCES employees(id), worksite_id TEXT NOT NULL REFERENCES worksites(id),
 PRIMARY KEY(employee_id,worksite_id)
);
CREATE TABLE IF NOT EXISTS punches (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id),
 worksite_id TEXT NOT NULL REFERENCES worksites(id),
 type TEXT NOT NULL CHECK(type IN ('IN','OUT','BREAK_START','BREAK_END')),
 client_request_id TEXT NOT NULL, submitted_at TEXT NOT NULL, distance_feet INTEGER,
 accuracy_feet INTEGER, provider_state TEXT NOT NULL CHECK(provider_state IN ('SIMULATED','PENDING','CONFIRMED','FAILED','UNKNOWN')),
 provider_ref TEXT, provider_message TEXT, UNIQUE(employee_id,client_request_id)
);
CREATE TABLE IF NOT EXISTS audit_log (
 id TEXT PRIMARY KEY, actor_id TEXT, operation TEXT NOT NULL, resource_id TEXT, detail TEXT,
 at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
