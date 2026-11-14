# IRM RMS prototype

Independent synthetic demonstration for web, Windows (Tauri), and Zebra Android keyboard-wedge scanning (Expo). No real IRM records are connected. Production record mutations remain disabled.

- [Current implementation and boundaries](docs/phase-8.md)
- [Authentication and sessions](docs/authentication-plan.md)
- [Local API setup](docs/backend.md)
- [Windows development](apps/windows/README.md)
- [Android demo](apps/mobile/README.md)

Requires Node 24+ for the SQL-backed security tests. Run npm ci, npm test and npm run build:web. Historical phase documents describe earlier states; phase 8 supersedes their implementation status.
