# IRM RMS prototype

Independent synthetic demonstration for web, Windows (Tauri), and Zebra Android keyboard-wedge scanning (Expo). No real IRM records are connected. Production record mutations remain disabled.

- [Current phases 13–15 and pilot boundaries](docs/phases-13-15.md)
- [Warehouse phases 9–12](docs/phases-9-12.md)
- [Authentication and sessions](docs/authentication-plan.md)
- [Local API setup](docs/backend.md)
- [Windows development](apps/windows/README.md)
- [Android demo](apps/mobile/README.md)

Requires Node 24+ for the SQL-backed security tests. Run npm ci, npm test and npm run build:web. Historical phase documents describe earlier states; the current phases 13–15 report supersedes their implementation status.

Latest continuation: [synthetic administration and pilot evidence](docs/two-phase-continuation.md).

Expanded product scope: [shredding-service competitive features](docs/shredding-service-scope.md).

Phase A implementation: [Commercial Office workflow and limits](docs/phase-a-commercial.md).

Phase B implementation: [Dispatch, driver operations, SAMPLE certificates and field reporting](docs/phase-b-field-operations.md).

App branding uses `assets/irm-icon.PNG` (the filename is case-sensitive on web hosts). After changing the source image, install the Windows package dependencies and run `npm run icons` from the repository root to regenerate web, Windows and mobile icons. Rebuild the web app and native installers to distribute updated icons; existing installed native apps retain their bundled icon until updated.

Backend continuation: [four phases, complete sample data and operations queue](docs/backend-four-phases.md).

Latest backend continuation adds Reports & Readiness, normalized report exports/entity search, settlement review, append-only sample documents, monitoring and protected shared mobile sessions. See [release and recovery procedures](docs/backend-release-runbook.md).
