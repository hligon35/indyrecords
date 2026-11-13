# IRM RMS prototype architecture

## Boundaries
Independent, unofficial proof of concept. Never connect to IRM/ASI infrastructure or use customer records without written authorization. All bundled records are fictional. LocalStorage is **demo-only**, not a secure offline queue.

## Phase 1 (implemented)
Static HTML/CSS/ES modules, responsive operations dashboard, scanner flow with keyboard wedge compatibility, synthetic inventory search, locally staged scans, demo-only confirmation, activity table and CSV summary export.

## Planned production design
- Android Zebra handheld: Expo/React Native with a tested native DataWedge intent receiver. Verify model, OS and DataWedge profile on an authorized test device. Browser demo only supports keyboard-wedge input.
- Offline queue: SQLite with unique client-generated event IDs, durable transactions, retry/backoff, acknowledgements, explicit conflict states and replay-safe server idempotency.
- Backend: authenticated Cloudflare Worker API with role/warehouse/customer scoped authorization, schema validation, rate limits and structured observability.
- Operational storage: relational tables for customer, record, box, file, location, work order, scan event and chain-of-custody history. Foreign keys, indexes, unique barcode constraints and immutable audit events.
- Reporting: indexed read models/materialized summaries, cursor pagination, queued long-running CSV exports and performance benchmarks at realistic dataset sizes.
- Security: least-privilege roles, retention controls, secure device provisioning, TLS, encrypted data at rest, backups and restoration drills.

## First acceptance targets (not yet verified)
- Typical scan confirmation feedback appears immediately without waiting for the network.
- Duplicate pending scan rejected; invalid barcode and wrong item type produce clear errors.
- Offline queue survives process restarts and sends each event idempotently when connected.
- Inventory lookups and reports meet measured p95 targets agreed with stakeholders, not invented claims.
- No production/customer data used until explicitly authorized.

## Current limitations
No real backend, Zebra DataWedge integration, authentication, tests, server synchronization, role enforcement, or production-grade data storage. The confirm button marks scans locally and must not be mistaken for remote upload.
