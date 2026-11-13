# IRM RMS Windows desktop (Tauri 2 scaffold)

This is a **source scaffold**, not a verified or signed installer. It hosts the current static prototype from the repository root in a native Windows WebView2 window.

## Prerequisites
- Windows 10/11, Rust toolchain with MSVC target, Visual Studio C++ build tools, WebView2, Node.js.
- Run a local static HTTP server on port 4173 for development.

## Run
From repository root:
```powershell
npx serve . -l 4173
```
In another terminal:
```powershell
cd apps/windows
npm install
npm run dev
```
Build with `npm run build` after verifying Rust, WebView2 and Tauri prerequisites.

## Limitations
- No code signing, auto-updates, native scanner adapter, OS notification integration or production auth yet.
- The root UI uses browser localStorage; this is demo-only.
- Tauri configuration and Rust build have not been tested in this environment.
- Do not deploy to company-owned devices without approval.
