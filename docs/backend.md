# Phase 2: D1 demo backend

This adds an **isolated API foundation**, not a production system. The existing browser UI remains local-only and is **not yet wired to the API**. This avoids misrepresenting local demo confirmations as durable server commits.

## Setup
1. `npm install`
2. `npx wrangler d1 create irm-rms-demo` and copy the generated database ID into `wrangler.toml`.
3. Set `DEMO_API_TOKEN` in a local `.dev.vars` file to a long random token. Do not commit it.
4. `npm run db:local`
5. `npm run dev:api`
6. `npm test`

No real customer data should be imported. The migration creates tables but no seed records; populate only with invented records through a future fixture script.

## Routes
- `GET /health`: public liveness check
- `GET /v1/records?q=&limit=&cursor=`: authenticated, paginated lookup
- `GET /v1/records/:barcode`: exact barcode lookup
- `POST /v1/scans`: idempotent event insert for synthetic demo operations
- `GET /v1/reports/summary`: grouped summary

All `/v1` routes require `Authorization: Bearer <DEMO_API_TOKEN>`. **This shared token is not suitable for production or a customer-facing browser.** Do not embed it in frontend code. No role-based access, user identity, custody workflow, export queue or live scanner adapter exists yet. The API rejects destruction and work-order-linked mutations pending those safeguards.

## Deployment caution
The placeholder database ID intentionally prevents deployment without explicit setup. Do not deploy this API publicly until session-based authentication, scoped permissions, rate limiting, audit and abuse controls are implemented. Never place a shared API token in a browser bundle.
