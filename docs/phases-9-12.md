# Phases 9–12 — synthetic implementation

Implemented against the current main/feature history on November 14, 2026. This report supersedes the older backlog status. Existing local demo navigation and behavior remain available; Warehouse Workflows is an additional screen.

## Phase 9: authentication and authorization

Verified Access JWTs, revocable hashed sessions, live role/customer checks and persistent audit writes from phase 8 remain enforced. Added interactive browser sign-in: an Access-protected /auth/login route independently verifies the edge assertion and approved user, then redirects with a one-minute, hashed, one-time code. /auth/exchange binds that code to the original state and S256 PKCE verifier before issuing a session. Codes cannot be replayed. Identity tokens never enter redirect URLs; the client clears the callback fragment before exchange. Tokens remain in memory; only the temporary PKCE verifier/state are stored in sessionStorage during navigation.

To configure an approved test identity provider, protect only /auth/login with a Cloudflare Access application. Configure ACCESS_ISSUER, ACCESS_AUDIENCE, ACCESS_LOGIN_ENABLED=true and exact READONLY_ALLOWED_ORIGINS. The rest of the API independently verifies its bearer sessions and does not depend on an Access browser cookie. Provision active app_users and explicit customer grants in a dedicated synthetic database. No provider was connected during implementation. Native apps retain the verified user-session connection option; platform-native interactive sign-in/deep-link integration is not supplied.

All warehouse commands require a verified user, an appropriate role and an explicit customer grant. Warehouse staff can pick, receive, stage, refile and move; dispatchers can create/cancel orders, register expected receipts and handle courier handoffs. Managers/admins combine these permissions but still require customer grants. Workspace reads require orders:read; viewers keep source inventory access without receiving work-order data. Existing /v1/scans remains a separate local-only synthetic event endpoint; warehouse processing uses the isolated command endpoint.

## Phase 10: inventory and location operations

Source inventory remains read-only through D1-backed search and exact record detail lookup. The web/Windows remote view now opens record details and escapes remote values. Local source demo records remain separate. New synthetic workspace inventories track record status, location, custodian and version, with validated storage/receiving/staging locations. New expected items must use DEMO-BX/FL numeric barcodes and a matching Box/File kind; they cannot create operational source records.

GET /v1/sandbox/workspace?customerId=c2 reads a customer workspace. POST /v1/sandbox/commands accepts {customerId,command}. These routes require SYNTHETIC_WORKFLOWS_ENABLED=true AND a localhost/127.0.0.1 hostname AND a verified user. Shared-token demo principals are rejected. Only c1–c4 synthetic fixtures are accepted. The sandbox_workspaces table stores versioned synthetic snapshots, receipts and custody history; original records, work_orders and scan_events tables are not updated by these commands. Compare-and-swap updates prevent concurrent writers from losing changes.

## Phase 11: Zebra and offline synchronization

The existing keyboard-wedge flow is preserved. A local Expo Android module additionally receives DataWedge broadcast intents with action com.alphazonelabs.irmrmsdemo.SCAN and data key com.symbol.datawedge.data_string. It registers only while observed, processes input only while the app has window focus, bounds payload length, and unregisters on cleanup. The app normalizes input, suppresses duplicate intent bursts and checks every action against synthetic inventory/workflow state. Hardware input is untrusted; it never supplies authorization.

In DataWedge, associate the installed package com.alphazonelabs.irmrmsdemo with a profile. Enable Barcode Input and either Keyboard Output with Enter-as-event OR Intent Output with Broadcast Intent, the action above, DEFAULT category, explicit package and signature verification. Enable one output mode at a time. Intent support requires a native development build; Expo Go can use keyboard-wedge input. Physical model/profile validation remains necessary.

The workflow queue uses SQLite WAL with exclusive transactions to atomically persist both the command and its optimistic projection. Queue/state scopes bind to user and customer; switching users cannot upload another user's queue. Stable command IDs, server receipts, interrupted-send recovery, retry scheduling, session-error stops and visible conflicts are integrated with the shared coordinator. Server conflicts are never silently replayed with revised versions: the user loads fresh state and explicitly creates a replacement with a new ID. Original rejected events remain persisted with a supersededBy link. Native custody hashing uses expo-crypto rather than assuming browser WebCrypto exists in Hermes.

Default mobile workflow synchronization targets an on-device durable simulator and is labelled accordingly. The verified local D1 mode uses http://127.0.0.1:8787; on a test device use adb reverse tcp:8787 tcp:8787. Supply an approved temporary user session from the local test backend. The API is never exposed on a LAN/public host to make mobile testing work. Foreground resume can resume an existing coordinator; background OS jobs and real operational uploads are not implemented.

## Phase 12: warehouse workflows and custody

Implemented commands: register_record, create_order, cancel_order, pick, receive, stage, refile, move, dispatch and deliver. Orders support Retrieval, Withdrawal, Refile and Receiving. Pick lists validate membership, record/order versions and sequencing. All outbound items must be staged before dispatch. Courier and recipient references must be synthetic demo identifiers. Retrieval deliveries can return through receiving/staging/refiling; withdrawals cannot be treated as retrieval returns. New expected arrivals use a Receiving order. Untouched orders may be cancelled; processed orders cannot be silently rolled back.

Each state transition appends an actor/time/customer/record/order event with before/after location, status and custodian. Custody events are hash-linked for integrity verification. They are stored atomically with workflow state and idempotency receipts. There is no API to edit old custody entries, but this is a synthetic database ledger, not an externally immutable compliance archive. Workspace size/event limits bound demonstration storage. Destruction, operational writes, real couriers and production integrations remain disabled.

## Validation and remaining rollout work

- Unit, signed-JWT, SQL-backed API, persisted SQLite queue, concurrency and DOM workflow tests cover phases 9–12.
- Local Wrangler/D1 completed a full retrieval → pick → stage → dispatch → deliver → return → receive → stage → refile round trip with nine verified custody events; source inventory was unchanged.
- The migration was applied only to local D1. Worker packaging uses dry-run only.
- All 78 tests pass. Android Hermes export passes (596 modules), Expo Doctor passes 18/18 checks, and :irm-scanner:compileDebugKotlin succeeds against SDK 36 / Kotlin 2.1.20. This verifies the receiver source compiles; no physical scanner or release APK sign-off is implied.
- Dependency installation reports 19 Android dependency advisories (1 low, 16 moderate, 2 high). These remain a production-readiness blocker.
- Windows x64 release/NSIS installer packaging and Worker dry-run packaging both pass. No Worker is deployed.
- Approved Access configuration, Zebra hardware validation, native interactive login, OS-secure credential acquisition, installer signing and production security/dependency remediation remain rollout work. No real data or production endpoint was connected.

Existing phase-8.md remains a historical record of that delivery. Phases 13–15 (management/reporting, approved external adapters and supervised production readiness) are not implemented by this change.
