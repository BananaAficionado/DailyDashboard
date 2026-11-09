# Updates at Dashboard startup

Install V0.5.11 once to enable this behaviour. Every subsequent installed-app launch checks for a newer stable GitHub release, including launches at Windows sign-in. This feature does not register Dashboard to start with Windows.

## Windows

The native updater starts shortly after launch, even if the web interface is still loading or the locked display is unavailable. By default, a visible in-app notification announces a newer stable release; downloading and installing require your action. If you explicitly opt in to automatic installation, it downloads the Windows x64 installer, verifies its SHA-256, starts the silent installer and exits. The installer relaunches the updated Dashboard with its existing settings and monitor binding.

**Settings → Updates → Updates on Dashboard startup** controls the behaviour:

- **Automatically download and install on startup**: opt-in, Windows only. A newer release installs and restarts Dashboard automatically.
- **Download on startup; install manually**: download and verify, then wait for Install now or Install next reboot.
- **Notify me only (default)**: check only; download and installation remain manual.
- **Disable update checks**: skip automatic checks. Check now remains available.

Automatic downloads and installation require explicit consent. On first launch of this version, legacy automatic preferences reset to notification-only so automatic downloading or installation requires a fresh choice. An existing disabled-checks preference is preserved. Choices saved by this release persist across launches, and selecting Notify me only opts out without losing notifications.

Public GitHub Releases require no account or token. While the repository is private, save a fine-grained token with repository Contents: read access under Settings → Updates → Private-repository access (optional). Existing saved tokens are preserved. Credentials stay in the local profile and are not embedded in source or installers. GitHub rate limits, missing credentials or connection failures leave the current app running with a status message.

## Connectivity and recovery

Temporary release-check failures retry twice, after 5 and 15 seconds. Dashboard stays usable during checks and downloads. Permanent request errors do not retry automatically. Failed downloads or checksum checks leave the installed app running. Drafts/prereleases are excluded, and automatic updates require a compatible installer and its SHA-256 digest.

To skip one startup check, run from the installation folder:

```powershell
.\V0.5.14_Daily-Dashboard.exe --skip-update
```

The display recovery commands `--unlock-display` and `--reset-display-lock` also skip automatic updates on that launch so recovery cannot immediately restart the app. A relaunch routed to an existing instance does not start another updater.

Rollback changes the saved update mode to Check and ask me before starting the older installer. This prevents an automatic upgrade from immediately undoing the rollback. Select automatic installation again when ready to resume updates.

## macOS and development

macOS checks for updates and can download a compatible DMG when a release supplies one. Automatic installation and Windows installation controls are omitted. View release opens the GitHub release for a manual update; the current releases provide Windows installers. Development builds skip automatic startup updates.

Available updates trigger a dismissible in-app notification. Update progress and errors also appear in Settings → Updates. The web interface polls native status; it does not run a second startup updater. Manual checks and downloads remain available after startup finishes.
