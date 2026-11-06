# Contributing

Daily Dashboard uses React, TypeScript, Vite, and Tauri 2.

For layout bugs, include your OS, app version, display resolution, application scale, and steps to reproduce.

## Run locally

You’ll need:

- Node.js 22 and npm.
- Rust 1.90 or newer, installed through [rustup](https://www.rust-lang.org/tools/install).
- [Tauri’s system dependencies](https://v2.tauri.app/start/prerequisites/): Xcode Command Line Tools on macOS; Microsoft C++ Build Tools and WebView2 on Windows.

```sh
npm ci
npm run tauri:dev
```

For frontend work without the desktop shell:

```sh
npm run dev
```

Open `http://127.0.0.1:1420/?mock=1` to use demo data without connecting accounts. Browser mode cannot run desktop commands such as the system shell or native Spotify controls.

The default window is 1280 × 400, with a minimum size of 960 × 360.

## Integrations and credentials

Local Spotify controls work without an API login. Google Calendar, Microsoft Calendar, and the Spotify Web API use your own registered OAuth applications.

Enter credentials in Settings, or copy `.env.example` to `keys.env`:

```env
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_TENANT=common
```

`keys.env` is ignored by Git. Keep secrets and saved application settings out of commits.

### OAuth configuration

Register these callback URLs with each provider. You can change them in Settings before signing in.

| Provider | Redirect URI | Permissions |
| --- | --- | --- |
| Google | `http://127.0.0.1:8911` | `https://www.googleapis.com/auth/calendar.readonly` |
| Microsoft | `http://localhost:8912` | `openid profile email offline_access User.Read Calendars.Read` |
| Spotify | `http://127.0.0.1:4200/callback` | `user-read-playback-state user-modify-playback-state user-read-currently-playing user-library-read user-library-modify` |

For Google, use a **Desktop app** client without a client secret, or a **Web application** client with `GOOGLE_CLIENT_SECRET`. The client ID is under Advanced settings.

For Microsoft, register the redirect as a mobile/desktop URI in Entra. Sign-in uses the system browser and PKCE. The `common` tenant accepts work, school, and personal accounts, subject to the tenant’s policy.

Custom callback ports must be 1024 or higher to avoid requiring elevated privileges on macOS and Linux.

### Other integrations

- **Spotify:** native controls show playback and track details. Favourite and additional client controls require the [local connector](integrations/spotify/README.md). See the [integration notes](docs/spotify-local-integration.md) for platform limitations.
- **Aircraft:** the default [ADSB.lol endpoint](https://api.adsb.lol/) refreshes every 10 seconds while the widget is visible. Settings accepts an alternative endpoint with `{lat}`, `{lon}`, and `{radius}` placeholders, plus an API key if required.
- **Weather:** forecast and radar are separate views. Radar uses [RainViewer](https://www.rainviewer.com/api/weather-maps-api.html) tiles over OpenStreetMap, loaded when the radar view is open.
- **Codex:** the optional widget opens `codex://threads/new`, with `https://chatgpt.com/codex` as a fallback. Sign-in happens in Codex; the dashboard does not authenticate the account.

## Widget flags

Set these Vite environment variables when building to include or exclude widgets:

| Flag | Default |
| --- | --- |
| `VITE_FEATURE_WIDGET_CALENDAR` | Enabled |
| `VITE_FEATURE_WIDGET_CLOCK` | Enabled |
| `VITE_FEATURE_WIDGET_SPOTIFY` | Enabled |
| `VITE_FEATURE_WIDGET_WEATHER` | Enabled |
| `VITE_FEATURE_WIDGET_AIRCRAFT` | Enabled |
| `VITE_FEATURE_WIDGET_TERMINAL` | Enabled |
| `VITE_FEATURE_WIDGET_CODEX` | Disabled |

Excluded widgets are removed from the sidebar, saved layouts, and Settings.

## UI changes

Check layouts on small ultrawide screens, not just a large development window. Widgets have four sizes: `half`, `tall`, `wide`, and `full`. Application scaling ranges from 75% to 200%.

A few behaviors to preserve:

- Calendar Work mode shows Monday–Friday, 9 AM–6 PM, and advances one week at a time. Events fit the widget height; overlapping events share the available width.
- Event details stay inside the calendar. Settings and event details close with Escape; Settings keeps keyboard focus inside the dialog while open.
- Widget visibility and the Spotify album-art toggle save immediately.
- Small weather widgets scroll internally. Chart inspection works with a pointer and the Left/Right, Home/End, and Escape keys.

Platform-specific details are in the [dedicated-display guide](docs/dedicated-display.md), [Spotify notes](docs/spotify-local-integration.md), and [update guide](docs/startup-updates.md).

## Tests

Run the build and unit checks before submitting changes:

```sh
npm run build
npm test
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --lib --locked --manifest-path src-tauri/Cargo.toml
```

For browser checks, start `npm run dev` in another terminal, then run:

```sh
npm run test:ui
```

The browser scripts require Google Chrome on macOS. They test control placement, event overlap, dialogs, keyboard focus, settings, and widget layouts. They do not test native Windows behavior or physical monitor switching; test those changes on Windows hardware.

For layout work, these narrower checks are also available:

| Command | Coverage | Screenshots |
| --- | --- | --- |
| `npm run test:design` | Display sizes, application scaling, dialogs, and settings | `/tmp/daily-dashboard-review` |
| `npm run test:widgets` | Each widget at all four sizes, across display and scaling combinations | `/tmp/daily-dashboard-widget-matrix` |

`npm run test:security` checks that the built dashboard runs under its production CSP and blocks injected scripts and unapproved network requests.

Set `UI_REVIEW_OUTPUT` to change the design-review output directory. The scripts delete their temporary Chrome profiles when finished and keep the screenshots.

Reference captures: [full dashboard](docs/images/dashboard-1280x400.jpg), [Spotify](docs/images/spotify-widget.jpg), [weather](docs/images/weather-widget.jpg), and [clock](docs/images/clock-widget.jpg).

## Builds

### Windows installer

Run on Windows:

```sh
npm ci
npm run tauri:build
```

The NSIS installer is written to `src-tauri/target/release/bundle/nsis/`.

[The Windows workflow](.github/workflows/windows.yml) builds on pushes to `main`. Release tags starting with `V` or `v` publish the installer to GitHub Releases.

### Portable Windows executable

```sh
npm run tauri:build:portable
```

Output: `src-tauri/target/release/V0.5.12_Daily-Dashboard.exe`.

The executable can run from a writable folder or USB drive without an installer. WebView2 must already be installed on the target computer.

[The portable workflow](.github/workflows/windows-portable.yml) builds an Actions artifact on a Windows runner.

To cross-compile from macOS with `cargo-xwin` installed:

```sh
npm run tauri:build:windows-cross
```

Use the Tauri wrapper rather than `cargo xwin build` directly. It embeds the frontend and enables the production custom protocol; a direct Cargo build can leave the executable pointing at the development server. Test the result on Windows.

### macOS

```sh
npm run tauri:build
```

The DMG is written to `src-tauri/target/release/bundle/dmg/`.

### Browser build

```sh
npm run build
npm run preview
```

The static files are in `dist/`. Append `?mock=1` to the preview URL to use demo data.

## Releases

Before publishing, run:

```sh
npm run audit:release
```

This checks tracked files for credential patterns and accidentally committed local state. See [release preparation](docs/release-preparation.md) for the remaining steps.

The updater reads GitHub Releases and verifies downloaded assets against GitHub’s SHA-256 digest. Notifications are enabled by default; automatic downloads and installation require opting in. Windows supports installation and rollback. macOS installation is manual. Implementation details are in [startup updates](docs/startup-updates.md).

For the README video and GIF export commands, see [demo media](docs/demo-video.md).

Security reports and credential storage are covered in [SECURITY.md](SECURITY.md).
