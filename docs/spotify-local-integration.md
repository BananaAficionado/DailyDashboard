# Spotify local integration investigation

Investigated 5 November 2026 against the current Tauri/React widget and current Microsoft, Spotify and Spicetify documentation.

## Implementation status — V0.5.5

Implemented native Spotify media-session control on Windows, Spotify scripting on macOS, and an optional authenticated Spicetify loopback connector for Like and full controls. Settings supports Auto, Local only and API modes; local-only makes no Spotify Web API requests. Track identity is not fabricated when Windows metadata lacks it. Source capabilities drive the widget buttons. The connector is exported/paired per installation; it is not silently installed. See the [setup guide](../integrations/spotify/README.md).

Validation covers protocol authentication, stale sessions, expired/duplicate commands, connector acknowledgements and track guards, actual frontend routing with a native transport stub, Windows binding cross-compilation and the Windows CI build. Real Windows Spotify sessions, Spicetify client compatibility and physical upgrade installation remain on-device validation. The investigation below records the evidence and options considered before implementation; catalogue browsing remains outside this release.

## Original finding

Direct control of the installed Spotify desktop app is feasible for the widget's basic playback functions. On Windows, the best supported route is Windows media sessions, rather than Spotify's Web API or simulated global media keys. Rich catalogue browsing is a separate problem: those media sessions do not expose search, the library, or Spotify's personalised Home feed.

At the time of the initial investigation no playback commands were sent. The implementation above now provides the bridge; both Spotify installation variants still need an on-device check.

## Application before implementation

- `src/App.tsx`: `loadSpotify` polls Spotify's Web API every 15 seconds. `spotifyCommand` sends transport, seek, volume and library requests to the Web API.
- The widget currently treats an OAuth token as its connection state. Local availability needs its own connection state, independent of API credentials.
- `SpotifyMediaItem` requires a Spotify ID and URI. Windows media metadata does not supply those identifiers, so the model must support unavailable IDs rather than fabricate a match from title and artist.
- `src-tauri/src/lib.rs` has no local Spotify bridge. The existing native backend is a suitable place for one. `windows` 0.61.3 is already a transitive dependency; using its media interfaces would require an explicit Windows-only dependency with the relevant features.
- The opener capability currently allows web URLs and an explicit `codex:` route. Spotify URI handling needs a narrow, validated native path or an appropriate additional opener scope.

## Windows capability matrix

| Feature | Without the Spotify Web API | Qualification |
| --- | --- | --- |
| Play/pause, previous, next | Feasible through the Spotify media session | Spotify must expose a session and permit the action. Installation alone is not an active session. |
| Title, artist, album, artwork | Available through session metadata | The player decides which fields to publish. |
| Progress and seeking | Timeline information and a seek command exist | Use the session's capability flags; support and timeline accuracy need testing with Spotify. |
| Volume | Feasible through Windows Core Audio | This controls Spotify's Windows mixer session volume, rather than necessarily changing Spotify's own volume setting. It is separate from the media-session interface. |
| Open a known album/playlist/track | Feasible using Spotify URIs | Navigation is distinct from reliably starting playback of a selected context. |
| Like/save, library, catalogue search | Not exposed by Windows media sessions | Requires another data/control interface. |
| Full personalised Home feed | No supported interface found in the reviewed public APIs | A custom Home screen is possible, but should not be described as Spotify's actual Home feed. |

Microsoft documents session control on Windows 10 version 1809 and later, including playback capability checks and change notifications. Its example explains selecting a particular application's session and notes that metadata completeness is controlled by the source player. The metadata properties list contains album/title/artist/thumbnail fields, but no Spotify catalogue URI. [Session API](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssession?view=winrt-26100), [Microsoft desktop example](https://devblogs.microsoft.com/oldnewthing/20231108-00/?p=108980/), [media metadata](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmediaproperties?view=winrt-26100).

Windows Core Audio exposes process identity for audio sessions and per-session volume. A volume implementation must locate Spotify's audio session rather than change system-wide output. [Session process ID](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nf-audiopolicy-iaudiosessioncontrol2-getprocessid), [session volume](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-isimpleaudiovolume-setmastervolume).

## Search, Home and albums

### Supported hybrid approach

Build dashboard search results and album pages using Spotify's catalogue API, while keeping ordinary playback controls local. Spotify documents catalogue search and album/playlist/track URIs. Known resources can be opened in the desktop client. Search/Home navigation routes such as `spotify:search:...` or `spotify:home` should be treated as client-specific until tested, rather than assumed to be stable public desktop APIs. [Search API](https://developer.spotify.com/documentation/web-api/reference/search), [Spotify URIs](https://developer.spotify.com/documentation/web-api/concepts/spotify-uris-ids).

For reliable one-click playback of a specific album through the existing Web API, the playback endpoint accepts an album context and an explicit device ID; that endpoint requires Spotify Premium. This would remain an API-backed action, even when the target device is the same PC. Merely opening a URI and then sending Play does not establish that the requested album has become the current context. [Start playback](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback).

A dashboard Home page could combine supported library/recent-content data and user-pinned links, subject to the account/app's available endpoints. It cannot promise an exact copy of Spotify's personalised Home feed. API access remains subject to Spotify's current development-mode requirements and shared quotas. [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes), [July 2026 quota update](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates).

### Without catalogue API access

Provide local Now Playing plus user-pinned Spotify album/playlist links and Open in Spotify navigation. Full search results and imported library/Home data would need an additional interface; operating-system media sessions alone cannot supply them.

Spotify's supported Embeds display individual content such as albums and playlists. They are not a documented surface for embedding the full desktop app's Home/Search UI or attaching its native session to our widget. Their minimum audio-player width is 280 CSS pixels, which is wider than some of this project's scaled half widgets. [Spotify Embeds](https://developer.spotify.com/documentation/embeds), [Embed sizing](https://developer.spotify.com/documentation/embeds/tutorials/creating-an-embed).

### Additional local integration options

- **Spotify Soloist:** An official, separate headless playback client for x86_64 Windows, Apple Silicon Mac and Linux. Its local WebSocket API supports playback state, queue, seek, volume and playing known album/playlist/track URIs. The documented query commands do not include catalogue search or a Home feed. It controls Soloist's playback, rather than the already-installed graphical Spotify app. [Overview](https://developer.spotify.com/documentation/soloist), [WebSocket reference](https://developer.spotify.com/documentation/soloist/reference/websocket-api).
- Soloist requires a personal API key generated by a Premium account and Spotify Connect pairing. Spotify's setup guide says not to redistribute its binaries directly. It therefore belongs behind an optional integration, with a separately installed client, rather than being silently bundled into this dashboard. [Setup and distribution guidance](https://developer.spotify.com/documentation/soloist/tutorials/getting-started), [authentication](https://developer.spotify.com/documentation/soloist/concepts/authentication).
- **Spicetify bridge:** A custom extension could expose the client's playback/platform interfaces to a local dashboard bridge. This is an inference from Spicetify's documented Player, Platform and Cosmos interfaces, not an existing tested bridge in this project. It requires modifying Spotify and depends on client internals, making it a less stable default than OS media control. [Extension interfaces](https://spicetify.app/docs/development/extensions), [internal request wrapper](https://spicetify.app/docs/development/api-wrapper/methods/cosmos-async).

## macOS evidence

The installed Spotify app on this development machine is version `1.3.5.3058`. Its shipped scripting dictionary at `/Applications/Spotify.app/Contents/Resources/Spotify.sdef` exposes play/pause, next/previous, position, volume, shuffle/repeat, track metadata/artwork URL and `play track` with an optional context URI. Its `Info.plist` registers the `spotify` URL scheme. This was verified by reading the files only; automation permission and actual playback have not been tested. A macOS backend can therefore use Spotify's own scripting interface, subject to macOS Automation permission.

## Recommended implementation

1. Add a provider layer with **Auto**, **Local only**, and **Spotify API** modes. Display the actual source and local app/session availability. Local-only mode must not require OAuth or make Spotify Web API requests.
2. Add a Windows native media-session backend. Select Spotify explicitly, including Store and standalone installations; do not control whichever app happens to be the global current session. Subscribe to metadata/playback/timeline changes and session lifecycle events.
3. Expose supported actions to the existing widget. Disable unavailable seek, volume and library actions. Preserve hide-art behaviour. Interpolate progress between timestamped updates rather than relying on the existing 15-second API poll.
4. Handle installed-but-closed, running-without-session, paused, unavailable and disconnected states separately. Offer Open Spotify, then wait for the session. Do not silently send a failed local command to a different remote device.
5. Add optional catalogue browsing and album/library views through the Web API. Make navigation and guaranteed playback actions distinct. A compact widget can retain Now Playing and open browsing in a bounded expanded view.
6. Consider Soloist only as a separately selected playback backend. Consider a Spicetify bridge only if deeper client integration is explicitly wanted despite its additional setup and maintenance.

## Validation required before a release

Test on actual Windows with Store and standalone Spotify: startup/closed app, media-session registration, paused and playing tracks, podcasts, capability restrictions, artwork changes, missing metadata, seeking, volume, Spotify restarts, other media apps active, and API/network failures. Verify that local-only mode makes no Spotify Web API requests and never controls a browser or another player. Confirm the current NSIS-installed desktop app can access the Windows APIs; do not assume a Tauri capability grant substitutes for OS API access. Then run the existing four-size, 19-configuration widget matrix, including art shown/hidden and unsupported-action states.
