import { readFile } from "node:fs/promises";

const capabilities = JSON.parse(await readFile(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"));
const tauriConfig = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const rustSource = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const capabilitiesSource = await readFile(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8");

assert(
  capabilities.permissions.includes("core:window:allow-is-fullscreen") &&
    capabilities.permissions.includes("core:window:allow-set-fullscreen"),
  "Tauri fullscreen ACL permissions are present"
);

assert(
  appSource.includes("onToggleFullscreen") &&
    appSource.includes("<strong>Application</strong>") &&
    appSource.includes('const APP_VERSION = "V0.3"') &&
    appSource.includes("Version {APP_VERSION}") &&
    appSource.includes("Toggle Full Screen") &&
    cssSource.includes(".settings-action-button") &&
    !appSource.includes('title="Fullscreen"'),
  "application settings show version and fullscreen control instead of a widget topbar fullscreen button"
);

assert(
  tauriConfig.version === "0.3.0" &&
    tauriConfig.mainBinaryName === "V0.3_Daily-Dashboard" &&
    tauriConfig.bundle.targets.includes("nsis"),
  "release metadata is V0.3 with the prefixed main binary name"
);

assert(
  !appSource.includes("Clock3") && !appSource.includes('title="Today agenda"'),
  "clock agenda button has been removed from the component rail"
);

assert(
  appSource.includes("submitCalendarSearch") &&
    appSource.includes('event.key === "Enter"') &&
    appSource.includes("setViewMode(\"day\")"),
  "calendar search has an Enter action that opens the matching day"
);

assert(
  appSource.includes('<X size={18} />') &&
    !appSource.includes('<Check size={16} />'),
  "Spotify close control uses an X instead of the old tick/right-arrow control"
);

assert(
  appSource.includes("dashboardWidgets") &&
    appSource.includes("dashboard-grid") &&
    appSource.includes("DEFAULT_WIDGET_LAYOUT") &&
    appSource.includes("order: [\"calendar\", \"spotify\", \"weather\", \"codex\", \"terminal\"]") &&
    appSource.includes("visible: [\"calendar\", \"spotify\", \"weather\"]") &&
    appSource.includes("stacks: [[\"spotify\", \"weather\"]]") &&
    appSource.includes("buildDashboardEntries") &&
    appSource.includes("addWidgetToLayout") &&
    appSource.includes("widget-size-${widgetSize(widget)}") &&
    appSource.includes("toggleWidget") &&
    appSource.includes("hideWidget") &&
    appSource.includes("railWidgetActive") &&
    appSource.includes("calendar-widget-size-${widgetSize(widget)}") &&
    appSource.includes("empty-wave-field") &&
    appSource.includes("empty-dashboard-content"),
  "saved widget layout tracks visible dashboard widgets, calendar as a widget, and the four allowed widget sizes"
);

assert(
  (appSource.match(/className="empty-wave-line wave-/g) || []).length >= 9 &&
    cssSource.includes(".wave-nine"),
  "empty dashboard renders a fuller animated wave field"
);

assert(
  appSource.includes("CodexPanel") &&
    appSource.includes("DEFAULT_CODEX_OPEN_URL") &&
    appSource.includes("codex://threads/new") &&
    appSource.includes("codexPromptUrl") &&
    appSource.includes("<strong>Codex</strong>") &&
    appSource.includes("OpenAI Account Email") &&
    appSource.includes("Action Approvals") &&
    appSource.includes("CODEX_APPROVAL_LABELS") &&
    appSource.includes('const desktopWindow = window.open(desktopUrl') &&
    appSource.includes("connected={false}") &&
    cssSource.includes(".codex-panel") &&
    cssSource.includes(".codex-panel.compact") &&
    cssSource.includes(".widget-size-tall"),
  "Codex widget opens the desktop sign-in handoff from browser and Tauri contexts without treating an email as authentication"
);

assert(
  capabilitiesSource.includes('"url": "codex://*"') &&
    appSource.includes('const DEFAULT_CODEX_OPEN_URL = "codex://threads/new"') &&
    appSource.includes('title="Open Codex"'),
  "Codex widget can hand off to the signed-in desktop app through its deep-link"
);

assert(
  appSource.includes("const RAIL_HIDE_DELAY_MS = 3_000") &&
    appSource.includes("onPointerEnter={showRail}") &&
    appSource.includes("onFocusCapture={showRail}") &&
    cssSource.includes(".rail-peek-closed .rail:hover") &&
    cssSource.includes(".rail-peek-closed .rail:focus-within"),
  "rail hides after a configurable delay while pointer and keyboard focus can reopen it"
);

assert(
  cssSource.includes(".app-shell.rail-peek-closed") &&
    cssSource.includes("grid-template-columns: 0 minmax(0, 1fr)") &&
    cssSource.includes(".rail-peek-closed .rail:hover"),
  "hidden rail releases its layout column while retaining a hoverable overlay"
);

assert(
  appSource.includes("weather-graph-time-axis") &&
    appSource.includes(".filter((item) => !narrow || item.sourceIndex % 2 === 1)") &&
    appSource.includes("solarTimeX(day.sunrise, hourly)") &&
    appSource.includes('className="weather-solar-gradient"') &&
    cssSource.includes(".weather-graph-time-axis") &&
    cssSource.includes(".weather-solar-gradient") &&
    appSource.includes('title="Hide Calendar"'),
  "weather graphs expose readable narrow time labels, solar shading, and the calendar has a matching close control"
);

assert(
  appSource.includes("const EMPTY_DASHBOARD_IDLE_DELAY_MS = 15_000") &&
    appSource.includes("emptyDashboardContentVisible") &&
    appSource.includes('window.addEventListener("pointermove"') &&
    appSource.includes('window.addEventListener("keydown"') &&
    cssSource.includes(".empty-dashboard-content.is-hidden"),
  "empty dashboard guidance fades after inactivity and returns for pointer or keyboard input"
);

assert(
  appSource.includes('narrow={widgetSize("weather") === "tall"}') &&
    appSource.includes("WeatherDayGraph({ day, narrow = false }") &&
    appSource.includes("formatGraphHour(item.time, narrow)") &&
    cssSource.includes(".weather-day-graph.narrow .weather-graph-time-axis") &&
    cssSource.includes(".widget-size-half .weather-panel .weather-location"),
  "compact weather graphs use readable narrow labels and half-height weather keeps its location and alert visible"
);

assert(
  appSource.includes("if (activeBefore.length === 2 && wideEntry && tallEntry)") &&
    appSource.includes("sizes[item] = \"tall\"") &&
    appSource.includes("stacks: []"),
  "adding a widget to a wide-plus-third layout expands all widgets into full-height thirds"
);

assert(
  appSource.includes('"https://graph.microsoft.com/v1.0/me/calendars') &&
    appSource.includes("microsoftAuthUrl") &&
    appSource.includes('Sign in with Microsoft') &&
    rustSource.includes('"microsoft"') &&
    rustSource.includes("login.microsoftonline.com/common/oauth2/v2.0/token"),
  "Microsoft calendar uses PKCE sign-in and Microsoft Graph calendar data"
);

assert(
  appSource.includes("icalCalendarUrl") &&
    appSource.includes("loadIcalCalendar") &&
    appSource.includes("parseIcalendarFeed") &&
    appSource.includes("webcal://") &&
    appSource.includes("readOnly: true") &&
    appSource.includes("<strong>iCalendar</strong>") &&
    appSource.includes('placeholder="https://calendar.example.com/public.ics"') &&
    rustSource.includes("fetch_icalendar") &&
    rustSource.includes("Daily Dashboard iCalendar reader"),
  "iCalendar feeds can be configured as read-only sources without OAuth credentials"
);

assert(
  appSource.includes("type CalendarStyle = \"google\" | \"outlook\"") &&
    appSource.includes("calendarStyle?: CalendarStyle") &&
    appSource.includes("normalizeCalendarStyle(settings.calendarStyle)") &&
    appSource.includes("calendar-style-${calendarStyle}") &&
    appSource.includes('role="radiogroup" aria-label="Calendar style"') &&
    appSource.includes("Microsoft Outlook") &&
    cssSource.includes(".calendar-style-outlook .day-header") &&
    cssSource.includes(".calendar-style-outlook .timed-event") &&
    cssSource.includes(".date-heading h1"),
  "calendar presentation can switch between Google and Outlook styles while preserving the shared controls"
);

assert(
  appSource.includes("gridColumn: dayIndex + 2") &&
    appSource.includes('["06", "Monday"]') &&
    appSource.includes('["07", "Tuesday"]') &&
    appSource.includes('["08", "Wednesday"]') &&
    appSource.includes('["09", "Thursday"]') &&
    appSource.includes('["10", "Friday"]'),
  "timed calendar columns are explicitly aligned after the time gutter and mock meetings are named Monday through Friday"
);

assert(
  appSource.includes("TerminalPanel") &&
    appSource.includes("run_terminal_command") &&
    appSource.includes("terminalWorkingDirectory") &&
    rustSource.includes("run_terminal_command") &&
    rustSource.includes("system_shell_command") &&
    cssSource.includes(".terminal-panel") &&
    cssSource.includes(".terminal-panel.compact") &&
    cssSource.includes(".widget-size-full"),
  "command line widget is available with shell execution, settings, compact mode, and dashboard sizing"
);

assert(
  appSource.includes('"user-read-recently-played"') &&
    appSource.includes("loadRecentlyPlayed") &&
    appSource.includes("Spotify needs to be reconnected"),
  "Spotify falls back to recently played items and prompts for the new scope when needed"
);

assert(
  appSource.includes("additional_types=track,episode") &&
    appSource.includes("spotifyMediaFromItem") &&
    appSource.includes('candidate.type === "episode"') &&
    appSource.includes("spotify:episode:${candidate.id}") &&
    appSource.includes("/v1/me/library/contains?uris=") &&
    appSource.includes("/v1/me/library?uris="),
  "Spotify playback accepts podcast episodes and saves/checks tracks and episodes through library URIs"
);

assert(
  appSource.indexOf("const currentLoaded = await loadCurrentlyPlayingOrRecent") < appSource.indexOf("const mediaItem = spotifyMediaFromItem(data.item)") &&
    appSource.includes("JSON.stringify({ uris: [itemUri], position_ms: Math.max(0, Math.round(playback?.progress_ms || 0)) })"),
  "Spotify prefers the currently-playing endpoint before stale player state and can resume the displayed paused item"
);

assert(
  appSource.includes('"volume"') &&
    appSource.includes("/v1/me/player/volume?volume_percent=") &&
    appSource.includes("VolumeControl"),
  "Spotify volume control is wired to the playback volume endpoint"
);

assert(
  appSource.includes("WeatherPanel") &&
    appSource.includes("https://api.open-meteo.com/v1/forecast") &&
    appSource.includes("https://geocoding-api.open-meteo.com/v1/search") &&
    appSource.includes("https://geocoding-api.open-meteo.com/v1/reverse") &&
    appSource.includes("friendlyWeatherError") &&
    appSource.includes("Close weather settings") &&
    appSource.includes("Hide Weather") &&
    appSource.includes("FiveDayForecast") &&
    appSource.includes("WeatherDayGraph") &&
    appSource.includes("onResolveCurrentWeatherLocation") &&
    appSource.includes("Feels like") &&
    appSource.includes("apparent_temperature") &&
    appSource.includes("Min {activeDay.minTemp}") &&
    appSource.includes("Max {activeDay.maxTemp}") &&
    cssSource.includes(".forecast-controls") &&
    cssSource.includes(".weather-settings-grid") &&
    appSource.includes("temperatureGradientStops(minTemp, maxTemp)") &&
    appSource.includes("const stopCount = 96") &&
    appSource.includes("temperatureColour(temp)") &&
    appSource.includes("smoothRatio((temp - 14) / 6)") &&
    appSource.includes("temp < 20") &&
    appSource.includes("temp < 32") &&
    appSource.includes("mixHex(\"#ff9f43\", \"#ef476f\"") &&
    appSource.includes("smoothPath(tempPoints)") &&
    appSource.includes("smoothPath(rainPoints)") &&
    appSource.includes("rain-gradient") &&
    cssSource.includes(".temp-curve") &&
    cssSource.includes(".temp-line") &&
    cssSource.includes(".rain-curve") &&
    cssSource.includes(".rain-line") &&
    !cssSource.includes(".rain-bars span") &&
    cssSource.includes("grid-template-rows: minmax(0, 1fr) minmax(0, 1fr)") &&
    cssSource.includes(".app-shell.thirds-stacked .weather-panel .five-day-forecast") &&
    cssSource.includes("@media (max-height: 430px)") &&
    cssSource.includes("--dashboard-half-height: calc((100vh - 8px) / 2)") &&
    !cssSource.includes("--dashboard-half-height: max(260px"),
  "weather widget uses Open-Meteo, has readable location errors, close controls, reverse-geocoded current location, and forecast views"
);

assert(
  !cssSource.includes(".weather-panel.compact .weather-day-graph") &&
    cssSource.includes(".app-shell.thirds-stacked .weather-panel .weather-day-graph"),
  "weather graphs remain visible in full-height one-third mode and are hidden only when the third column is stacked"
);

assert(
  appSource.includes('className="settings-section"') &&
    appSource.includes("<strong>Spotify</strong>") &&
    appSource.includes("<strong>Weather</strong>") &&
    appSource.includes("<strong>Google Calendar</strong>"),
  "settings are split into separate Calendar, Spotify, and Weather sections"
);

assert(
  appSource.includes("{setupOpen ? (") &&
    !appSource.includes("setupOpen || needsSetup") &&
    appSource.includes("onClose={() => setSetupOpen(false)}"),
  "settings close control can dismiss the setup overlay when credentials are missing"
);

assert(
  appSource.includes('className="icon-button settings-close-button"') &&
    cssSource.includes(".setup-panel header .settings-close-button svg") &&
    cssSource.includes("padding: 0 12px 12px") &&
    !cssSource.includes("\nCSS\n"),
  "settings close icon keeps an explicit size, the short panel has no top gap, and the stylesheet has no malformed panel selector"
);

assert(
  appSource.includes("getCalendarTimeRange") &&
    appSource.includes("{ startHour: 8, endHour: 18 }") &&
    appSource.includes("formatHour(hour)") &&
    appSource.includes('className="date-heading"') &&
    appSource.includes("Math.max(36") &&
    appSource.includes("eventDateKey") &&
    appSource.includes("eventTimeParts") &&
    appSource.includes("zonedIsoWithOffset") &&
    appSource.includes("googleCalendarTimeZone") &&
    appSource.includes("Calendar Timezone") &&
    appSource.includes("timedEventsByDay") &&
    appSource.includes("visibleTimedEvents") &&
    appSource.includes("expandCalendarTimeRangeForNow") &&
    appSource.includes("CurrentTimeMarker") &&
    appSource.includes("MeetingReminder") &&
    appSource.includes("expandedEventId") &&
    cssSource.includes(".timed-event.short") &&
    cssSource.includes(".calendar-event-backdrop") &&
    cssSource.includes(".all-day-expanded") &&
    cssSource.includes(".current-time-marker") &&
    cssSource.includes(".meeting-reminder") &&
    cssSource.includes(".event-details"),
  "calendar uses timezone-aware date/time placement, readable short events, expandable details, current time marker, and meeting reminders"
);

assert(
  appSource.includes("selectedCalendarIds") &&
    appSource.includes("calendarSourceGroups") &&
    appSource.includes("My calendars") &&
    appSource.includes("Other calendars") &&
    appSource.includes("toggleCalendarSource") &&
    appSource.includes("setCalendarGroupSelected"),
  "calendar widget exposes persistent My calendars and Other calendars source selection"
);

assert(
    cssSource.includes(".dashboard-grid") &&
    cssSource.includes(".widget-size-full") &&
    cssSource.includes(".widget-size-wide") &&
    cssSource.includes(".widget-size-tall") &&
    cssSource.includes(".widget-size-half") &&
    cssSource.includes("--dashboard-half-height") &&
    cssSource.includes("grid-auto-flow: row") &&
    !cssSource.includes("grid-auto-flow: column dense") &&
    cssSource.includes(".empty-dashboard-content") &&
    cssSource.includes("@keyframes empty-wave-drift") &&
    cssSource.includes("@media (prefers-reduced-motion: reduce)") &&
    cssSource.includes("@keyframes widget-slide-up") &&
    cssSource.includes("background: #323640") &&
    cssSource.includes("background: #5bbcff") &&
    cssSource.includes("transform: translateX(-50%)"),
  "CSS covers the dashboard grid, allowed widget sizes, blue precipitation, and centered vertical volume slider"
);

assert(
  appSource.includes("rearrangeMode") &&
    appSource.includes("widget-layout-bar") &&
    appSource.includes("dropWidget") &&
    appSource.includes("dropWidgetOnGrid") &&
    appSource.includes("gridDropModeFromPointer") &&
    appSource.includes("widgetPreviewFromPointer") &&
    appSource.includes("DragPreview") &&
    appSource.includes("bump-drop-indicator") &&
    appSource.includes("moveWidgetBesideTarget") &&
    appSource.includes("Neighbours will shift") &&
    appSource.includes("grid-drop-guides") &&
    appSource.includes("grid-empty-lanes") &&
    appSource.includes("gridDropTitle") &&
    appSource.includes("split-drop-indicator") &&
    appSource.includes("Stack above") &&
    appSource.includes("Stack below") &&
    appSource.includes("stackWidgets") &&
    appSource.includes("placeWidgetInGrid") &&
    appSource.includes("cleanWidgetStacks") &&
    appSource.includes("dragPreviewFromClientPoint") &&
    appSource.includes("startWidgetPointerDrag") &&
    appSource.includes("finishWidgetPointerDrag") &&
    appSource.includes("document.elementFromPoint") &&
    appSource.includes("dataTransfer.setData(\"text/plain\", widget)") &&
    appSource.includes("dataTransfer.dropEffect = \"move\"") &&
    appSource.includes("startWidgetDrag") &&
    appSource.includes("draggable={false}") &&
    cssSource.includes(".widget-layout-bar") &&
    cssSource.includes(".rail-arrange") &&
    cssSource.includes(".grid-drop-zone") &&
    cssSource.includes(".grid-empty-lane") &&
    cssSource.includes(".bump-drop-indicator") &&
    cssSource.includes(".dashboard-widget.bump-preview") &&
    cssSource.includes(".split-drop-indicator") &&
    cssSource.includes("z-index: 0") &&
    !cssSource.includes(".size-controls") &&
    cssSource.includes(".dragging-widget .widget-slot:not(.drag-source)"),
  "rearrange mode exposes direct drag-to-stack cards, rail-bottom arrange control, and no settings size picker"
);

assert(
  htmlSource.includes('/dashboard.svg') &&
    tauriConfig.bundle.icon.includes("icons/icon.png") &&
    tauriConfig.bundle.icon.includes("icons/icon.ico"),
  "application favicon and bundle icons are configured"
);

assert(
  appSource.includes("toastVisible") &&
    appSource.includes("setToastVisible(false), 5_500") &&
    appSource.includes('className={`toast ${toastVisible ? "show" : "hide"}`}'),
  "errors auto-hide through the toast visibility lifecycle"
);

assert(
  rustSource.includes("secret.trim().to_string()") &&
    rustSource.includes('"google"') &&
    rustSource.includes('"https://oauth2.googleapis.com/token"') &&
    rustSource.includes('"spotify"') &&
    rustSource.includes('"https://accounts.spotify.com/api/token"') &&
    rustSource.includes("client_secret.is_some()"),
  "OAuth token exchange trims optional secrets and keeps Google on PKCE-first form auth"
);

console.log("Static checks passed");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
