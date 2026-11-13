PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS customers (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS locations (
 id TEXT PRIMARY KEY,
 label TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS records (
 id TEXT PRIMARY KEY,
 barcode TEXT NOT NULL UNIQUE,
 customer_id TEXT NOT NULL REFERENCES customers(id),
 location_id TEXT REFERENCES locations(id),
 kind TEXT NOT NULL CHECK(kind IN ('Box','File')),
 status TEXT NOT NULL DEFAULT 'Stored',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_records_customer_status ON records(customer_id,status,id);
CREATE INDEX IF NOT EXISTS idx_records_location ON records(location_id,id);
CREATE TABLE IF NOT EXISTS work_orders (
 id TEXT PRIMARY KEY,
 customer_id TEXT NOT NULL REFERENCES customers(id),
 operation TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS work_order_items (
 work_order_id TEXT NOT NULL REFERENCES work_orders(id),
 record_id TEXT NOT NULL REFERENCES records(id),
 status TEXT NOT NULL DEFAULT 'pending',
 PRIMARY KEY(work_order_id,record_id)
);
CREATE TABLE IF NOT EXISTS scan_events (
 id TEXT PRIMARY KEY,
 client_event_id TEXT NOT NULL UNIQUE,
 record_id TEXT NOT NULL REFERENCES records(id),
 work_order_id TEXT REFERENCES work_orders(id),
 operation TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('inbound','outbound')),
 actor_id TEXT NOT NULL,
 occurred_at TEXT NOT NULL,
 received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_scans_received ON scan_events(received_at,id);
CREATE INDEX IF NOT EXISTS idx_scans_record ON scan_events(record_id,received_at);
