# IRM RMS Windows (Tauri 2)

Install Node, Rust with the MSVC target, Visual Studio C++ build tools, and WebView2. Run npm ci at repository root for the web/PDF bundler, then from this directory run npm ci, then npm run dev or npm run build. The runner generates icons, locates the usual user Rust installation, and launches Tauri. Development automatically builds and serves only dist/web at http://127.0.0.1:4173; no separate server is needed.

The same read-only inventory interface is used on web and Windows. Default CSP permits only the loopback synthetic API at port 8787. To include a separately approved HTTPS read-only API, set IRM_READONLY_API_ORIGIN to its exact origin before building; the runner adds just that origin to CSP. Configure the API's READONLY_ALLOWED_ORIGINS for the desktop origin (normally http://tauri.localhost on Windows), and the web preview origin when testing development. Never embed credentials in this setting or app assets.

Preserves the local synthetic demo. Tokens and remote inventory stay in memory. No shared token is distributed, remote writes are blocked, and no updater, signing or real-data integration is configured. The installer remains a development artifact; see [phases 13–15](../../docs/phases-13-15.md) for current build results and remaining validation.

Reference: [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/).

## Native account sign-in

The system browser opens the approved HTTPS identity login, and the installed app handles irmrmsdesktop://auth through Tauri deep-link/single-instance support. Configure the API native redirect allowlist and desktop CORS origin before testing. Tokens remain in memory. A callback without matching state/PKCE cannot sign in. Code signing and a real-provider/runtime test are external pilot gates; see [phases 13–15](../../docs/phases-13-15.md).
