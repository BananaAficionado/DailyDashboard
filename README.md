# Daily Dashboard

A Tauri v2 desktop dashboard sized for a 1280 x 400 ultrawide display. It shows a Google Calendar-style day/week calendar and a Spotify now-playing panel with playback controls, album art, seeking, and library save/remove.

## First-Run Setup

The app reads Spotify credentials from `keys.env` when present:

```env
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_TENANT=common
```

If a value is missing, the dashboard opens a setup panel where it can be entered and saved locally. Google Calendar uses a Google Sign-In flow for live API sync. Google still requires the app's OAuth client ID behind the scenes; the setup panel keeps it under Advanced settings, or it can be supplied in `keys.env`. A Google **Desktop app** OAuth client is recommended and does not need a client secret. A Google **Web application** OAuth client requires `GOOGLE_CLIENT_SECRET` as well.

Register these redirect URIs in the provider dashboards:

```text
Spotify: http://127.0.0.1:4200/callback
Google:  http://127.0.0.1:8911
Microsoft: http://localhost:8912
```

Both redirect URIs are editable in the app setup/settings panel before signing in.
Use port `1024` or higher for local OAuth redirects; lower ports require elevated OS privileges on macOS/Linux.

Scopes used:

```text
Google:  https://www.googleapis.com/auth/calendar.readonly
Microsoft: openid profile email offline_access User.Read Calendars.Read
Spotify: user-read-playback-state user-modify-playback-state user-read-currently-playing user-library-read user-library-modify
```

Microsoft Calendar uses the system browser with OAuth authorization code + PKCE. Register the Microsoft redirect URI as a mobile/desktop redirect in Microsoft Entra and grant delegated `Calendars.Read` permission. The `common` tenant supports work, school, and personal Microsoft accounts where the tenant policy permits it; the existing browser session provides SSO.

The Codex widget hands off to the installed Codex desktop app using `codex://threads/new` from both the Tauri app and browser preview. If the browser blocks the custom protocol, it falls back to `https://chatgpt.com/codex`. Account authentication remains owned by Codex; the dashboard does not receive or store Codex account credentials. The optional email field is display metadata only and is never treated as proof of authentication.

## Development

### Prerequisites and dependencies

Install these tools before cloning the project on another machine:

- [Node.js](https://nodejs.org/) 22.x (the version used by CI), including npm.
- The latest stable [Rust toolchain](https://www.rust-lang.org/tools/install) (`rustup`, `rustc`, and `cargo`).
- The [Tauri v2 system prerequisites](https://v2.tauri.app/start/prerequisites/) for the target operating system:
  - Windows: Microsoft C++ Build Tools and Microsoft Edge WebView2.
  - macOS: Xcode Command Line Tools.

All project libraries are declared and version-locked in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`. The direct application dependencies are:

- Frontend/runtime: React, React DOM, Lucide React, Tauri API, and the Tauri opener plugin.
- Frontend/build: TypeScript, Vite, the Vite React plugin, Tauri CLI, and React type definitions.
- Rust/runtime: Tauri, Tauri opener plugin, Reqwest with Rustls, Serde, Serde JSON, Base64, and URL.
- Rust/build: Tauri Build.

After cloning, install the locked JavaScript dependencies (Cargo downloads the locked Rust dependencies automatically during the first Tauri command):

```bash
npm ci
npm run tauri:dev
```

Copy `.env.example` to `keys.env` only if you want to preconfigure OAuth credentials. `keys.env` and other environment/credential files are intentionally ignored and must be recreated separately on each machine. Never commit provider client secrets.

The Tauri window is configured at 1280 x 400 with a resizable minimum of 960 x 360.

## Windows Build

On a Windows machine:

```bash
npm ci
npm run tauri:build
```

The Tauri config targets an NSIS setup executable. Build outputs are written under:

```text
src-tauri/target/release/bundle/nsis/
```

A GitHub Actions workflow is also included at `.github/workflows/windows.yml` to build the Windows installer on `windows-latest`.

### Portable Windows executable

On a Windows machine, build the unpackaged executable with:

```bash
npm ci
npm run tauri:build:portable
```

The executable is written to:

```text
src-tauri/target/release/V0.3_Daily-Dashboard.exe
```

Copy the EXE to a user-writable folder or USB drive and run it directly. It does not need an installer or administrator rights. The target computer must already have the Microsoft Edge WebView2 Runtime, which is normally present on supported Windows 10 and Windows 11 systems. The portable build does not silently install missing runtimes.

The workflow at `.github/workflows/windows-portable.yml` produces the same executable as a downloadable GitHub Actions artifact. A Windows runner is required because this project cannot reliably produce the WebView2-linked Windows binary from macOS alone.

### Local-only website

For a browser-only, installation-free option, build the static site:

```bash
npm ci
npm run build
```

Open `dist/index.html` in a browser, or copy the `dist/` directory to a user-writable location and serve it with any available local static HTTP server. The website preserves the dashboard UI and browser-supported web APIs, but cannot use desktop-only features such as the system shell or Tauri-native commands. `?mock=1` can be appended for an offline preview.

## macOS Build

On macOS:

```bash
npm ci
npm run tauri:build
```

The macOS-specific Tauri config targets a DMG installer. Build outputs are written under:

```text
src-tauri/target/release/bundle/dmg/
```

## Verified Locally

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Local Vite serving was also checked at `http://127.0.0.1:1420/`.
