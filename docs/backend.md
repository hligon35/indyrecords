# Local synthetic Worker API

1. Install Node 24+ and run npm ci.
2. Run npm run db:local. The placeholder database binding is sufficient for local emulation; do not replace it with an IRM database.
3. Seed fictional inventory with npx wrangler d1 execute irm-rms-demo --local --file scripts/seed-demo.sql.
4. Set a random DEMO_API_TOKEN in an untracked .dev.vars file for loopback-only testing, or configure the verified identity provider described in authentication-plan.md.
5. Set READONLY_ALLOWED_ORIGINS to a comma-separated list of exact frontend origins for cross-origin calls. Examples: http://127.0.0.1:4173 and http://tauri.localhost. No wildcard or ambient cookie credentials are supported.
6. Run npm run dev:api. Keep the API on loopback and use synthetic fixtures only.

Routes: GET /health, GET /v1/session, POST /v1/session, DELETE /v1/session, GET /v1/records?q=&limit=&cursor=, GET /v1/records/:barcode, GET /v1/reports/summary. Scan POST /v1/scans requires explicit DEMO_WRITES_ENABLED=true and a loopback hostname, even with verified user credentials. No record table updates are enabled.

workers_dev and preview_urls are disabled. No Worker was deployed. Keep the database ID placeholder until separately approved private synthetic infrastructure exists. The development shared token must never be exposed publicly or included in a client build.

Run npm test for policy, cryptographic JWT, SQL-backed authorization/audit/session and offline sync tests. The SQL tests use Node SQLite with all migrations applied, not remote D1. Worker packaging is npx wrangler deploy --dry-run; this does not deploy.
