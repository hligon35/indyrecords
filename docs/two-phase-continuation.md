# Two-phase continuation

## Phase 1 — synthetic administration

Added Account Administration to web/Windows. A verified local admin can create inactive demo-user-* accounts with explicit customer grants and viewer/warehouse/dispatcher roles. Identity subjects are synthetic:*; no real identity provider is provisioned. Creation uses an atomic D1 batch. Activation/deactivation uses optimistic versions; existing authentication reloads active state on every request. Administrators cannot modify themselves, grant elevated roles, or operate outside their own customer grants. These endpoints never expose external identity subjects or session tokens. Existing source customers remain unchanged. Apply migration 0006 only locally.

## Phase 2 — operational acceptance evidence

Added Pilot Evidence to web/Windows, backed by append-only D1 observations recording actor, tenant, check, outcome, fictional evidence reference and full source commit. Checks cover identity, Zebra, offline, Windows, signing, restore, vendor contracts and security. Failures remain preserved when a later pass is recorded. Only scoped managers/admins can read/write observations, and writes additionally require local synthetic management enabled. No mutation/deletion or production approval endpoint exists. Requests inherit fail-closed access audit logging.

## Boundaries and remaining work

This continuation does not complete every operational gap. Real provider onboarding, physical Zebra/Windows acceptance, vendor-supported real adapters, enterprise signing, production deployment, audit archival/retention and independent security review remain external gates. General management reports remain synchronous and capped at 1,000 rows; the separate operations export service handles larger background snapshots. Management PDFs now embed Noto Sans for complete Latin, Greek and Cyrillic values; complex-script shaping, right-to-left layout and CJK remain open. Destruction stays blocked. No old package or readiness report certifies new commits; rebuild installers and collect new acceptance evidence before use. Neither recording observations nor activating a fictional user authorizes production.

## Verification

102 automated tests pass, including scoped onboarding, atomic duplicate handling, activation/version conflicts, deactivation taking effect in authentication, permission/public-host denials, immutable observation history, UI escaping and stale-data clearing, and Worker access-audit failure withholding data. Web bundling and Worker dry-run pass. Migration 0006 applies successfully to local D1 only. Android source is unchanged in this continuation; no new physical-device evidence is claimed.

Windows x64 release and NSIS packaging also pass with both new screens. The installer remains unsigned and has not undergone workstation runtime acceptance.
