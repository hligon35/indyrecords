# Phases 13–15 — management, synthetic adapters and pilot preparation

Implemented November 14, 2026, preserving the interface, local demonstration and production-write restrictions. The user selected synthetic export adapters; no vendor/company endpoints or records were connected. This document supersedes the older backlog status.

## Phase 13 — management and reporting

Management & Reports is a new web/Windows screen with a local demo and verified-API mode. Managers/admins can edit versioned c1–c4 synthetic customer profiles (display name, demo contact alias and active/archive state). Profiles are separate from the read-only source customers table; original names/records are preserved. Archiving blocks new synthetic order creation/intake, while existing work can still be completed. This is fixture-profile management, not an operational customer-provisioning service.

Scoped inventory, order and custody reports include dashboard totals/status counts, text/kind/status/location filters and UTC date ranges. Source inventory filtering is parameterized in SQL; workspaces filter only within the verified customer's scope. Inventory source dates use record creation time; synthetic inventory dates use the last custody event, orders use their first custody event and custody uses event time. Undated demo records are not assigned invented timestamps. Order reports require orders:read and custody reports require audit:read in addition to reports:read.

CSV exports use RFC-style quoting/CRLF and neutralize spreadsheet formulas. PDF exports are paginated landscape reports with repeated headings, source/customer/filter metadata and page numbers. Four-line PDF cells are visibly shortened; CSV/JSON retain full values. Built-in portable fonts represent non-ASCII code points using explicit U+ notation. This limitation requires acceptance before multilingual use. A 40-row sample PDF was rendered and every page visually reviewed. Exports are capped at 1,000 rows and fail rather than silently drop records; narrow filters for larger source inventories.

GET /v1/management/customers, POST /v1/management/customers, GET /v1/management/report, GET/POST /v1/management/integrations and scoped integration job-detail GET routes are implemented. Writes require a verified user, role/customer permission, loopback hostname and SYNTHETIC_MANAGEMENT_ENABLED=true. Shared-token principals are rejected. Original inventory, vendor data and production records are never modified. Download responses are audited before data is disclosed; audit failure returns 503.

## Phase 14 — synthetic read-only adapters and reconciliation

CONTRACTS defines synthetic-andrew-v1 and synthetic-qshred-v1 CSV contracts. These are explicitly test contracts, not claims about supported Andrew/Q-Shred product APIs. Example files are under fixtures/integrations. The strict reader handles BOM, CRLF, quoted commas, escaped quotes and multiline fields, and rejects malformed quoting, wrong headers, oversized fields/files, excess rows and invalid contract versions.

Staging enforces a single granted synthetic customer and fictional barcodes. It records source-qualified IDs, schema version, filename, raw-file SHA-256, source/row timestamps, source age/freshness warnings, accepted/rejected counts, row references and reconciliation output. Raw rejected row contents are not returned. Exports older than 30 days or future-dated beyond a five-minute skew are rejected; exports over 24 hours old are flagged. Files are bounded at 128 KiB / 500 rows. Staging persists only integration_jobs and never overwrites canonical/source inventory.

Reconciliation uses customer-qualified barcode keys, detects duplicate barcodes on both sides, and reports mismatches, missing source matches and target-only rows. Scoped history retains immutable job snapshots for review; the UI shows recent jobs and retrieves full results through the authorized API. There is no vendor HTTP client, credential scraper, undocumented endpoint or write-back path. Supported real product/version schemas and integration rights remain external approval work.

## Phase 15 — security and cross-platform preparation

Added persistent per-peer authentication throttling for login/code exchange/session issuance, bounded export input, explicit native redirect allowlists and expired authentication-data cleanup primitives. Custody/audit history is not automatically purged; operational retention requires an approved policy. API permissions, customer isolation, replay resistance, version conflicts, CSV injection, source preservation and audit-storage failure have executable tests.

Windows system-browser login uses Tauri deep-link/opener/single-instance plugins. Only HTTPS URLs may be opened; the installed application registers irmrmsdesktop://auth. Android system-browser login returns through irmrmsdemo://auth, with short-lived sessions stored through expo-secure-store and cleared on expiry/revocation/sign-out. Login codes remain state/PKCE-bound. To enable either flow, a test identity administrator must configure Access protection on /auth/login, exact READONLY_ALLOWED_ORIGINS, and explicit NATIVE_LOGIN_REDIRECTS. No provider was configured or contacted. Windows keeps bearer sessions in memory; Android backup excludes protected session data through its config plugin.

Patched image-size/PostCSS overrides remove the previously reported two high-severity Android build-tool findings without changing the supported Expo major version. A Metro PNG parser and PostCSS compatibility check passes. The final audit reports zero high/critical findings and 18 low/moderate dependency findings requiring remediation or documented risk review. The SDK was not blindly upgraded across four major releases while target Zebra compatibility is unknown.

pilot/acceptance-plan.md is a concrete supervised synthetic acceptance/stop/rollback plan with named evidence owners and explicit entry/exit conditions. pilot/evidence.template.json starts all external approvals as pending. npm run verify:pilot executes the tests, web build and Worker dry-run, ties evidence to a commit, checks workspace cleanliness and validates referenced platform proof hashes. It cannot self-certify external approvals or enable production readiness. npm run verify:restore exports only local D1, restores into a separate database, checks integrity/foreign keys, and revokes restored sessions/codes to avoid reviving old credentials. Backup artifacts stay ignored/private.

## Observed verification

- 96 Node tests pass, covering domain, persisted queue, signed/native login, customer management, report/export, adapter, role/scope, concurrency and DOM flows.
- Migration 0005 applied only to local D1.
- Local D1 management test passed profile archive/versioning, tenant isolation, CSV/PDF downloads with audit IDs, both adapters/job history, and source preservation (765 ms in the observed local run; not a production performance claim).
- Local backup/restore passed after profiles and staging jobs were populated; original DB was unchanged and restored authentication data was invalidated.
- Android Hermes export and all 18 Expo health checks pass; patched dependency compatibility check passes. Android app/Zebra Kotlin compilation passes with the secure-storage/browser SDK modules linked.
- Windows x64 release/NSIS packaging passes with native authentication plugins. The installer remains unsigned and was not installed on an operational workstation.
- Sample PDF: 40 synthetic rows, four rendered/inspected pages, no JavaScript/form fields. CSV/JSON retain complete data beyond shortened PDF cells.
- Worker package verification uses --dry-run; no public API or real database deployment occurred.

Full arm64 Android APK assembly passed (235 Gradle tasks) in an isolated short-path workspace. The long checkout triggered Ninja/CMake path handling, and a shortened Windows compiler name required explicit C++ shared-linker mode; scripts/windows-android-ndk.init.gradle documents and reproduces that host workaround. The APK embeds its JavaScript bundle and uses the standard Android test key. It is a synthetic test artifact, not a signed enterprise/store release or physical-device acceptance. The readiness gate requires a complete APK as well as the Hermes bundle and scanner compilation.

## Remaining external acceptance gates

Operational deployment and a real supervised pilot are NOT certified. Actual Access/native callback round trips, physical Zebra/DataWedge behavior, Android Keystore/backup behavior, Windows/WebView2 runtime behavior, enterprise signing, approved vendor contracts, residual dependency disposition and management/security sign-off require independent evidence. Production/shared-token publication, live company records and operational writes remain disabled. The package prepares those reviews without claiming they happened.
