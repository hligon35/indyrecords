# IRM Time Clock — standalone iOS preview shell

This is a **separate Expo iOS client** from `apps/mobile` (IRM RMS). It displays the independently deployed, Access-protected Time Clock PWA and does **not** include payroll credentials or local clock-punch authority. Browser and iOS WebView authentication/location behavior must be tested on a real iPhone.

## Setup requirements
1. Cloudflare Worker preview must be deployed and secured (Cloudflare Access over the entire hostname, verified D1 binding, migrations, provisioned individual admin). There is no verified live URL yet.
2. Set `EXPO_PUBLIC_CLOCK_URL` to that HTTPS origin. Do not include secret tokens in this value. Managed login and Cloudflare Access can involve redirects and cookie policies; validate sign-in inside iOS WebView before employee use.
3. `cd apps/time-clock-ios && npm install`; run `npx expo install --fix` to align native packages with Expo SDK before building; run `npm run doctor`.
4. Authenticate `npx eas login` and `npx eas init` (create a **new** EAS project for this app, not the existing IRM RMS project); set `EAS_PROJECT_ID` to the resulting UUID in your build/update environment. Do not invent or reuse a project ID.
5. Configure Apple Developer membership and iOS internal provisioning as requested by EAS. Add authorized testers.
6. `npm run build:ios:preview` to create an internally distributed iOS build; `npm run ota:preview` after installing a compatible build.
7. OTA updates only change JS/assets with matching runtime version and native dependencies. Changed native modules, iOS permissions, bundle IDs or runtime require a new native build. For updates, supply identical `EAS_PROJECT_ID` and `EXPO_PUBLIC_CLOCK_URL`.

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
