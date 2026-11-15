# Four backend implementation phases

Requested November 15, 2026. Backend behavior, persistence and basic usable controls take priority. Precise layout and physical web/Windows/mobile acceptance are deferred until the feature set and sample data are ready. Automated backend validation continues during implementation.

All phases preserve the current demonstration and source inventory. Live provider connections, production mutations, external messages, actual destruction and public shared-token access remain disabled. A fixture adapter cannot establish vendor compatibility or regulatory certification.

| Phase | Backend scope | Current implementation |
|---|---|---|
| 1 - Shared operations and sample data | Cross-workflow fixture factory, tenant/role boundaries, non-destructive atomic installation, versioned sample manifest and basic Operations screen | Implemented for the existing synthetic warehouse/commercial/field backends |
| 2 - Durable processing and provider orchestration | Relational task queue, leases, retry timing, recovery, deduplication, review/cancellation, existing provider-outbox and certificate delivery bridges, recurrence/export workers, opt-in scheduled handler | Implemented with synthetic adapters; no live adapters or deployed cron |
| 3 - Billing, documents and reporting | Fixed-point measured units, backend invoice/certificate/operations documents, embedded-font PDF and full-value HTML/CSV; larger universal exports, financial reconciliation and legally approved templates | Implemented synthetic measured billing, seven resumable export types, settlement review and append-only document archives; typography/legal/provider limits remain |
| 4 - Client and production readiness | Unified driver/account login, protected offline data and migration, production storage/retention, monitoring/alerts, secret rotation, approved provider adapters, deployment/rollback, release evidence | Shared mobile login, protected queues/migration, indexed relational reads, monitoring/retention and disabled release template implemented; external acceptance remains |

## Phase 1: complete linked sample

`npm run build:sample` writes four reproducible customer bundles and a manifest under dist/sample. Reference date: 2026-11-15. This fixed date deliberately prevents fixtures from changing every time a test runs. Each customer has four accounts (customer/prospect/lost/archived), two timezoned service locations, a contact, interaction and follow-ups, a signed simulated agreement, four estimates including fractional weight, recurrence with a skip, six commercial jobs, two invoices, capture/refund/credit history, pending payment and provider failure, five linked field jobs, two trucks, a route, ready-to-start assignment, completion and exception evidence, a SAMPLE certificate and delivery draft, a pending export, nine warehouse records and two completed receiving/retrieval orders. Across four tenants: 16 accounts, 8 locations, 24 commercial jobs, 20 field jobs, 8 invoices and 36 warehouse records.

The factory invokes the existing commercial, warehouse and field engines, including independent sample supervisor/driver actors and valid custody hashes. It does not mutate canonical source records. These are representative linked scenarios, not a production-sized load test or a dataset for features still pending.

Open **Backend Operations** for a preview or full JSON download. For D1 installation, connect a verified manager/admin through Remote Read-Only, select an empty customer workspace, preview and install. Migration 0009 must be applied locally. Enable SYNTHETIC_OPERATIONS_ENABLED, SYNTHETIC_COMMERCIAL_ENABLED, SYNTHETIC_FIELD_ENABLED and SYNTHETIC_WORKFLOWS_ENABLED only in ignored local configuration. The Worker remains bound to loopback.

Installation creates all three workspaces, manifest, scoped driver account and audit event in one D1 transaction. Existing workspace rows or an existing driver identifier cause a conflict; nothing is replaced. Repeated installed-dataset requests acknowledge the existing manifest. Drivers start disabled and receive no credentials, sessions or login bypass. Their synthetic external identity is intentionally not a real identity-provider subject. Historical sample events use fictional actor references. Real testing identities need the existing approved provisioning flow.

## Phase 2: persistent task execution

Migration 0009 adds backend_tasks and backend_task_history. Task kinds:

- commercial_delivery: advance the actual synthetic DocuSign/payment/QBO outbox entry; successful capture/refund updates the existing invoice/payment ledger.
- certificate_delivery: advance the existing consent-checked daily SAMPLE batch; no email provider is contacted.
- recurrence: generate a specified bounded date range from an existing recurring plan, retaining stable occurrence IDs.
- field_export: advance persisted 100-row chunks, preserving the original snapshot and checkpoint.

Enqueue binds a request key to actor, tenant, source and canonical policy. Changed-content replay conflicts. An active-source unique index prevents duplicate competing tasks. Source references are looked up server-side in the scoped workspace; request payloads cannot inject jobs, payment amounts or recipient addresses.

Claiming uses a conditional update and a 60-second lease. Expired leases resume the same attempt rather than consuming another provider attempt. Each checkpoint atomically commits source workspace state, task status/history and an audit entry. An audit/storage failure rolls back provider effects and leaves recoverable leased work. Competing workspace updates release the task for retry without overwriting another command. Every execution reloads the original owner's current role/grants/active status, feature enablement and customer archive status. Revoked or disabled work is blocked pending explicit review.

Delivery fixtures support success, transient failure and permanent failure. The queue respects the domain outbox's next-attempt time and three-attempt review limit. Permanent failures stop for review. Supervisor review/resume retains history; only the original authorized owner resumes a task. A different authorized manager can cancel it and create a new task under their own account. Cancellation stops queue processing; it does not void an invoice, release a pending payment reservation or revoke a source delivery. Those remain explicit domain actions. An already delivered source is acknowledged without another effect.

**Process due tasks** performs bounded execution. The Worker also exports a scheduled handler, enabled only by SYNTHETIC_OPERATIONS_SCHEDULER_ENABLED=true plus the operations/domain flags. No cron trigger, public processing URL, production queue or deployment is configured. Local Wrangler test-scheduled can exercise the handler. Future work needs approved deployment scheduling, metrics/alerts, retention and production scaling. Synthetic tasks are capped at 2,000 retained rows per tenant; listing is cursor-paginated at 100 and history explicitly indicates its 100-entry display limit.

Provider registry exposes capabilities and live=false for DocuSign, payments, QBO, certificate mail, Andrew, Q-Shred, truck navigation and fleet fixtures. Existing Andrew/Q-Shred exports remain the approved synthetic export adapters; this queue does not introduce live compatibility.

## Phase 3: delivered document and measured-billing work

Uncontracted weight/hour estimates accept optional measuredQuantity as a decimal string with up to three fractional digits (0.001-10000 units). Integer thousandths and BigInt multiplication round the extended amount to cents, half up, before existing discounts/fuel/tax. Legacy whole-unit behavior and accepted price snapshots remain intact. Containers/fixed units reject fractional quantities. Signed agreement pricing remains authoritative; entering measured units does not override it. Money remains USD, configurable tax remains manually supplied, and no automatic tax/FX provider is added.

GET /v1/operations/document accepts customerId, type=invoice|certificate|operations, id for individual documents, and format=json|html|csv|pdf. All reads require the verified local manager/admin scope. Downloads are JSON envelopes with filename, contentType, encoding, content and SHA-256 of decoded file bytes. Binary PDF uses base64; HTML/CSV use UTF-8. The basic Operations screen downloads these outputs.

The document endpoint requires all three domain workspace flags as well as operations enablement; disabling a workspace cannot be bypassed through this reporting surface.

Invoice documents show billing snapshots, line snapshots, refunds/credits and current balances. Certificate documents verify the custody chain and preserve SAMPLE, void and revision labels. Operational reports include all rows within the current workspace bounds. HTML escapes markup and CSV neutralizes formula prefixes. PDFs embed bundled OFL-licensed Noto Sans, wrap long values and paginate rather than applying the older four-line truncation. Latin/Greek/Cyrillic text is covered; unsupported glyphs return an explicit error and suggest UTF-8 output. PDF output is bounded at 200 pages; document models at 1.5 MiB. These are sample document templates, not legally approved invoices or real destruction evidence. Existing management/PDF and inventory export limits are unchanged; this service does not claim universal multilingual support or unlimited exports.

Generate sample outputs with `node scripts/build-sample-documents.mjs`. Remaining phase 3 work includes general asynchronous exports across inventory/finance/custody, complex-script/RTL/CJK fonts and layout, production document archival/delivery, approved tax/financial reconciliation policies and any required currency support.

## Phase 4 and external dependencies

The reporting/client-readiness continuation below implements the shared login, protected queues/migration, indexed relational reads, monitoring, retention and release procedures. Approved live adapters, larger canonical write volumes, advanced PDF typography and external acceptance are still separate limits; ProductionReady remains false.

## API surface

All paths begin /v1/operations/. GET: status, sample, tasks (cursor), history (taskId), document. POST: sample (datasetVersion), tasks (task), run (limit 1-10), control (taskId/action/expectedVersion/reason). POST bodies include customerId. The local shared-token principal, dispatcher/warehouse/viewer roles and foreign scopes are denied. Existing persistent request auditing still applies, with additional transactional task/install audit entries.

## Verification recorded for this increment

154 automated tests pass, including deterministic four-tenant samples, transactional sample install, audit-failure rollback, financial delivery effects, expired leases, competing runners, workspace compare-and-swap races, revocation/feature controls, recurrence deduplication, a 1,205-row durable export, PDF output and basic UI flows. Web build and Worker dry-run pass. The backend dependency audit reports zero vulnerabilities. An actual isolated local D1 run passes all four task kinds, source preservation, replay, customer denial and Worker PDF output; its backup restores with integrity/foreign-key checks and sessions revoked. Sample PDFs were rendered and visually checked, and accented text extraction verified. This is automated/local evidence, not physical-device or production acceptance.

## Continuation: reporting and client-readiness backend

Migrations 0010 and 0011 add normalized export snapshots/rows, append-only document archives, settlement reconciliation, persistent alerts and a transactional relational entity read model. The new **Reports & Readiness** screen provides basic controls. Current dataset is irm-full-sample-v2, including matched and mismatched settlement CSVs for all four tenants. Existing installed datasets/workspaces are preserved; use a fresh isolated fixture database for the complete v2 scenarios.

Seven export kinds cover source inventory, warehouse inventory/custody, invoices/payments and field jobs/custody. Snapshots are retained in normalized rows, processed 200 rows per pass, and read in pages of up to 1,000 rows. Processing leases recover after restart; owner/grants, feature flags and customer status are rechecked. State/output/audit checkpoint atomically. A 2,006-row fixture verifies no older 1,000-row truncation. Exports are bounded at 100,000 rows and 100 retained runs per tenant. The browser combines pages up to 50 MiB; larger consumers use the chunk endpoint directly. Every download chunk has a SHA-256. Exports preserve snapshot values after source edits.

Settlement import uses the synthetic contract ExternalID,Kind,Reference,AmountCents,Currency. Capture/refund rows have positive USD cents and fictional demo- IDs. Duplicate identities/references are rejected; matched, mismatched, missing and unknown entries are retained, along with explicit review reasons. Neither imports nor review change the money ledger. Archive requests store generated sample PDF/HTML/CSV bytes and hashes; replay returns the same immutable output even after source changes. SQL triggers prohibit updates/deletion through ordinary application access. They do not claim privileged-administrator WORM certification.

Operational entities are scoped by customer/domain/collection/entity and indexed by status and service date. Additive triggers backfill and maintain read projections inside the source transaction; unchanged entity payloads are not rewritten. Search paginates 100 records with text/status/date filters. Existing aggregate engines remain the command authority and retain their explicit workspace/event bounds; this read-model work does not claim unlimited canonical write scalability.

Mobile inventory/driver/warehouse screens now share system-browser PKCE account login and sign-out. Pasted test-session controls are removed. Verified offline queues use SQLCipher with independent OS-protected 256-bit keys per API origin/workflow/actor/customer; missing cipher or keys fails closed, with no plaintext fallback. Demo-only storage remains separate. Legacy verified rows copy before source cleanup; durable markers permit interrupted cleanup without overwriting newer protected work. Ownership mismatch, source races or copy failure retain original evidence. Sign-out/expiry/revocation lock scopes; pending encrypted evidence is retained for the same account. Device backup erasure and loss/recovery remain operational acceptance matters.

Alerts persist review/access/stalled-processing/report/provider/financial conditions, acknowledgment actor/reason and resolution. The opt-in scheduled handler refreshes them. Retention offers a dry-run preview and narrowly confirmed cleanup of old terminal task/export metadata, preserving business records, audits and document archives. No external notifications are sent.

See backend-release-runbook.md for local preparation, migration/rollback, key handling, secret rotation and rollout gates. wrangler.pilot.json is an intentionally disabled placeholder with no public route/preview/cron and all mutation flags false. No deployment was performed.

The current software delivers the authorized synthetic workflows across the four phases. Separate remaining implementation/acceptance limits are explicit: complex-script/RTL/CJK PDF typography, replacing bounded canonical aggregates for larger operational volumes, approved live-provider adapters/credentials, regulated archival/compliance policies, native iOS compilation, physical-device testing, signing and production approval. These are not established by automated fixture tests, and production readiness remains false.

Observed continuation checks: 176 automated tests pass. Actual local D1 verifies all seven general export types, indexed search, archive replay, matched settlement review, alert acknowledgment and retention preview; source inventory stays unchanged. The complete database restores with integrity/foreign-key checks and sessions invalidated. Native arm64 Android assembly with SQLCipher and iOS JavaScript export pass; native iOS/device acceptance is not inferred. No production deployment or external delivery was performed.

Protected identity-cache restore also covers offline cold restart within original verified expiry, without allowing a revoked/expired session to fall back offline. This is bounded offline authorization, not a renewed server session.
