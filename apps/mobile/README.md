# IRM RMS synthetic Zebra app

Run npm ci from this directory. Use npm run native:android followed by npm run android to generate and run the custom native app; npm run build:android exports its JavaScript bundle only. The compact app has Scan, Warehouse, Driver and Account tabs, with tablet navigation and shared protected sessions. The original keyboard-wedge scanner and on-device scan simulator remain available. Warehouse adds customer-specific work orders, inbound/outbound processing, location tracking, courier handoffs and a durable command queue. See [all-platform startup commands](../../docs/compact-ui.md).

## DataWedge input

Use keyboard output with an Enter key event for the existing scan field. For native intent input, build/install the development app and select intent mode in Warehouse Workflows. Configure the profile for package com.alphazonelabs.irmrmsdemo, Broadcast Intent action com.alphazonelabs.irmrmsdemo.SCAN, DEFAULT category, explicit package and signature verification. Disable keyboard output when intent output is enabled. The native module is automatically linked from modules/irm-scanner. Expo Go has no custom native receiver and can use keyboard input instead.

The receiver accepts bounded input only while observed and the app has window focus. JavaScript normalizes barcodes, rejects records outside the current synthetic workspace and suppresses repeated intent bursts. Intents never establish user identity or permissions. Validate the actual Zebra model, Android version and DataWedge profile before rollout.

## Offline and verified-local modes

Default workflow synchronization acknowledges commands against a durable on-device synthetic simulator. Confirmed means acknowledged by that selected receiver, not by an operational IRM system. Pending commands and projected workspace changes are committed in one SQLite transaction. Restart recovery, single-flight sync, retry backoff and conflict review are integrated. Conflicted events remain in the queue; a reviewed replacement has a new event ID and preserves the original superseded event.

For verified local D1 testing, run the API on loopback with SYNTHETIC_WORKFLOWS_ENABLED=true, an approved local test identity and explicit customer grants. On a test device run adb reverse tcp:8787 tcp:8787. The Account tab supports system-browser login with irmrmsdemo://auth and OS-protected short-lived session storage. Do not expose the Worker on a public or LAN hostname. Queues are isolated by user and customer. Real-provider/device acceptance remains rollout work. No real records may be stored in this prototype database.

## Native build checks

Generate the Android project with npx expo prebuild --platform android --no-install. From android/, run ./gradlew :irm-scanner:compileDebugKotlin --no-daemon to check the receiver, or :app:assembleDebug for a development APK. The generated project is ignored; tracked local module sources recreate it. Java/SDK/NDK setup is required. On this Windows host, a short jdk.net.unixdomain.tmpdir and an isolated GRADLE_USER_HOME avoided Java socket-path/cache-lock failures. These are build-host workarounds, not application settings.

See [phases 9–12](../../docs/phases-9-12.md) for the API, role policy, custody model, observed validation and remaining deployment boundaries.

## Phase 15 account and dependency checks

Account provides the shared approved session; local synthetic workspace controls remain available without it. expo-web-browser handles the system-browser flow; expo-secure-store protects the short session and its plugin excludes protected data from device backup. Use the exact configured native callback and approved API origin. Patched image-size/PostCSS overrides retain Metro compatibility; run npm run test:build-deps. The Metro compatibility wrapper converts asset paths to bytes for image-size 2.x in both the supervisor and transform worker; it does not modify installed dependencies. See [phases 13–15](../../docs/phases-13-15.md) for audit results and acceptance gates.

For full APK packaging on Windows, use a short checkout path to avoid Ninja/CMake path limits. This host also shortened clang++.exe to CLANG_~1.EXE, losing automatic C++ linker mode. The optional scripts/windows-android-ndk.init.gradle explicitly selects that mode for shared-library linking and requests shortened CMake object paths. For nested Windows checkouts, also pass -PirmCmakeStagingRoot=C:/irm-build/cxx to put native intermediates under a dedicated short path. From the generated android directory, pass --init-script ../../../scripts/windows-android-ndk.init.gradle to Gradle. This is a build-host workaround, not a dependency source patch. Generated release builds currently use Android's test key; they are synthetic test packages, never production/store releases. Enterprise signing and device acceptance remain pending.

Phase B adds Driver assignments, camera/keyboard/Zebra input and an isolated durable SQLite queue. See [field operations](../../docs/phase-b-field-operations.md) for verified-session use, conflict review, platform evidence and remaining device gates.

Shared account login now serves inventory, driver and warehouse panels. Verified queues require a custom SQLCipher-enabled build; Expo Go cannot supply encrypted storage. See ../../docs/backend-release-runbook.md for migration/key handling and remaining acceptance gates.
