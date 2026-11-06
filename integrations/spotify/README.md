# Local Spotify controls

Daily Dashboard V0.5.5 controls the Spotify app on this computer and displays the current title, artist, album and cover. It does not add catalogue, Search or Home pages.

In **Settings → Music → Playback controls**, choose **Automatic** (local first, existing Web API connection as fallback), **Local Spotify only** (no Spotify Web API requests or OAuth), or **Spotify Web API**. Save the setting. Open Spotify and start a track to publish a media session.

## Available controls

| Connection | Controls |
| --- | --- |
| Windows media session | Play/pause, previous/next, seek, shuffle and repeat when Spotify publishes support; track details and cover. Like and volume require the connector below. |
| macOS Spotify scripting | Playback, previous/next, seek, volume, shuffle, details and cover. macOS may ask for Automation permission. Like and three-state repeat require the connector. |
| Optional Spotify client connector | Playback, like/unlike, shuffle, repeat, seek, volume, track details and cover, subject to the client's current restrictions. |

Unavailable buttons are disabled. A failed local command is never redirected to another device through the Web API. Windows selects Spotify's own session rather than the system's current media app. Spotify must expose a session; installing it alone is insufficient.

## One-time connector setup for Like and full controls

The connector is an optional [Spicetify extension](https://spicetify.app/docs/customization/extensions). Spicetify modifies the installed Spotify desktop client and can need reapplying after Spotify updates. Daily Dashboard does not install it or change your Spotify installation automatically.

1. Install/configure Spicetify using its [official getting-started guide](https://spicetify.app/docs/getting-started). Follow its current compatibility instructions for your Spotify installation.
2. In Daily Dashboard, open **Settings → Music → Export local connector**. Save the file as `daily-dashboard-bridge.js` in Spicetify's Extensions folder:
   - Windows: `%APPDATA%\spicetify\Extensions\`
   - macOS/Linux: `~/.config/spicetify/Extensions/`
3. Enable it in a terminal:

   ```sh
   spicetify config extensions daily-dashboard-bridge.js
   spicetify apply
   ```

4. Keep Daily Dashboard running, restart Spotify if needed and play a track. The widget status should read **Local Spotify · Connected** and Like should become available.

The exported file is paired to this Dashboard installation. It contains a private pairing credential: keep it local and do not upload or share it. The template in this repository deliberately has no usable credential. Export a new file on each computer. To revoke a pair, quit Dashboard, delete `spotify-bridge-key` in its application configuration folder, restart Dashboard and export/install a fresh connector. Existing dashboard settings do not need clearing.

## Troubleshooting and validation

- If Like stays disabled, verify that Spicetify loads the exported file and that Spotify permits this action for the current item. Ads/local files are not guessed into catalogue tracks.
- The connector polls `127.0.0.1:47691` with a per-install pairing key; it listens only on this computer. If the port is occupied or client/network policy blocks loopback, native controls still work, but connector-only controls remain unavailable.
- If Spotify changes its client APIs, update Spicetify/reapply and recheck this extension. The implementation uses the documented [Player methods](https://spicetify.app/docs/development/api-wrapper/methods/player), whose internal data can change with Spotify.
- On macOS, allow Dashboard to control Spotify under **Privacy & Security → Automation**.
- Hide album art remains available and the controls expand into the space.

Automated checks cover the authenticated loopback protocol, stale/expired messages, command acknowledgement, track-change guards, connector execution, local-only UI routing and widget layouts. The Windows code is cross-compiled and the installer built in CI. Real Spotify playback, both Windows install variants, Spicetify compatibility and upgrading a physical Windows machine require an on-device check; they are not simulated by these tests.
