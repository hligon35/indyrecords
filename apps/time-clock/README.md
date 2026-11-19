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

### Verify sign-in after deployment

Use the stable Worker hostname configured in the iOS app. In a private browser, signed-out navigation to both `/` and `/api/me` should start Cloudflare Access login. Sign in and check that `/api/me` returns the expected employee. The Worker checks the Access assertion header first and verifies the application cookie with the same rules when the header is absent.

- `ACCESS_CONFIGURATION_REQUIRED` means the active Worker needs the team HTTPS origin and the exact audience tag of the Access application covering this hostname. Wrangler preserves dashboard variables across deploys.
- `ACCESS_TOKEN_NOT_FORWARDED` means the Worker received neither the assertion header nor a usable application cookie. Verify protection of the exact hostname and API path.
- `ACCESS_TOKEN_INVALID_OR_EXPIRED` means the credential failed verification. Check expiry, the configured issuer and the application-specific audience.
- `ACCOUNT_NOT_PROVISIONED` means Access verification succeeded. Check that the verified Cloudflare subject is associated with the correct active D1 employee.

From repository root, after installing dependencies and configuring the database UUID and Access settings:
```powershell
cd apps/time-clock
npx wrangler d1 migrations apply irm_employees --remote --config wrangler.toml
npx wrangler deploy --config wrangler.toml
```
Do not run these until Cloudflare Access and the D1 binding are configured. The test URL is not guaranteed until Wrangler reports a successful deployment.

## Attendance implementation increment (November 18, 2026)
- Schema migrations 0003 and 0004 add scoped correction requests, supervisor role grants and assignments, schedules, attendance events, in-app notification records, rate/classification history, optional email contacts and inactive identity staging.
- `attendance.js` adds secure application-session-based routes at `/api/attendance/*` for simulation attendance, correction submission/approval, assigned schedules, timecard previews, notifications and restricted admin configuration. Supervisor capabilities are granted through `supervisor_roles` and `supervisor_assignments`; no supervisor role is created in the original employee-role CHECK.
- UI supports six distinct clock/break actions, employee correction requests and statuses, supervisor approval, schedules, and admin staging/pay configuration. Correction approval does not post to ADP. The timecard uses a seven-day rolling example window; the official workweek boundary remains pending independent confirmation.
- Resend adapter uses the requested display sender `IRM Time Clock <clock@alphazonelabs.com>`. **Important:** requested domain `mail.alphazonelabs.com` differs from the From domain `alphazonelabs.com`. Sending is disabled until the exact From domain is verified and keys are securely configured. `EMAIL_ENABLED=false` by default.
- Do not treat archived or current `/api/punches` entries as a complete payroll ledger; the new simulated attendance event stream and old prototype stream are separate pending a reviewed migration plan.
- No live Cloudflare deployment or migration has been executed by this implementation. The worker and app have not been tested against a real identity provider, physical Android kiosk or actual ADP environment.
- Tests have been added under `tests/time-clock-attendance.test.js` and `tests/time-clock-resend.test.js` but successful execution has not been verified. Run `npm ci && npm test && npm run build:web` at repo root and `npx wrangler deploy --dry-run --config apps/time-clock/wrangler.toml` only in an authorized development environment.
- Still incomplete: managed identity provider selection/configuration; email-password sign-in, verified invitations/activation, kiosk ID/PIN and trusted fixed-device presence, offline encrypted request queue, ADP adapter/reconciliation, actual payroll schedule, device test acceptance, reporting accuracy, notification retry/delivery audit policies, archival/retention and production security review.

## Standalone iOS preview builds and simulated location testing (November 19, 2026)

A **separate Expo iOS client** now exists at `apps/time-clock-ios/`. Do not use `apps/mobile` to build it. Repository root convenience scripts:
- `npm run clock:ios:doctor`
- `npm run clock:ios:preview`
- `npm run clock:ios:ota:preview`

Before EAS build/OTA, install iOS app dependencies, verify SDK-compatible versions via `npx expo install --fix`, configure `EXPO_PUBLIC_CLOCK_URL` with a deployed and Access-protected HTTPS time-clock origin, create the separate EAS project with `eas init` and supply its actual `EAS_PROJECT_ID`. Configure Apple Developer provisioning and internal testers. Expo OTA changes JS/assets only and requires an installed native app with matching runtime. Nothing has been built or deployed from this session; build validation is pending.

**Preview location bypass:** Preview Wrangler config uses `APP_ENV=preview`, `ADP_MODE=simulated`, `CLOCK_TESTING_ENABLED=true` and `PREVIEW_DISABLE_GEOFENCE=true`. All four server-controlled values must match to bypass location checks. Both the original punch path and the newer attendance path use the same policy. Bypass applies only to enabled worksites and emits simulated/non-payroll status; it cannot be requested by a client. Set `PREVIEW_DISABLE_GEOFENCE=false` to test real GPS/geofencing. In production or ADP gateway mode the bypass automatically fails closed. Do not deploy this preview configuration as payroll production.
