# IRM Time Clock
Independent, Access-protected employee PWA and Cloudflare Worker API. Shares the geofence policy in `packages/time-clock/policy.js` with the future IRM RMS module.

## Current capabilities
- 500-ft default per-worksite geofence; administrators can set 100–2,000 ft or disable restrictions.
- Employee-level site assignment and access control via a verified Cloudflare Access JWT; employee identities are explicitly provisioned.
- Server-side distance and accuracy checks, fresh GPS reading, audit rows for denied and accepted submissions.
- Idempotent employee punch requests, append-only time punch history, simulation mode clearly labeled.
- Optional **approved ADP gateway contract**, NOT an automatically working ADP integration. A gateway must map the authorized product's event types and verify processing state.
- Standalone PWA static files live in `public/` and are served on the same origin as `/api/*`. The hostname MUST be protected by Cloudflare Access before deploying or sharing it.

## Local/production setup (manual)
1. Request written employer authorization for ADP integration and the location-use policy, including break/shift rules, exceptions, payroll corrections and retention. Confirm ADP product and approved API scopes.
2. D1 database `irm_employees` is bound in `wrangler.toml` with the owner-supplied UUID. Apply migrations and verify the dedicated preview database. Migration `0002_indianapolis_worksite.sql` seeds only the supplied Indianapolis worksite, not employee identities.
3. Configure Cloudflare Access (entire app + API) and set `ACCESS_ISSUER` and `ACCESS_AUDIENCE` secrets/vars. The Worker verifies the Access-signed JWT and rejects unprovisioned subjects.
4. Insert approved employee rows, authorized admin roles and worksite assignments using an administrator-controlled bootstrap procedure (not a public endpoint). The Indianapolis worksite is seeded at latitude 39.80869, longitude -86.05169 with a 500-foot default radius; have the manager confirm that the location marks the required facility entrance or clock-in area.
5. Keep `ADP_MODE=simulated` during development. No punches reach payroll. For real payroll, separately implement, review and deploy an authorized HTTPS ADP gateway; set `ADP_MODE=gateway`, `ADP_GATEWAY_URL`, `ADP_GATEWAY_ALLOWED_HOST` and secret `ADP_GATEWAY_TOKEN`. The gateway accepts `{eventId,workerId,type,worksiteId}` and returns `{state:'PENDING'|'CONFIRMED',reference}`. It MUST implement OAuth, product-specific mapping, idempotency, provider confirmation and reconciliation. This is a contract, not a verified vendor integration.
6. Require HTTPS and Cloudflare Access protection for the entire `workers.dev` hostname before sharing; authenticate both static page and API. Verify browsers, mobiles, geofence accuracy, role boundaries, exceptions, and signed audit/retention policy.
7. Do not use real punch controls as the official payroll clock before employee device testing, security review and ADP validation have been completed.

## Operational limits
GPS supplied by the browser is untrusted and can be spoofed; server-side calculation does not prove physical presence. Accuracy is limited to 50 meters and a 60-second capture window; the conservative boundary check requires distance plus reported accuracy to be within the radius. A blocked clock-out must have an authorized human correction path so people can report time actually worked. Location coordinates are used for the decision but not retained in punch history. Provider timeouts are marked UNKNOWN, not silently retried to prevent duplicate payroll punches. Pending events need gateway-side reconciliation before any payroll confirmation claim.

The RMS prototype's warehouse mutations, synthetic data, and release gates remain unchanged. Do not copy its demo sign-in into this live-facing application.

An employee can select **Check status** for a pending entry. This queries the configured gateway's read-back endpoint and persists CONFIRMED or FAILED once verified. UNKNOWN results require supervisor reconciliation and are deliberately not automatically retried.

## Temporary test deployment
The Worker is named `irm-time-clock-preview`, with `workers_dev = true` and `preview_urls = true`; the exact `workers.dev` URL is assigned by your Cloudflare account after deployment. This is a **test deployment name**, not an ADP production integration. Configure Cloudflare Access with an allowlist of testing identities before deploying; a public URL exposes employee UI and API traffic to anyone even though API identity is checked. Keep `ADP_MODE=simulated`.

From repository root, after installing dependencies and configuring the database UUID and Access settings:
```powershell
cd apps/time-clock
npx wrangler d1 migrations apply irm_employees --remote --config wrangler.toml
npx wrangler deploy --config wrangler.toml
```
Do not run these until Cloudflare Access and the D1 binding are configured. The test URL is not guaranteed until Wrangler reports a successful deployment.
