# IRM RMS synthetic Zebra app

Run npm ci, npm start or npm run build:android from this directory. The original keyboard-wedge scanner and on-device scan simulator remain available. Warehouse Workflows adds customer-specific work orders, inbound/outbound processing, location tracking, courier handoffs and a durable command queue.

## DataWedge input

Use keyboard output with an Enter key event for the existing scan field. For native intent input, build/install the development app and select intent mode in Warehouse Workflows. Configure the profile for package com.alphazonelabs.irmrmsdemo, Broadcast Intent action com.alphazonelabs.irmrmsdemo.SCAN, DEFAULT category, explicit package and signature verification. Disable keyboard output when intent output is enabled. The native module is automatically linked from modules/irm-scanner. Expo Go has no custom native receiver and can use keyboard input instead.

The receiver accepts bounded input only while observed and the app has window focus. JavaScript normalizes barcodes, rejects records outside the current synthetic workspace and suppresses repeated intent bursts. Intents never establish user identity or permissions. Validate the actual Zebra model, Android version and DataWedge profile before rollout.

## Offline and verified-local modes

Default workflow synchronization acknowledges commands against a durable on-device synthetic simulator. Confirmed means acknowledged by that selected receiver, not by an operational IRM system. Pending commands and projected workspace changes are committed in one SQLite transaction. Restart recovery, single-flight sync, retry backoff and conflict review are integrated. Conflicted events remain in the queue; a reviewed replacement has a new event ID and preserves the original superseded event.

For verified local D1 testing, run the API on loopback with SYNTHETIC_WORKFLOWS_ENABLED=true, an approved local test user/session and explicit customer grants. On a test device run adb reverse tcp:8787 tcp:8787; use the temporary session field to connect. Do not expose the Worker on a public or LAN hostname. Sessions stay in memory; queues are isolated by user and customer. Native interactive identity-provider login and device-secure credential acquisition remain rollout work. No real records may be stored in this prototype database.

## Native build checks

Generate the Android project with npx expo prebuild --platform android --no-install. From android/, run ./gradlew :irm-scanner:compileDebugKotlin --no-daemon to check the receiver, or :app:assembleDebug for a development APK. The generated project is ignored; tracked local module sources recreate it. Java/SDK/NDK setup is required. On this Windows host, a short jdk.net.unixdomain.tmpdir and an isolated GRADLE_USER_HOME avoided Java socket-path/cache-lock failures. These are build-host workarounds, not application settings.

See [phases 9–12](../../docs/phases-9-12.md) for the API, role policy, custody model, observed validation and remaining deployment boundaries.
