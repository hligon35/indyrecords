# Synthetic backend release and recovery

This is an operational procedure, not deployment authorization. ProductionReady remains false. No real vendor account, money, destruction, customer message, fleet device or live records connection is enabled.

## Local acceptance preparation

Use a fresh isolated Wrangler persistence directory. Apply migrations 0001-0012 with --local and --persist-to pointing into workspace .wrangler. Seed only scripts/seed-demo.sql. Bind the Worker to 127.0.0.1. Enable operations/commercial/field/warehouse flags only for that local process. Reuse approved verified identities; never invent an authentication bypass or publish a shared token. Preview/install the current full sample dataset into empty workspaces. Existing work is never overwritten, and existing installed v1 fixtures are not silently upgraded to v2.

The Operations and Reports & Readiness screens provide reports, archive, reconciliation, alerts and a retention preview. Scheduling is opt-in and remains undeployed. A local scheduled test can exercise the handler; otherwise Process queued work performs bounded passes. Large exports require repeated passes until complete, and downloads page through retained output without changing the snapshot.

## Device login and protected queues

Inventory, driver and warehouse screens share one approved system-browser PKCE session, verified by the API and retained with a minimal verified identity snapshot only in protected session storage until its original expiry. API field mutations still require an approved loopback setup; a public HTTPS origin does not gain mutation access by signing in. Native redirect approval and the real identity provider must be configured externally before testing that flow.

Custom native builds must enable expo-sqlite useSQLCipher. Verified data uses separate databases and 256-bit keys for API origin, workflow, actor and customer. A missing cipher implementation, unreadable/missing key or expired scope blocks access. No plaintext fallback exists for verified storage. Keys use the OS protected store with device-only unlocked access. Demonstration data remains separate and synthetic.

On successful approved connection, legacy rows for the verified actor/customer are copied transactionally, with a durable hash marker. Cleanup occurs only after the protected copy commits and a second source-hash check passes. Copy failure leaves source rows intact. Interrupted cleanup can resume without overwriting newer protected state. Only that verified scope is removed from active legacy tables; secure_delete and WAL checkpoint are requested. This is not proof that historical device backups, filesystem snapshots or old app backups were erased. Those need device acceptance and approved handling.

Sign-out locks memory/database access on every screen, clears the saved session and attempts server revocation even when local deletion fails. Pending encrypted work and its keys are retained so the same approved account can resume. A missing device key is a recovery condition, not permission to discard/recreate the queue. Device loss, off-device key recovery, regulated retention and backup policy require management approval. No encryption certification is inferred from a successful build.

## Migration and rollback

Before an approved change, make a consistent backup in an isolated local environment and run the restore drill. The drill verifies integrity and foreign keys and invalidates restored sessions/codes. A custom --persist-to directory uses SQLite's consistent backup API because Wrangler export does not accept that option.

Migrations are additive. Entity projections are maintained transactionally by source-workspace triggers. Do not remove a migration or roll schema backward with data in place. Roll back executable code to a known compatible commit only after reviewing schema compatibility; use a separate restored fixture environment to test recovery. Keep audits and document archives. Do not restore over operational data or reconnect revoked sessions.

## Monitoring and retention

The scheduled handler refreshes tenant alerts after processing. Alerts cover provider failures, blocked/review tasks, stale processing, stuck exports and open financial exceptions. Acknowledgment requires an operator and reason; resolution follows the condition clearing. Alerts are persisted and visible in the UI; no email or other outbound notification is configured.

Retention defaults to a dry-run preview. Explicit confirmation may remove only completed/cancelled task/export metadata older than 30-3650 days in the authorized synthetic scope. It does not delete business records, persistent access audits, financial reconciliation evidence or document archives. Append-only document triggers prevent application/ordinary SQL updates or deletion; they are not independent WORM storage or a compliance certification against privileged database administrators.

## Identity and secret rotation

Keep issuer/audience/redirect settings in the approved environment and secrets in Cloudflare's secret store, never in source or mobile packages. Rotate through the identity provider's supported signing-key rollover and verify new/old token acceptance and expiry with isolated identities. Revoke affected app_sessions when access must end immediately. Credential and vendor-token rotation must follow the chosen provider contracts; synthetic adapters store no live vendor credentials.

Do not delete protected offline keys while pending evidence is retained. A changed API origin intentionally uses a different local database/key namespace. Any planned key rotation or origin migration needs verified backup/recovery and device acceptance before operational rollout.

## Packaging and deployment gates

wrangler.pilot.json is a disabled template: nil database ID, no public preview, no route, no scheduled trigger, every mutation/scheduler flag false, no credentials. Dry-run packaging is safe; it is not a deployable approved environment. Create/approve dedicated resources, private access, a real identity-provider policy, supported provider contracts, signing and independent security review before any supervised pilot. Keep the original no-public-shared-token restriction.

Windows/Android builds and iOS exports are software checks. Native iOS compilation and physical Zebra/iPhone/Windows behavior must be verified separately; the last observed GitHub Actions runs could not start because of an account billing lock. External acceptance, production volumes, legal documents, arbitrary-script PDF typography and actual third-party compatibility remain independent gates.

Offline cold restart may reuse that OS-protected identity snapshot only on a transport/server outage, only within the original server-clamped 15-minute lifetime, and only to open an existing protected workspace/key. It cannot create or migrate a new verified cache offline, renew expiry, or fall back after a 401/403. First protected connection and legacy migration require online verification. Server role/grant checks still apply on every upload; offline revocation cannot be learned until connectivity returns or the short session expires.
