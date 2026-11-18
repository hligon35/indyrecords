# IRM Time Clock
Independent, Access-protected employee PWA and Cloudflare Worker API. Shares the geofence policy in `packages/time-clock/policy.js` with the future IRM RMS module.

## Current capabilities
- 500-ft default per-worksite geofence; administrators can set 100–2,000 ft or disable restrictions.
- Employee-level site assignment and access control via a verified Cloudflare Access JWT; employee identities are explicitly provisioned.
- Server-side distance and accuracy checks, fresh GPS reading, audit rows for denied and accepted submissions.
- Idempotent employee punch requests, append-only time punch history, simulation mode clearly labeled.
- Optional **approved ADP gateway contract**, NOT an automatically working ADP integration. A gateway must map the authorized product's event types and verify processing state.
- Standalone static PWA in this directory. Deploy static files with an Access-protected same-origin reverse proxy routing `/api/*` to the Worker, or bundle them in an approved Worker deployment. Do not publish raw endpoints without Access.

## Local/production setup (manual)
1. Request written employer authorization for ADP integration and the location-use policy, including break/shift rules, exceptions, payroll corrections and retention. Confirm ADP product and approved API scopes.
2. Create a dedicated Cloudflare D1 database and replace the placeholder UUID in `wrangler.toml`; apply `apps/time-clock/migrations/0001.sql` using Wrangler against that dedicated database only.
3. Configure Cloudflare Access (entire app + API) and set `ACCESS_ISSUER` and `ACCESS_AUDIENCE` secrets/vars. The Worker verifies the Access-signed JWT and rejects unprovisioned subjects.
4. Insert approved employee rows, authorized admin roles, worksite coordinates and assignments using an administrator-controlled bootstrap procedure (not a public endpoint). Default site radius is 500 ft.
5. Keep `ADP_MODE=simulated` during development. No punches reach payroll. For real payroll, separately implement, review and deploy an authorized HTTPS ADP gateway; set `ADP_MODE=gateway`, `ADP_GATEWAY_URL`, `ADP_GATEWAY_ALLOWED_HOST` and secret `ADP_GATEWAY_TOKEN`. The gateway accepts `{eventId,workerId,type,worksiteId}` and returns `{state:'PENDING'|'CONFIRMED',reference}`. It MUST implement OAuth, product-specific mapping, idempotency, provider confirmation and reconciliation. This is a contract, not a verified vendor integration.
6. Require HTTPS, Access JWT forwarding and a trusted same-origin `/api` reverse proxy. Verify browsers, mobiles, geofence accuracy, role boundaries, exceptions, and signed audit/retention policy.
7. Do not use real punch controls as the official payroll clock before employee device testing, security review and ADP validation have been completed.

## Operational limits
GPS supplied by the browser is untrusted and can be spoofed; server-side calculation does not prove physical presence. Accuracy is limited to 50 meters and a 60-second capture window; the conservative boundary check requires distance plus reported accuracy to be within the radius. A blocked clock-out must have an authorized human correction path so people can report time actually worked. Location coordinates are used for the decision but not retained in punch history. Provider timeouts are marked UNKNOWN, not silently retried to prevent duplicate payroll punches. Pending events need gateway-side reconciliation before any payroll confirmation claim.

The RMS prototype's warehouse mutations, synthetic data, and release gates remain unchanged. Do not copy its demo sign-in into this live-facing application.
