# IRM RMS cross-platform architecture

## Product surfaces
1. **Web**: responsive React/TypeScript admin and operations UI, served over HTTPS, including customer portal only after scoped authorization.
2. **Mobile**: Expo/React Native Android and iOS app; Zebra Android hardware uses a custom native DataWedge Intent Output adapter in a development/production build. Browser wedge fallback is not equivalent to native scan integration.
3. **Windows**: Tauri 2 desktop application with native installer, OS notifications and local file export; compatible USB barcode readers may operate as keyboard wedges. A native HID/serial adapter needs separate device testing.

## Shared foundations
- `packages/domain`: shared validation, workflow state machines, DTOs, permissions and reporting definitions.
- `packages/api-client`: authenticated API calls, retry/error normalization and idempotency keys.
- `apps/web`: React browser application.
- `apps/mobile`: Expo app, scanner adapters and SQLite offline queue.
- `apps/windows`: Tauri desktop host for a shared web frontend.
- `apps/api`: Cloudflare Workers API with D1 initially, subject to measured workload suitability.

These paths are a **target structure**, not all implemented today. The current repository retains a static browser demo, Workers API, migrations and a pure sync queue.

## UX and platform capabilities
- Same navigation model, design tokens, permissions and record statuses on all surfaces.
- Web/Windows prioritize large-table inventory search, reporting, work orders and administration.
- Handheld prioritizes large touch targets, minimal typing, hardware trigger scans and offline continuity.
- Desktop must remain usable with keyboard-only navigation and external barcode readers.
- Cross-platform sessions must use short-lived tokens and secure platform-specific storage. Do not embed a shared API token in browser or desktop bundles.
- Conflict handling must explicitly distinguish local queued, uploading, confirmed and rejected actions.

## Deployment channels
- Independent development, staging and production environments.
- Browser: HTTPS deployment with CSP, CSRF protections where applicable and session security.
- Android/iOS: signed builds, device enrollment and OTA only for compatible JS updates; native scanner bridge changes require new binary.
- Windows: signed MSI/MSIX or supported Tauri installer, controlled auto-update and rollback, signature verification.
- API: separately provisioned environment bindings, migrations, secrets and audit trails.

## Security boundaries
This is an independent unofficial demonstration. Do not use real IRM customer information, scan logs, company credentials or company devices without authorization. No production deployment until tenant isolation, role permissions, custody validation, encryption, monitoring and disaster recovery are tested.

## Cross-platform acceptance
- Browser works on current desktop/mobile browsers with accessible responsive layout.
- Windows builds and launches a native installer, supports keyboard input and downloads, and safely handles updates.
- Android Zebra scanner receives scan intents with correct symbology and repeated scans; iOS uses supported camera scanning.
- Search/report behavior and audit event IDs agree across platforms.
- Offline queue persists across restart, retries idempotently and requires user resolution for conflicts.
- Performance p95 is benchmarked on realistic synthetic workloads and representative hardware.
