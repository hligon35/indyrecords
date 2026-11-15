# Shredding-service competitive implementation scope

Requested November 14, 2026. This is additional product scope, not a claim of implemented feature parity. The existing RMS has synthetic inventory/custody, workflow, scoped administration and reporting foundations. It does not yet implement the commercial shredding lifecycle below. Existing synthetic-only, no-production-mutations and no-public-shared-token restrictions continue to apply.

## Competitive baseline

Reviewed the vendor's public descriptions, not a live Q-Shred installation:

- https://shredmetrics.com/customer-management/ — prospects/clients, account contacts, locations, interactions, contracts, estimating and certificates.
- https://shredmetrics.com/software-features/ — recurring/purge estimating, driver work, invoicing and accounting/payment integration.
- https://shredmetrics.com/q-shred-software/ — on/off-site jobs, mobile driver work and bin barcode monitoring.
- https://shredmetrics.com/routing-dispatch/ — route sequencing, vehicle restrictions, navigation and optional fleet services.

Fleet GPS/ECM, cameras and ELD offerings are described as additional provider-backed services. Do not present these as native functions already supplied by IRM RMS, or describe a custom driver log as an approved ELD. Public marketing descriptions are not API specifications or independent certification evidence.

## Phase A — commercial office workflows

1. CRM: separate prospects and customers; multiple contacts and service/billing locations; interactions, assigned follow-ups, pipeline stage and loss reasons; idempotent prospect conversion preserving history. Tenant-scoped CRUD, archive instead of destructive deletion, optimistic versions, audit events and synthetic imports with reconciliation.
2. Agreements: effective dates, price schedule versions, renewal dates, cancellation terms and location coverage. DocuSign adapter contract for draft/send/status/completed/declined/voided; synthetic webhook fixtures first, signed-webhook verification and replay protection before live enablement. Keep customer consent, signer permissions and document access separate from user login.
3. Estimates: purge and recurring service, on-site/off-site, container/weight/time/minimum-charge pricing, discounts, fuel surcharges and tax configuration; integer currency arithmetic and explicit rounding; revision history, acceptance and conversion to service orders without duplicate jobs.
4. Scheduling: location timezone, service windows, weekly/custom recurrence, holidays, exceptions, skips, reschedules and cancelled occurrences. Generate a bounded horizon with unique occurrence IDs; daylight-saving transitions and repeated generation must not duplicate work.
5. Billing: per-job and parent-account consolidated invoice drafts, location/job line references, period grouping, credits, refunds, overdue balances and reconciliation. Issued invoice values remain versioned/immutable; changes require adjustments. Prevent double billing when jobs move between draft batches.
6. Payments: provider-hosted checkout/tokenization, payment/refund state machine, signed webhooks, idempotency and settlement reconciliation. Never collect/store raw card credentials in RMS. Synthetic success/failure/retry/dispute cases first; no real charges under current authorization.
7. QBO: approved OAuth connection, scoped mappings for customers/items/tax/invoices/payments, durable outbox, idempotent writes, retry/backoff, conflict review and reconciliation. Synthetic adapter is not a live integration. Financial writes require separate authorization before enabling production.

Acceptance: an authorized synthetic operator can convert a prospect, service two locations, accept a versioned estimate, generate recurring and purge jobs, reschedule an occurrence, and produce individual/consolidated invoice drafts without losing history, leaking tenants or charging a real card. Contract/payment/accounting simulators must run replay, duplicate and failure scenarios. UI, persistent API, permission tests and exportable reconciliation evidence are required; schema-only work does not count as complete.

## Phase B — dispatch, driver execution and evidence

1. Dispatch board: unassigned/assigned/in-progress/completed/exception work, vehicle/driver assignment, availability, container capacity, service duration, breaks, time windows, depot/recycler endpoints, multi-day plans and manual resequencing.
2. Route planning: pluggable travel-time matrix and constrained sequencing; estimate travel/service/wait/break time, day end and configurable overtime warning. Show infeasible jobs and data freshness. A synthetic distance heuristic must be labeled a simulation, not road-safe truck navigation.
3. Commercial navigation: provider-backed routes using vehicle dimensions/weight and road restrictions; approved navigation handoff, location permissions and interruption recovery. Provider selection, licensed map data and road/device acceptance remain prerequisites for real navigation.
4. Driver app: iPhone and Zebra Android assignment list, start/arrive/complete/exception actions, bin assignment and barcode events, production quantities, customer acknowledgment and custody evidence. Persist offline events atomically; recover on restart; handle duplicate delivery, revoked access, concurrent reassignment, conflicts and explicit supervisor review. Build/test iOS separately; existing Android support does not prove iPhone readiness.
5. Destruction evidence: separate authorization, performed-action evidence and certificate issuance. Authorized transitions only; chain-of-custody reconciliation; no certificate for incomplete/unauthorized work. Synthetic certificates must say SAMPLE / NOT PROOF OF DESTRUCTION. Preserve revisions, void/correction history and references. Real destruction remains blocked until separately approved.
6. Certificate delivery: daily per-customer batching in the customer's timezone, recipients/consent, durable outbox, retries, duplicate suppression, bounces and dispatch history. Draft deliveries first; no outbound customer messages are authorized by this scope entry.
7. Fleet monitoring: provider interfaces for timestamped GPS, odometer/engine diagnostics, camera availability and ELD status. Handle stale/offline/out-of-order data, restrict driver/location access, apply approved retention and log sensitive access. Camera streaming and ELD remain provider/hardware capabilities requiring independent verification; synthetic telemetry must be visibly labeled.
8. Operational dashboards: service completion, exceptions, route utilization, production, estimate conversion, invoice aging and integration failures. Definitions must be testable and drill down to scoped source records. Include large background exports and multilingual reports from the existing backlog.

Acceptance: a synthetic dispatch-to-driver-to-custody-to-invoice/certificate scenario works across web/Windows and iPhone/Android, including offline restart and conflicting reassignment. Route estimates are reproducible against a test matrix. Unsafe/infeasible routing is never silently represented as valid. Telemetry fixtures distinguish live, stale and absent signals. No certification claim is inferred from passing application tests.

## Cross-cutting release gates

- Every new customer/location/job/document remains tenant scoped; define sales, billing, dispatcher, driver and compliance permissions explicitly.
- Money and external deliveries use durable idempotent workflows, not optimistic browser-only status changes.
- Define audit retention, backups, data import/export, monitoring, error ownership and rollback before operational rollout.
- Approve actual DocuSign, payment, QBO, mapping and fleet providers/accounts; obtain supported contracts and credentials outside source control. Keep all adapters synthetic until then.
- Independently review certification support, actual equipment, iOS/Android/Windows behavior, commercial-navigation safety, signing and pilot acceptance. NAID AAA support is a workflow requirement, not a certification awarded by this repository.
- Existing large-export, multilingual PDF, security remediation and deployment gaps are retained rather than superseded by this roadmap.

Implementation order within the two phases: CRM/location model -> agreements/pricing -> estimates/recurrence -> invoice ledger -> synthetic integration outboxes; then dispatch -> driver offline execution -> custody/certificates -> delivery -> provider telemetry/navigation -> end-to-end acceptance. Each increment needs working UI/API/persistence, scoped tests and an honest blocker record before it is reported complete.
