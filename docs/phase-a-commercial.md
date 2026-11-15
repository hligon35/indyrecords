# Phase A — synthetic commercial office

Implemented November 14, 2026. Open **Commercial Office** in the web/Windows navigation. This is a working synthetic office workflow, not live financial or signature processing. Existing inventory, warehouse, account administration and demonstration screens remain available.

The later [four-phase backend continuation](backend-four-phases.md) adds optional fractional weight/hour estimates, backend sample invoice PDFs/HTML/CSV and a durable runner for the existing synthetic provider outbox. Whole-unit-only and no-invoice-PDF limitations below describe the original Phase A delivery.

## Delivered workflow

- Separate prospects, customers and lost prospects; conversion retains account/contact/activity references. Add/archive accounts, locations and contacts, update names, record interactions, assign dated follow-ups and complete tasks.
- Multiple service locations with IANA timezones and local service windows, plus an explicit billing location/contact. Invoice drafts snapshot billing details so later CRM edits do not change issued documents.
- Strict synthetic CRM CSV import: ExternalID,Name,Stage; IDs start demo-, names start Demo, stages prospect/customer. Imports create up to 50 rows per run and reconcile matching/conflicting/duplicate/rejected rows without overwriting existing accounts. Imported customers enqueue synthetic QBO updates. Sample:

```csv
ExternalID,Name,Stage
demo-legal,Demo Legal,prospect
demo-medical,Demo Medical,customer
```

- Agreements cover one or multiple locations, effective/end/renewal dates, cancellation terms and versioned pricing. Draft revisions retain prior prices. Simulated DocuSign requests enter a persistent outbox; delivery makes the agreement sent, then a simulated signer outcome records signed/declined/voided. Signed agreements may be terminated with a reason; new contracted work requires an in-date signed agreement.
- Purge and recurring estimates support onsite/offsite work and container/weight/hour/fixed units. Price = max(quantity × unit rate, minimum), less discount, plus fuel surcharge, then tax. USD amounts use integer cents, percentages use basis points and half-up rounding; financial snapshots retain the exact calculation. Draft revisions preserve previous prices; accepted estimates cannot be repriced.
- Location-local date scheduling uses arbitrary day intervals (7 = weekly), bounded rolling generation windows up to 90 days, skips/holiday exceptions, moved occurrences, job reschedule/cancel and recurring-plan cancellation. Stable occurrence keys prevent duplicates when generating again. Dates do not drift over daylight-saving transitions. Location windows are planning metadata; this is not truck routing or automatic UTC appointment allocation.
- Synthetic job completion enables invoice drafting. Choose one job for an individual invoice, or multiple completed jobs across locations of the same account for consolidated billing. Explicit billing periods, due dates and immutable line snapshots prevent duplicate billing. Cancelling drafts releases jobs for rebatching. Issued invoice totals cannot be edited; adjustments are separate credits. Balances account for captured payments, settled refunds and credits; overdue-day display uses UTC calendar dates.
- Simulated hosted checkout requests reserve unpaid balances. No card fields or credentials are collected. Capture and partial-refund requests settle only through the synthetic payments outbox; pending refunds reserve refundable funds. Pending payment cancellation releases its reservation. Credits cannot overdraw the balance or race a pending capture.
- Persistent provider outbox for synthetic DocuSign, payments and QBO customer/invoice/payment/credit/refund entries. Requests preserve payload snapshots and stable keys. Delivery supports explicit success/failure, exponential retry backoff, a three-attempt limit and supervisor review before another attempt cycle. QBO fixture reconciliation records matched/conflicting external references and totals with retained history, rather than silently overwriting local money.
- Commercial views show current records, history, balances and delivery status, with CSV exports of all rows in the selected section. Section exports preserve nested records as JSON cells; these are operational review exports, not vendor-supported import files or legal invoice PDFs.

## Persistence, security and retries

Migration 0007 creates commercial_workspaces, keyed by the existing fictional c1–c4 customer scope. It never changes source inventory. State, immutable snapshots, events, command receipts and integration outbox are saved atomically in a versioned D1 compare-and-swap. Replaying the same command ID/content acknowledges the original result; reusing an ID with changed content or using a stale version returns a conflict. Concurrent callers cannot overwrite another accepted command.

GET /v1/commercial/workspace?customerId=c2 and POST /v1/commercial/commands require a verified manager/admin with commercial:read/manage and an explicit tenant grant. Both routes require loopback and SYNTHETIC_COMMERCIAL_ENABLED=true. Shared-token principals, public hosts, viewers and foreign scopes are denied. Every request inherits persistent fail-closed access auditing. Workspace responses omit internal command receipts. There is no raw vendor webhook, OAuth credential endpoint, public mutation or real checkout URL.

Local demonstration uses the same engine and persistent browser storage. Verified API mode keeps workspace responses in memory and clears them when the connection changes. After an uncertain API delivery, retrying unchanged reuses the command ID; after a full reload, review recent activity before submitting a replacement. This is not a production-grade persistent client financial queue.

Workspace limits: 100 commercial accounts, 1,000 jobs, 2,000 accepted commands and 1.5 MiB encoded state. Inputs are bounded at 16 KiB; CRM CSV at 8 KiB. Quantities are whole units; money is USD only. These limits fail explicitly rather than silently truncate data. Tables display the latest 100 rows; section CSV exports include all stored rows.

## Local verification and operation

1. Install root dependencies and apply migrations with npm run db:local. Load scripts/seed-demo.sql only with Wrangler --local. The repository binding may identify a real Cloudflare database; no remote command is needed or authorized for this workflow.
2. Set SYNTHETIC_COMMERCIAL_ENABLED=true only in ignored local .dev.vars and run the API bound to 127.0.0.1. Provision a dedicated synthetic manager/admin and short-lived scoped test session through the existing local test procedure. Do not publish that session or a shared token.
3. Connect through Remote Read-Only, then choose Verified local API in Commercial Office and reload the workspace. Alternatively, use the independent local demonstration without a server.
4. Create prospect/contact/locations -> convert customer -> choose billing destination -> draft/send/simulate signing agreement -> draft/accept estimate -> schedule/generate -> record synthetic completion -> draft/issue invoice -> request/capture simulated payment. Use Integrations to deliver pending fixtures, inspect failures, review exhausted deliveries and reconcile QBO fixture totals.
5. npm test verifies the domain/UI and Worker integration boundaries. scripts/local-commercial-smoke.mjs uses IRM_TEST_SESSION (never a command-line token), connects only to loopback, executes prospect-to-payment with replay of every command, checks customer denial and source preservation, and revokes its temporary session afterward. Evidence is ignored under dist/readiness/phase-a-local.json.
6. npm run verify:restore now includes the commercial workspace count and still invalidates restored sessions/codes in a separate local database. Never restore this synthetic backup over an operational database.

Observed results: 115 automated tests pass; web bundling and Worker dry-run pass; migration 0007 applies locally; the local D1 prospect-to-payment/replay/isolation/source-preservation check passes. Final Windows x64 release/NSIS packaging and isolated local backup/restore pass. The installer remains unsigned and unverified on an operational workstation. No Android source changed and no new mobile release or physical-device acceptance is claimed.

## What is deliberately not live

DocuSign, payments and QBO are explicitly labeled simulation workflows. They do not send contracts, collect money, refund real transactions, synchronize a real company or validate real provider webhooks. Live adapters require approved accounts/provider selection, supported contracts, OAuth/secret handling, signed-webhook verification, independent reconciliation/security testing and separate authorization for external mutations. There are no claims of DocuSign/QBO compatibility based on these fixtures alone.

No automatic tax determination, fractional measured-unit billing, multi-currency accounting, legally formatted invoice PDFs, real electronic signature evidence or production finance approval is supplied. Configurable synthetic tax/price calculations require operational review before use. Driver routing, GPS, iPhone workflows, destruction authorization/certificates and fleet monitoring remain Phase B. Existing larger export/multilingual PDF and security/release gates remain tracked separately. Nothing here authorizes real destruction, certifies compliance or enables production readiness.
