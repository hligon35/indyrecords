# Phase 8 — verified access and synthetic platform integration

Implemented on feature/irm-rms-foundation, validated November 13, 2026. The existing navigation, local inventory, scanner and synthetic demonstration remain available. No real records, production mutations or public API deployment were connected or enabled.

## Implementation

1. Authentication: Cloudflare Access RS256 signature/claim verification, fixed issuer/audience, cached/rotating public keys, explicit active-user provisioning, opaque 15-minute maximum sessions stored only as hashes, expiry and logout revocation. Web/Windows exchange verified identity tokens and keep sessions in memory. Interactive provider login remains external.
2. Authorization: role checks at the Worker boundary; customer grants constrain list, barcode detail, inventory aggregates and scan aggregates in SQL. User state and grants reload on every request. Even admins require explicit customer access. Shared-token demo access is loopback only.
3. Audit: persistent D1 allow/deny writes for non-health API requests, including anonymous denials. The response is withheld if audit persistence fails. Request IDs correlate with audit rows; detail barcode paths are hashed. No tokens or search queries are logged. No audit browser or immutable archive is provided.
4. Read-only inventory: user verification, bounded pagination, exact-origin CORS, credential clearing on 401, stale-response rejection and session revocation on disconnect. Remote data stays in memory and is not mixed with local demonstration state. The service worker caches only static assets.
5. Android: DataWedge keyboard-wedge/Enter flow, focus restoration, immediate duplicate-submit locking, corrected duplicate operation matching and event keys, SQLite receipt simulator connected to the shared offline coordinator. Acknowledgements, retries, conflicts and interrupted-send recovery use stable IDs. Synchronization is explicitly on-device synthetic simulation, with no remote uploads. Shared-source Metro configuration and an Expo SDK override avoid build resolution/version conflicts.
6. Windows: automatic loopback-only frontend development server, generated icon assets, working frontend build path, CSP matching the existing interface, explicit approved HTTPS-origin option, Rust-path discovery, dependency locks, and successful x64 NSIS installer generation.

Added GitHub Actions checks for API/web, Android bundling, and Windows builds. Local verification is complete; hosted workflow results must be checked separately after push.

## Observed verification

| Check | Result |
| --- | --- |
| Node tests, including signed JWTs and SQLite-backed API security | 62 passed, 0 failed |
| Local D1 migrations 0001–0003 | All applied |
| Worker/D1 read-only integration | Four paginated synthetic records, detail, summary, desktop CORS and audit request ID passed |
| Static web build | Passed |
| Wrangler packaging dry run | Passed; no deployment |
| Expo Android export | Passed; 588 modules, Hermes bundle generated |
| Expo Doctor | 18/18 passed |
| Tauri release and NSIS packaging | Passed; unsigned x64 installer generated |
| Diff whitespace check | Passed |
| Android dependency audit | 14 affected packages: 1 low, 11 moderate, 2 high |
| Visual browser/native runtime check | Browser automation timed out; no visual sign-off |

The test suite uses both mocked D1 calls and actual SQLite with every migration applied. Local Wrangler checks additionally exercise D1 emulation. No remote D1 migrations ran. The Android export is a JavaScript/Hermes bundle, not a release APK or a physical-device test.

## Remaining blockers and boundaries

- An approved Access team/application, audience, users and exact frontend origins must be provisioned before verified remote login can be exercised. No identity account is configured. Interactive login redirects/native secure token acquisition remain future work.
- Dependency audit still reports image-size and postcss high-severity findings plus the Expo tooling advisory chain. A compatible audit repair was attempted, but remediation requires further dependency work/SDK migration; the app stays on SDK 54. Do not treat the successful bundle or Expo Doctor result as security clearance.
- A Zebra device must validate its DataWedge profile, Enter events, focus, duplicate reads, offline restart and SQLite durability. Native intent delivery, device encryption/provisioning and real server sync remain unimplemented.
- Windows compiles and packages; installer launch, WebView2 behavior, authentication/CORS in the installed app, enterprise signing and target-device rollout remain unverified. The installer is unsigned and contains synthetic demonstration behavior only.
- Operational API rate limiting, session cleanup/audit retention, immutable audit archival, work-order validation and custody/destruction approvals remain future work. Production record mutations remain blocked regardless of user role.
- workers_dev and preview URLs are disabled; the database ID remains a placeholder. No development shared-token API was published.

See authentication-plan.md and backend.md for local setup; platform READMEs explain the scanner and desktop boundaries. Historical phase documents describe earlier implementation states and are superseded by this report.
