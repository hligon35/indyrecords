# Web deployment: static installable demo

The browser demo now includes a web manifest, vector icon, and service worker that caches only static shell assets. This allows the **interface** to reopen offline after its first successful load. It does not make server records available offline or synchronize queued scans. The existing localStorage demo records are fictional.

## Local preview
```powershell
npx serve . -l 4173
```
Open http://localhost:4173. Browsers permit service workers on localhost or HTTPS.

## Cloudflare Pages (manual, no deployment performed)
- Use a separate preview project and hostname clearly marked **independent prototype**.
- Framework preset: None; build command: `npm run build:web`; output directory: `dist/web`.
- Do not configure production customer domains or expose the development-only API token.
- Validate offline static shell, install prompt eligibility, mobile navigation, content security policy and accessible input controls.
- For a production deployment, use a security review, CSP headers, identity provider and scoped access control.

## Caveats
- Browser installation availability depends on browser/platform and installability checks.
- The service worker deliberately never intercepts API routes.
- A real multi-user system needs secure sessions and remote data; this remains a synthetic-data demonstration.
- Windows native Tauri builds and Expo binaries are separate from this web deployment.
