# Mobile SQLite prototype

Uses Expo SQLite to persist synthetic scan events across app restarts. New scans are written before being shown as queued. The UI does **not** transmit scans or mark them server-confirmed.

This store implements the shared synchronization coordinator's `read()` and `write(queue)` contract, but is not yet connected to it. A production implementation must enforce serializable write behavior, handle process-level locks, encrypt sensitive device data, and add secure login/token storage.

## Setup
From `apps/mobile`:
```powershell
npx expo install expo-sqlite
npx expo-doctor
npx expo start
```

The app's Expo SDK dependency compatibility must be validated locally before building. Never use real company data.
