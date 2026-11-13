# Phase 3: reliability foundation (prototype)

## Delivered
- Pure sync queue state machine with deduplication, pending/sending/confirmed/conflict states, exponential retry delay, interrupted-send recovery, and test cases.
- Explicit fictional SQL fixtures for a local D1 database.
- Tests for queue behavior and existing scanner domain rules.

## Local workflow
```powershell
npm install
npm run db:local
npx wrangler d1 execute irm-rms-demo --local --file=./scripts/seed-demo.sql
npm test
npm run dev:api
```

## Not yet delivered
- The queue is **not connected to the browser UI** or a native Zebra app.
- No secure offline persistence (SQLite), worker retry service, production session auth, RBAC, work-order validation, custody transactions, or report export job queue.
- The API uses a development-only shared token and must not be exposed as a production service.

## Next integration design
1. Build an authenticated Android app with Zebra DataWedge intent receiver.
2. Store scan events in encrypted local SQLite, generating stable UUIDs before transmission.
3. Feed pending events into this state machine; on reconnect, submit them individually or in bounded batches.
4. Map HTTP 201/200 idempotent acknowledgement to confirmed; 409 to conflict; network errors/5xx to retry; 401/403 to pause and require reauthentication.
5. Show server-confirmed status separately from locally accepted scans.
6. Implement work-order validation and atomic custody transitions before enabling real warehouse actions.

## Performance measurement
Benchmark exact barcode lookup and cursor-paginated search at 10k, 100k, and 1M synthetic records. Record p50/p95/p99 latency, errors, cold starts, and report completion. The current prototype has no measured performance claims.
