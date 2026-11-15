# IRM RMS prototype

Independent synthetic demonstration for web, Windows (Tauri), and Zebra Android keyboard-wedge scanning (Expo). No real IRM records are connected. Production record mutations remain disabled.

- [Current phases 13–15 and pilot boundaries](docs/phases-13-15.md)
- [Warehouse phases 9–12](docs/phases-9-12.md)
- [Authentication and sessions](docs/authentication-plan.md)
- [Local API setup](docs/backend.md)
- [Windows development](apps/windows/README.md)
- [Android demo](apps/mobile/README.md)

Requires Node 24+ for the SQL-backed security tests. Run npm ci, npm test and npm run build:web. Historical phase documents describe earlier states; the current phases 13–15 report supersedes their implementation status.
