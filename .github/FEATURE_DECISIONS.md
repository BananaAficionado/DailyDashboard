# Dashboard feature decisions

## 2026-08-18: display scaling, live aircraft, and weather radar

### Application scaling

- Persist `appScale` with the rest of the local application settings.
- Offer only the requested sticky values: 75%, 100%, 125%, 150%, and 200%.
- Scale the complete application shell, including settings and touch targets, while inversely sizing its logical viewport so the app still fills the window.
- Anchor the Settings backdrop to that logical application shell rather than the physical browser viewport. This prevents viewport dimensions from being scaled twice and clipping the panel at the top or bottom.
- Bound the Settings panel to the shell's available width and height, keep its heading sticky, and scroll its contents so every control remains reachable at 200% on short displays.
- Default existing installations to 100%.

### Single-row widget packing

- Keep the dashboard to three horizontal columns at every scale; it must not create a second full dashboard row when four to six widgets are visible.
- Automatically pair excess widgets vertically within the existing columns. Four widgets use two full-height columns and one split column, five use one full-height column and two split columns, and six use three split columns.
- Repair previously saved layouts during normalization by deriving the missing stacks, while preserving valid user-created two-widget stacks and widget order.
- Calculate the two internal half-height tracks from the scaled dashboard shell rather than directly from `100vh`, without a fixed minimum that can overflow at 150% or 200%.

### Live aircraft widget

- Add `aircraft` to the existing saved widget layout model. It is available from the rail and Settings but is not enabled automatically for existing users.
- Default to the free ADSB.lol point/radius endpoint and refresh every 10 seconds only while the widget is visible.
- Keep the endpoint template and optional API key configurable. Templates accept `{lat}`, `{lon}`, and `{radius}`; optional keys are sent as `x-rapidapi-key` for ADSB Exchange/RapidAPI-compatible services.
- Route desktop requests through a small Tauri command to avoid browser CORS restrictions. Browser preview uses a direct fetch and reports a non-blocking feed error if the provider disallows it.
- Use the weather location when no aircraft-specific location is set. Users can search/set an independent location, use device location, pan with mouse or touch, zoom with wheel/buttons/pinch, and save the current map centre.
- Keep map navigation local until **Set centre** is chosen, preventing an accidental drag from changing persisted settings or the API query area.
- Selecting an aircraft shows flight/callsign, aircraft type, registration, altitude, ground speed, and vertical rate. Graphic-only mode hides labels and the details card.
- Base maps use OpenStreetMap tiles with visible attribution. Aircraft data remains attributable to the configured provider; the default is ADSB.lol (ODbL).

### Weather radar

- Keep forecast content as page 1 and add radar as page 2, with explicit arrow controls and a `1 / 2` or `2 / 2` indicator.
- Fetch RainViewer frame metadata only when the radar page is open, update it every five minutes, and use the most recent past frame.
- Overlay the radar on the shared interactive OpenStreetMap surface with mouse/touch pan and zoom.
- Display RainViewer's required attribution in the widget and degrade to the base map plus an inline error if radar metadata is unavailable.
- Allow the shared base map to zoom to level 19. RainViewer requests remain capped at its documented maximum level 7; higher map levels crop and enlarge the matching level-7 overlay tile instead of requesting an unsupported URL.

### Map presentation and sizing

- Default the ADS-B and weather maps to a dark monochrome OpenStreetMap treatment that matches the application, with an in-map control to restore the original colour tiles.
- Keep radar reflectivity colours intact in monochrome mode because those colours encode precipitation intensity.
- Make both map surfaces flex to the full remaining widget height with no fixed minimum height, including when the widget occupies half of a stacked column.
- Validate the map UX and smoke behavior at both 1280×480 and 1920×720.
- Convert pointer movement from the rendered coordinate system back into the map's logical pixel space, which keeps panning proportional when application scaling is active.
- Apply drag movement incrementally from the latest committed map centre so React rerenders cannot reapply an old drag origin and cause large jumps.

### Data and security

- API keys are stored in the same local Tauri settings JSON as the app's existing provider credentials and are never committed.
- ADS-B requests time out after 12 seconds. Feed failures do not stop the rest of the dashboard.
- No aircraft history or location trail is retained; only the chosen map location and display preference are persisted.

### Verification

- `npm run build`
- `npm test`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- UI and short-viewport smoke tests where the local browser runtime is available.
- Settings geometry and bottom-control access verified at 75%, 100%, 125%, 150%, and 200% on a short ultrawide viewport.

## 2026-08-18: Outlook iCalendar recurrence fix

- The previous iCalendar parser treated each `VEVENT` as a single event and ignored Outlook `RRULE` properties, which left only the first meeting visible.
- Recurrence is expanded only around the active calendar window to prevent unbounded work for never-ending series.
- Supported recurrence fields include daily/weekly/monthly/yearly frequency, interval, count, until, weekdays, month days, months, set position, and week start.
- `EXDATE` exclusions and `RECURRENCE-ID` overrides/cancellations are applied by UID. UTC timestamps and all-day durations retain their original semantics across recurrence expansion.
- Behavioral regression tests cover Outlook weekly rules, count/until bounds, exclusions, monthly ordinal weekdays, all-day events, and UTC meetings.
