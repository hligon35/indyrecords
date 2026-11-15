# Phase B — synthetic field operations

Implemented November 15, 2026. This extends the working Phase A office workflow with dispatch, driver execution, custody evidence, SAMPLE certificates, delivery drafts, fleet fixtures and operational reporting. It does not enable real destruction, public mutations, real customer messages or live fleet services.

## Working user flows

### Dispatch and route planning

Open **Dispatch & Driver Operations** in web/Windows. The independent local demonstration persists in browser storage; verified API mode uses local D1. Load fixed fictional jobs or import scheduled jobs from Commercial Office. Server-side imports ignore caller-supplied job rows and read only the granted tenant's commercial workspace. Imported stops retain the commercial job reference, location address and timezone; expected containers derive from container estimates and can be configured before work starts.

Register trucks with capacity, height, width, length and gross weight. Active, explicitly scoped warehouse users are eligible drivers; driver/vehicle double-booking is prevented per route date, and vehicles have an availability switch. Configure stop duration and expected bins, create day-specific routes, reorder unstarted stops, reassign jobs or cancel uncollected work. Multiple days use separate routes; this is not an HOS/leave-calendar system. Routes with started work cannot be silently reordered. Reassignment invalidates the old plan for review.

A directed travel-time matrix supplies simulated travel. Up to six stops use exhaustive feasible sequencing; larger routes use a deterministic nearest-neighbor heuristic and manual override, not a claim of global optimality. Planning accounts for service windows, service duration, waiting, planned breaks, capacity and supplied truck restrictions. Infeasible routes are rejected. The route length/day-end/overtime estimate and matrix timestamp remain visible. The synthetic model uses DEPOT and RECYCLER endpoints and a bounded 50-stop route limit. It is never commercial road-safe navigation; the navigation command records a simulated handoff with no external URI. Actual routing/navigation requires licensed provider data and vehicle/road acceptance.

### Driver work, scanning and offline synchronization

The new mobile **Driver assignments** panel supports iPhone/Android camera decoding, keyboard input and the existing Zebra intent bridge. Camera access is requested only after tapping the scan action, stops on backgrounding, and does not save photographs. The Android manifest explicitly removes RECORD_AUDIO; iOS microphone permission is disabled. Existing warehouse and read-only account panels remain intact.

The default driver demonstration works on-device with fictional assignments. Verified mode accepts a temporary warehouse-user session for the loopback API. This remains separate from the existing native read-only account login. Use approved loopback forwarding for device/API testing (Android adb reverse); a physical iPhone needs an approved forwarding/test setup. No LAN/public field API is enabled by this work. Driver sessions remain in memory; they are not embedded in packages or written to the queue.

A driver starts one job at a time, records arrival, scans unique DEMO-BIN-* labels, records positive production and a fictional acknowledgment, and completes or raises an exception. Expected bins must all be scanned before completion. The same workflow engine projects offline actions. SQLite stores the projected state and queued command in one exclusive transaction. Queue/state data is isolated by actor and tenant; interrupted sends recover after restart, acknowledgments are idempotent, and retry backoff is durable. Refresh cannot overwrite pending projections. This is synthetic local storage, not a production encrypted records cache.

Current server assignments, roles, grants and active status are checked for every request. Reassignment returns a conflict to the previous driver; deactivation stops synchronization. A stale owned-job version sets a persisted supervisor-review requirement. Fresh commands cannot bypass that requirement: a dispatcher/manager must explicitly review it. The driver then refreshes and can create a corrected replacement with a new event ID, preserving the original conflict and its supersession link. Retaining a rejected conflict without retry preserves its evidence. Authentication failures clear the active client context and keep that user's pending queue isolated for later reauthentication.

### Custody, SAMPLE certificates and billing

Job transitions append actor/time/action/bin evidence to a SHA-256 linked custody chain. Completion alone is insufficient for a sample certificate. An authorized certificate manager must record SAMPLE authorization; the assigned driver, as a separate actor, records SAMPLE performed evidence. Issuance checks completion, authorization, performed evidence and chain integrity. Pending supervisor review blocks progression. Revisions and void reasons are preserved; correction creates a new sample revision. Every download is prominently marked **SAMPLE / NOT PROOF OF DESTRUCTION**. These are UTF-8 printable HTML samples, not signed legal PDFs or a compliance certification.

Completed commercial-linked field jobs can be handed back to Commercial Office by a commercial manager. The bridge verifies completion and custody, performs a version-checked commercial completion, and acknowledges repeats without double-completing or double-billing. Phase A can then draft an individual or consolidated invoice. Canonical/source inventory is never changed.

### Daily delivery drafts and fleet fixtures

Per-account fictional recipients require explicit consent and IANA timezone. Daily batch preparation uses the customer's local date, merges eligible certificates into unsent drafts, and suppresses duplicate certificate delivery. Late certificates after a sent batch wait for the next local day. Voids and recipient/consent changes invalidate pending drafts. Simulated delivery supports success, failure, bounce history, backoff, and three attempts before explicit supervisor review. No SMTP, email API, automatic external daily sending or real customer recipient exists.

Fleet observations contain timestamped synthetic GPS, odometer and diagnostic data. Invalid coordinates, excessive future dates, backward odometers and out-of-order observations are rejected. The dashboard distinguishes absent, fresh synthetic and stale data. Drivers do not receive fleet telemetry or other drivers' jobs. Fleet camera streaming is unavailable; ELD status explicitly says NOT AN APPROVED ELD. There are no real vehicle/device connections or certified ELD claims.

### Reporting and durable background exports

The field dashboard shows job states, exceptions, production and route overtime, with record references for review. Authorized office users additionally see Phase A prospect/customer counts, estimate acceptance, issued receivables/UTC aging and provider/reconciliation failures. Driver views omit finance, certificates and fleet monitoring.

Export jobs snapshot up to the workspace's bounded 2,000 field jobs. After request auditing, the Worker uses waitUntil to advance chunks of 100 rows, rechecking the owner's active role and customer grant before every chunk and persisting chunk audit entries. Offsets and output rows survive interruption; manual advance resumes a paused job. Background execution is bounded to 25 chunk attempts per invocation, not an indefinitely provisioned Queue service. The 1,205-row regression verifies no silent 1,000-row truncation. Unicode HTML retains full job text; UTF-8 CSV exports the explicit job reference, status, date, driver and production columns without truncating their cell values. Markup/formulas are escaped. Browser printing depends on installed fonts; this does not change the older synchronous inventory/PDF limits or supply universal embedded-font PDF output.

## API, roles and persistence

Migration 0008 adds field_workspaces. State, command receipts, route plans, custody, certificates, delivery drafts and export progress are stored under the existing fictional c1–c4 tenant scopes with version compare-and-swap. Drivers use job versions; concurrent changes to other jobs do not permit overwriting their job or assignment. Receipts bind event IDs to actor and canonical payload. Scope and role checks happen before reads/mutations; persistent access-audit failure withholds data. Background exports pause before committing a chunk if their audit insert fails.

- Manager/admin: field read/manage and SAMPLE certificate controls; commercial permission additionally required for billing handoff.
- Dispatcher: field read/manage and operational review, without certificate issuance or commercial finance access.
- Warehouse: assigned-job reads and driver transitions only; no certificate-management or fleet/finance data.
- Viewer/shared development principal: no field workflow access.

Endpoints: GET /v1/field/workspace?customerId=c2; GET /v1/field/drivers?customerId=c2; POST /v1/field/commands; POST /v1/field/billing. All require a verified principal, an explicit tenant grant, loopback host, and SYNTHETIC_FIELD_ENABLED=true. Public hosts are denied even with the flag enabled. Real destruction remains blocked in the existing inventory API. Configure only ignored local .dev.vars or explicit local Wrangler variables; no public deployment or remote migration was performed.

Limits fail explicitly: 3,000 accepted field events, 2,000 jobs, 1.8 MiB encoded workspace, 32 KiB input and 50 stops per route. The mobile projection uses JSON-safe cloning and native injected hashing rather than relying on browser-only clone/encoder globals. This bounded synthetic workspace model needs operational scalability/retention review before real rollout.

## Verification and external gates

The final report records regression count and artifact hashes. Verified locally: dispatch/custody/certificate/delivery/invoice handoff on actual local D1, replay of every field command, automatic background export completion, customer/driver isolation, source inventory preservation and isolated backup/restore with restored sessions invalidated. Temporary sessions are revoked and test users deactivated afterward. Existing Windows and Android packaging, Android/iOS Hermes exports, Expo health and dependency checks are included in the delivery evidence.

Native iOS simulator build support is added as a macOS GitHub Actions job (Expo prebuild, CocoaPods, unsigned simulator compilation). Windows cannot run Xcode. GitHub's existing run annotation states: "The job was not started because your account is locked due to a billing issue." Until that account issue is resolved and a native iOS run passes, native iOS is NOT verified. The readiness gate now requires both iOS bundle and native build evidence, so Android success cannot silently certify iPhone readiness.

Actual Zebra/DataWedge/camera behavior, offline device restart, iPhone runtime, commercial navigation, fleet hardware/camera/ELD providers, external certificate delivery, real destruction policy, immutable compliance archival, enterprise signing and independent security/management approval remain acceptance gates. Dependency findings below high/critical still need remediation or risk review. ProductionReady and supervisedPilotReady remain false. There is no claim of operational parity or certification based on synthetic fixtures alone.

## Observed local results

134 automated tests pass, including API authorization/concurrency, supervisor review, receiver replay, SQLite restart/conflict preservation, revoked-session queue handling, routing constraints, certificate history, background exports and Unicode output. Web/Worker packaging, Windows x64 NSIS packaging, complete arm64 Android APK assembly and Android/iOS Hermes exports pass. Expo Doctor passes 18/18 checks; the Metro dependency compatibility check passes. APK signature verification identifies the Android test key; native Expo camera descriptors are present and the final manifest has CAMERA without RECORD_AUDIO. No device runtime or enterprise signing is inferred from these checks. The observed mobile audit has zero high/critical findings; lower-severity counts are captured in the verification JSON.

The final loopback D1 smoke test runs from office estimate to dispatch, driver custody, SAMPLE certificate, simulated customer-local delivery draft, invoice and automatic background export. Every client field command is replayed safely; source inventory remains unchanged. Its local identities/sessions are deactivated/revoked afterward, and the populated field workspace passes isolated backup/restore.

Native test transport is explicitly scoped: the Android network-security resource permits cleartext only for exact localhost/127.0.0.1 hosts, keeps public cleartext disabled and does not add custom certificate authorities. The prebuild plugin packages that resource into release test APKs. iOS keeps arbitrary loads disabled and declares local-network testing support. This does not widen the Worker host restrictions. Policy reference: https://developer.android.com/privacy-and-security/security-config .

The later backend continuation supersedes the temporary mobile test-session flow: inventory/driver/warehouse now share approved account login, and verified queues require SQLCipher-protected storage. See backend-four-phases.md and backend-release-runbook.md.
