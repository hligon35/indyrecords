# Compact UI and local startup

The compact interface is the default on web and Windows. Daily work, Office and Administration group all existing screens; Compact/Comfortable is a browser-local layout preference. Narrow windows use a Menu button. Reset and Sign out are inside that menu on phones. Tables scroll inside their own keyboard-focusable region, while long values and diagnostic JSON expand on demand without discarding data. Existing sample datasets, exports and workflow actions remain available.

Android and iOS use Scan, Warehouse, Driver and Account tabs, with a side rail on tablets. Switching tabs preserves visited forms and selections; inactive camera/intent scanners stop receiving input. Controls retain at least 44-point touch targets, visible input labels and safe-area/keyboard handling. The Account session remains shared across inventory, warehouse and driver workflows. Desktop density preferences do not reduce native touch targets.

## Install after pulling main

Use Node 24.22 or newer. Run these commands from the repository root:

```sh
git switch main
git pull --ff-only
npm ci
npm --prefix apps/windows ci
npm --prefix apps/mobile ci
npm test
```

For Android on Windows, use a short checkout path (for example `C:\irm-rms`) before installing dependencies and generating native projects. Long paths can exceed CMake/Ninja limits.

## Web

```sh
npm run dev:web
```

Open http://127.0.0.1:4173 and use demonstration login `demo` / `irm-demo`. This opens synthetic mode, without an API connection. Stop and restart the preview after changing source files; it builds once on startup. For static packaging, run `npm run build:web`; output is `dist/web`.

## Windows

Install Rust, Microsoft C++ Build Tools (Desktop development with C++) and WebView2 first. Stop the web preview before starting Windows development, because both use port 4173.

```sh
npm run dev:windows
```

To create the installer:

```sh
npm run build:windows
```

The installer is under `apps/windows/src-tauri/target/release/bundle/nsis`. Local installers are unsigned prototype packages.

## Android / Zebra

Install JDK 17 and the Android SDK/NDK through Android Studio. Connect an authorized USB device or start an emulator, then run:

```sh
npm run prepare:android
npm run dev:android
```

These commands generate and compile the custom native application. Expo Go cannot provide the encrypted workflow database or native DataWedge receiver. Use the Scan tab for the isolated scan simulator, Warehouse for synthetic work orders and Driver for assignments. Configure Zebra input using the [mobile setup](../apps/mobile/README.md). Emulator startup does not validate physical Zebra hardware.

If Windows reports long CMake object paths or shortened Clang linker names, stop the failed build and use the optional host workaround from `apps/mobile/android`:

```powershell
.\gradlew.bat :app:assembleDebug --no-daemon --init-script ../../../scripts/windows-android-ndk.init.gradle -PirmCmakeStagingRoot=C:/irm-build/cxx
```

Use Android Studio or `adb install -r app/build/outputs/apk/debug/app-debug.apk` to install that debug build. It expects Metro running via `npm start` in `apps/mobile` (use `adb reverse tcp:8081 tcp:8081` for a USB device).

## iOS (macOS only)

Install Xcode and its command-line tools, then run from the repository root:

```sh
npm run prepare:ios
cd apps/mobile
npx pod-install
npm run ios
```

A native iOS project is generated on macOS. To build an iPhone development app from Windows, the project includes an EAS development profile. From apps/mobile, run `npx eas-cli login`, `npx eas-cli build:configure` once to link the Expo project, then `npx eas-cli build --platform ios --profile development`. Install the resulting build and start Metro with `npm run start:dev-client`. An Apple Developer account is required for installing development builds on registered physical iPhones. An SDK-matched Expo Go cannot run this app’s custom native database/scanner modules.

## Optional local API

The default demonstration does not require an API. For verified, customer-scoped local API testing, follow [backend setup](backend.md) and [authentication setup](authentication-plan.md). Keep the Worker on loopback, use synthetic data and approved identity settings, and retain all production-mutation/provider restrictions. Do not publish the development shared-token API or turn these startup commands into a production deployment.

## Validation boundaries

The compact change has unit coverage for navigation, density persistence, menu focus, retained long values and mobile workspace visibility. Browser verification covers all 14 screens at widths 320, 390, 768, 1366 and 1920, plus demo login/sign-out and persisted density. Native packaging and bundle results are reported separately from device acceptance. Physical Zebra scanning, camera permissions, keyboard/screen-reader behavior, iOS safe areas and device-specific large-text behavior still need platform acceptance testing.
