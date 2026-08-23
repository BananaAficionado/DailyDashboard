# Daily Dashboard

Current release: **V0.4.1** (`0.4.1`).

A Tauri v2 desktop dashboard sized for a 1280 x 400 ultrawide display. It supports calendar, Spotify, weather, live ADS-B aircraft, Codex, and command-line widgets in a configurable layout; individual widgets can be omitted from a release build.

Release builds expose one Vite feature flag per widget: `VITE_FEATURE_WIDGET_CALENDAR`, `VITE_FEATURE_WIDGET_SPOTIFY`, `VITE_FEATURE_WIDGET_WEATHER`, `VITE_FEATURE_WIDGET_AIRCRAFT`, `VITE_FEATURE_WIDGET_CODEX`, and `VITE_FEATURE_WIDGET_TERMINAL`. All default to enabled except Codex, which defaults to disabled and is removed from the dashboard rail, saved layouts, and Settings UI unless explicitly enabled at build time.

The Settings page includes full-application scaling at 75%, 100%, 125%, 150%, and 200% for small high-resolution displays. Scaling applies to the complete interface, including text, buttons, widgets, and Settings.

When every widget is hidden, the idle screen offers five persistent backgrounds directly from its bottom selector: the original animated waves, an interactive top-down pixel fish pond, a location-and-time-aware night sky, an automatically panning label-free elevation map, and an album slideshow. The night sky and elevation map use the dedicated map location, then fall back to the weather location. Album images are read locally and are never uploaded; supported formats are JPEG, PNG, WebP, GIF, and BMP. Slideshows can crop images to fill the screen or shrink them over a heavily blurred, slowly moving copy of the same image.

Installed builds can check `BananaAficionado/DailyDashboard` GitHub Releases for newer versions. Settings provides ask-first, automatic download, automatic Windows installation, and fully ignored modes. A downloaded Windows installer can run immediately or be scheduled through the current user's `RunOnce` entry for the next sign-in. Version ordering supports lettered releases (`V0.6B` is newer than `V0.6A`, while a final `V0.6` is newer than both). Update downloads are restricted to this repository's release URLs and SHA-256 verified when GitHub supplies an asset digest.

Because the repository is private, update checks require a fine-grained GitHub token with read access to this repository and `Contents: read`. Enter it under **Settings → Application updates**. The token is stored only in the dashboard's local settings file and is attached to GitHub API requests; it is never included in logs or release URLs. Public-repository update checks work without a token.

The live aircraft widget defaults to the [ADSB.lol point/radius API](https://api.adsb.lol/) and refreshes every 10 seconds while visible. It supports mouse/touch panning, wheel/buttons/pinch zooming, device or searched locations, a saved manual map centre, selectable aircraft details, and graphic-only mode. An ADSB Exchange/RapidAPI-compatible URL template and key can be entered in Settings. URL templates use `{lat}`, `{lon}`, and `{radius}` placeholders.

The Weather widget has two pages: forecast and an interactive global rain-radar overlay. Radar tiles come from [RainViewer](https://www.rainviewer.com/api/weather-maps-api.html), are loaded only while the radar page is open, and are displayed over an OpenStreetMap base map.

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
- Rust/runtime: Tauri, Tauri opener plugin, Reqwest with Rustls, Serde, Serde JSON, Base64, URL, RFD for the native album folder picker, and SHA-2 for update verification.
- Rust/build: Tauri Build.

After cloning, install the locked JavaScript dependencies (Cargo downloads the locked Rust dependencies automatically during the first Tauri command):

```bash
npm ci
npm run tauri:dev
```

Copy `.env.example` to `keys.env` only if you want to preconfigure OAuth credentials. `keys.env` and other environment/credential files are intentionally ignored and must be recreated separately on each machine. Never commit provider client secrets.

The optional ADS-B API key is saved locally with the other application settings. Do not commit or paste it into source files. The default ADSB.lol endpoint does not currently require a key; review the provider's terms before production or high-volume use.

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

A GitHub Actions workflow is also included at `.github/workflows/windows.yml` to build the Windows installer on `windows-latest`. Pushing a `V*` tag publishes the generated NSIS installer to GitHub Releases, which is the source used by the in-app update assistant.

### Portable Windows executable

On a Windows machine, build the unpackaged executable with:

```bash
npm ci
npm run tauri:build:portable
```

On macOS with `cargo-xwin` installed, use the Tauri production build wrapper:

```bash
npm run tauri:build:windows-cross
```

Do not invoke `cargo xwin build` directly. The Tauri wrapper enables the production custom protocol and embeds `dist`; a direct Cargo build will try to connect to the development server and show `ERR_CONNECTION_REFUSED` on the target computer.

The executable is written to:

```text
src-tauri/target/release/V0.4.1_Daily-Dashboard.exe
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
npm test
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Responsive browser smoke coverage includes 1280×400 at 75% and 100%, plus 1920×720 at 100%, 150%, and 200%. Each case verifies toolbar hit targets and pairwise geometry, the single-column calendar controls, and a fitted, non-scrolling idle screen.
