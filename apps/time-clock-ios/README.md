# IRM Time Clock — standalone iOS preview shell

This is a **separate Expo iOS client** from `apps/mobile` (IRM RMS). It displays the independently deployed, Access-protected Time Clock PWA and does **not** include payroll credentials or local clock-punch authority. Browser and iOS WebView authentication/location behavior must be tested on a real iPhone.

## Setup requirements
1. Use the deployed Time Clock Worker origin with Cloudflare Access protecting the page and API. Verify the D1 binding, migrations and active employee record for the intended administrator.
2. Set `EXPO_PUBLIC_CLOCK_URL` to that HTTPS origin. Do not include secret tokens in this value. Managed login and Cloudflare Access can involve redirects and cookie policies; validate sign-in inside iOS WebView before employee use.
3. `cd apps/time-clock-ios && npm install`; run `npx expo install --fix` to align native packages with Expo SDK before building; run `npm run doctor`.
4. Authenticate `npx eas login` and `npx eas init` (create a **new** EAS project for this app, not the existing IRM RMS project); set `EAS_PROJECT_ID` to the resulting UUID in your build/update environment. Do not invent or reuse a project ID.
5. Configure Apple Developer membership and iOS internal provisioning as requested by EAS. Add authorized testers.
6. `npm run build:ios:preview` to create an internally distributed iOS build; `npm run ota:preview` after installing a compatible build.
7. OTA updates only change JS/assets with matching runtime version and native dependencies. Changed native modules, iOS permissions, bundle IDs or runtime require a new native build. For updates, supply identical `EAS_PROJECT_ID` and `EXPO_PUBLIC_CLOCK_URL`.

The preview OTA command checks that `EXPO_PUBLIC_CLOCK_URL` is an HTTPS origin before publishing. If the Access login redirects to an external identity provider, set `EXPO_PUBLIC_CLOCK_LOGIN_ORIGINS` to the comma-separated, exact HTTPS origins used in the approved login flow. Cloudflare Access team domains are included by default. Complete sign-in in the app WebView so its session cookies stay with the app.

On the iPhone, tap **Update info** and compare the Worker origin, channel, runtime and running update ID with the iOS update in EAS. The current preview profile uses channel `preview` and runtime `0.1.0`. A compatible update normally downloads on a launch and runs on a subsequent full launch. Returning from the background refreshes attendance in the existing WebView.

## iOS testing
- Preview UI is clearly marked NON-PAYROLL.
- The Cloudflare Worker has an explicit preview-only simulated location bypass (server-controlled, not user-toggleable). A production environment or connected ADP mode must always enforce geofencing.
- Test location permission prompts, Cloudflare Access login in the WebView, employee session security, refresh/foreground behavior, and locked-screen lifecycle.
- Actual ADP, manager identity invitations, kiosk PIN, full attendance reporting and retention are not ready for production.

## Commands
From repo root after installing all dependencies in this directory:
```powershell
npm --prefix apps/time-clock-ios run build:ios:preview
npm --prefix apps/time-clock-ios run ota:preview
```

The existing IRM RMS `build:ios:dev` script builds **RMS**, not this standalone Time Clock client.

## Branded IRM icon

The iOS app config now uses `./assets/irm-time-clock-icon.png` for both the Expo app icon and iOS icon. The 1024×1024 PNG was generated separately and **must be copied into the Git repository**, because the connected GitHub text-file API cannot upload binary image bytes. The image package is provided in the ChatGPT conversation.

Extract the package so your local repository contains `apps/time-clock-ios/assets/irm-time-clock-icon.png`, or save the standalone PNG directly to that location. From `apps/time-clock-ios`, run `npm run verify:icon` and `npx expo config --type public` before building. Then commit the binary image with `git add apps/time-clock-ios/assets/irm-time-clock-icon.png` from the repository root and push it to `main`.

Changing a native iOS app icon requires a fresh `eas build --platform ios --profile preview` and reinstalling that build. An EAS OTA update alone **will not** replace the installed iOS home-screen icon.

## iOS white-halo / double-mask fix
Expo/iOS applies its own rounded Home Screen mask to the square app icon. The supplied branded artwork contains white canvas beyond its rounded icon shape; without normalization the white background appears as a halo. The build now runs `npm run prepare:icon` before EAS native build, using `sharp` to fill bright/transparent **edge-connected** canvas with the icon's navy background. The script preserves disconnected interior light artwork, makes the image fully opaque, and keeps dimensions 1024 × 1024. Run it locally and inspect the resulting PNG before committing the binary asset. If an internal white border remains, it is part of the artwork and requires a manual art-specific adjustment.

From `apps/time-clock-ios`:
```powershell
npm install
npm run prepare:icon
npm run verify:icon
npx expo config --type public
npm run build:ios:preview
```
Commit the updated `apps/time-clock-ios/assets/irm-time-clock-icon.png` and lockfile to `main`. New native icon **requires a new iOS build and reinstall**; Expo OTA cannot alter the Home Screen icon.
