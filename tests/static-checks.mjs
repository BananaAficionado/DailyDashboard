import { readFile } from "node:fs/promises";

const capabilities = JSON.parse(await readFile(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"));
const tauriConfig = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const timelineSource = await readFile(new URL("../src/CalendarTimeline.tsx", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../src/calendarLayout.ts", import.meta.url), "utf8");
const clockSource = await readFile(new URL("../src/ClockWidget.tsx", import.meta.url), "utf8");
const idleSource = await readFile(new URL("../src/IdleBackgrounds.tsx", import.meta.url), "utf8");
const mapSource = await readFile(new URL("../src/InteractiveMap.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const rustSource = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const capabilitiesSource = await readFile(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8");
const envExampleSource = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const installerHooksSource = await readFile(new URL("../src-tauri/installer-hooks.nsh", import.meta.url), "utf8");

assert(
  capabilities.permissions.includes("core:window:allow-is-fullscreen") &&
    capabilities.permissions.includes("core:window:allow-set-fullscreen"),
  "Tauri fullscreen ACL permissions are present"
);

assert(
  appSource.includes("onToggleFullscreen") &&
    appSource.includes("<strong>Application</strong>") &&
    appSource.includes('const APP_VERSION = "V0.5.12"') &&
    appSource.includes("Version {APP_VERSION}") &&
    appSource.includes("Toggle Full Screen") &&
    cssSource.includes(".settings-action-button") &&
    !appSource.includes('title="Fullscreen"'),
  "application settings show version and fullscreen control instead of a widget topbar fullscreen button"
);

assert(
  tauriConfig.version === "0.5.12" &&
    tauriConfig.mainBinaryName === "V0.5.12_Daily-Dashboard" &&
    tauriConfig.bundle.windows.nsis.installerHooks === "installer-hooks.nsh" &&
    tauriConfig.bundle.targets.includes("nsis"),
  "release metadata is V0.5.12 with the prefixed main binary name and NSIS hooks"
);

assert(
  installerHooksSource.includes("NSIS_HOOK_POSTINSTALL") &&
    installerHooksSource.includes("IfSilent") &&
    installerHooksSource.includes('nsis_tauri_utils::RunAsUser "$INSTDIR\\${MAINBINARYNAME}.exe"'),
  "silent Windows updates relaunch the newly installed executable after installation"
);

assert(
  appSource.includes('title="Clock"') &&
    appSource.includes('widget === "clock"') &&
    clockSource.includes("AnalogClock") &&
    clockSource.includes("DigitalClock") &&
    clockSource.includes("ClockAgenda") &&
    clockSource.includes("AgendaDetails") &&
    clockSource.includes("onFaceModeChange") &&
    clockSource.includes("size !== \"tall\"") &&
    clockSource.includes('padStart(2, "0")') &&
    clockSource.includes("Array.from({ length: 12 }") &&
    clockSource.includes("detailsClosing") &&
    clockSource.includes("clock-side-pane") &&
    clockSource.includes("setInterval(tick, 100)") &&
    clockSource.includes('timeZone === "system"') &&
    clockSource.includes("onWheel={(event) => event.stopPropagation()}") &&
    cssSource.includes(".second-hand") &&
    cssSource.includes(".clock-widget-full .clock-widget-body") &&
    cssSource.includes("min(28cqw, 55cqh)") &&
    cssSource.includes(".clock-widget-half .clock-number { display: none; }") &&
    cssSource.includes("grid-template-rows: auto minmax(0, 1fr)") &&
    cssSource.includes("touch-action: pan-y") &&
    cssSource.includes("@keyframes clock-details-enter") &&
    cssSource.includes("@keyframes clock-details-exit"),
  "clock widget has accurate analog seconds, in-widget timezones, digital wide layouts, and responsive daily agenda modes"
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
    appSource.includes("order: [\"calendar\", \"clock\", \"spotify\", \"weather\", \"aircraft\", \"codex\", \"terminal\"]") &&
    appSource.includes("visible: [\"calendar\", \"spotify\", \"weather\"]") &&
    appSource.includes("stacks: [[\"spotify\", \"weather\"]]") &&
    appSource.includes("buildDashboardEntries") &&
    appSource.includes("addWidgetToLayout") &&
    appSource.includes("packWidgetStacks") &&
    appSource.includes("style={{ gridColumn, gridRow }}") &&
    appSource.includes("widget-size-${widgetSize(widget)}") &&
    appSource.includes("toggleWidget") &&
    appSource.includes("hideWidget") &&
    appSource.includes("railWidgetActive") &&
    appSource.includes("calendar-widget-size-${widgetSize(widget)}") &&
    idleSource.includes("empty-wave-field") &&
    idleSource.includes("empty-dashboard-content"),
  "saved widget layout tracks visible dashboard widgets, calendar as a widget, and the four allowed widget sizes"
);

assert(
  appSource.includes("type AppScale = 75 | 100 | 125 | 150 | 175 | 200") &&
    appSource.includes("APP_SCALES") &&
    appSource.includes("Application scale") &&
    cssSource.includes("zoom: var(--app-scale)") &&
    rustSource.includes("app_scale"),
  "application scaling is persisted and offers persisted display scaling"
);

assert(
  appSource.includes("WIDGET_FEATURE_FLAGS") &&
    appSource.includes("VITE_FEATURE_WIDGET_CALENDAR") &&
    appSource.includes("VITE_FEATURE_WIDGET_CLOCK") &&
    appSource.includes("VITE_FEATURE_WIDGET_SPOTIFY") &&
    appSource.includes("VITE_FEATURE_WIDGET_WEATHER") &&
    appSource.includes("VITE_FEATURE_WIDGET_AIRCRAFT") &&
    appSource.includes("VITE_FEATURE_WIDGET_CODEX, false") &&
    appSource.includes("VITE_FEATURE_WIDGET_TERMINAL") &&
    appSource.includes("filter(isEnabledWidgetId)") &&
    appSource.includes("WIDGET_FEATURE_FLAGS.codex ? <section") &&
    envExampleSource.includes("VITE_FEATURE_WIDGET_CODEX=false"),
  "every widget has a release flag and Codex defaults off in layouts, the rail, and Settings"
);

assert(
  appSource.includes("checkForRollback") &&
    appSource.includes("rollbackToPreviousRelease") &&
    appSource.includes("Rollback to {previousRelease.version}") &&
    rustSource.includes("async fn check_for_rollback") &&
    rustSource.includes("compare_numeric_versions(&release.tag_name, &current_version).is_lt()") &&
    rustSource.includes('compare_numeric_versions("V0.4.4", "V0.4.5").is_lt()') &&
    rustSource.includes("any(|asset| preferred_update_asset(&asset.name))") &&
    rustSource.includes("check_for_rollback,"),
  "settings can locate, verify, and reinstall the immediately previous stable GitHub release"
);

assert(
  timelineSource.includes("var(--calendar-gutter)") &&
    appSource.includes("if (calendarNarrow) setCalendarSourcePanelOpen(false)") &&
    cssSource.includes(".calendar-widget-size-tall .calendar-source-sidebar") &&
    cssSource.includes("position: absolute") &&
    cssSource.includes(".calendar-widget-size-tall .segmented") &&
    cssSource.includes(".calendar-widget-size-tall .calendar-search"),
  "one-column calendar keeps compact controls while calendars open in a non-width-consuming overlay"
);

assert(
  appSource.includes("AircraftPanel") &&
    appSource.includes("DEFAULT_ADSB_API_URL") &&
    appSource.includes("fetch_adsb") &&
    appSource.includes("Graphic only") &&
    appSource.includes("Set centre") &&
    appSource.includes("historyByAircraft") &&
    appSource.includes("trails={trails}") &&
    rustSource.includes("async fn fetch_adsb") &&
    mapSource.includes("zoomMapAroundPoint") &&
    mapSource.includes("map-trail-segment") &&
    cssSource.includes(".aircraft-detail") &&
    cssSource.includes(".map-trail-segment") &&
    cssSource.includes(".aircraft-map-wrap > .interactive-map") &&
    cssSource.includes("height: 100%"),
  "live ADS-B aircraft widget supports cursor-anchored zoom, altitude-coloured selected trails, graphic-only mode, and persisted provider settings"
);

assert(
  appSource.includes("api.rainviewer.com/public/weather-maps.json") &&
    appSource.includes("Weather data by RainViewer") &&
    appSource.includes('page === "radar" ? "Forecast" : "Radar"') &&
    appSource.includes("data.radar?.nowcast") &&
    appSource.includes("setRadarFrameIndex") &&
    appSource.includes("radarMaxZoom={7}") &&
    appSource.includes("onMonochromeChange") &&
    mapSource.includes("bounds.width / Math.max(1, element.clientWidth)") &&
    mapSource.includes("commitPan") &&
    mapSource.includes("discontinuityLimit") &&
    mapSource.includes("data-center-longitude") &&
    cssSource.includes(".weather-radar-page") &&
    cssSource.includes("will-change: transform") &&
    cssSource.includes(".interactive-map.map-monochrome .map-base-tile"),
  "weather radar has direct show/hide controls, animated observed/forecast frames, and stable buffered map panning"
);

assert(
  idleSource.includes("paths.map") && idleSource.includes('"one","two","three","four","five","six","seven","eight","nine"') &&
    cssSource.includes(".wave-nine"),
  "empty dashboard renders a fuller animated wave field"
);

assert(
  appSource.includes("IdleDashboard") && idleSource.includes('"fish"') && idleSource.includes('"stars"') &&
    idleSource.includes('"topographic"') && idleSource.includes('"slideshow"') &&
    idleSource.includes("Orange roughy") && idleSource.includes("Blue cod") && idleSource.includes("Gemfish") &&
    idleSource.includes("Please select an album folder from the settings menu") &&
    rustSource.includes("select_slideshow_folder") && rustSource.includes("read_slideshow_image") &&
    rustSource.includes("collect_slideshow_images") && appSource.includes("await onSave(next)"),
  "no-widget screen offers all five persisted backgrounds and a native slideshow album folder"
);

assert(
  idleSource.includes("localSiderealHours") && idleSource.includes("projectStar") &&
    idleSource.includes("constellation-popup") && idleSource.includes("Orange roughy") &&
    idleSource.includes("pixel-fish-food") && idleSource.includes('"seeking-food"') &&
    idleSource.includes('behaviour = "circling-cursor"') && idleSource.includes("requestAnimationFrame(animate)") &&
    idleSource.includes("constellation-hit-star") && cssSource.includes("stroke-width: 18") &&
    idleSource.includes("World_Hillshade") && !idleSource.includes("World_Topo_Map") &&
    idleSource.includes("nearby ridge") && idleSource.includes("creek valley") && idleSource.includes("trail country") &&
    idleSource.includes("overpass-api.de/api/interpreter") && idleSource.includes('tags.route === "hiking"') &&
    appSource.includes("Shrink to fit with blurred background") && rustSource.includes("idle_slideshow_fit") &&
    cssSource.includes("slideshow-backdrop-drift"),
  "ambient backgrounds include local constellation projection, interactive feeding fish, label-free hillshade, and both slideshow fit modes"
);

assert(
  appSource.includes("auto-download") && appSource.includes("auto-install") && appSource.includes("Disable update checks") &&
    appSource.includes("Install next reboot") && rustSource.includes("check_for_updates") && rustSource.includes("download_update") &&
    rustSource.includes("DailyDashboardUpdate") && rustSource.includes("compare_versions"),
  "GitHub release update assistant supports automatic, immediate, next-sign-in, and ignored update modes"
);

assert(
  appSource.includes("Private-repository access (optional)") && rustSource.includes("github_token") &&
    rustSource.includes("application/octet-stream") && appSource.includes("Notify me only (default)"),
  "public releases work anonymously, private releases retain optional authentication, and automatic updates are opt-in"
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
    appSource.includes("weather-chart-legend") &&
    appSource.includes("solarTimeX(day.sunrise, hourly)") &&
    appSource.includes('className="weather-solar-gradient"') &&
    cssSource.includes(".weather-graph-time-axis") &&
    cssSource.includes(".weather-solar-gradient") &&
    appSource.includes('className={`weather-current-time') &&
    appSource.includes("weatherCurrentTimeX(now, timeZone, hourly)") &&
    cssSource.includes(".weather-current-time") &&
    cssSource.includes("-webkit-text-fill-color: var(--bg-elev)") &&
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
  appSource.includes("WeatherDayGraph({ day, narrow = false, now, timeZone }") &&
    appSource.includes("formatGraphHour(item.time, compactLabels, timeZone)") &&
    appSource.includes("observer.observe(graphRef.current)") &&
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
    appSource.includes("expandIcalRecurrence") &&
    appSource.includes("RECURRENCE-ID") &&
    appSource.includes("EXDATE") &&
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
    appSource.includes("calendar-display-summary") &&
    appSource.includes("Outlook style") &&
    cssSource.includes(".calendar-style-outlook .day-header") &&
    cssSource.includes(".calendar-style-outlook .timed-event") &&
    cssSource.includes(".date-heading h1"),
  "calendar uses the Outlook presentation while preserving shared calendar controls"
);

assert(
  timelineSource.includes("time-gutter") &&
    appSource.includes('["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]') &&
    appSource.includes("const monday = addDays(startOfWeek(new Date()), 1)"),
  "timed calendar columns are explicitly aligned after the time gutter and mock meetings remain current Monday through Friday"
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
    appSource.includes('url.searchParams.set("past_hours", "24")') &&
    appSource.includes("RainHistoryGraph") &&
    appSource.includes("Rain history") &&
    appSource.includes("Rain ${rainHistoryPeriod}") &&
    appSource.includes("friendlyWeatherError") &&
    appSource.includes("Close weather settings") &&
    appSource.includes("Hide Weather") &&
    appSource.includes("FiveDayForecast") &&
    appSource.includes("WeatherDayGraph") &&
    appSource.includes("onResolveCurrentWeatherLocation") &&
    appSource.includes("Feels like") &&
    appSource.includes("apparent_temperature") &&
    appSource.includes("Low {activeDay.minTemp}") &&
    appSource.includes("High {activeDay.maxTemp}") &&
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
    cssSource.includes("--dashboard-half-height: calc((100% - 8px) / 2)") &&
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
  appSource.includes("CalendarTimeline") && timelineSource.includes("ResizeObserver") &&
    timelineSource.includes("startHour = showFullDay ? 0 : 9") && timelineSource.includes("endHour = showFullDay ? 24 : 18") &&
    layoutSource.includes("positionMeetings") && layoutSource.includes("laneSpan") &&
    appSource.includes("CalendarEventDetails") && appSource.includes("MeetingReminder") &&
    timelineSource.includes("current-time-marker") && timelineSource.includes("All day"),
  "calendar fits the workday, provides full-day access, and preserves event details and collision-safe columns"
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
    cssSource.includes("background: var(--border)") &&
    cssSource.includes("background: var(--blue)") &&
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
