# IRM RMS Mobile (Expo proof of concept)

Initial Android/iOS React Native source with a scanner-first warehouse interface and fictional data. This is not a native Zebra DataWedge integration, authenticated API client, durable queue, or production app.

## Development
```powershell
cd apps/mobile
npm install
npx expo-doctor
npx expo start
```

The initial scaffold targets Expo SDK 54; check compatible versions with `npx expo install --check` and upgrade before distributing. Native barcode intents require a custom Android module and a development build, not Expo Go.

Use fictional barcode `IRM-BX-1002` for Box Retrieval or `IRM-FL-1001` for File Retrieval. Events are held in memory only and disappear on restart. Do not use real IRM data or company devices without authorization.
