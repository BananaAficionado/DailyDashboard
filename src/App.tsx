import { loadStoredTokens } from "./tokenStorage";
import {
  Bot,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CloudSun,
  Droplets,
  Sun,
  Sunrise,
  Thermometer,
  ExternalLink,
  Grip,
  Heart,
  Image as ImageIcon,
  ImageOff,
  LayoutGrid,
  ListMusic,
  Maximize2,
  Pause,
  Plane,
  Play,
  RefreshCcw,
  Shuffle,
  Repeat,
  Repeat1,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Terminal,
  Volume2,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CSSProperties, DragEvent, FormEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InteractiveMap, type MapPoint, type MapTrail, type MapTrailPoint } from "./InteractiveMap";
import { expandIcalRecurrence, icalDateKey } from "./icalRecurrence";
import { adsbAltitudeColor } from "./mapTiles";
import { IdleDashboard, type IdleBackgroundKind, type SlideshowFit } from "./IdleBackgrounds";
import { meetingMinutes, calendarViewDays, normalizeCalendarView, type CalendarViewMode } from "./calendarLayout";
import { DisplayLockSetting, readDisplayLockInfo, type DisplayBinding } from "./DisplayLockSetting";
import { CalendarTimeline } from "./CalendarTimeline";
import { buildWeatherDays, formatWeatherTime, upcomingWeatherDays, weatherHourIndex, weatherLocalTime, weatherSolarState, type WeatherData, type WeatherDay } from "./weather";
import { useLocalClock } from "./useLocalClock";
import { ClockWidget, type ClockAgendaItem, type ClockFaceMode } from "./ClockWidget";

import { localCommandValue, localMediaItem, normalizeSpotifyMode, type SpotifyAction, type SpotifyControls, type LocalSpotifySnapshot, type SpotifyControlMode } from "./spotifyLocal";

type ViewMode = CalendarViewMode;
type CalendarStyle = "google" | "outlook";
type Provider = "google" | "microsoft" | "spotify";

type EnvConfig = {
  spotifyClientId?: string;
  spotifyClientSecret?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
  microsoftTenant?: string;
};

type StoredSettings = EnvConfig & {
  calendarId?: string;
  googleCalendarTimeZone?: string;
  calendarStyle?: CalendarStyle;
  calendarViewMode?: ViewMode;
  icalCalendarUrl?: string;
  spotifyRedirectUri?: string;
  spotifyHideAlbumArt?: boolean;
  spotifyControlMode?: SpotifyControlMode;
  displayLock?: DisplayBinding | null;
  googleRedirectUri?: string;
  microsoftRedirectUri?: string;
  codexAccountEmail?: string;
  codexApprovalMode?: CodexApprovalMode;
  codexOpenUrl?: string;
  codexWebUrl?: string;
  terminalWorkingDirectory?: string;
  weatherLocation?: WeatherLocation;
  widgetLayout?: WidgetLayout;
  selectedCalendarIds?: string[];
  appScale?: AppScale;
  adsbLocation?: WeatherLocation;
  adsbApiUrl?: string;
  adsbApiKey?: string;
  adsbGraphicOnly?: boolean;
  idleBackground?: IdleBackgroundKind;
  idleMapLocation?: WeatherLocation;
  idleSlideshowFolder?: string;
  idleSlideshowFit?: SlideshowFit;
  updatePreference?: UpdatePreference;
  startupUpdatePolicyVersion?: number;
  githubUpdateToken?: string;
  clockTimeZone?: string;
  clockFaceMode?: ClockFaceMode;
};

type WidgetId = "calendar" | "clock" | "spotify" | "weather" | "aircraft" | "codex" | "terminal";
type AppScale = 75 | 100 | 125 | 150 | 175 | 200;
type UpdatePreference = "notify" | "auto-download" | "auto-install" | "ignore";
type AvailableUpdate = { version: string; name: string; notes: string; releaseUrl: string; assetName?: string; assetUrl?: string; assetDigest?: string; prerelease: boolean };
type DownloadedUpdate = { path: string; assetName: string };
type WidgetLayoutMode = "thirds" | "focus";
type WidgetSize = "full" | "wide" | "tall" | "half";
type DashboardEntry = {
  widget: WidgetId;
  size: WidgetSize;
  gridColumn: string;
  gridRow: string;
};
type WidgetDropPosition = "top" | "bottom";
type WidgetBumpSide = "before" | "after";
type GridDropMode = "third-left" | "wide-centre" | "third-right";
type DragPreview =
  | { type: "grid"; mode: GridDropMode }
  | { type: "bump"; target: WidgetId; side: WidgetBumpSide }
  | { type: "split"; target: WidgetId; position: WidgetDropPosition }
  | null;
type CodexApprovalMode = "on-request" | "auto-review" | "never";

type WidgetLayout = {
  mode: WidgetLayoutMode;
  order: WidgetId[];
  visible: WidgetId[];
  thirdsStacked?: boolean;
  sizes?: Partial<Record<WidgetId, WidgetSize>>;
  stacks?: WidgetId[][];
};

type TokenBundle = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
};

type CalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  calendarId?: string;
  calendarSummary?: string;
  calendarColor?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  colorId?: string;
  attendees?: { email?: string; displayName?: string; responseStatus?: string; self?: boolean }[];
  organizer?: { email?: string; displayName?: string; self?: boolean };
  htmlLink?: string;
  hangoutLink?: string;
};

type CalendarSource = {
  id: string;
  summary: string;
  backgroundColor?: string;
  selected?: boolean;
  primary?: boolean;
  accessRole?: string;
  readOnly?: boolean;
};

type MicrosoftGraphEvent = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  location?: { displayName?: string };
  start: { dateTime: string };
  end: { dateTime: string };
  isAllDay?: boolean;
  webLink?: string;
  organizer?: { emailAddress?: { name?: string; address?: string } };
  attendees?: { emailAddress?: { name?: string; address?: string }; status?: { response?: string } }[];
};

type SpotifyImage = {
  url: string;
  height: number;
  width: number;
};

type SpotifyMediaItem = {
  id: string;
  uri: string;
  name: string;
  type: "track" | "episode";
  subtitle: string;
  caption: string;
  images: SpotifyImage[];
  duration_ms: number;
};

type PlaybackState = {
  is_playing: boolean;
  progress_ms: number;
  item: SpotifyMediaItem | null;
  device?: { id?: string; name?: string; is_active?: boolean; volume_percent?: number };
  source?: "active" | "currently-playing" | "recently-played" | "local";
  controls?: SpotifyControls;
  shuffle_state?: boolean;
  repeat_state?: number;
  sampledAt?: number;
  status?: string;
};

type WeatherLocation = {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
};

type Aircraft = {
  id: string;
  flight: string;
  registration: string;
  aircraftType: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  onGround: boolean;
  speed: number | null;
  heading: number;
  verticalRate: number | null;
};

type CodexActivity = {
  prompt: string;
  summary: string;
  phase: string;
  startedAt?: number;
  pendingApproval?: { title: string; detail: string };
};

type TerminalEntry = {
  id: string;
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
};

type TerminalRunResult = Omit<TerminalEntry, "id">;

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const MICROSOFT_SCOPE = "openid profile email offline_access User.Read Calendars.Read";
const SPOTIFY_SCOPE = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "user-read-recently-played",
  "user-library-read",
  "user-library-modify",
].join(" ");

const TOKEN_KEYS: Record<Provider, string> = {
  google: "daily-dashboard.google-token",
  microsoft: "daily-dashboard.microsoft-token",
  spotify: "daily-dashboard.spotify-token",
};

const EVENT_COLORS = ["#d064e8", "#e8c957", "#8ab4f8", "#81c995", "#f28b82", "#fdd663"];
const LEGACY_SPOTIFY_REDIRECT_URI = "http://127.0.0.1:420/callback";
const DEFAULT_SPOTIFY_REDIRECT_URI = "http://127.0.0.1:4200/callback";
const DEFAULT_GOOGLE_REDIRECT_URI = "http://127.0.0.1:8911";
const DEFAULT_MICROSOFT_REDIRECT_URI = "http://localhost:8912";
const DEFAULT_CODEX_OPEN_URL = "codex://threads/new";
const DEFAULT_CODEX_WEB_URL = "https://chatgpt.com/codex";
const DEFAULT_ADSB_API_URL = "https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{radius}";
const APP_SCALES: AppScale[] = [75, 100, 125, 150, 175, 200];
const APP_VERSION = "V0.5.14";
const RAIL_HIDE_DELAY_MS = 3_000;
const EMPTY_DASHBOARD_IDLE_DELAY_MS = 15_000;
const featureFlag = (value: unknown, defaultEnabled = true) => {
  if (value == null || value === "") return defaultEnabled;
  return String(value).toLowerCase() !== "false" && String(value) !== "0";
};
const WIDGET_FEATURE_FLAGS: Record<WidgetId, boolean> = {
  calendar: featureFlag(import.meta.env.VITE_FEATURE_WIDGET_CALENDAR),
  clock: featureFlag(import.meta.env.VITE_FEATURE_WIDGET_CLOCK),
  spotify: featureFlag(import.meta.env.VITE_FEATURE_WIDGET_SPOTIFY),
  weather: featureFlag(import.meta.env.VITE_FEATURE_WIDGET_WEATHER),
  aircraft: featureFlag(import.meta.env.VITE_FEATURE_WIDGET_AIRCRAFT),
  codex: featureFlag(import.meta.env.VITE_FEATURE_WIDGET_CODEX, false),
  terminal: featureFlag(import.meta.env.VITE_FEATURE_WIDGET_TERMINAL),
};
const DEFAULT_WIDGET_SIZES: Record<WidgetId, WidgetSize> = {
  calendar: "wide",
  clock: "tall",
  spotify: "half",
  weather: "half",
  aircraft: "tall",
  codex: "tall",
  terminal: "tall",
};
const DEFAULT_WIDGET_LAYOUT: WidgetLayout = {
  mode: "thirds",
  order: ["calendar", "clock", "spotify", "weather", "aircraft", "codex", "terminal"],
  visible: ["calendar", "spotify", "weather"],
  thirdsStacked: true,
  sizes: DEFAULT_WIDGET_SIZES,
  stacks: [["spotify", "weather"]],
};
const DEFAULT_CODEX_ACTIVITY: CodexActivity = {
  prompt: "",
  summary: "Ready for a Codex prompt.",
  phase: "Idle",
};
const CODEX_APPROVAL_LABELS: Record<CodexApprovalMode, string> = {
  "on-request": "Ask first",
  "auto-review": "Auto review",
  never: "Never ask",
};

const isTauri = () => Boolean("__TAURI_INTERNALS__" in window);
const isMockMode = () => new URLSearchParams(window.location.search).has("mock");

function App() {
  const [settings, setSettings] = useState<StoredSettings>({});
  const [env, setEnv] = useState<EnvConfig>({});
  const [googleToken, setGoogleToken] = useState<TokenBundle | null>(null);
  const [microsoftToken, setMicrosoftToken] = useState<TokenBundle | null>(null);
  const [spotifyToken, setSpotifyToken] = useState<TokenBundle | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendarSources, setCalendarSources] = useState<CalendarSource[]>([]);
  const [calendarSourcePanelOpen, setCalendarSourcePanelOpen] = useState(false);
  const [calendarSourceGroupsOpen, setCalendarSourceGroupsOpen] = useState({ my: true, other: true });
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [localSpotifyStatus, setLocalSpotifyStatus] = useState("Open Spotify to connect local controls");
  const spotifyLoading = useRef(false);
  const spotifyNextApiRead = useRef(0);
  const spotifyAbort = useRef<AbortController | null>(null);
  const spotifySliderTimers = useRef<Partial<Record<"seek" | "volume", number>>>({});
  const spotifyMode = normalizeSpotifyMode(settings.spotifyControlMode);
  const spotifyModeRef = useRef(spotifyMode);
  spotifyModeRef.current = spotifyMode;
  const currentSpotifyMode = () => spotifyModeRef.current;
  const [isSavedTrack, setIsSavedTrack] = useState(false);
  const [volumePercent, setVolumePercent] = useState(50);
  const [codexPrompt, setCodexPrompt] = useState("");
  const [codexActivity, setCodexActivity] = useState<CodexActivity>(DEFAULT_CODEX_ACTIVITY);
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const { now: weatherNow } = useLocalClock(weather?.timezone, weatherClockNow);
  const weatherLoadedLocation = useRef("");
  const weatherDate = weatherLocalTime(weatherNow, weather?.timezone)?.date;
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [aircraftError, setAircraftError] = useState("");
  const [weatherQuery, setWeatherQuery] = useState("");
  const [weatherSearching, setWeatherSearching] = useState(false);
  const calendarTimeZone = normalizeTimeZone(settings.googleCalendarTimeZone);
  const { now, refresh: refreshCalendarClock } = useLocalClock(calendarTimeZone);
  const calendarToday = dateKeyInTimeZone(now, calendarTimeZone);
  const [browsedCalendarDate, setCurrentDate] = useState(() => startOfDay(new Date()));
  const [calendarFollowsToday, setCalendarFollowsToday] = useState(true);
  const currentDate = useMemo(() => calendarFollowsToday ? dateFromKey(calendarToday) : browsedCalendarDate, [calendarFollowsToday, calendarToday, browsedCalendarDate]);
  const viewMode = normalizeCalendarView(settings.calendarViewMode);
  function setViewMode(next: ViewMode) { saveSettings({ ...settings, calendarViewMode: next }).catch(err => setError(String(err))); }
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCursor, setSearchCursor] = useState(-1);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [dismissedReminderIds, setDismissedReminderIds] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [rearrangeMode, setRearrangeMode] = useState(false);
  const [draggedWidget, setDraggedWidget] = useState<WidgetId | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [authStatus, setAuthStatus] = useState("");
  const [error, setError] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [railPeekOpen, setRailPeekOpen] = useState(false);
  const [emptyDashboardContentVisible, setEmptyDashboardContentVisible] = useState(true);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [previousRelease, setPreviousRelease] = useState<AvailableUpdate | null>(null);
  const [downloadedUpdate, setDownloadedUpdate] = useState<DownloadedUpdate | null>(null);
  const [updateStatus, setUpdateStatus] = useState("");
  const [updateBusy, setUpdateBusy] = useState(isTauri());
  const [canAutoInstall, setCanAutoInstall] = useState(() => isMockMode() && new URLSearchParams(location.search).get("platform") !== "macos");
  const railHideTimer = useRef<number | null>(null);
  const emptyDashboardIdleTimer = useRef<number | null>(null);

  const credentials = useMemo(
    () => ({
      googleClientId: settings.googleClientId || env.googleClientId || "",
      googleClientSecret: settings.googleClientSecret || env.googleClientSecret || "",
      microsoftClientId: settings.microsoftClientId || env.microsoftClientId || "",
      microsoftTenant: settings.microsoftTenant || env.microsoftTenant || "common",
      spotifyClientId: settings.spotifyClientId || env.spotifyClientId || "",
      spotifyClientSecret: settings.spotifyClientSecret || env.spotifyClientSecret || "",
      calendarId: settings.calendarId || "primary",
      googleCalendarTimeZone: normalizeTimeZone(settings.googleCalendarTimeZone),
      spotifyRedirectUri: normalizeSpotifyRedirect(settings.spotifyRedirectUri),
      googleRedirectUri: settings.googleRedirectUri || DEFAULT_GOOGLE_REDIRECT_URI,
      microsoftRedirectUri: settings.microsoftRedirectUri || DEFAULT_MICROSOFT_REDIRECT_URI,
    }),
    [env, settings]
  );
  const codexSettings = useMemo(
    () => ({
      accountEmail: settings.codexAccountEmail?.trim() || "",
      approvalMode: normalizeCodexApprovalMode(settings.codexApprovalMode),
      openUrl: normalizeCodexOpenUrl(settings.codexOpenUrl),
      webUrl: normalizeCodexWebUrl(settings.codexWebUrl),
    }),
    [settings]
  );
  const googleClientSource = settings.googleClientId ? "Settings" : env.googleClientId ? "keys.env" : "Not configured";
  const widgetLayout = normalizeWidgetLayout(settings.widgetLayout);
  const visibleWidgetSet = new Set(widgetLayout.visible);
  const selectedCalendarSet = new Set(settings.selectedCalendarIds || []);
  const dashboardEntries = buildDashboardEntries(widgetLayout);
  const dashboardWidgets = dashboardEntries.map((entry) => entry.widget);
  const widgetSize = (widget: WidgetId) => dashboardEntries.find((entry) => entry.widget === widget)?.size || DEFAULT_WIDGET_SIZES[widget];
  const widgetCompact = (widget: WidgetId) => widgetSize(widget) === "half";
  const calendarStyle = normalizeCalendarStyle(settings.calendarStyle);
  const appScale = normalizeAppScale(settings.appScale);
  const railWidgetActive = (widget: WidgetId) => visibleWidgetSet.has(widget);
  const calendarNarrow = widgetSize("calendar") === "tall" || widgetSize("calendar") === "half";

  function clearRailHideTimer() {
    if (railHideTimer.current !== null) {
      window.clearTimeout(railHideTimer.current);
      railHideTimer.current = null;
    }
  }

  function showRail() {
    clearRailHideTimer();
    setRailPeekOpen(true);
  }

  function scheduleRailHide() {
    clearRailHideTimer();
    railHideTimer.current = window.setTimeout(() => {
      const rail = document.querySelector(".rail");
      if (!rail?.matches(":hover") && !rail?.matches(":focus-within")) {
        setRailPeekOpen(false);
      }
      railHideTimer.current = null;
    }, RAIL_HIDE_DELAY_MS);
  }

  function clearEmptyDashboardIdleTimer() {
    if (emptyDashboardIdleTimer.current !== null) {
      window.clearTimeout(emptyDashboardIdleTimer.current);
      emptyDashboardIdleTimer.current = null;
    }
  }

  function resetEmptyDashboardActivity() {
    if (dashboardWidgets.length) {
      return;
    }
    setEmptyDashboardContentVisible(true);
    clearEmptyDashboardIdleTimer();
    emptyDashboardIdleTimer.current = window.setTimeout(() => {
      setEmptyDashboardContentVisible(false);
      emptyDashboardIdleTimer.current = null;
    }, EMPTY_DASHBOARD_IDLE_DELAY_MS);
  }

  const visibleDays = useMemo(() => calendarViewDays(currentDate, viewMode), [currentDate, viewMode]);

  const calendarSourceGroups = useMemo(() => ({
    my: calendarSources.filter(isMyCalendarSource),
    other: calendarSources.filter((source) => !isMyCalendarSource(source)),
  }), [calendarSources]);

  useEffect(() => {
    if (calendarFollowsToday) setExpandedEventId(null);
  }, [calendarToday, calendarFollowsToday]);

  useEffect(() => {
    if (calendarNarrow) setCalendarSourcePanelOpen(false);
  }, [calendarNarrow]);

  useEffect(() => () => clearRailHideTimer(), []);

  useEffect(() => {
    clearEmptyDashboardIdleTimer();
    if (dashboardWidgets.length) {
      setEmptyDashboardContentVisible(true);
      return;
    }

    const handlePointerMove = () => resetEmptyDashboardActivity();
    const handleKeyDown = () => resetEmptyDashboardActivity();
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("keydown", handleKeyDown);
    resetEmptyDashboardActivity();
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("keydown", handleKeyDown);
      clearEmptyDashboardIdleTimer();
    };
  }, [dashboardWidgets.length]);

  useEffect(() => {
    async function boot() {
      try {
        if (isTauri()) {
          const initial = await invoke<{ env: EnvConfig; settings: StoredSettings }>("load_initial_config");
          setEnv(initial.env);
          const tokens = await loadStoredTokens((command, args) => invoke(command, args), localStorage);
          setGoogleToken(tokens.google);
          setMicrosoftToken(tokens.microsoft);
          setSpotifyToken(tokens.spotify);
          setSettings({
            calendarId: "primary",
            ...initial.settings,
          });
          setSetupOpen(!initial.env.googleClientId && !initial.settings.googleClientId);
        } else if (isMockMode()) {
          setEnv({
            googleClientId: "mock-google.apps.googleusercontent.com",
            spotifyClientId: "mock-spotify",
          });
          const mockCalendarTall = new URLSearchParams(window.location.search).has("calendarTall");
          const mockParams = new URLSearchParams(window.location.search);
          const mockScale = normalizeAppScale(Number(mockParams.get("scale")));
          const mockEmpty = mockParams.has("empty");
          const mockWidget = mockParams.get("widget");
          const mockSize = mockParams.get("widgetSize");
          const mockClockSize = isWidgetSize(mockParams.get("clockSize")) ? mockParams.get("clockSize") as WidgetSize : null;
          setSettings({
            calendarId: "primary",
            spotifyControlMode: mockParams.has("musicBackend") ? "local" : "auto",
            updatePreference: "notify",
            startupUpdatePolicyVersion: 2,
            appScale: mockScale,
            calendarViewMode: normalizeCalendarView(mockParams.get("calendarView")),
            weatherLocation: mockParams.get("weatherState") === "setup" ? undefined : mockWeatherLocation(),
            widgetLayout: isWidgetId(mockWidget) && isWidgetSize(mockSize) ? mockWidgetLayout(mockWidget, mockSize) : mockEmpty ? { ...DEFAULT_WIDGET_LAYOUT, visible: [], stacks: [] } : mockClockSize ? mockClockWidgetLayout(mockClockSize) : mockCalendarTall ? {
              ...DEFAULT_WIDGET_LAYOUT,
              sizes: { ...DEFAULT_WIDGET_SIZES, calendar: "tall", spotify: "tall", weather: "tall" },
              stacks: [],
            } : undefined,
          });
          setEvents(mockCalendarEvents());
          setCalendarSources(mockCalendarSources());
          setPlayback(mockParams.get("musicState") === "disconnected" ? null : mockParams.get("musicState") === "idle" ? { ...mockPlayback(), item: null, is_playing: false } : mockPlayback(mockParams.get("musicBackend")));
          setWeather(mockParams.get("weatherState") === "loading" ? null : mockWeather());
          setSpotifyToken(mockParams.get("musicState") === "disconnected" ? null : { accessToken: "mock", expiresAt: Date.now() + 3_600_000 });
          setVolumePercent(mockPlayback().device?.volume_percent || 50);
          setSetupOpen(false);
        } else {
          setSettings({ calendarId: "primary" });
          setSetupOpen(true);
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setConfigLoaded(true);
      }
    }
    boot();
  }, []);

  useEffect(() => {
    if (!configLoaded || !isTauri()) return;
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const status = await invoke<{busy: boolean; finished: boolean; message: string; availableUpdate?: AvailableUpdate | null; downloadedUpdate?: DownloadedUpdate | null; canAutoInstall: boolean} | null>("startup_update_status");
        if (!active) return;
        if (!status) { setUpdateBusy(false); return; }
        setCanAutoInstall(status.canAutoInstall);
        setUpdateBusy(status.busy);
        setUpdateStatus(status.message);
        if (status.availableUpdate) setAvailableUpdate(status.availableUpdate);
        if (status.downloadedUpdate) setDownloadedUpdate(status.downloadedUpdate);
        if (!status.finished) timer = window.setTimeout(refresh, 500);
      } catch (error) {
        if (active) { setUpdateBusy(false); setUpdateStatus(`Startup update status unavailable: ${String(error)}`); }
      }
    };
    void refresh();
    return () => { active = false; window.clearTimeout(timer); };
  }, [configLoaded]);

  useEffect(() => {
    if (!error) {
      setToastVisible(false);
      return;
    }
    setToastVisible(true);
    const hideTimer = window.setTimeout(() => setToastVisible(false), 5_500);
    const clearTimer = window.setTimeout(() => {
      setError((current) => current === error ? "" : current);
    }, 6_100);
    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, [error]);

  const ensureToken = useCallback(
    async (provider: Provider, existing: TokenBundle | null) => {
      if (!existing) {
        return null;
      }
      if (Date.now() < existing.expiresAt - 60_000) {
        return existing;
      }
      if (!existing.refreshToken || !isTauri()) {
        return existing;
      }
      try {
        const refreshed = await invoke<{
          access_token: string;
          refresh_token?: string;
          expires_in?: number;
          scope?: string;
        }>("refresh_access_token", {
          request: {
            provider,
            refreshToken: existing.refreshToken,
            clientId: provider === "google" ? credentials.googleClientId : provider === "microsoft" ? credentials.microsoftClientId : credentials.spotifyClientId,
            clientSecret: provider === "google" ? credentials.googleClientSecret.trim() : provider === "spotify" ? credentials.spotifyClientSecret.trim() : undefined,
            scope: provider === "microsoft" ? MICROSOFT_SCOPE : undefined,
          },
        });
        const next = normalizeToken(refreshed, existing.refreshToken);
        await writeToken(provider, next);
        if (provider === "google") {
          setGoogleToken(next);
        } else if (provider === "microsoft") {
          setMicrosoftToken(next);
        } else {
          setSpotifyToken(next);
        }
        return next;
      } catch (err) {
        setError(String(err));
        return existing;
      }
    },
    [credentials.googleClientId, credentials.googleClientSecret, credentials.microsoftClientId, credentials.spotifyClientId, credentials.spotifyClientSecret]
  );

  const loadMicrosoftCalendar = useCallback(async (token: TokenBundle, signal?: AbortSignal) => {
    const headers = { Authorization: `Bearer ${token.accessToken}` };
    const timeMin = new Date(zonedIsoWithOffset(dateKey(visibleDays[0]), credentials.googleCalendarTimeZone)).toISOString();
    const timeMax = new Date(zonedIsoWithOffset(dateKey(addDays(visibleDays[visibleDays.length - 1], 1)), credentials.googleCalendarTimeZone)).toISOString();
    const sourceResponse = await fetch("https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,color,canEdit&$top=100", { headers, signal, cache: "no-cache" });
    if (!sourceResponse.ok) {
      throw new Error(`Microsoft calendar list failed: ${sourceResponse.status}`);
    }
    const sourceData = await sourceResponse.json();
    if (signal?.aborted) return;
    const sources: CalendarSource[] = (sourceData.value || []).map((source: { id: string; name?: string; color?: string; canEdit?: boolean }) => ({
      id: source.id,
      summary: source.name || source.id,
      backgroundColor: microsoftCalendarColor(source.color),
      selected: true,
      accessRole: source.canEdit ? "writer" : "reader",
    }));
    setCalendarSources(sources);
    const sourceIds = new Set(sources.map((source) => source.id));
    const selectedIds = settings.selectedCalendarIds?.filter((id) => sourceIds.has(id));
    const activeSources = selectedIds?.length
      ? sources.filter((source) => selectedIds.includes(source.id))
      : sources;
    const results = await Promise.allSettled(activeSources.map(async (source) => {
      const url = new URL(`https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(source.id)}/calendarView`);
      url.searchParams.set("startDateTime", timeMin);
      url.searchParams.set("endDateTime", timeMax);
      url.searchParams.set("$top", "80");
      url.searchParams.set("$orderby", "start/dateTime");
      url.searchParams.set("$select", "id,subject,bodyPreview,location,start,end,isAllDay,webLink,organizer,attendees");
      const response = await fetch(url, { headers, signal, cache: "no-cache" });
      if (!response.ok) {
        throw new Error(`${source.summary}: ${response.status}`);
      }
      const data = await response.json();
      return (data.value || []).map((event: MicrosoftGraphEvent) => microsoftEventToCalendarEvent(event, source));
    }));
    const loadedEvents = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    if (signal?.aborted) return;
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length && !loadedEvents.length) {
      throw new Error(`Microsoft calendar request failed: ${failures.map((result) => String((result as PromiseRejectedResult).reason)).join(", ")}`);
    }
    setEvents(loadedEvents);
  }, [credentials.googleCalendarTimeZone, settings.selectedCalendarIds, visibleDays]);

  const loadIcalCalendar = useCallback(async (signal?: AbortSignal) => {
    const feedUrl = normalizeIcalCalendarUrl(settings.icalCalendarUrl);
    if (!feedUrl) {
      return;
    }
    const feedText = isTauri()
      ? await invoke<string>("fetch_icalendar", { url: feedUrl })
      : await fetch(feedUrl, { signal, cache: "no-cache" }).then(async (response) => {
          if (!response.ok) {
            throw new Error(`iCalendar feed returned HTTP ${response.status}`);
          }
          return response.text();
        });
    if (signal?.aborted) return;
    const parsed = parseIcalendarFeed(feedText, feedUrl, visibleDays);
    setCalendarSources([parsed.source]);
    setEvents(parsed.events);
  }, [settings.icalCalendarUrl, visibleDays]);

  const loadCalendar = useCallback(async (signal?: AbortSignal) => {
    if (isMockMode()) {
      const sources = mockCalendarSources();
      const activeSourceIds = settings.selectedCalendarIds
        ? new Set(settings.selectedCalendarIds)
        : new Set(sources.filter((source) => source.selected !== false).map((source) => source.id));
      setCalendarSources(sources);
      setEvents(mockCalendarEvents().filter((event) => event.calendarId && activeSourceIds.has(event.calendarId)));
      return;
    }

    if (normalizeIcalCalendarUrl(settings.icalCalendarUrl)) {
      try {
        await loadIcalCalendar(signal);
      } catch (err) {
        if (!signal?.aborted) throw err;
      }
      return;
    }

    const microsoft = await ensureToken("microsoft", microsoftToken);
    if (signal?.aborted) return;
    if (microsoft && credentials.microsoftClientId) {
      try {
        await loadMicrosoftCalendar(microsoft, signal);
      } catch (err) {
        if (!signal?.aborted) throw err;
      }
      return;
    }

    const token = await ensureToken("google", googleToken);
    if (signal?.aborted) return;
    if (!token || !credentials.googleClientId) {
      return;
    }
    try {
      const timeMin = zonedIsoWithOffset(dateKey(visibleDays[0]), credentials.googleCalendarTimeZone);
      const timeMax = zonedIsoWithOffset(dateKey(addDays(visibleDays[visibleDays.length - 1], 1)), credentials.googleCalendarTimeZone);
      const headers = { Authorization: `Bearer ${token.accessToken}` };
      const sourceResponse = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader", { headers, signal, cache: "no-cache" });
      let sources: CalendarSource[] = [];

      if (sourceResponse.ok) {
        const sourceData = await sourceResponse.json();
        if (signal?.aborted) return;
        sources = (sourceData.items || [])
          .map((source: CalendarSource) => ({
            id: source.id,
            summary: source.summary || source.id,
            backgroundColor: source.backgroundColor,
            selected: source.selected,
            primary: source.primary,
            accessRole: source.accessRole,
          }));
      }

      if (signal?.aborted) return;
      if (!sources.length) {
        sources = [{ id: credentials.calendarId, summary: credentials.calendarId }];
      }
      setCalendarSources(sources);
      const activeSourceIds = settings.selectedCalendarIds
        ? new Set(settings.selectedCalendarIds)
        : new Set(sources.filter((source) => source.selected !== false).map((source) => source.id));
      const activeSources = sources.filter((source) => activeSourceIds.has(source.id));

      if (!activeSources.length) {
        setEvents([]);
        return;
      }

      const results = await Promise.allSettled(activeSources.map(async (source) => {
        const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(source.id)}/events`);
        url.searchParams.set("singleEvents", "true");
        url.searchParams.set("orderBy", "startTime");
        url.searchParams.set("timeMin", timeMin);
        url.searchParams.set("timeMax", timeMax);
        url.searchParams.set("timeZone", credentials.googleCalendarTimeZone);
        url.searchParams.set("maxResults", "80");
        const response = await fetch(url, { headers, signal, cache: "no-cache" });
        if (!response.ok) {
          throw new Error(`${source.summary}: ${response.status}`);
        }
        const data = await response.json();
        return (data.items || []).map((event: CalendarEvent) => ({
          ...event,
          id: `${source.id}:${event.id}`,
          calendarId: source.id,
          calendarSummary: source.summary,
          calendarColor: source.backgroundColor,
        }));
      }));

      const loadedEvents = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      if (signal?.aborted) return;
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length && !loadedEvents.length) {
        throw new Error(`Calendar request failed: ${failures.map((result) => String((result as PromiseRejectedResult).reason)).join(", ")}`);
      }
      setEvents(loadedEvents);
    } catch (err) {
      if (!signal?.aborted) throw err;
    }
  }, [credentials.calendarId, credentials.googleCalendarTimeZone, credentials.googleClientId, credentials.microsoftClientId, ensureToken, googleToken, loadIcalCalendar, loadMicrosoftCalendar, microsoftToken, settings.icalCalendarUrl, settings.selectedCalendarIds, visibleDays]);

  const loadSpotify = useCallback(async () => {
    if (isMockMode()) {
      return;
    }
    if (!configLoaded || !isTauri() || spotifyLoading.current) return;
    spotifyLoading.current = true;
    try {
      if (spotifyMode !== "api") {
        try {
          const local = await invoke<LocalSpotifySnapshot>("local_spotify_snapshot");
          if (currentSpotifyMode() !== spotifyMode) return;
          setLocalSpotifyStatus(local.status);
          if (local.available) {
            spotifyNextApiRead.current = 0;
            setPlayback({ is_playing: local.isPlaying, progress_ms: local.progressMs, item: localMediaItem(local), source: "local", controls: local.controls,
              shuffle_state: local.shuffle, repeat_state: local.repeat, sampledAt: Date.now(), status: local.status });
            setIsSavedTrack(Boolean(local.liked));
            if (local.volumePercent != null) setVolumePercent(local.volumePercent);
            return;
          }
        } catch (error) { setLocalSpotifyStatus(String(error)); }
        if (spotifyMode === "local" || !spotifyToken) { setPlayback(null); setIsSavedTrack(false); return; }
      }
      if (Date.now() < spotifyNextApiRead.current) return;
      spotifyNextApiRead.current = Date.now() + 15_000;
      const token = await ensureToken("spotify", spotifyToken);
      if (!token || !credentials.spotifyClientId || currentSpotifyMode() !== spotifyMode) return;
      spotifyAbort.current = new AbortController();
      const signal = spotifyAbort.current.signal;
      const headers = { Authorization: `Bearer ${token.accessToken}` };
      const response = await fetch("https://api.spotify.com/v1/me/player?additional_types=track,episode", { headers, signal });
      if (response.status === 204) {
        if (!await loadCurrentlyPlayingOrRecent(token.accessToken)) await loadRecentlyPlayed(token.accessToken);
        return;
      }
      if (!response.ok) {
        throw new Error(`Spotify request failed: ${response.status}`);
      }
      const data = await response.json();
      if (currentSpotifyMode() === "local") return;
      const currentLoaded = await loadCurrentlyPlayingOrRecent(token.accessToken, { device: data.device, shuffle_state: Boolean(data.shuffle_state), repeat_state: data.repeat_state === "track" ? 2 : data.repeat_state === "context" ? 1 : 0 });
      if (currentLoaded) {
        return;
      }
      const mediaItem = spotifyMediaFromItem(data.item);
      if (!mediaItem) {
        await loadRecentlyPlayed(token.accessToken);
        return;
      }
      setPlayback({
        ...data,
        item: mediaItem,
        progress_ms: data.progress_ms || 0,
        source: "active",
        status: data.device?.name ? `Spotify API · ${data.device.name}` : "Spotify API",
        shuffle_state: Boolean(data.shuffle_state), repeat_state: data.repeat_state === "track" ? 2 : data.repeat_state === "context" ? 1 : 0,
      });
      if (typeof data.device?.volume_percent === "number") {
        setVolumePercent(data.device.volume_percent);
      }
      await loadSavedItemState(token.accessToken, mediaItem.uri);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setError(String(err));
    } finally { spotifyLoading.current = false; }
  }, [configLoaded, credentials.spotifyClientId, ensureToken, spotifyToken, spotifyMode]);

  async function loadCurrentlyPlayingOrRecent(accessToken: string, playerState?: Pick<PlaybackState, "device" | "shuffle_state" | "repeat_state">): Promise<boolean> {
    if (currentSpotifyMode() === "local") return false;
    const response = await fetch("https://api.spotify.com/v1/me/player/currently-playing?additional_types=track,episode", {
      signal: spotifyAbort.current?.signal, headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 204) {
      return false;
    }
    if (!response.ok) {
      throw new Error(`Spotify currently-playing request failed: ${response.status}`);
    }
    const data = await response.json();
    if (currentSpotifyMode() === "local") return false;
    const mediaItem = spotifyMediaFromItem(data.item);
    if (!mediaItem) {
      return false;
    }
    setPlayback({
      is_playing: Boolean(data.is_playing),
      progress_ms: data.progress_ms || 0,
      item: mediaItem,
      device: playerState?.device, shuffle_state: playerState?.shuffle_state, repeat_state: playerState?.repeat_state,
      source: "currently-playing",
      status: data.is_playing ? "Spotify API" : "Spotify API · Paused",
    });
    await loadSavedItemState(accessToken, mediaItem.uri);
    return true;
  }

  async function loadRecentlyPlayed(accessToken: string) {
    if (currentSpotifyMode() === "local") return;
    const response = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=1", {
      signal: spotifyAbort.current?.signal, headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 204) {
      setPlayback({ is_playing: false, progress_ms: 0, item: null, source: "recently-played", status: "No Spotify playback found" });
      return;
    }
    if (response.status === 403) {
      throw new Error("Spotify needs to be reconnected to show recently played items. Open Settings, clear Spotify, then connect Spotify again.");
    }
    if (!response.ok) {
      throw new Error(`Spotify recently-played request failed: ${response.status}`);
    }
    const data = await response.json();
    if (currentSpotifyMode() === "local") return;
    const mediaItem = spotifyMediaFromItem(data.items?.[0]?.track);
    if (!mediaItem) {
      setPlayback({ is_playing: false, progress_ms: 0, item: null, source: "recently-played", status: "No Spotify playback found" });
      return;
    }
    setPlayback({
      is_playing: false,
      progress_ms: 0,
      item: mediaItem,
      source: "recently-played",
      status: "Spotify API · Last played",
    });
    await loadSavedItemState(accessToken, mediaItem.uri);
  }

  async function loadSavedItemState(accessToken: string, uri: string) {
    if (currentSpotifyMode() === "local" || !uri) return;
    const savedResponse = await fetch(`https://api.spotify.com/v1/me/library/contains?uris=${encodeURIComponent(uri)}`, {
      signal: spotifyAbort.current?.signal, headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (savedResponse.ok && currentSpotifyMode() !== "local") {
      const [saved] = await savedResponse.json();
      setIsSavedTrack(Boolean(saved));
    }
  }

  useEffect(() => {
    if (!configLoaded) return;
    const controller = new AbortController();
    let pending = false, lastCompleted = -Infinity, retry: number | undefined;
    const refresh = async () => {
      const elapsed = Date.now() - lastCompleted;
      if (controller.signal.aborted || pending || (elapsed >= 0 && elapsed < 5_000)) return;
      pending = true;
      window.clearTimeout(retry);
      try {
        await loadCalendar(controller.signal);
        lastCompleted = Date.now();
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(String(error));
          retry = window.setTimeout(refresh, 60_000);
        }
      } finally { pending = false; }
    };
    const resume = () => {
      // A new local day will re-render and request its new range. Do not start
      // an obsolete-range request from the previous render's event listener.
      if (dateKeyInTimeZone(new Date(), calendarTimeZone) === calendarToday) void refresh();
    };
    const visible = () => { if (document.visibilityState === "visible") resume(); };
    void refresh();
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      window.clearTimeout(retry);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [loadCalendar, calendarToday, calendarTimeZone, configLoaded]);

  useEffect(() => {
    spotifyAbort.current?.abort();
    spotifyNextApiRead.current = 0;
    loadSpotify();
    const timer = window.setInterval(loadSpotify, spotifyMode === "api" ? 15_000 : 2_000);
    return () => { window.clearInterval(timer); spotifyAbort.current?.abort(); };
  }, [loadSpotify, spotifyMode]);

  useEffect(() => {
    if (isMockMode()) {
      return;
    }
    if (!settings.weatherLocation) {
      setWeather(null);
      weatherLoadedLocation.current = "";
      return;
    }
    const location = settings.weatherLocation;
    if (weatherLoadedLocation.current === `${location.latitude},${location.longitude}` && weather?.days[0]?.date === weatherDate) return;
    const controller = new AbortController();
    let retry: number | undefined, pending = false, complete = false;
    const refresh = async () => {
      if (controller.signal.aborted || pending || complete) return;
      window.clearTimeout(retry);
      pending = true;
      try {
        const loaded = await loadWeather(location, controller.signal);
        complete = Boolean(loaded && loaded.date === weatherLocalTime(weatherClockNow(), loaded.timezone)?.date);
        // The provider may briefly serve yesterday's cached response at midnight.
        if (!complete && !controller.signal.aborted) retry = window.setTimeout(refresh, 60_000);
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(String(error));
          retry = window.setTimeout(refresh, 60_000);
        }
      } finally { pending = false; }
    };
    void refresh();
    window.addEventListener("online", refresh);
    return () => {
      controller.abort();
      window.clearTimeout(retry);
      window.removeEventListener("online", refresh);
    };
  }, [settings.weatherLocation, weatherDate]);


  const loadAircraft = useCallback(async () => {
    const location = settings.adsbLocation || settings.weatherLocation;
    if (!location || !visibleWidgetSet.has("aircraft")) return;
    if (isMockMode()) {
      setAircraft(mockAircraft(location));
      setAircraftError("");
      return;
    }
    const endpoint = (settings.adsbApiUrl || DEFAULT_ADSB_API_URL)
      .replace("{lat}", location.latitude.toFixed(5))
      .replace("{lon}", location.longitude.toFixed(5))
      .replace("{radius}", "100");
    try {
      const data = isTauri()
        ? await invoke<unknown>("fetch_adsb", { url: endpoint, apiKey: settings.adsbApiKey || null })
        : await fetch(endpoint, { headers: settings.adsbApiKey ? { "x-rapidapi-key": settings.adsbApiKey, "x-rapidapi-host": new URL(endpoint).host } : undefined }).then(async (response) => {
            if (!response.ok) throw new Error(`ADS-B request failed: ${response.status}`);
            return response.json();
          });
      setAircraft(normalizeAircraft(data));
      setAircraftError("");
    } catch (err) {
      setAircraftError(String(err).replace(/^Error:\s*/, ""));
    }
  }, [settings.adsbApiKey, settings.adsbApiUrl, settings.adsbLocation, settings.weatherLocation, widgetLayout.visible.join("|")]);

  useEffect(() => {
    loadAircraft();
    const timer = window.setInterval(loadAircraft, isMockMode() ? 750 : 10_000);
    return () => window.clearInterval(timer);
  }, [loadAircraft]);

  async function refreshDashboard() {
    setIsRefreshing(true);
    setError("");
    try {
      await Promise.all([
        loadCalendar(),
        loadSpotify(),
        loadAircraft(),
        settings.weatherLocation ? loadWeather(settings.weatherLocation) : Promise.resolve(),
      ]);
      setAuthStatus("Refreshed");
    } catch (error) {
      setError(String(error));
    } finally {
      window.setTimeout(() => setIsRefreshing(false), 250);
    }
  }

  async function toggleFullscreen() {
    if (!isTauri()) {
      return;
    }
    const display = await readDisplayLockInfo();
    if (display.supported && display.binding) throw new Error("Unlock the dedicated display in Settings before changing fullscreen.");
    const appWindow = getCurrentWindow();
    await appWindow.setFullscreen(!(await appWindow.isFullscreen()));
  }

  const eventMatchesSearch = useCallback((event: CalendarEvent) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return true;
    }
    return [event.summary, event.location, event.calendarSummary]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(query));
  }, [searchQuery]);

  useEffect(() => {
    setSearchCursor(-1);
  }, [searchQuery]);

  function submitCalendarSearch() {
    const query = searchQuery.trim();
    if (!query) {
      return;
    }
    const matches = events
      .filter(eventMatchesSearch)
      .filter(event => {
        if (viewMode !== "work") return true;
        const key = eventDateKey(event.start.dateTime, event.start.date, credentials.googleCalendarTimeZone);
        const weekday = dateFromKey(key).getDay();
        const minutes = meetingMinutes(event, key, credentials.googleCalendarTimeZone);
        return weekday > 0 && weekday < 6 && (!minutes || (minutes.start < 1080 && minutes.end > 540));
      })
      .sort((a, b) => eventStartDate(a).getTime() - eventStartDate(b).getTime());

    if (!matches.length) {
      setError(`No calendar matches for "${query}"`);
      return;
    }

    const nextCursor = (searchCursor + 1) % matches.length;
    const nextEvent = matches[nextCursor];
    setSearchCursor(nextCursor);
    setCalendarFollowsToday(false);
    setCurrentDate(dateFromKey(eventDateKey(nextEvent.start.dateTime, nextEvent.start.date, credentials.googleCalendarTimeZone)));
    if (viewMode !== "work") setViewMode("day");
    setError("");
  }

  useEffect(() => {
    const reset = () => {
      setSetupOpen(false);
      invoke<{settings: StoredSettings}>("load_initial_config").then(config => setSettings(config.settings)).catch(error => setError(String(error)));
    };
    window.addEventListener("dashboard-display-unlocked", reset);
    return () => window.removeEventListener("dashboard-display-unlocked", reset);
  }, []);

  async function saveSettings(next: StoredSettings) {
    const normalized = normalizeSettings(next);
    if (isTauri()) {
      await invoke("save_settings", { settings: normalized });
    }
    setSettings(normalized);
  }

  async function checkForUpdates(githubToken = settings.githubUpdateToken) {
    if (!isTauri()) {
      setUpdateStatus("Update checks are available in the installed app.");
      return;
    }
    setUpdateBusy(true);
    setUpdateStatus("Checking GitHub releases…");
    try {
      const update = await invoke<AvailableUpdate | null>("check_for_updates", { currentVersion: APP_VERSION, ...(githubToken?.trim() ? { githubToken: githubToken.trim() } : {}) });
      setAvailableUpdate(update);
      if (!update) {
        setUpdateStatus(`${APP_VERSION} is up to date.`);
        return;
      }
      setUpdateStatus(`${update.version} is available.`);

    } finally {
      setUpdateBusy(false);
    }
  }

  async function downloadAvailableUpdate(update = availableUpdate) {
    if (!update?.assetUrl || !update.assetName) throw new Error("This release does not include an installer for this operating system.");
    setUpdateBusy(true);
    setUpdateStatus(`Downloading ${update.version}…`);
    try {
      const downloaded = await invoke<DownloadedUpdate>("download_update", { assetUrl: update.assetUrl, assetName: update.assetName, assetDigest: update.assetDigest, ...(settings.githubUpdateToken?.trim() ? { githubToken: settings.githubUpdateToken.trim() } : {}) });
      setDownloadedUpdate(downloaded);
      setUpdateStatus(`${update.version} is downloaded and verified.`);
      return downloaded;
    } finally {
      setUpdateBusy(false);
    }
  }

  async function checkForRollback(githubToken = settings.githubUpdateToken) {
    if (!isTauri()) {
      setUpdateStatus("Rollback checks are available in the installed app.");
      return;
    }
    setUpdateBusy(true);
    setUpdateStatus("Finding the previous stable release…");
    try {
      const release = await invoke<AvailableUpdate | null>("check_for_rollback", { currentVersion: APP_VERSION, ...(githubToken?.trim() ? { githubToken: githubToken.trim() } : {}) });
      setPreviousRelease(release);
      setUpdateStatus(release ? `${release.version} is available to restore.` : "No earlier installable release was found.");
    } finally {
      setUpdateBusy(false);
    }
  }

  async function rollbackToPreviousRelease() {
    if (!previousRelease?.assetUrl || !previousRelease.assetName) throw new Error("Find a previous release before rolling back.");
    setUpdateBusy(true);
    setUpdateStatus(`Downloading and verifying ${previousRelease.version}…`);
    try {
      const downloaded = await invoke<DownloadedUpdate>("download_update", {
        assetUrl: previousRelease.assetUrl,
        assetName: previousRelease.assetName,
        assetDigest: previousRelease.assetDigest,
        ...(settings.githubUpdateToken?.trim() ? { githubToken: settings.githubUpdateToken.trim() } : {}),
      });
      setUpdateStatus(`Restoring ${previousRelease.version}…`);
      await invoke("install_update", { path: downloaded.path, installOnReboot: false, pauseAutoUpdates: true });
    } finally {
      setUpdateBusy(false);
    }
  }

  async function installDownloadedUpdate(downloaded = downloadedUpdate, installOnReboot = false) {
    if (!downloaded) throw new Error("Download the update before installing it.");
    setUpdateBusy(true);
    setUpdateStatus(installOnReboot ? "Scheduling update for the next Windows sign-in…" : "Starting the update installer…");
    try {
      await invoke("install_update", { path: downloaded.path, installOnReboot, pauseAutoUpdates: false });
      if (installOnReboot) setUpdateStatus("Update scheduled for the next Windows sign-in.");
    } finally {
      setUpdateBusy(false);
    }
  }

  function saveWidgetLayout(layout: WidgetLayout) {
    return saveSettings({ ...settings, widgetLayout: normalizeWidgetLayout(layout) });
  }

  function calendarSourceSelected(source: CalendarSource) {
    return settings.selectedCalendarIds ? selectedCalendarSet.has(source.id) : source.selected !== false;
  }

  function toggleCalendarSource(id: string) {
    const selected = new Set(
      settings.selectedCalendarIds || calendarSources.filter((source) => source.selected !== false).map((source) => source.id)
    );
    selected.has(id) ? selected.delete(id) : selected.add(id);
    saveSettings({ ...settings, selectedCalendarIds: Array.from(selected) });
  }

  function setCalendarGroupSelected(group: CalendarSource[], selected: boolean) {
    const next = new Set(
      settings.selectedCalendarIds || calendarSources.filter((source) => source.selected !== false).map((source) => source.id)
    );
    group.forEach((source) => selected ? next.add(source.id) : next.delete(source.id));
    saveSettings({ ...settings, selectedCalendarIds: Array.from(next) });
  }

  function toggleWidget(widget: WidgetId) {
    if (widgetLayout.visible.includes(widget)) {
      hideWidget(widget);
      return;
    }
    saveWidgetLayout(addWidgetToLayout(widgetLayout, widget));
  }

  function focusWidget(widget: WidgetId) {
    if (!widgetLayout.visible.includes(widget)) {
      saveWidgetLayout(addWidgetToLayout(widgetLayout, widget));
    }
  }

  function hideWidget(widget: WidgetId) {
    const visible = widgetLayout.visible.filter((item) => item !== widget);
    saveWidgetLayout({
      ...widgetLayout,
      visible,
      stacks: cleanWidgetStacks(widgetLayout.stacks, visible),
    });
  }

  function updateDragPreview(nextPreview: DragPreview) {
    setDragPreview((current) => (
      JSON.stringify(current) === JSON.stringify(nextPreview) ? current : nextPreview
    ));
  }

  function dropWidget(target: WidgetId, dragged = draggedWidget, position: WidgetDropPosition = "bottom") {
    if (!dragged || dragged === target) {
      setDraggedWidget(null);
      setDragPreview(null);
      return;
    }
    saveWidgetLayout(stackWidgets(widgetLayout, target, dragged, position));
    setDraggedWidget(null);
    setDragPreview(null);
  }

  function dropWidgetOnGrid(mode: GridDropMode, dragged = draggedWidget) {
    if (!dragged) {
      setDraggedWidget(null);
      setDragPreview(null);
      return;
    }
    saveWidgetLayout(placeWidgetInGrid(widgetLayout, dragged, mode));
    setDraggedWidget(null);
    setDragPreview(null);
  }

  function dropWidgetFromPreview(preview: DragPreview, dragged = draggedWidget) {
    if (!dragged) {
      setDraggedWidget(null);
      setDragPreview(null);
      return;
    }
    if (preview?.type === "grid") {
      dropWidgetOnGrid(preview.mode, dragged);
      return;
    }
    if (preview?.type === "bump" || preview?.type === "split") {
      dropWidgetOnTarget(preview.target, preview, dragged);
      return;
    }
    setDraggedWidget(null);
    setDragPreview(null);
  }

  function dropWidgetOnTarget(target: WidgetId, preview: DragPreview, dragged = draggedWidget) {
    if (!dragged || dragged === target) {
      setDraggedWidget(null);
      setDragPreview(null);
      return;
    }
    if (preview?.type === "bump") {
      saveWidgetLayout(moveWidgetBesideTarget(widgetLayout, dragged, target, preview.side));
    } else if (preview?.type === "split") {
      saveWidgetLayout(stackWidgets(widgetLayout, target, dragged, preview.position));
    }
    setDraggedWidget(null);
    setDragPreview(null);
  }

  function gridDropModeFromRect(rect: DOMRect, clientX: number): GridDropMode {
    const x = rect.width ? (clientX - rect.left) / rect.width : 0.5;
    if (x < 0.3) {
      return "third-left";
    }
    if (x > 0.7) {
      return "third-right";
    }
    return "wide-centre";
  }

  function gridDropModeFromPointer(event: { currentTarget: HTMLElement; clientX: number }): GridDropMode {
    return gridDropModeFromRect(event.currentTarget.getBoundingClientRect(), event.clientX);
  }

  function gridDropClass(mode: GridDropMode) {
    return mode === "wide-centre" ? "drop-wide" : mode === "third-right" ? "drop-right" : "drop-left";
  }

  function gridDropTitle(mode: GridDropMode) {
    return mode === "wide-centre" ? "2/3 width" : "1/3 width";
  }

  function gridDropSubtitle(mode: GridDropMode) {
    if (mode === "wide-centre") {
      return "Drop in the middle";
    }
    return mode === "third-right" ? "Drop on the right" : "Drop on the left";
  }

  function isDraggingOverSource(event: { target: EventTarget | null }, dragged: WidgetId) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return target.closest<HTMLElement>(".widget-slot")?.dataset.widget === dragged;
  }

  function widgetPreviewFromRect(target: WidgetId, rect: DOMRect, clientX: number, clientY: number, dragged = draggedWidget): DragPreview {
    if (!dragged || dragged === target) {
      return null;
    }
    const x = rect.width ? (clientX - rect.left) / rect.width : 0.5;
    if (x < 0.26) {
      return { type: "bump", target, side: "before" };
    }
    if (x > 0.74) {
      return { type: "bump", target, side: "after" };
    }
    if (widgetSize(target) !== "tall") {
      return null;
    }
    return {
      type: "split",
      target,
      position: clientY < rect.top + rect.height / 2 ? "top" : "bottom",
    };
  }

  function widgetPreviewFromPointer(target: WidgetId, event: { currentTarget: HTMLElement; clientX: number; clientY: number }, dragged = draggedWidget): DragPreview {
    return widgetPreviewFromRect(target, event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY, dragged);
  }

  function dragPreviewFromClientPoint(clientX: number, clientY: number, dragged = draggedWidget): DragPreview {
    if (!dragged) {
      return null;
    }
    const element = document.elementFromPoint(clientX, clientY);
    if (!(element instanceof HTMLElement)) {
      return null;
    }
    const slot = element.closest<HTMLElement>(".widget-slot");
    const target = slot?.dataset.widget;
    if (slot && isWidgetId(target)) {
      return widgetPreviewFromRect(target, slot.getBoundingClientRect(), clientX, clientY, dragged);
    }
    const grid = element.closest<HTMLElement>(".dashboard-grid");
    if (grid) {
      return { type: "grid", mode: gridDropModeFromRect(grid.getBoundingClientRect(), clientX) };
    }
    return null;
  }

  function startWidgetPointerDrag(event: ReactPointerEvent<HTMLElement>, widget: WidgetId) {
    if (!rearrangeMode) {
      return;
    }
    event.preventDefault();
    try {
      if (event.currentTarget.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    } catch {
      // Synthetic and some embedded pointer streams may not expose capture.
    }
    setDraggedWidget(widget);
    setDragPreview(null);
  }

  function moveWidgetPointerDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!rearrangeMode || !draggedWidget) {
      return;
    }
    event.preventDefault();
    updateDragPreview(dragPreviewFromClientPoint(event.clientX, event.clientY, draggedWidget));
  }

  function finishWidgetPointerDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!rearrangeMode || !draggedWidget) {
      return;
    }
    event.preventDefault();
    const preview = dragPreviewFromClientPoint(event.clientX, event.clientY, draggedWidget);
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore capture release differences between browser hosts.
    }
    dropWidgetFromPreview(preview, draggedWidget);
  }

  function cancelWidgetPointerDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!draggedWidget) {
      return;
    }
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore capture release differences between browser hosts.
    }
    setDraggedWidget(null);
    setDragPreview(null);
  }

  function startWidgetDrag(event: DragEvent, widget: WidgetId) {
    if (!rearrangeMode) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", widget);
    setDraggedWidget(widget);
    setDragPreview(null);
  }

  async function openCodexWindow(prompt?: string) {
    const promptText = prompt?.trim();
    const desktopUrl = promptText
      ? codexPromptUrl(codexSettings.openUrl, promptText)
      : codexSettings.openUrl;
    const webUrl = promptText
      ? codexPromptUrl(codexSettings.webUrl, promptText)
      : codexSettings.webUrl;
    if (isTauri()) {
      try {
        await openUrl(desktopUrl);
      } catch {
        await openUrl(webUrl);
      }
      return;
    }
    const desktopWindow = window.open(desktopUrl, "_blank", "noopener,noreferrer");
    if (!desktopWindow) {
      window.open(webUrl, "_blank", "noopener,noreferrer");
    }
  }

  async function submitCodexPrompt(event?: FormEvent) {
    event?.preventDefault();
    const prompt = codexPrompt.trim();
    if (!prompt) {
      return;
    }
    setCodexActivity({
      prompt,
      summary: summarisePrompt(prompt),
      phase: "Opening Codex",
      startedAt: Date.now(),
    });
    setCodexPrompt("");
    try {
      await openCodexWindow(prompt);
    } catch (err) {
      setError(String(err));
    }
  }

  function updateCodexApprovalMode(mode: CodexApprovalMode) {
    saveSettings({ ...settings, codexApprovalMode: mode }).catch((err) => setError(String(err)));
  }

  async function submitTerminalCommand(event?: FormEvent) {
    event?.preventDefault();
    const command = terminalInput.trim();
    if (!command || terminalRunning) {
      return;
    }

    setTerminalInput("");
    setTerminalRunning(true);
    try {
      const result = isTauri()
        ? await invoke<TerminalRunResult>("run_terminal_command", {
            request: {
              command,
              cwd: settings.terminalWorkingDirectory?.trim() || undefined,
            },
          })
        : mockTerminalCommand(command);
      setTerminalEntries((entries) => [...entries.slice(-24), { ...result, id: `terminal-${Date.now()}` }]);
    } catch (err) {
      setTerminalEntries((entries) => [
        ...entries.slice(-24),
        {
          id: `terminal-${Date.now()}`,
          command,
          cwd: settings.terminalWorkingDirectory || "~",
          stdout: "",
          stderr: String(err),
          exitCode: null,
          durationMs: 0,
        },
      ]);
    } finally {
      setTerminalRunning(false);
    }
  }

  async function disconnect(provider: Provider) {
    if (isTauri()) await invoke("save_saved_token", { provider, token: null });
    localStorage.removeItem(TOKEN_KEYS[provider]);
    setAuthStatus(`${provider} disconnected`);
    if (provider === "google") {
      setGoogleToken(null);
      setEvents([]);
    } else if (provider === "microsoft") {
      setMicrosoftToken(null);
      setEvents([]);
    } else {
      setSpotifyToken(null);
      setPlayback(null);
      setIsSavedTrack(false);
    }
  }

  async function connect(provider: Provider) {
    setError("");
    setAuthStatus(`Connecting ${provider}`);

    const clientId = (
      provider === "google"
        ? credentials.googleClientId
        : provider === "microsoft"
          ? credentials.microsoftClientId
          : credentials.spotifyClientId
    ).trim();
    if (!clientId) {
      setSetupOpen(true);
      setError(
        provider === "google"
          ? "Google Sign-In needs the app's Google OAuth client ID in keys.env or Advanced settings."
          : provider === "microsoft"
            ? "Microsoft sign-in needs an Entra application client ID in keys.env or Settings."
            : "Spotify needs a client ID in keys.env or Settings."
      );
      setAuthStatus("");
      return;
    }
    if (!isTauri()) {
      setError("OAuth login is available in the Tauri desktop app.");
      setAuthStatus("");
      return;
    }

    const redirect = parseLocalRedirectUri(
      provider === "google"
        ? credentials.googleRedirectUri
        : provider === "microsoft"
          ? credentials.microsoftRedirectUri
          : credentials.spotifyRedirectUri
    );
    const codeVerifier = randomString(96);
    const codeChallenge = await pkceChallenge(codeVerifier);
    const state = randomString(32);
    const start = await invoke<{ listenerId: string; redirectUri: string }>("start_oauth_listener", {
      preferredPort: redirect.port,
      redirectPath: redirect.path,
      redirectHost: redirect.host,
    });

    const url = provider === "google"
      ? googleAuthUrl(clientId, start.redirectUri, codeChallenge, state)
      : provider === "microsoft"
        ? microsoftAuthUrl(credentials.microsoftTenant, clientId, start.redirectUri, codeChallenge, state)
        : spotifyAuthUrl(clientId, start.redirectUri, codeChallenge, state);

    await openUrl(url);
    const callback = await waitForOAuth(start.listenerId);

    if (callback.error) {
      throw new Error(callback.error);
    }
    if (callback.state !== state || !callback.code) {
      throw new Error("OAuth response did not match the dashboard request.");
    }

    const token = await invoke<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    }>("exchange_oauth_code", {
      request: {
        provider,
        code: callback.code,
        redirectUri: start.redirectUri,
        clientId,
        clientSecret: provider === "google" ? credentials.googleClientSecret.trim() : provider === "spotify" ? credentials.spotifyClientSecret.trim() : undefined,
        scope: provider === "microsoft" ? MICROSOFT_SCOPE : undefined,
        codeVerifier,
      },
    });

    const bundle = normalizeToken(token);
    await writeToken(provider, bundle);
    if (provider === "google") {
      setGoogleToken(bundle);
    } else if (provider === "microsoft") {
      setMicrosoftToken(bundle);
    } else {
      setSpotifyToken(bundle);
    }
    setAuthStatus(`${provider} connected`);
    setSetupOpen(false);
  }

  async function waitForOAuth(listenerId: string) {
    const started = Date.now();
    while (Date.now() - started < 120_000) {
      const result = await invoke<{ code?: string; state?: string; error?: string } | null>("poll_oauth_listener", {
        listenerId,
      });
      if (result) {
        return result;
      }
      await delay(700);
    }
    throw new Error("Timed out waiting for OAuth login.");
  }

  useEffect(() => () => {
    Object.values(spotifySliderTimers.current).forEach(window.clearTimeout);
    spotifySliderTimers.current = {};
  }, [spotifyMode, playback?.item?.uri]);

  function scheduleSpotifyCommand(action: SpotifyAction, value?: number) {
    if (action !== "seek" && action !== "volume") { void spotifyCommand(action, value); return; }
    // Keep dragging responsive and send only the final value, rather than filling the local queue.
    if (action === "volume") setVolumePercent(value || 0);
    else setPlayback(current => current ? { ...current, progress_ms: value || 0, sampledAt: Date.now() } : null);
    window.clearTimeout(spotifySliderTimers.current[action]);
    spotifySliderTimers.current[action] = window.setTimeout(() => {
      delete spotifySliderTimers.current[action];
      void spotifyCommand(action, value);
    }, 180);
  }

  async function spotifyCommand(action: SpotifyAction, value?: number) {
    if (isMockMode()) {
      if (action === "save") setIsSavedTrack(current => !current);
      else if (action === "volume") setVolumePercent(value || 0);
      else setPlayback(current => current ? { ...current, is_playing: action === "toggle" ? !current.is_playing : current.is_playing, shuffle_state: action === "shuffle" ? !current.shuffle_state : current.shuffle_state, repeat_state: action === "repeat" ? ((current.repeat_state || 0) + 1) % 3 : current.repeat_state, progress_ms: action === "seek" ? value || 0 : current.progress_ms } : null);
      return;
    }
    try {
    if (playback?.source === "local") {
      if (!playback.controls?.[action]) throw new Error("This control is unavailable in the local Spotify session");
      await invoke("local_spotify_command", {action, value: localCommandValue(action, value, playback, isSavedTrack), expectedUri: playback.item?.uri || null});
      window.setTimeout(loadSpotify, 350);
      return;
    }
    if (spotifyMode === "local") return;
    const token = await ensureToken("spotify", spotifyToken);
    if (!token || currentSpotifyMode() !== spotifyMode) {
      return;
    }
    const headers = { Authorization: `Bearer ${token.accessToken}` };
    const playing = playback?.is_playing;
    const itemUri = playback?.item?.uri;
    const calls = {
      shuffle: () => fetch(`https://api.spotify.com/v1/me/player/shuffle?state=${!playback?.shuffle_state}`, { method: "PUT", headers }),
      repeat: () => fetch(`https://api.spotify.com/v1/me/player/repeat?state=${["off", "context", "track"][((playback?.repeat_state || 0) + 1) % 3]}`, { method: "PUT", headers }),
      previous: () => fetch("https://api.spotify.com/v1/me/player/previous", { method: "POST", headers }),
      toggle: () =>
        fetch(`https://api.spotify.com/v1/me/player/${playing ? "pause" : "play"}`, {
          method: playing ? "PUT" : "PUT",
          headers: playing || !itemUri ? headers : { ...headers, "Content-Type": "application/json" },
          body: playing || !itemUri ? undefined : JSON.stringify({ uris: [itemUri], position_ms: Math.max(0, Math.round(playback?.progress_ms || 0)) }),
        }),
      next: () => fetch("https://api.spotify.com/v1/me/player/next", { method: "POST", headers }),
      save: () =>
        itemUri
          ? fetch(`https://api.spotify.com/v1/me/library?uris=${encodeURIComponent(itemUri)}`, {
              method: isSavedTrack ? "DELETE" : "PUT",
              headers,
            })
          : Promise.resolve(new Response()),
      seek: () =>
        fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${Math.round(value || 0)}`, {
          method: "PUT",
          headers,
        }),
      volume: () =>
        fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${Math.max(0, Math.min(100, Math.round(value || 0)))}`, {
          method: "PUT",
          headers,
        }),
    };
    const response = await calls[action]();
    if (!response.ok) throw new Error(`Spotify declined ${action}: ${response.status}`);
    if (action === "save") {
      setIsSavedTrack((current) => !current);
    }
    if (action === "volume") {
      setVolumePercent(Math.max(0, Math.min(100, Math.round(value || 0))));
    }
    spotifyNextApiRead.current = 0;
    window.setTimeout(loadSpotify, 500);
    } catch (error) { setError(String(error)); }
  }

  async function loadWeather(location: WeatherLocation, signal?: AbortSignal) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(location.latitude));
    url.searchParams.set("longitude", String(location.longitude));
    url.searchParams.set("current", "temperature_2m,apparent_temperature,precipitation");
    url.searchParams.set("hourly", "temperature_2m,apparent_temperature,precipitation,precipitation_probability");
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_sum,precipitation_probability_max,sunrise,sunset");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("forecast_days", "5");
    url.searchParams.set("past_hours", "24");
    const response = await fetch(url, { signal, cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`Weather request failed: ${response.status}`);
    }
    const data = await response.json();
    if (signal?.aborted) return;
    const days = buildWeatherDays(data);
    const today = days[0] || {
      date: new Date().toISOString(),
      minTemp: 0,
      maxTemp: 0,
      uvIndex: 0,
      precipTotal: 0,
      precipProbability: 0,
      hourly: [],
    };
    const currentWeatherTime = String(data.current?.time || "");
    const rainHistory = (data.hourly?.time || [])
      .map((time: string, index: number) => ({ time, value: Number(data.hourly?.precipitation?.[index] ?? 0) }))
      .filter((item: { time: string }) => !currentWeatherTime || item.time <= currentWeatherTime)
      .slice(-24);
    weatherLoadedLocation.current = `${location.latitude},${location.longitude}`;
    setWeather({
      timezone: typeof data.timezone === "string" ? data.timezone : undefined,
      currentTemp: Math.round(data.current?.temperature_2m ?? 0),
      feelsLikeTemp: Math.round(data.current?.apparent_temperature ?? data.current?.temperature_2m ?? 0),
      minTemp: today.minTemp,
      maxTemp: today.maxTemp,
      uvIndex: today.uvIndex,
      precipTotal: today.precipTotal,
      precipProbability: today.precipProbability,
      hourlyPrecip: today.hourly.map((hour) => ({ time: hour.time, value: hour.precip })),
      rainHistory,
      days,
      alert: weatherAlertText(
        today.precipTotal,
        today.uvIndex,
        today.precipProbability
      ),
    });
    return { date: today.date, timezone: typeof data.timezone === "string" ? data.timezone : undefined };
  }

  async function findWeatherLocation(query: string): Promise<WeatherLocation | null> {
    const trimmed = query.trim();
    if (!trimmed) {
      return null;
    }
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", trimmed);
    url.searchParams.set("count", "1");
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Location search failed: ${response.status}`);
    }
    const data = await response.json();
    const result = data.results?.[0];
    if (!result) {
      throw new Error(`No weather location found for "${trimmed}"`);
    }
    return {
      name: result.name,
      latitude: result.latitude,
      longitude: result.longitude,
      country: result.country,
      admin1: result.admin1,
    };
  }

  async function searchWeatherLocation(query: string) {
    setWeatherSearching(true);
    try {
      const location = await findWeatherLocation(query);
      if (!location) {
        return;
      }
      await saveSettings({ ...settings, weatherLocation: location });
      await loadWeather(location);
      setWeatherQuery("");
    } finally {
      setWeatherSearching(false);
    }
  }

  async function resolveCurrentWeatherLocation(): Promise<WeatherLocation> {
    if (!navigator.geolocation) {
      throw new Error("Location services are not available in this webview.");
    }
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 10_000 });
    });
    return resolveWeatherLocation(position.coords.latitude, position.coords.longitude);
  }

  async function useCurrentWeatherLocation() {
    const location = await resolveCurrentWeatherLocation();
    await saveSettings({ ...settings, weatherLocation: location });
    await loadWeather(location);
  }

  const monthLabel = currentDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const filteredEvents = events.filter(eventMatchesSearch);
  const selectedCalendarEvent = events.find((event) => event.id === expandedEventId);
  const upcomingReminder = useMemo(() => {
    const nowMs = now.getTime();
    return events
      .filter((event) => event.start.dateTime && !dismissedReminderIds.includes(event.id))
      .map((event) => ({ event, startsAt: eventStartDate(event).getTime() }))
      .filter(({ startsAt }) => startsAt >= nowMs && startsAt - nowMs <= 5 * 60_000)
      .sort((a, b) => a.startsAt - b.startsAt)[0]?.event || null;
  }, [dismissedReminderIds, events, now]);
  const clockAgenda = useMemo<ClockAgendaItem[]>(() => events.map((event) => ({
    id: event.id,
    title: event.summary || "Untitled event",
    description: event.description,
    location: event.location,
    calendarName: event.calendarSummary,
    organizer: event.organizer?.displayName || event.organizer?.email,
    attendees: (event.attendees || []).filter((attendee) => !attendee.self).map((attendee) => attendee.displayName || attendee.email).filter((value): value is string => Boolean(value)),
    startDate: event.start.date,
    startDateTime: event.start.dateTime,
    endDate: event.end.date,
    endDateTime: event.end.dateTime,
    color: event.calendarColor,
  })), [events]);
  const renderCalendarSourceGroup = (key: "my" | "other", title: string, group: CalendarSource[]) => {
    if (!group.length) {
      return null;
    }
    const groupOpen = calendarSourceGroupsOpen[key];
    const selectedCount = group.filter(calendarSourceSelected).length;

    return (
      <section className="calendar-source-group" key={key}>
        <div className="source-group-header">
          <button
            className="source-group-toggle"
            onClick={() => setCalendarSourceGroupsOpen((open) => ({ ...open, [key]: !open[key] }))}
            title={`${groupOpen ? "Collapse" : "Expand"} ${title}`}
          >
            <ChevronDown size={14} className={groupOpen ? "" : "collapsed"} />
            <span>{title}</span>
          </button>
          <button
            className="source-group-action"
            onClick={() => setCalendarGroupSelected(group, selectedCount !== group.length)}
          >
            {selectedCount === group.length ? "None" : "All"}
          </button>
        </div>
        {groupOpen ? (
          <div className="source-list">
            {group.map((source) => (
              <label className="source-row" key={source.id} title={source.summary}>
                <input
                  type="checkbox"
                  checked={calendarSourceSelected(source)}
                  onChange={() => toggleCalendarSource(source.id)}
                />
                <span className="source-swatch" style={{ background: source.backgroundColor || "#8ab4f8" }} />
                <span>{source.summary}</span>
              </label>
            ))}
          </div>
        ) : null}
      </section>
    );
  };

  return (
    <main
      className={`app-shell app-scale-${appScale} ${railPeekOpen ? "rail-peek-open" : "rail-peek-closed"} ${rearrangeMode ? "rearrange-mode" : ""} ${draggedWidget ? "dragging-widget" : ""}`}
      style={{ "--app-scale": appScale / 100 } as CSSProperties}
    >
      <aside
        className="rail"
        onPointerEnter={showRail}
        onPointerLeave={scheduleRailHide}
        onFocusCapture={showRail}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            scheduleRailHide();
          }
        }}
        onKeyDown={showRail}
      >
        {WIDGET_FEATURE_FLAGS.calendar ? <button className={`rail-button ${railWidgetActive("calendar") ? "active" : ""}`} title="Calendar" aria-pressed={railWidgetActive("calendar")} onClick={() => toggleWidget("calendar")}>
          <CalendarDays size={20} />
        </button> : null}
        {WIDGET_FEATURE_FLAGS.clock ? <button className={`rail-button ${railWidgetActive("clock") ? "active" : ""}`} title="Clock" aria-pressed={railWidgetActive("clock")} onClick={() => toggleWidget("clock")}>
          <Clock3 size={20} />
        </button> : null}
        {WIDGET_FEATURE_FLAGS.spotify ? <button className={`rail-button ${railWidgetActive("spotify") ? "active" : ""}`} title="Spotify" aria-pressed={railWidgetActive("spotify")} onClick={() => toggleWidget("spotify")}>
          <ListMusic size={20} />
        </button> : null}
        {WIDGET_FEATURE_FLAGS.weather ? <button className={`rail-button ${railWidgetActive("weather") ? "active" : ""}`} title="Weather" aria-pressed={railWidgetActive("weather")} onClick={() => toggleWidget("weather")}>
          <CloudSun size={20} />
        </button> : null}
        {WIDGET_FEATURE_FLAGS.aircraft ? <button className={`rail-button ${railWidgetActive("aircraft") ? "active" : ""}`} title="Live aircraft" aria-pressed={railWidgetActive("aircraft")} onClick={() => toggleWidget("aircraft")}>
          <Plane size={20} />
        </button> : null}
        {WIDGET_FEATURE_FLAGS.codex ? <button className={`rail-button ${railWidgetActive("codex") ? "active" : ""}`} title="Codex" onClick={() => toggleWidget("codex")}>
          <Bot size={20} />
        </button> : null}
        {WIDGET_FEATURE_FLAGS.terminal ? <button className={`rail-button ${railWidgetActive("terminal") ? "active" : ""}`} title="Terminal" aria-pressed={railWidgetActive("terminal")} onClick={() => toggleWidget("terminal")}>
          <Terminal size={20} />
        </button> : null}
        <button className={`rail-button rail-arrange ${rearrangeMode ? "active" : ""}`} title="Arrange widgets" onClick={() => setRearrangeMode((mode) => !mode)}>
          <LayoutGrid size={19} />
        </button>
        <button className="rail-button bottom rail-settings" title="Settings" onClick={() => setSetupOpen(true)}>
          <Settings size={19} />
        </button>
      </aside>

      <section
        className={`dashboard-grid widget-count-${dashboardWidgets.length} ${dashboardWidgets.length ? "" : "empty-dashboard-grid"} ${dragPreview?.type === "grid" ? `grid-preview-${dragPreview.mode}` : ""}`}
        onDragOver={(event) => {
          if (!rearrangeMode || !draggedWidget) {
            return;
          }
          event.preventDefault();
          if (isDraggingOverSource(event, draggedWidget)) {
            event.dataTransfer.dropEffect = "none";
            updateDragPreview(null);
            return;
          }
          event.dataTransfer.dropEffect = "move";
          updateDragPreview({ type: "grid", mode: gridDropModeFromPointer(event) });
        }}
        onDrop={(event) => {
          if (!rearrangeMode || !draggedWidget) {
            return;
          }
          event.preventDefault();
          if (isDraggingOverSource(event, draggedWidget)) {
            setDraggedWidget(null);
            setDragPreview(null);
            return;
          }
          dropWidgetOnGrid(gridDropModeFromPointer(event));
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            updateDragPreview(null);
          }
        }}
      >
        {rearrangeMode && draggedWidget ? (
          <div className="grid-drop-guides" aria-hidden="true">
            <div className="grid-empty-lanes">
              <span className="grid-empty-lane" />
              <span className="grid-empty-lane" />
              <span className="grid-empty-lane" />
            </div>
            {dragPreview?.type === "grid" ? (
              <span className={`grid-drop-zone active ${gridDropClass(dragPreview.mode)}`}>
                <strong>{gridDropTitle(dragPreview.mode)}</strong>
                <small>{gridDropSubtitle(dragPreview.mode)}</small>
              </span>
            ) : null}
          </div>
        ) : null}
        {!dashboardWidgets.length ? <IdleDashboard
          kind={normalizeIdleBackground(settings.idleBackground)}
          location={settings.idleMapLocation || settings.weatherLocation}
          slideshowFolder={settings.idleSlideshowFolder}
          slideshowFit={normalizeSlideshowFit(settings.idleSlideshowFit)}
          contentVisible={emptyDashboardContentVisible}
          onShowWidgets={() => { showRail(); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".rail-button")?.focus()); }}
          onKindChange={(idleBackground) => saveSettings({ ...settings, idleBackground }).catch((err) => setError(String(err)))}
        /> : null}
        {dashboardEntries.map(({ widget, gridColumn, gridRow }) => (
          <div
            key={widget}
            data-widget={widget}
            style={{ gridColumn, gridRow }}
            className={`widget-slot dashboard-widget widget-size-${widgetSize(widget)} ${draggedWidget === widget ? "drag-source" : ""} ${dragPreview?.type === "split" && dragPreview.target === widget ? `split-preview split-${dragPreview.position}` : ""} ${dragPreview?.type === "bump" && dragPreview.target === widget ? `bump-preview bump-${dragPreview.side}` : ""}`}
            onDragEnd={() => {
              setDraggedWidget(null);
              setDragPreview(null);
            }}
            onDragOver={(event) => {
              if (rearrangeMode && draggedWidget === widget) {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "none";
                updateDragPreview(null);
              } else if (rearrangeMode && draggedWidget) {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                updateDragPreview(widgetPreviewFromPointer(widget, event, draggedWidget));
              }
            }}
            onPointerUp={(event) => {
              if (rearrangeMode && draggedWidget && draggedWidget !== widget) {
                dropWidgetOnTarget(widget, widgetPreviewFromPointer(widget, event, draggedWidget), draggedWidget);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const dragged = event.dataTransfer.getData("text/plain");
              const draggedId = isWidgetId(dragged) ? dragged : draggedWidget;
              dropWidgetOnTarget(widget, widgetPreviewFromPointer(widget, event, draggedId), draggedId);
            }}
          >
            {dragPreview?.type === "bump" && dragPreview.target === widget ? (
              <div className={`bump-drop-indicator ${dragPreview.side}`}>
                <span>
                  <strong>{dragPreview.side === "before" ? "Move before" : "Move after"}</strong>
                  <small>Neighbours will shift</small>
                </span>
              </div>
            ) : null}
            {dragPreview?.type === "split" && dragPreview.target === widget ? (
              <div className={`split-drop-indicator ${dragPreview.position}`}>
                <span>
                  <strong>{dragPreview.position === "top" ? "Stack above" : "Stack below"}</strong>
                  <small>Split this 1/3 column</small>
                </span>
              </div>
            ) : null}
            {rearrangeMode ? (
              <div className="widget-layout-bar">
                <button
                  className="drag-handle"
                  title="Drag to move"
                  aria-label="Drag to move"
                  draggable={false}
                  onDragStart={(event) => startWidgetDrag(event, widget)}
                  onPointerDown={(event) => startWidgetPointerDrag(event, widget)}
                  onPointerMove={moveWidgetPointerDrag}
                  onPointerUp={finishWidgetPointerDrag}
                  onPointerCancel={cancelWidgetPointerDrag}
                >
                  <Grip size={16} />
                </button>
                <span>{widgetLabel(widget)}</span>
                <button className="layout-hide-button" title={`Hide ${widgetLabel(widget)}`} onClick={() => hideWidget(widget)}>
                  <X size={15} />
                </button>
              </div>
            ) : null}
            {widget === "clock" ? (
              <ClockWidget
                size={widgetSize("clock")}
                timeZone={normalizeClockTimeZone(settings.clockTimeZone)}
                faceMode={normalizeClockFaceMode(settings.clockFaceMode)}
                agenda={clockAgenda}
                onTimeZoneChange={(clockTimeZone) => saveSettings({ ...settings, clockTimeZone }).catch((err) => setError(String(err)))}
                onFaceModeChange={(clockFaceMode) => saveSettings({ ...settings, clockFaceMode }).catch((err) => setError(String(err)))}
                onClose={() => hideWidget("clock")}
              />
            ) : widget === "calendar" ? (
              <section className={`calendar-panel calendar-widget-size-${widgetSize(widget)} calendar-style-${calendarStyle}`}>
                <header className="topbar">
                  <button className="today-button" onClick={() => { refreshCalendarClock(); setCalendarFollowsToday(true); }}>Today</button>
                  <button className="icon-button" title="Previous" onClick={() => { setCalendarFollowsToday(false); setCurrentDate(addDays(currentDate, viewMode === "day" ? -1 : -7)); }}>
                    <ChevronLeft size={21} />
                  </button>
                  <button className="icon-button" title="Next" onClick={() => { setCalendarFollowsToday(false); setCurrentDate(addDays(currentDate, viewMode === "day" ? 1 : 7)); }}>
                    <ChevronRight size={21} />
                  </button>
                  <div className="date-heading">
                    <h1>{monthLabel}</h1>
                  </div>
                  <div className="topbar-spacer" />
                  <button className={`icon-button ${searchOpen ? "active" : ""}`} title="Search" onClick={() => setSearchOpen((open) => !open)}>
                    <Search size={19} />
                  </button>
                  {searchOpen ? (
                    <input
                      className="calendar-search"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          submitCalendarSearch();
                        }
                      }}
                      placeholder="Search"
                      autoFocus
                    />
                  ) : null}
                  <button className={`icon-button calendar-sources-button ${calendarSourcePanelOpen ? "active" : ""}`} title={calendarSourcePanelOpen ? "Hide calendars" : "Show calendars"} aria-expanded={calendarSourcePanelOpen} onClick={() => setCalendarSourcePanelOpen(open => !open)}><CalendarDays size={17} /></button>
                  <div className="segmented">
                    <button className={viewMode === "day" ? "selected" : ""} aria-pressed={viewMode === "day"} onClick={() => setViewMode("day")}>Day</button>
                    <button className={viewMode === "work" ? "selected" : ""} aria-pressed={viewMode === "work"} title="Work: Monday–Friday, 9 AM–6 PM" onClick={() => setViewMode("work")}>Work</button>
                    <button className={viewMode === "week" ? "selected" : ""} aria-pressed={viewMode === "week"} onClick={() => setViewMode("week")}>Week</button>
                  </div>
                  <select className="calendar-view-select" aria-label="Calendar view" value={viewMode} onChange={event => setViewMode(normalizeCalendarView(event.target.value))}><option value="day">Day</option><option value="work">Work</option><option value="week">Week</option></select>
                  <button className="icon-button" title="Hide Calendar" onClick={() => hideWidget("calendar")}>
                    <X size={18} />
                  </button>
                </header>

                <div className={`calendar-card ${calendarSourcePanelOpen ? "sources-open" : "sources-collapsed"}`}>
                  {calendarSourcePanelOpen ? <aside className="calendar-source-sidebar"><div className="calendar-source-heading">Calendars</div><div className="source-panel-content">{renderCalendarSourceGroup("my", "My calendars", calendarSourceGroups.my)}{renderCalendarSourceGroup("other", "Other calendars", calendarSourceGroups.other)}</div></aside> : null}
                  <CalendarTimeline workMode={viewMode === "work"} days={visibleDays} events={filteredEvents} timeZone={credentials.googleCalendarTimeZone} now={now} selectedId={expandedEventId} onSelect={(id) => setExpandedEventId(current => current === id ? null : id)} />
                  {selectedCalendarEvent ? <>
                    <button className="calendar-event-backdrop" aria-label="Close meeting details" onClick={() => setExpandedEventId(null)} />
                    <CalendarEventDetails key={selectedCalendarEvent.id} event={selectedCalendarEvent} timeZone={credentials.googleCalendarTimeZone} onClose={() => setExpandedEventId(null)} />
                  </> : null}
                </div>
              </section>
            ) : widget === "spotify" ? (
              <SpotifyPanel
                playback={playback}
                isSavedTrack={isSavedTrack}
                onCommand={scheduleSpotifyCommand}
                onConnect={() => connect("spotify").catch((err) => setError(String(err)))}
                connected={playback?.source === "local" || (spotifyMode !== "local" && Boolean(spotifyToken))}
                localMode={spotifyMode !== "api"}
                localStatus={localSpotifyStatus}
                onOpenSpotify={() => invoke("open_local_spotify").catch(error => setError(String(error)))}
                onFocus={() => focusWidget("spotify")}
                onClose={() => hideWidget("spotify")}
                hideAlbumArt={Boolean(settings.spotifyHideAlbumArt)}
                onHideAlbumArtChange={(spotifyHideAlbumArt) => saveSettings({ ...settings, spotifyHideAlbumArt }).catch((err) => setError(String(err)))}
                volumePercent={volumePercent}
                compact={widgetCompact("spotify")}
              />
            ) : widget === "weather" ? (
              <WeatherPanel
                location={settings.weatherLocation}
                weather={weather}
                weatherNow={weatherNow}
                query={weatherQuery}
                searching={weatherSearching}
                compact={widgetCompact("weather")}
                narrow={widgetSize("weather") === "tall"}
                onFocus={() => focusWidget("weather")}
                onClose={() => hideWidget("weather")}
                onQueryChange={setWeatherQuery}
                onSearch={() => searchWeatherLocation(weatherQuery).catch((err) => setError(String(err)))}
                onUseCurrentLocation={() => useCurrentWeatherLocation().catch((err) => setError(friendlyWeatherError(err)))}
                onChangeLocation={() => saveSettings({ ...settings, weatherLocation: undefined })}
              />
            ) : widget === "aircraft" ? (
              <AircraftPanel
                aircraft={aircraft}
                error={aircraftError}
                location={settings.adsbLocation || settings.weatherLocation}
                graphicOnly={Boolean(settings.adsbGraphicOnly)}
                compact={widgetCompact("aircraft")}
                onGraphicOnlyChange={(graphicOnly) => saveSettings({ ...settings, adsbGraphicOnly: graphicOnly })}
                onLocationChange={(location) => saveSettings({ ...settings, adsbLocation: location })}
                onUseCurrentLocation={() => resolveCurrentWeatherLocation().then((location) => saveSettings({ ...settings, adsbLocation: location })).catch((err) => setError(friendlyWeatherError(err)))}
                onFocus={() => focusWidget("aircraft")}
                onClose={() => hideWidget("aircraft")}
              />
            ) : widget === "codex" ? (
              <CodexPanel
                activity={codexActivity}
                now={now}
                prompt={codexPrompt}
                accountEmail={codexSettings.accountEmail}
                approvalMode={codexSettings.approvalMode}
                compact={widgetCompact("codex")}
                connected={false}
                onPromptChange={setCodexPrompt}
                onSubmit={submitCodexPrompt}
                onOpen={() => openCodexWindow().catch((err) => setError(String(err)))}
                onApprovalModeChange={updateCodexApprovalMode}
                onFocus={() => focusWidget("codex")}
                onClose={() => hideWidget("codex")}
              />
            ) : (
              <TerminalPanel
                entries={terminalEntries}
                input={terminalInput}
                running={terminalRunning}
                compact={widgetCompact("terminal")}
                wide={widgetSize("terminal") === "wide" || widgetSize("terminal") === "full"}
                workingDirectory={settings.terminalWorkingDirectory}
                onInputChange={setTerminalInput}
                onSubmit={submitTerminalCommand}
                onFocus={() => focusWidget("terminal")}
                onClose={() => hideWidget("terminal")}
              />
            )}
          </div>
        ))}
      </section>

      {setupOpen ? (
          <SetupOverlay
          settings={settings}
          env={env}
          googleConnected={Boolean(googleToken)}
          microsoftConnected={Boolean(microsoftToken)}
          spotifyConnected={Boolean(spotifyToken)}
            googleClientSource={googleClientSource}
            activeGoogleClientId={credentials.googleClientId}
            calendarTimeZone={credentials.googleCalendarTimeZone}
          status={authStatus}
          error={error}
          onSave={saveSettings}
          onClose={() => setSetupOpen(false)}
          onConnect={(provider) => connect(provider).catch((err) => setError(friendlyAuthError(String(err), credentials.googleClientId, googleClientSource)))}
          onDisconnect={(provider) => disconnect(provider).catch(err => setError(String(err)))}
          onFindWeatherLocation={findWeatherLocation}
          onResolveCurrentWeatherLocation={resolveCurrentWeatherLocation}
          onSaveLayout={(layout) => saveSettings({ ...settings, widgetLayout: layout })}
          widgetLayout={widgetLayout}
          onOpenCodex={() => openCodexWindow().catch((err) => setError(String(err)))}
          onToggleFullscreen={() => toggleFullscreen().catch((err) => setError(String(err)))}
          availableUpdate={availableUpdate}
          previousRelease={previousRelease}
          downloadedUpdate={downloadedUpdate}
          updateStatus={updateStatus}
          updateBusy={updateBusy}
          canAutoInstall={canAutoInstall}
          onCheckForUpdates={(githubToken) => checkForUpdates(githubToken)}
          onDownloadUpdate={() => downloadAvailableUpdate()}
          onInstallUpdate={(installOnReboot) => installDownloadedUpdate(undefined, installOnReboot)}
          onCheckForRollback={(githubToken) => checkForRollback(githubToken)}
          onRollback={() => rollbackToPreviousRelease()}
        />
      ) : null}
      {upcomingReminder ? (
        <MeetingReminder event={upcomingReminder} onDismiss={() => setDismissedReminderIds((ids) => [...ids, upcomingReminder.id])} />
      ) : null}
      {availableUpdate && dismissedUpdateVersion !== availableUpdate.version && !setupOpen ? (
        <div className="update-notice" role="status" aria-live="polite">
          <span>Daily Dashboard {availableUpdate.version} is available.</span>
          <button onClick={() => openUrl(availableUpdate.releaseUrl).catch(err => setError(String(err)))}>View release</button>
          <button aria-label="Dismiss update notification" onClick={() => setDismissedUpdateVersion(availableUpdate.version)}>×</button>
        </div>
      ) : null}
      {error && !setupOpen ? <div className={`toast ${toastVisible ? "show" : "hide"}`}>{error}</div> : null}
    </main>
  );
}

function SpotifyPanel({
  playback,
  isSavedTrack,
  onCommand,
  onConnect,
  connected,
  onFocus,
  onClose,
  volumePercent,
  compact,
  hideAlbumArt,
  onHideAlbumArtChange,
  localMode,
  localStatus,
  onOpenSpotify,
}: {
  playback: PlaybackState | null;
  isSavedTrack: boolean;
  onCommand: (action: SpotifyAction, value?: number) => void;
  onConnect: () => void;
  connected: boolean;
  onFocus: () => void;
  onClose: () => void;
  volumePercent: number;
  compact: boolean;
  hideAlbumArt: boolean;
  onHideAlbumArtChange: (hidden: boolean) => void;
  localMode: boolean; localStatus: string; onOpenSpotify: () => void;
}) {
  const [, refreshProgress] = useState(0);
  useEffect(() => { if (!playback?.is_playing || !playback.sampledAt) return; const timer = window.setInterval(() => refreshProgress(v => v + 1), 500); return () => window.clearInterval(timer); }, [playback?.is_playing, playback?.sampledAt]);
  const can = (action: SpotifyAction) => connected && (playback?.source !== "local" || Boolean(playback.controls?.[action]));
  const progressMs = Math.min(playback?.item?.duration_ms || 0, (playback?.progress_ms || 0) + (playback?.is_playing && playback.sampledAt ? Math.max(0, Date.now() - playback.sampledAt) : 0));
  const track = playback?.item;
  const image = track?.images[0]?.url;
  const progress = playback && track ? Math.min(progressMs / Math.max(1, track.duration_ms), 1) : 0;

  return (
    <section className={`widget-panel spotify-panel ${compact ? "compact" : ""} ${hideAlbumArt || !track ? "without-art" : "with-art"} ${!connected ? "is-disconnected" : ""}`} onDoubleClick={onFocus}>
      <div className="spotify-header">
        <span className="widget-title"><ListMusic size={16} /><span>Spotify</span></span>
        <div className="spotify-header-actions">
        <button className="icon-button album-art-toggle" title={hideAlbumArt ? "Show album art" : "Hide album art"} aria-pressed={hideAlbumArt} aria-label="Hide album art" onClick={() => onHideAlbumArtChange(!hideAlbumArt)}>{hideAlbumArt ? <ImageOff size={16} /> : <ImageIcon size={16} />}</button>
        <button className="icon-button" title="Hide Spotify" onClick={onClose}>
          <X size={18} />
        </button>
        </div>
      </div>
      {!hideAlbumArt && track ? <div className="cover-wrap">
        {image ? <img src={image} alt="" className="album-cover" /> : <div className="album-cover placeholder" aria-hidden="true"><ListMusic size={40} /></div>}
      </div> : null}
      <div className="track-copy">
        {track ? (
          <>
            <strong>{track.name}</strong>
            <span>{track.subtitle}</span>
            <small>{track.caption}</small>
          </>
        ) : (
          <>
            <strong>{connected ? "No track available" : localMode ? "Open Spotify" : "Spotify not connected"}</strong>
            <span>{connected ? "Start a track in Spotify." : localMode ? localStatus : "Connect Spotify to show playback."}</span>
            <small>{connected ? playback?.status || "Waiting for Spotify" : localMode ? "Local controls · no API login needed" : "Not connected"}</small>
          </>
        )}
      </div>
      {!connected ? <button className="spotify-connect-button" onClick={localMode ? onOpenSpotify : onConnect}>{localMode ? "Open Spotify" : "Connect Spotify"}</button> : null}
      <input
        className="scrubber"
        type="range"
        min={0}
        max={track?.duration_ms || 1}
        value={track ? progressMs : 0}
        onChange={(event) => track ? onCommand("seek", Number(event.currentTarget.value)) : undefined}
        style={{ backgroundSize: `${progress * 100}% 100%` }}
        aria-label="Seek"
        disabled={!track || !can("seek")}
      />
      <div className="time-row">
        <span>{formatMs(track ? progressMs : 0)}</span>
        {playback?.status ? <span className="playback-status">{playback.status}</span> : <span />}
        <span>{formatMs(track?.duration_ms || 0)}</span>
      </div>
      <div className="player-controls">
        <div className="extra-controls left">
          <button className={`icon-button ${isSavedTrack ? "liked" : ""}`} title={can("save") ? "Favourite" : "Like requires the local Spotify connector (Settings → Music)"} aria-label="Favourite" aria-pressed={isSavedTrack} onClick={() => onCommand("save")} disabled={!track || !can("save")}>
            <Heart size={18} fill={isSavedTrack ? "currentColor" : "none"} />
          </button>
        </div>
        <div className="transport-controls">
          <button className={`icon-button shuffle-button ${playback?.shuffle_state ? "selected" : ""}`} title="Shuffle" aria-pressed={Boolean(playback?.shuffle_state)} onClick={() => onCommand("shuffle")} disabled={!can("shuffle")}><Shuffle size={15} /></button>
          <button className="icon-button" title="Previous" onClick={() => onCommand("previous")} disabled={!can("previous")}>
            <SkipBack size={19} />
          </button>
          <button className="play-button" title={playback?.is_playing ? "Pause" : "Play"} onClick={() => onCommand("toggle")} disabled={!can("toggle")}>
            {playback?.is_playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <button className="icon-button" title="Next" onClick={() => onCommand("next")} disabled={!can("next")}>
            <SkipForward size={19} />
          </button>
          <button className={`icon-button repeat-button ${playback?.repeat_state ? "selected" : ""}`} title="Repeat" aria-label={playback?.repeat_state === 2 ? "Repeat one" : "Repeat"} aria-pressed={Boolean(playback?.repeat_state)} onClick={() => onCommand("repeat")} disabled={!can("repeat")}>{playback?.repeat_state === 2 ? <Repeat1 size={15} /> : <Repeat size={15} />}</button>
        </div>
        <div className="extra-controls right">
          <VolumeControl value={volumePercent} disabled={!can("volume")} onChange={(value) => onCommand("volume", value)} />
        </div>
      </div>
    </section>
  );
}

function VolumeControl({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (value: number) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="volume-control" onMouseEnter={() => setOpen(true)}>
      <button className="icon-button" title="Volume" disabled={disabled} onClick={() => setOpen((current) => !current)}>
        <Volume2 size={18} />
      </button>
      {open && !disabled ? (
        <div className="volume-popover" onMouseLeave={() => setOpen(false)}>
          <input
            className="volume-slider"
            type="range"
            min={0}
            max={100}
            value={value}
            onChange={(event) => onChange(Number(event.currentTarget.value))}
            style={{ backgroundSize: `${value}% 100%` }}
            aria-label="Volume"
          />
        </div>
      ) : null}
    </div>
  );
}

function CodexPanel({
  activity,
  now,
  prompt,
  accountEmail,
  approvalMode,
  compact,
  connected,
  onPromptChange,
  onSubmit,
  onOpen,
  onApprovalModeChange,
  onFocus,
  onClose,
}: {
  activity: CodexActivity;
  now: Date;
  prompt: string;
  accountEmail: string;
  approvalMode: CodexApprovalMode;
  compact: boolean;
  connected: boolean;
  onPromptChange: (value: string) => void;
  onSubmit: (event?: FormEvent) => void;
  onOpen: () => void;
  onApprovalModeChange: (mode: CodexApprovalMode) => void;
  onFocus: () => void;
  onClose: () => void;
}) {
  const workingFor = activity.startedAt ? formatElapsed(now.getTime() - activity.startedAt) : "0m";
  const usageLabel = connected ? "Open Codex" : "Sign in";

  return (
    <section className={`widget-panel codex-panel ${compact ? "compact" : ""}`} onDoubleClick={onFocus}>
      <div className="codex-header">
        <div>
          <span className="widget-title"><Bot size={16} /><span>Codex</span></span>
          <small>{accountEmail || "OpenAI account"}</small>
        </div>
        <div className="codex-header-actions">
          <button className="icon-button" title="Open Codex" onClick={onOpen}>
            <ExternalLink size={17} />
          </button>
          <button className="icon-button" title="Hide Codex" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="codex-content" role="region" aria-label="Codex activity" tabIndex={0}>
        <div className="codex-usage">
          <div>
            <span>5h limit</span>
            <strong>{usageLabel}</strong>
          </div>
          <div>
            <span>Reset</span>
            <strong>{connected ? "In Codex" : "--"}</strong>
          </div>
          <div>
            <span>Weekly</span>
            <strong>{usageLabel}</strong>
          </div>
        </div>

        <div className="codex-progress">
          <div className="codex-phase">
            <Bot size={17} />
            <div>
              <strong>{activity.phase}</strong>
              <span>{activity.startedAt ? `Working ${workingFor}` : "Waiting"}</span>
            </div>
          </div>
          <p>{activity.summary}</p>
          {activity.prompt ? <small>{activity.prompt}</small> : null}
        </div>

        <div className="codex-approvals">
          <label>
            <span><ShieldCheck size={14} /> Action approvals</span>
            <select value={approvalMode} onChange={(event) => onApprovalModeChange(normalizeCodexApprovalMode(event.currentTarget.value))}>
              {Object.entries(CODEX_APPROVAL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <div className="codex-approval-card">
            {activity.pendingApproval ? (
              <>
                <strong>{activity.pendingApproval.title}</strong>
                <span>{activity.pendingApproval.detail}</span>
              </>
            ) : (
              <>
                <strong>No approvals waiting</strong>
                <span>{CODEX_APPROVAL_LABELS[approvalMode]}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <form className="codex-composer" onSubmit={onSubmit}>
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Ask Codex"
        />
        <button className="play-button" title="Send to Codex" disabled={!prompt.trim()}>
          <Send size={18} />
        </button>
      </form>
    </section>
  );
}

function TerminalPanel({
  entries,
  input,
  running,
  compact,
  wide,
  workingDirectory,
  onInputChange,
  onSubmit,
  onFocus,
  onClose,
}: {
  entries: TerminalEntry[];
  input: string;
  running: boolean;
  compact: boolean;
  wide: boolean;
  workingDirectory?: string;
  onInputChange: (value: string) => void;
  onSubmit: (event?: FormEvent) => void;
  onFocus: () => void;
  onClose: () => void;
}) {
  return (
    <section className={`widget-panel terminal-panel ${compact ? "compact" : ""} ${wide ? "wide" : ""}`} onDoubleClick={onFocus}>
      <div className="terminal-header">
        <div>
          <span className="widget-title"><Terminal size={16} /><span>Command Line</span></span>
          <small>{workingDirectory?.trim() || "System shell"}</small>
        </div>
        <button className="icon-button" title="Hide Command Line" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="terminal-screen" aria-live="polite">
        {entries.length ? entries.map((entry) => (
          <div className="terminal-entry" key={entry.id}>
            <div className="terminal-prompt">
              <span>{entry.cwd}</span>
              <strong>$ {entry.command}</strong>
            </div>
            {entry.stdout ? <pre>{entry.stdout}</pre> : null}
            {entry.stderr ? <pre className="terminal-error">{entry.stderr}</pre> : null}
            <small>{entry.exitCode === null ? "failed" : `exit ${entry.exitCode}`} · {formatElapsed(entry.durationMs)}</small>
          </div>
        )) : (
          <div className="terminal-empty">
            <Terminal size={20} />
            <span>Ready</span>
          </div>
        )}
        {running ? <div className="terminal-running">Running...</div> : null}
      </div>
      <form className="terminal-composer" onSubmit={onSubmit}>
        <span>$</span>
        <input
          value={input}
          onChange={(event) => onInputChange(event.currentTarget.value)}
          placeholder="Type a command"
          aria-label="Shell command"
          spellCheck={false}
        />
        <button className="play-button" title="Run command" disabled={!input.trim() || running}>
          <Send size={17} />
        </button>
      </form>
    </section>
  );
}

function AircraftPanel({
  aircraft,
  error,
  location,
  graphicOnly,
  compact,
  onGraphicOnlyChange,
  onLocationChange,
  onUseCurrentLocation,
  onFocus,
  onClose,
}: {
  aircraft: Aircraft[];
  error: string;
  location?: WeatherLocation;
  graphicOnly: boolean;
  compact: boolean;
  onGraphicOnlyChange: (value: boolean) => void;
  onLocationChange: (location: WeatherLocation) => void;
  onUseCurrentLocation: () => void;
  onFocus: () => void;
  onClose: () => void;
}) {
  const fallback = location || { name: "Melbourne", latitude: -37.8136, longitude: 144.9631 };
  const [center, setCenter] = useState({ latitude: fallback.latitude, longitude: fallback.longitude });
  const [zoom, setZoom] = useState(7);
  const [monochrome, setMonochrome] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyByAircraft, setHistoryByAircraft] = useState<Record<string, Array<MapTrailPoint & { capturedAt: number }>>>({});
  const selected = aircraft.find((item) => item.id === selectedId) || null;

  useEffect(() => {
    if (location) setCenter({ latitude: location.latitude, longitude: location.longitude });
  }, [location?.latitude, location?.longitude]);

  useEffect(() => {
    const capturedAt = Date.now();
    setHistoryByAircraft((current) => {
      const next = { ...current };
      for (const item of aircraft) {
        const recent = (current[item.id] || []).filter((point) => capturedAt - point.capturedAt <= 60 * 60_000);
        const last = recent[recent.length - 1];
        if (!last || last.latitude !== item.latitude || last.longitude !== item.longitude || last.altitude !== item.altitude || last.onGround !== item.onGround) {
          recent.push({ latitude: item.latitude, longitude: item.longitude, altitude: item.altitude, onGround: item.onGround, capturedAt });
        }
        next[item.id] = recent.slice(-360);
      }
      return next;
    });
  }, [aircraft]);

  const points: MapPoint[] = aircraft.map((item) => ({
    id: item.id,
    latitude: item.latitude,
    longitude: item.longitude,
    heading: item.heading,
    altitude: item.altitude,
    onGround: item.onGround,
    label: graphicOnly ? undefined : item.flight || item.registration,
    title: `${item.flight || "Aircraft"} · ${formatAltitude(item.altitude)} · ${formatSpeed(item.speed)}`,
  }));
  const trails: MapTrail[] = selectedId && historyByAircraft[selectedId]?.length > 1
    ? [{ id: selectedId, points: historyByAircraft[selectedId] }]
    : [];

  return (
    <section className={`widget-panel aircraft-panel ${compact ? "compact" : ""}`} onDoubleClick={onFocus}>
      <div className="aircraft-header">
        <span className="widget-title"><Plane size={16} /><span>Live Aircraft</span></span>
        <div>
          <button className={graphicOnly ? "selected" : ""} onClick={() => onGraphicOnlyChange(!graphicOnly)} title="Toggle graphic-only aircraft">Graphic only</button>
          <button className="icon-button" onClick={onClose} title="Hide Live Aircraft"><X size={18} /></button>
        </div>
      </div>
      <div className="aircraft-map-wrap">
        <InteractiveMap
          center={center}
          zoom={zoom}
          points={points}
          trails={trails}
          selectedPointId={selectedId}
          monochrome={monochrome}
          onViewChange={(nextCenter, nextZoom) => { setCenter(nextCenter); setZoom(nextZoom); }}
          onSelectPoint={setSelectedId}
          onMonochromeChange={setMonochrome}
        />
        <div className="aircraft-map-toolbar">
          <button onClick={() => { setCenter({ latitude: fallback.latitude, longitude: fallback.longitude }); setZoom(7); }}>Home</button>
          <button onClick={onUseCurrentLocation}>Use location</button>
          <button onClick={() => onLocationChange({ name: "Map centre", ...center })}>Set centre</button>
          <span>{aircraft.length} live</span>
        </div>
        {error ? <div className="map-feed-error">{error}</div> : null}
        {selected && !graphicOnly ? (
          <div className="aircraft-detail">
            <button className="icon-button" onClick={() => setSelectedId(null)} title="Close aircraft details"><X size={15} /></button>
            <Plane size={30} style={{ transform: `rotate(${selected.heading - 45}deg)` }} />
            <div><strong>{selected.flight || selected.registration || selected.id}</strong><span>{selected.aircraftType || "Unknown type"}</span></div>
            <dl>
              <div><dt>Registration</dt><dd>{selected.registration || "—"}</dd></div>
              <div><dt>Altitude</dt><dd className="aircraft-altitude-value" style={{ color: adsbAltitudeColor(selected.altitude, selected.onGround) }}>{formatAltitude(selected.altitude)}</dd></div>
              <div><dt>Speed</dt><dd>{formatSpeed(selected.speed)}</dd></div>
              <div><dt>Vertical</dt><dd>{selected.verticalRate == null ? "—" : `${Math.round(selected.verticalRate)} ft/min`}</dd></div>
            </dl>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function weatherClockNow() {
  if (isMockMode()) {
    const preview = new Date(new URLSearchParams(window.location.search).get("weatherTime") || "2026-07-07T12:00:00+10:00");
    if (Number.isFinite(preview.getTime())) return preview;
  }
  return new Date();
}

function WeatherPanel({
  location,
  weather,
  weatherNow,
  query,
  searching,
  compact,
  narrow,
  onFocus,
  onClose,
  onQueryChange,
  onSearch,
  onUseCurrentLocation,
  onChangeLocation,
}: {
  location?: WeatherLocation;
  weather: WeatherData | null;
  weatherNow: Date;
  query: string;
  searching: boolean;
  compact: boolean;
  narrow: boolean;
  onFocus: () => void;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onUseCurrentLocation: () => void;
  onChangeLocation: () => void;
}) {
  const weatherContentRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [forecastMode, setForecastMode] = useState<"day" | "five">("day");
  const [forecastDayIndex, setForecastDayIndex] = useState(0);
  const [rainHistoryPeriod, setRainHistoryPeriod] = useState<null | "1h" | "24h">(null);
  const [page, setPage] = useState<"forecast" | "radar">("forecast");
  const [radarFrames, setRadarFrames] = useState<Array<{ host: string; path: string; time: number; forecast: boolean }>>([]);
  const [radarFrameIndex, setRadarFrameIndex] = useState(0);
  const [radarPaused, setRadarPaused] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [radarError, setRadarError] = useState("");
  const [radarCenter, setRadarCenter] = useState(() => ({ latitude: location?.latitude || -37.8136, longitude: location?.longitude || 144.9631 }));
  const [radarZoom, setRadarZoom] = useState(7);
  const [radarMonochrome, setRadarMonochrome] = useState(true);
  const radarFrame = radarFrames[radarFrameIndex] || null;
  const showSetup = !location || settingsOpen;
  const localWeatherDate = weatherLocalTime(weatherNow, weather?.timezone)?.date;
  const availableDays = weather?.days?.length ? weather.days : weather ? [{
    date: localWeatherDate || "",
    minTemp: weather.minTemp,
    maxTemp: weather.maxTemp,
    uvIndex: weather.uvIndex,
    precipTotal: weather.precipTotal,
    precipProbability: weather.precipProbability,
    hourly: weather.hourlyPrecip.map((hour) => ({ time: hour.time, temp: weather.currentTemp, feelsLike: weather.feelsLikeTemp, precip: hour.value })),
  }] : [];
  const forecastDays = upcomingWeatherDays(availableDays, weatherNow, weather?.timezone);
  const [selectionDate, setSelectionDate] = useState(localWeatherDate);
  const activeIndex = selectionDate === localWeatherDate ? Math.min(forecastDayIndex, Math.max(0, forecastDays.length - 1)) : 0;
  const activeDay = forecastDays[activeIndex];
  const isToday = activeDay?.date === localWeatherDate;
  const currentConditions = isToday && availableDays[0]?.date === localWeatherDate;
  const solar = weatherSolarState(forecastDays.find(day => day.date === localWeatherDate), weatherNow, weather?.timezone);
  const visibleRainHistory = weather?.rainHistory?.slice(rainHistoryPeriod === "1h" ? -1 : -24) || [];
  const rainHistoryTotal = visibleRainHistory.reduce((total, item) => total + item.value, 0);

  useEffect(() => { weatherContentRef.current?.scrollTo(0, 0); }, [page, rainHistoryPeriod, forecastMode, settingsOpen]);

  function cycleRainHistory() {
    setPage("forecast");
    setRainHistoryPeriod((current) => current === null ? "1h" : current === "1h" ? "24h" : null);
  }

  useEffect(() => {
    setForecastDayIndex(0);
    setSelectionDate(localWeatherDate);
  }, [localWeatherDate, location?.latitude, location?.longitude]);

  useEffect(() => {
    if (location) setRadarCenter({ latitude: location.latitude, longitude: location.longitude });
  }, [location?.latitude, location?.longitude]);

  useEffect(() => {
    if (page !== "radar") return;
    let active = true;
    const loadRadar = () => fetch("https://api.rainviewer.com/public/weather-maps.json")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Radar request failed: ${response.status}`);
        const data = await response.json();
        const observed = Array.isArray(data.radar?.past) ? data.radar.past.slice(-3) : [];
        const forecast = Array.isArray(data.radar?.nowcast) ? data.radar.nowcast : [];
        const frames = [...observed.map((frame: { path: string; time: number }) => ({ ...frame, forecast: false })), ...forecast.map((frame: { path: string; time: number }) => ({ ...frame, forecast: true }))]
          .filter((frame) => typeof frame.path === "string" && Number.isFinite(frame.time))
          .map((frame) => ({ host: data.host, ...frame }));
        if (active && frames.length) {
          setRadarFrames(frames);
          setRadarFrameIndex(0);
          setRadarError("");
        } else if (active) {
          setRadarError("No radar frames are currently available");
        }
      })
      .catch((err) => active && setRadarError(String(err).replace(/^Error:\s*/, "")));
    loadRadar();
    const timer = window.setInterval(loadRadar, 5 * 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [page]);

  useEffect(() => {
    if (page !== "radar" || radarFrames.length < 2 || radarPaused) return;
    const timer = window.setInterval(() => setRadarFrameIndex((index) => (index + 1) % radarFrames.length), 1_000);
    return () => window.clearInterval(timer);
  }, [page, radarFrames.length, radarPaused]);

  return (
    <section className={`widget-panel weather-panel ${compact ? "compact" : ""} ${narrow ? "narrow" : ""} ${showSetup ? "is-setup" : ""} ${forecastMode === "five" && !rainHistoryPeriod && page === "forecast" ? "weather-five" : ""}`} data-solar-phase={solar.phase} data-forecast-date={activeDay?.date} style={{ '--weather-night': solar.night, '--weather-dawn': solar.dawn, '--weather-dusk': solar.dusk } as CSSProperties} onDoubleClick={onFocus}>
      <div className="weather-header">
        <span className="weather-widget-title"><CloudSun size={16} /><span>Weather</span></span>
        <div className="weather-header-actions">
          {!showSetup ? (
            <button
              className={`weather-rain-history-toggle ${rainHistoryPeriod ? "active" : ""}`}
              onClick={cycleRainHistory}
              title={rainHistoryPeriod === null ? "Show rainfall over the past hour" : rainHistoryPeriod === "1h" ? "Show rainfall over the past 24 hours" : "Return to forecast"}
            >{rainHistoryPeriod ? `Rain ${rainHistoryPeriod}` : "Rain history"}</button>
          ) : null}
          {!showSetup ? (
            <button
              className={`weather-radar-toggle ${page === "radar" ? "active" : ""}`}
              onClick={() => { setRainHistoryPeriod(null); setPage((current) => current === "radar" ? "forecast" : "radar"); }}
              title={page === "radar" ? "Hide radar" : "Show radar"}
            >{page === "radar" ? "Forecast" : "Radar"}</button>
          ) : null}
          {showSetup && location ? (
            <button className="icon-button" title="Close weather settings" onClick={() => setSettingsOpen(false)}><ChevronLeft size={16} /></button>
          ) : location ? (
            <button className="icon-button" title="Change location" onClick={() => setSettingsOpen(true)}><Settings size={16} /></button>
          ) : null}
          <button className="icon-button" title="Hide Weather" onClick={onClose}><X size={18} /></button>
        </div>
      </div>
      <div className="weather-content" ref={weatherContentRef}>
      {showSetup ? (
        <div className="weather-setup">
          <strong>{location ? "Change weather location" : "Set weather location"}</strong>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSearch();
              }
            }}
            placeholder="City or suburb"
            aria-label="Weather location"
          />
          <div className="weather-actions">
            <button onClick={onSearch}>{searching ? "Searching" : "Search"}</button>
            <button onClick={onUseCurrentLocation}>Use location</button>
            {location ? <button onClick={onChangeLocation}>Clear</button> : null}
          </div>
        </div>
      ) : page === "radar" ? (
        <div className="weather-radar-page">
          <InteractiveMap
            center={radarCenter}
            zoom={radarZoom}
            monochrome={radarMonochrome}
            onViewChange={(nextCenter, nextZoom) => { setRadarCenter(nextCenter); setRadarZoom(nextZoom); }}
            radarTileUrl={radarFrame ? (z, x, y) => `${radarFrame.host}${radarFrame.path}/256/${z}/${x}/${y}/2/1_1.png` : undefined}
            radarMaxZoom={7}
            showAttribution={false}
            onMonochromeChange={setRadarMonochrome}
          />
          <div className="radar-map-legend" aria-label="Radar precipitation intensity"><strong>Precipitation</strong><i /><div><span>Light</span><span>Heavy</span></div></div>
          <div className="radar-caption">
            <button className="radar-playback" title={radarPaused ? "Play radar animation" : "Pause radar animation"} aria-label={radarPaused ? "Play radar animation" : "Pause radar animation"} onClick={() => setRadarPaused(value => !value)}>{radarPaused ? <Play size={12} /> : <Pause size={12} />}</button>
            <div className="radar-timeline" role="progressbar" aria-label="Radar frame" aria-valuemin={0} aria-valuemax={Math.max(1, radarFrames.length)} aria-valuenow={radarFrames.length ? radarFrameIndex + 1 : 0}><i style={{ width: `${radarFrames.length ? (radarFrameIndex + 1) / radarFrames.length * 100 : 0}%` }} /></div>
            <span>{radarFrame ? `${radarFrame.forecast ? "Forecast" : radarFrameIndex === radarFrames.length - 1 ? "Latest radar" : "Radar movement"} ${new Date(radarFrame.time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${radarFrameIndex + 1}/${radarFrames.length}` : "Loading radar"}</span>
            <div className="radar-sources"><a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer" aria-label="Weather data by RainViewer">RainViewer</a><span>·</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></div>
          </div>
          {radarError ? <div className="map-feed-error">{radarError}</div> : null}
        </div>
      ) : weather && rainHistoryPeriod ? (
        <div className="rain-history-page">
          <div className="weather-location">{location.name}{location.admin1 ? `, ${location.admin1}` : ""}</div>
          <div className="rain-history-summary">
            <div><strong>{rainHistoryTotal.toFixed(1)}</strong><span> mm</span></div>
            <span>Rainfall in the past {rainHistoryPeriod === "1h" ? "hour" : "24 hours"}</span>
          </div>
          <RainHistoryGraph history={visibleRainHistory} period={rainHistoryPeriod} />
          <small className="rain-history-note">Estimated precipitation · Open-Meteo</small>
        </div>
      ) : weather && activeDay ? (
        <>
          <div className="weather-hero">
            <div className="weather-location">{location.name}<small>{location.admin1 || "Local weather"}</small></div>
            <div className="weather-main">
              <div className="weather-temperature"><small>{currentConditions ? "Current conditions" : "Daytime high"}</small><strong>{currentConditions ? weather.currentTemp : activeDay.maxTemp}°<small>C</small></strong></div>
              <span className="weather-condition-meta">{currentConditions ? `Feels like ${weather.feelsLikeTemp}°` : "Daily range"}<small>Low {activeDay.minTemp}° · High {activeDay.maxTemp}°</small></span>
            </div>
          </div>
          <div className="forecast-controls">
            <button onClick={() => setForecastDayIndex((index) => Math.max(0, index - 1))} disabled={forecastMode === "five" || activeIndex === 0} title="Previous forecast day">
              <ChevronLeft size={16} />
            </button>
            <span title={formatForecastDay(activeDay.date)}>{forecastMode === "five" ? "Next five days" : formatForecastDay(activeDay.date)}</span>
            <button onClick={() => setForecastDayIndex((index) => Math.min(forecastDays.length - 1, index + 1))} disabled={forecastMode === "five" || activeIndex >= forecastDays.length - 1} title="Next forecast day">
              <ChevronRight size={16} />
            </button>
            <button className={forecastMode === "five" ? "selected" : ""} aria-pressed={forecastMode === "five"} onClick={() => { setForecastDayIndex(0); setForecastMode((mode) => mode === "five" ? "day" : "five"); }}>5 days</button>
          </div>
          <WeatherMetricCards day={activeDay} weather={weather} isToday={isToday} currentConditions={currentConditions} now={weatherNow} />
          {isToday ? <div className="weather-alert">{weatherAlertText(activeDay.precipTotal, activeDay.uvIndex, activeDay.precipProbability)}</div> : null}
          <div className="weather-visual"><div className="weather-chart-heading"><span><Clock3 size={12} />{forecastMode === "five" ? "5-day forecast" : "Hourly forecast"}</span>{forecastMode !== "five" ? <span className="weather-chart-legend"><i className="legend-temperature" />Temperature<i className="legend-rain" />Rain</span> : null}</div>
          {forecastMode === "five" ? <FiveDayForecast days={forecastDays.slice(0, 5)} /> : <WeatherDayGraph day={activeDay} narrow={narrow} now={isToday ? weatherNow : undefined} timeZone={weather.timezone} />}</div>
        </>
      ) : (
        <div className="weather-setup">
          <strong>{location.name}</strong>
          <span role="status">Loading forecast…</span>
        </div>
      )}
      </div>
    </section>
  );
}

function WeatherMetricCards({ day, weather, isToday, currentConditions, now }: { day: WeatherDay; weather: WeatherData; isToday: boolean; currentConditions: boolean; now: Date }) {
  const uvLabel = day.uvIndex < 3 ? "Low" : day.uvIndex < 6 ? "Moderate" : day.uvIndex < 8 ? "High" : day.uvIndex < 11 ? "Very high" : "Extreme";
  const difference = weather.feelsLikeTemp - weather.currentTemp;
  const solarTime = (value?: string) => formatWeatherTime(value, weather.timezone);
  const solar = weatherSolarState(day, now, weather.timezone);
  const sun = solar.position;
  const solarLabel = sun ? `Sun ${sun.aboveHorizon ? "above" : "below"} the horizon at ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: weather.timezone })}` : `Daylight hours. Sunrise ${solarTime(day.sunrise)}, sunset ${solarTime(day.sunset)}`;
  return <div className="weather-metrics">
    <div className="weather-metric feels-like-card">
      <h3><Thermometer size={13} />{currentConditions ? "Feels like" : "Low temperature"}</h3>
      <strong>{currentConditions ? weather.feelsLikeTemp : day.minTemp}°</strong>
      <span className="metric-subtitle">{currentConditions ? `Actual: ${weather.currentTemp}°` : `High: ${day.maxTemp}°`}</span>
      <div className="feels-like-scale" aria-hidden="true">{currentConditions ? <i style={{ left: `${Math.max(4, Math.min(96, 50 + difference * 4))}%` }} /> : null}</div>
      <p>{currentConditions ? Math.abs(difference) < 1 ? "Similar to the actual temperature." : `Feels ${Math.abs(difference)}° ${difference < 0 ? "cooler" : "warmer"} than the actual temperature.` : "The expected daily temperature range."}</p>
    </div>
    <div className="weather-metric uv-card">
      <h3><Sun size={13} />UV index</h3><strong>{day.uvIndex}</strong><span className="metric-subtitle">{uvLabel}</span>
      <div className="uv-spectrum" role="img" aria-label={`UV index ${day.uvIndex}, ${uvLabel}`}><i style={{ left: `${Math.max(2, Math.min(98, day.uvIndex / 12 * 100))}%` }} /></div>
      <p>Daily maximum UV index.</p>
    </div>
    <div className="weather-metric precipitation-card">
      <h3><Droplets size={13} />Precipitation</h3><strong>{day.precipTotal.toFixed(1)} <small>mm</small></strong><span className="metric-subtitle">{isToday ? "Today" : "Daily total"}</span>
      <div className="rain-probability-scale" aria-hidden="true"><i style={{ width: `${day.precipProbability}%` }} /></div>
      <p>{day.precipProbability}% chance of rain.</p>
    </div>
    <div className="weather-metric sunrise-card">
      <h3><Sunrise size={13} />Sunrise</h3><strong className="solar-time">{solarTime(day.sunrise)}</strong>
      <svg className="sunrise-arc" viewBox="0 0 160 40" role="img" aria-label={solarLabel} data-solar-phase={solar.phase}>
        <path d="M8 24 Q80 -16 152 24" /><path className="solar-night-arc" d="M152 24 Q80 42 8 24" /><path className="solar-horizon" d="M0 24H160" />
        {sun ? <g className={`solar-sun ${sun.aboveHorizon ? "" : "below-horizon"}`} transform={`translate(${sun.x} ${sun.y})`}>
          <circle className="solar-sun-glow" r="7" /><circle r="3" /><path className="solar-sun-rays" d="M0 -6V-5 M0 5V6 M-6 0H-5 M5 0H6 M-4 -4L-3.5 -3.5 M3.5 3.5L4 4 M-4 4L-3.5 3.5 M3.5 -3.5L4 -4" />
        </g> : null}
      </svg>
      <p>Sunset: {solarTime(day.sunset)}</p>
    </div>
  </div>;
}

function RainHistoryGraph({ history, period }: { history: { time: string; value: number }[]; period: "1h" | "24h" }) {
  const values = history.length ? history : [{ time: new Date().toISOString(), value: 0 }];
  const max = Math.max(0.2, ...values.map((item) => item.value));
  return (
    <div className={`rain-history-graph rain-history-${period}`} aria-label={`Rainfall over the past ${period === "1h" ? "hour" : "24 hours"}`}>
      {values.map((item, index) => (
        <div className="rain-history-column" key={`${item.time}-${index}`} title={`${new Date(item.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}: ${item.value.toFixed(1)} mm`}>
          <span style={{ height: `${Math.max(item.value > 0 ? 5 : 1, item.value / max * 100)}%` }} />
          {(period === "1h" || index % 6 === 0 || index === values.length - 1) ? <small>{new Date(item.time).toLocaleTimeString([], { hour: "numeric" })}</small> : null}
        </div>
      ))}
    </div>
  );
}

function WeatherDayGraph({ day, narrow = false, now, timeZone }: { day: WeatherDay; narrow?: boolean; now?: Date; timeZone?: string }) {
  const graphRef = useRef<HTMLDivElement>(null);
  const [graphWidth, setGraphWidth] = useState(300);
  const [inspectedIndex, setInspectedIndex] = useState<number | null>(null);
  useEffect(() => setInspectedIndex(null), [day.date]);
  useEffect(() => {
    if (!graphRef.current) return;
    const observer = new ResizeObserver(([entry]) => setGraphWidth(entry.contentRect.width));
    observer.observe(graphRef.current);
    return () => observer.disconnect();
  }, []);
  const compactLabels = graphWidth < 320;
  const tickStep = graphWidth < 180 ? 12 : graphWidth < 260 ? 8 : graphWidth < 400 ? 6 : 4;
  const hourly = day.hourly.slice(0, 24);
  const timeTicks = hourly
    .map((item, sourceIndex) => ({
      ...item,
      x: hourly.length <= 1 ? 50 : (sourceIndex / (hourly.length - 1)) * 100,
      sourceIndex,
    }))
    .filter((item) => item.sourceIndex === 0 || item.sourceIndex === hourly.length - 1 || (item.sourceIndex % tickStep === 0 && item.sourceIndex <= hourly.length - Math.max(4, tickStep * .7)));
  const maxTemp = Math.max(...hourly.map((item) => item.temp), day.maxTemp, 1);
  const minTemp = Math.min(...day.hourly.map((item) => item.temp), day.minTemp);
  const tempRange = Math.max(1, maxTemp - minTemp);
  const maxRain = Math.max(1, ...hourly.map((item) => item.precip));
  const tempPoints = hourly.map((item, index) => ({
    x: hourly.length <= 1 ? 50 : (index / (hourly.length - 1)) * 100,
    y: 94 - ((item.temp - minTemp) / tempRange) * 88,
  }));
  const tempLinePath = smoothPath(tempPoints);
  const tempAreaPath = tempPoints.length
    ? `${tempLinePath} L ${tempPoints[tempPoints.length - 1].x.toFixed(2)} 100 L ${tempPoints[0].x.toFixed(2)} 100 Z`
    : "";
  const rainPoints = hourly.map((item, index) => ({
    x: hourly.length <= 1 ? 50 : (index / (hourly.length - 1)) * 100,
    y: 94 - (item.precip / maxRain) * 88,
  }));
  const rainLinePath = smoothPath(rainPoints);
  const rainAreaPath = rainPoints.length
    ? `${rainLinePath} L ${rainPoints[rainPoints.length - 1].x.toFixed(2)} 100 L ${rainPoints[0].x.toFixed(2)} 100 Z`
    : "";
  const graphId = day.date.replace(/[^a-z0-9]/gi, "-");
  const gradientId = `temp-gradient-${graphId}`;
  const rainGradientId = `rain-gradient-${graphId}`;
  const sunriseX = solarTimeX(day.sunrise, hourly);
  const sunsetX = solarTimeX(day.sunset, hourly);
  const solarBandWidth = sunriseX !== null && sunsetX !== null ? Math.max(0, sunsetX - sunriseX) : 0;
  const currentTimeX = now ? weatherCurrentTimeX(now, timeZone, hourly) : null;
  const currentTimeLabel = now?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone });
  const inspectedHour = inspectedIndex === null ? undefined : hourly[inspectedIndex];
  const inspectedX = inspectedIndex === null || hourly.length <= 1 ? 50 : inspectedIndex / (hourly.length - 1) * 100;
  const inspectPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setInspectedIndex(weatherHourIndex(event.clientX, bounds.left, bounds.width, hourly.length));
  };
  const graphSolarLabel = day.sunrise && day.sunset
    ? `; sunrise ${formatGraphHour(day.sunrise, false, timeZone)}, sunset ${formatGraphHour(day.sunset, false, timeZone)}`
    : "";

  return (
    <div ref={graphRef} className={`weather-day-graph ${compactLabels || narrow ? "narrow" : ""} ${inspectedHour ? "inspecting" : ""}`} role="group" tabIndex={hourly.length ? 0 : undefined} aria-label={`Temperature and rain graph${graphSolarLabel}. Use left and right arrow keys to inspect hourly forecasts.`}
      onPointerEnter={inspectPointer} onPointerMove={inspectPointer} onPointerLeave={() => { if (document.activeElement !== graphRef.current) setInspectedIndex(null); }}
      onFocus={() => { if (hourly.length) setInspectedIndex(index => index ?? Math.round((currentTimeX ?? 0) / 100 * (hourly.length - 1))); }} onBlur={() => setInspectedIndex(null)}
      onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); setInspectedIndex(null); }
        if (!hourly.length || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        setInspectedIndex(index => event.key === "Home" ? 0 : event.key === "End" ? hourly.length - 1 : Math.max(0, Math.min(hourly.length - 1, (index ?? 0) + (event.key === "ArrowRight" ? 1 : -1))));
      }}>
      {sunriseX !== null && sunsetX !== null ? (
        <div
          className="weather-solar-gradient"
          style={{ left: `${sunriseX}%`, width: `${solarBandWidth}%` }}
          aria-hidden="true"
          title={`Sunrise ${formatGraphHour(day.sunrise || "", false, timeZone)}; sunset ${formatGraphHour(day.sunset || "", false, timeZone)}`}
        />
      ) : null}
      {currentTimeX !== null ? (
        <div className={`weather-current-time ${currentTimeX > 85 ? "near-end" : ""}`} style={{ left: `${currentTimeX}%` }} title={`Current time ${currentTimeLabel}`} aria-label={`Current time ${currentTimeLabel}`}>
          <span>{currentTimeLabel}</span>
        </div>
      ) : null}
      <div className="temp-curve">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Temperature from ${Math.round(minTemp)}° to ${Math.round(maxTemp)}°`}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
              {temperatureGradientStops(minTemp, maxTemp).map((stop) => (
                <stop key={`${stop.offset}-${stop.colour}`} offset={stop.offset} stopColor={stop.colour} />
              ))}
            </linearGradient>
          </defs>
          {tempAreaPath ? <path className="temp-area" d={tempAreaPath} fill={`url(#${gradientId})`} /> : null}
          {tempLinePath ? <path className="temp-line" d={tempLinePath} stroke={`url(#${gradientId})`} /> : null}
        </svg>
      </div>
      <div className="rain-curve">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Rain up to ${maxRain.toFixed(1)} mm`}>
          <defs>
            <linearGradient id={rainGradientId} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#2f80ff" />
              <stop offset="55%" stopColor="#5bbcff" />
              <stop offset="100%" stopColor="#d7f3ff" />
            </linearGradient>
          </defs>
          {rainAreaPath ? <path className="rain-area" d={rainAreaPath} fill={`url(#${rainGradientId})`} /> : null}
          {rainLinePath ? <path className="rain-line" d={rainLinePath} stroke={`url(#${rainGradientId})`} /> : null}
        </svg>
      </div>
      <div className="weather-graph-time-axis" aria-label="Forecast times">
        {timeTicks.map((item) => (
          <span key={item.time} style={{ left: `${item.x}%` }} title={formatGraphHour(item.time, false, timeZone)}>{formatGraphHour(item.time, compactLabels, timeZone)}</span>
        ))}
      </div>
      {inspectedHour ? <>
        <div className="weather-graph-crosshair" style={{ left: `${inspectedX}%` }} aria-hidden="true" />
        <div className="weather-graph-readout" role="status" data-hour-index={inspectedIndex} style={{ '--inspect-x': `${inspectedX}%` } as CSSProperties}>
          <strong>{formatWeatherTime(inspectedHour.time, timeZone)}</strong>
          <div><span><Thermometer size={11} aria-hidden="true" />{Math.round(inspectedHour.temp * 10) / 10}°C</span><span aria-label={inspectedHour.precipProbability == null ? "Chance of rain unavailable" : `${inspectedHour.precipProbability}% chance of rain`}><Droplets size={11} aria-hidden="true" />{inspectedHour.precipProbability == null ? "—" : `${inspectedHour.precipProbability}%`}<small>rain</small></span></div>
        </div>
      </> : null}
    </div>
  );
}

function FiveDayForecast({ days }: { days: WeatherDay[] }) {
  const minimum = Math.min(...days.map(day => day.minTemp));
  const maximum = Math.max(...days.map(day => day.maxTemp));
  const range = Math.max(1, maximum - minimum);
  return <div className="five-day-forecast">
    {days.map(day => <div className="forecast-day" key={day.date} data-date={day.date}>
      <strong>{new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: "short" })}</strong>
      <span className="forecast-rain"><Droplets size={12} />{day.precipProbability}%</span>
      <span className="forecast-low">{day.minTemp}°</span>
      <div className="forecast-range" role="img" aria-label={`Low ${day.minTemp}°, high ${day.maxTemp}°`}><i style={{ left: `${(day.minTemp - minimum) / range * 100}%`, width: `${Math.max(3, (day.maxTemp - day.minTemp) / range * 100)}%`, background: `linear-gradient(90deg, ${temperatureColour(day.minTemp)}, ${temperatureColour(day.maxTemp)})` }} /></div>
      <span className="forecast-high">{day.maxTemp}°</span>
    </div>)}
  </div>;
}

function PrecipGraph({ values }: { values: { time: string; value: number }[] }) {
  const max = Math.max(1, ...values.map((item) => item.value));
  return (
    <div className="precip-graph" aria-label="Precipitation graph">
      {values.slice(0, 12).map((item) => (
        <span key={item.time} style={{ height: `${Math.max(4, (item.value / max) * 100)}%` }} title={`${formatGraphHour(item.time)} ${item.value} mm`} />
      ))}
    </div>
  );
}

function SetupOverlay({
  settings,
  env,
  googleConnected,
  microsoftConnected,
  spotifyConnected,
  googleClientSource,
  activeGoogleClientId,
  calendarTimeZone,
  status,
  error,
  onSave,
  onClose,
  onConnect,
  onDisconnect,
  onFindWeatherLocation,
  onResolveCurrentWeatherLocation,
  widgetLayout,
  onSaveLayout,
  onOpenCodex,
  onToggleFullscreen,
  availableUpdate,
  previousRelease,
  downloadedUpdate,
  updateStatus,
  updateBusy,
  canAutoInstall,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onCheckForRollback,
  onRollback,
}: {
  settings: StoredSettings;
  env: EnvConfig;
  googleConnected: boolean;
  microsoftConnected: boolean;
  spotifyConnected: boolean;
  googleClientSource: string;
  activeGoogleClientId: string;
  calendarTimeZone: string;
  status: string;
  error: string;
  onSave: (settings: StoredSettings) => Promise<void>;
  onClose: () => void;
  onConnect: (provider: Provider) => Promise<void>;
  onDisconnect: (provider: Provider) => void;
  onFindWeatherLocation: (query: string) => Promise<WeatherLocation | null>;
  onResolveCurrentWeatherLocation: () => Promise<WeatherLocation>;
  widgetLayout: WidgetLayout;
  onSaveLayout: (layout: WidgetLayout) => Promise<void>;
  onOpenCodex: () => void;
  onToggleFullscreen: () => void;
  availableUpdate: AvailableUpdate | null;
  previousRelease: AvailableUpdate | null;
  downloadedUpdate: DownloadedUpdate | null;
  updateStatus: string;
  updateBusy: boolean;
  canAutoInstall: boolean;
  onCheckForUpdates: (githubToken?: string) => Promise<void>;
  onDownloadUpdate: () => Promise<DownloadedUpdate>;
  onInstallUpdate: (installOnReboot: boolean) => Promise<void>;
  onCheckForRollback: (githubToken?: string) => Promise<void>;
  onRollback: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<StoredSettings>({
    calendarId: "primary",
    googleCalendarTimeZone: calendarTimeZone,
    spotifyRedirectUri: DEFAULT_SPOTIFY_REDIRECT_URI,
    googleRedirectUri: DEFAULT_GOOGLE_REDIRECT_URI,
    microsoftRedirectUri: DEFAULT_MICROSOFT_REDIRECT_URI,
    codexApprovalMode: "on-request",
    codexOpenUrl: DEFAULT_CODEX_OPEN_URL,
    codexWebUrl: DEFAULT_CODEX_WEB_URL,
    microsoftTenant: "common",
    ...settings,
  });
  const [activeSection, setActiveSection] = useState("application");
  const [displayLockSupported, setDisplayLockSupported] = useState(false);
  const [saveState, setSaveState] = useState("");
  const [updateError, setUpdateError] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const settingsSections = [
    { id: "application", label: "General", icon: Settings, enabled: true },
    { id: "appearance", label: "Appearance", icon: LayoutGrid, enabled: true },
    { id: "updates", label: "Updates", icon: RefreshCcw, enabled: true },
    { id: "calendar", label: "Calendars", icon: CalendarDays, enabled: WIDGET_FEATURE_FLAGS.calendar },
    { id: "spotify", label: "Music", icon: ListMusic, enabled: WIDGET_FEATURE_FLAGS.spotify },
    { id: "weather", label: "Weather", icon: CloudSun, enabled: WIDGET_FEATURE_FLAGS.weather },
    { id: "aircraft", label: "Aircraft", icon: Plane, enabled: WIDGET_FEATURE_FLAGS.aircraft },
    { id: "codex", label: "Codex", icon: Bot, enabled: WIDGET_FEATURE_FLAGS.codex },
    { id: "terminal", label: "Terminal", icon: Terminal, enabled: WIDGET_FEATURE_FLAGS.terminal },
    { id: "layout", label: "Widgets", icon: LayoutGrid, enabled: true },
  ].filter((section) => section.enabled);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLButtonElement>(".settings-close-button")?.focus();
    return () => previousFocus?.focus();
  }, []);

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
    if (event.key !== "Tab") return;
    const controls = [...(panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'
    ) || [])].filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  const [calendarAdvancedOpen, setCalendarAdvancedOpen] = useState(false);
  const [spotifyAdvancedOpen, setSpotifyAdvancedOpen] = useState(false);
  const [weatherDraftQuery, setWeatherDraftQuery] = useState("");
  const [weatherDraftSearching, setWeatherDraftSearching] = useState(false);
  const [weatherDraftError, setWeatherDraftError] = useState("");
  const [adsbDraftQuery, setAdsbDraftQuery] = useState("");
  const [adsbDraftSearching, setAdsbDraftSearching] = useState(false);
  const [adsbDraftError, setAdsbDraftError] = useState("");
  const [idleMapDraftQuery, setIdleMapDraftQuery] = useState("");
  const [idleMapDraftSearching, setIdleMapDraftSearching] = useState(false);
  const [idleMapDraftError, setIdleMapDraftError] = useState("");


  useEffect(() => { setSaveState(""); }, [draft]);

  async function save() {
    setSaveState("Saving…");
    try {
      await onSave(draft);
      setSaveState("Settings saved");
    } catch {
      setSaveState("Could not save. Try again.");
    }
  }


  async function saveThenConnect(provider: Provider) {
    await onSave(draft);
    await onConnect(provider);
  }

  async function saveThenOpenCodex() {
    onOpenCodex();
    await onSave(draft);
  }

  async function setManualWeatherLocation() {
    setWeatherDraftSearching(true);
    setWeatherDraftError("");
    try {
      const location = await onFindWeatherLocation(weatherDraftQuery);
      if (location) {
        setDraft({ ...draft, weatherLocation: location });
        setWeatherDraftQuery("");
      }
    } catch (err) {
      setWeatherDraftError(String(err));
    } finally {
      setWeatherDraftSearching(false);
    }
  }

  async function setCurrentWeatherLocation() {
    setWeatherDraftSearching(true);
    setWeatherDraftError("");
    try {
      const location = await onResolveCurrentWeatherLocation();
      setDraft({ ...draft, weatherLocation: location });
    } catch (err) {
      setWeatherDraftError(friendlyWeatherError(err));
    } finally {
      setWeatherDraftSearching(false);
    }
  }

  async function setAdsbLocation(useCurrent = false) {
    setAdsbDraftSearching(true);
    setAdsbDraftError("");
    try {
      const location = useCurrent ? await onResolveCurrentWeatherLocation() : await onFindWeatherLocation(adsbDraftQuery);
      if (location) {
        setDraft({ ...draft, adsbLocation: location });
        setAdsbDraftQuery("");
      }
    } catch (err) {
      setAdsbDraftError(friendlyWeatherError(err));
    } finally {
      setAdsbDraftSearching(false);
    }
  }

  async function setIdleMapLocation(useCurrent = false) {
    setIdleMapDraftSearching(true);
    setIdleMapDraftError("");
    try {
      const location = useCurrent ? await onResolveCurrentWeatherLocation() : await onFindWeatherLocation(idleMapDraftQuery);
      if (location) {
        setDraft({ ...draft, idleMapLocation: location });
        setIdleMapDraftQuery("");
      }
    } catch (err) {
      setIdleMapDraftError(friendlyWeatherError(err));
    } finally {
      setIdleMapDraftSearching(false);
    }
  }

  async function chooseSlideshowFolder() {
    try {
      const folder = await invoke<string | null>("select_slideshow_folder");
      if (folder) {
        const next = { ...draft, idleSlideshowFolder: folder };
        setDraft(next);
        await onSave(next);
      }
    } catch (err) {
      setIdleMapDraftError(`Could not open the folder picker: ${String(err)}`);
    }
  }

  return (
    <div className="setup-backdrop">
      <section className="setup-panel" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="settings-title" onKeyDown={handleDialogKeyDown}>
        <header>
          <div><h2 id="settings-title">Settings</h2><p>Make this dashboard yours.</p></div>
          <button className="icon-button settings-close-button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="settings-body">
        <nav className="settings-nav" aria-label="Settings sections">
          {settingsSections.map(({ id, label, icon: Icon }) => (
            <button key={id} className={activeSection === id ? "selected" : ""}
              aria-current={activeSection === id ? "page" : undefined}
              aria-controls={`settings-${id}`}
              onClick={() => { setActiveSection(id); panelRef.current?.querySelector(".settings-content")?.scrollTo(0, 0); }}>
              <Icon size={16} /><span>{label}</span>
            </button>
          ))}
          <small>Daily Dashboard<br />Version {APP_VERSION}</small>
        </nav>
        <div className="settings-content" onChange={() => setSaveState("")}>
        <section id="settings-application" hidden={activeSection !== "application"} className="settings-section">
          <div className="provider-panel">
            <div>
              <strong>Application</strong>
              <span>Window controls</span>
              <small>Version {APP_VERSION}</small>
            </div>
            <button className="settings-action-button" disabled={displayLockSupported && Boolean(draft.displayLock)} title={displayLockSupported && draft.displayLock ? "Unlock the dedicated display to change fullscreen" : undefined} onClick={onToggleFullscreen}>
              <Maximize2 size={16} />
              <span>Toggle Full Screen</span>
            </button>
          </div>
          <div className="scale-setting">
            <label htmlFor="application-scale">Application scale <strong>{normalizeAppScale(draft.appScale)}%</strong></label>
            <input
              id="application-scale"
              type="range"
              min="0"
              max={APP_SCALES.length - 1}
              step="1"
              value={APP_SCALES.indexOf(normalizeAppScale(draft.appScale))}
              onChange={(event) => setDraft({ ...draft, appScale: APP_SCALES[Number(event.target.value)] })}
            />
            <div>{APP_SCALES.map((scale) => <button key={scale} className={normalizeAppScale(draft.appScale) === scale ? "selected" : ""} onClick={() => setDraft({ ...draft, appScale: scale })}>{scale}%</button>)}</div>
          </div>
          <DisplayLockSetting value={draft.displayLock} onChange={displayLock => setDraft({ ...draft, displayLock })} onSupported={setDisplayLockSupported} />
        </section>
        <section id="settings-appearance" hidden={activeSection !== "appearance"} className="settings-section">
          <div className="provider-panel"><div><strong>Appearance</strong><span>Backgrounds when all widgets are hidden</span></div></div>
          <div className="idle-settings">
            <label>
              <span>No-widgets background</span>
              <select value={normalizeIdleBackground(draft.idleBackground)} onChange={(event) => setDraft({ ...draft, idleBackground: normalizeIdleBackground(event.target.value) })}>
                <option value="waves">Waves (original)</option>
                <option value="fish">Pixel fish pond</option>
                <option value="stars">Location-aware night sky</option>
                <option value="topographic">Panning topographic map</option>
                <option value="slideshow">Album slideshow</option>
              </select>
            </label>
            {["topographic", "stars"].includes(normalizeIdleBackground(draft.idleBackground)) ? <div className="setup-grid weather-settings-grid">
              <label>
                <span>Background location</span>
                <input value={idleMapDraftQuery} placeholder={draft.idleMapLocation?.name || "City or suburb"} onChange={(event) => setIdleMapDraftQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setIdleMapLocation(); } }} />
              </label>
              <div className="weather-settings-actions">
                <button onClick={() => setIdleMapLocation()}>{idleMapDraftSearching ? "Searching" : "Search"}</button>
                <button onClick={() => setIdleMapLocation(true)}>Use Location</button>
              </div>
            </div> : null}
            {normalizeIdleBackground(draft.idleBackground) === "slideshow" ? <>
            <div className="folder-setting">
              <div><span>Slideshow album folder</span><small>{draft.idleSlideshowFolder || "No folder selected"}</small></div>
              <button onClick={chooseSlideshowFolder}>Choose folder</button>
            </div>
            <label>
              <span>Slideshow image fit</span>
              <select value={normalizeSlideshowFit(draft.idleSlideshowFit)} onChange={(event) => setDraft({ ...draft, idleSlideshowFit: normalizeSlideshowFit(event.target.value) })}>
                <option value="crop">Crop to fit</option>
                <option value="contain">Shrink to fit with blurred background</option>
              </select>
            </label>
            </> : null}
            {idleMapDraftError ? <p className="error-line">{idleMapDraftError}</p> : null}
          </div>
        </section>
        <section id="settings-updates" hidden={activeSection !== "updates"} className="settings-section">
          <div className="provider-panel"><div><strong>Updates</strong><span>Daily Dashboard {APP_VERSION}</span></div></div>
          <div className="update-settings">
            <label>
              <span>Updates on Dashboard startup</span>
              <select value={normalizeUpdatePreference(draft.updatePreference)} onChange={(event) => setDraft({ ...draft, updatePreference: normalizeUpdatePreference(event.target.value) })}>
                <option value="notify">Notify me only (default)</option>
                <option value="auto-download">Download on startup; install manually</option>
                <option value="auto-install" disabled={!canAutoInstall}>Automatically download and install on startup{!canAutoInstall ? " (Windows only)" : ""}</option>
                <option value="ignore">Disable update checks</option>
              </select>
            </label>
            <p className="setup-note">Automatic downloads and installation are off by default. Dashboard checks stable GitHub releases on launch and notifies you when an update is available. Public releases need no account or token; private releases need optional access credentials below. Choose an automatic mode above to opt in, or Notify me only to opt out while keeping notifications. Save to apply. Recovery launches skip update checks.</p>
            <details className="private-update-access"><summary>Private-repository access (optional)</summary><label><span>GitHub token · Contents: read</span><input type="password" value={draft.githubUpdateToken || ""} autoComplete="off" onChange={event => setDraft({ ...draft, githubUpdateToken: event.target.value })} /></label><small>Public releases work without an account or token. Use this only while the releases are private.</small></details>
            <div className="update-actions">
              <button disabled={updateBusy} onClick={() => onSave(draft).then(() => onCheckForUpdates(draft.githubUpdateToken)).catch((err) => setUpdateError(String(err)))}>Check now</button>
              {availableUpdate ? <button onClick={() => openUrl(availableUpdate.releaseUrl).catch(err => setUpdateError(String(err)))}>View release</button> : null}
              {availableUpdate && !downloadedUpdate ? <button disabled={updateBusy || !availableUpdate.assetUrl} onClick={() => onDownloadUpdate().catch((err) => setUpdateError(String(err)))}>Download {availableUpdate.version}</button> : null}
              {downloadedUpdate && canAutoInstall ? <button disabled={updateBusy} onClick={() => onInstallUpdate(false).catch((err) => setUpdateError(String(err)))}>Install now</button> : null}
              {downloadedUpdate && canAutoInstall ? <button disabled={updateBusy} onClick={() => onInstallUpdate(true).catch((err) => setUpdateError(String(err)))}>Install next reboot</button> : null}
            </div>
            {updateStatus ? <small className="update-status">{updateStatus}</small> : null}
            {availableUpdate?.notes ? <details><summary>What’s new in {availableUpdate.version}</summary><p>{availableUpdate.notes.slice(0, 1200)}</p></details> : null}
            <div className="rollback-settings">
              <div>
                <strong>Rollback</strong>
                <small>Restore the immediately previous stable release. Automatic installation pauses after rollback so the older version can stay installed. Your dashboard settings are retained.</small>
              </div>
              <div className="update-actions">
                <button disabled={updateBusy} onClick={() => onSave(draft).then(() => onCheckForRollback(draft.githubUpdateToken)).catch((err) => setUpdateError(String(err)))}>
                  {previousRelease ? "Refresh previous release" : "Find previous release"}
                </button>
                {previousRelease ? (
                  <button className="rollback-button" disabled={updateBusy || !previousRelease.assetUrl || !canAutoInstall} onClick={() => onRollback().catch((err) => setUpdateError(String(err)))}>
                    Rollback to {previousRelease.version}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          {updateError ? <p className="error-line" role="alert">{updateError}</p> : null}
        </section>
        {WIDGET_FEATURE_FLAGS.calendar ? <section id="settings-calendar" hidden={activeSection !== "calendar"} className="settings-section calendar-settings-group">
          <div className="calendar-display-summary"><strong>Calendar display</strong><span>Outlook style · Work shows Monday–Friday, 9 AM–6 PM only. Day and Week also offer a full-day view.</span><label>Calendar view<select value={normalizeCalendarView(draft.calendarViewMode)} onChange={event => setDraft({ ...draft, calendarViewMode: normalizeCalendarView(event.target.value) })}><option value="day">Day</option><option value="work">Work · Monday–Friday</option><option value="week">Week · Sunday–Saturday</option></select></label></div>
          <div className="calendar-settings-subgroup">
          <div className="provider-panel">
            <div>
              <strong>Google Calendar</strong>
              <span>{googleConnected ? "Live sync connected" : "Live sync"}</span>
              {calendarAdvancedOpen ? <small>{googleClientSource}: {maskClientId(activeGoogleClientId)}</small> : null}
            </div>
            <button onClick={() => saveThenConnect("google")} className={googleConnected ? "connected" : ""}>
              {googleConnected ? "Google Connected" : "Sign in with Google"}
            </button>
          </div>
          <div className="setup-grid single">
            <label>
              <span>Calendar ID</span>
              <input
                value={draft.calendarId || "primary"}
                onChange={(event) => setDraft({ ...draft, calendarId: event.target.value })}
              />
            </label>
            <label>
              <span>Calendar Timezone</span>
              <select
                value={normalizeTimeZone(draft.googleCalendarTimeZone)}
                onChange={(event) => setDraft({ ...draft, googleCalendarTimeZone: event.target.value })}
              >
                {calendarTimeZoneOptions().map((timeZone) => (
                  <option key={timeZone} value={timeZone}>{timeZone}</option>
                ))}
              </select>
            </label>
          </div>
          <button className="advanced-toggle" onClick={() => setCalendarAdvancedOpen((open) => !open)}>
            {calendarAdvancedOpen ? "Hide Calendar Advanced" : "Calendar Advanced"}
          </button>
          {calendarAdvancedOpen ? (
            <div className="setup-grid advanced-grid">
              <label>
                <span>Google Client ID</span>
                <input
                  value={draft.googleClientId || ""}
                  placeholder={env.googleClientId ? "Loaded from keys.env" : "Google OAuth client ID"}
                  onChange={(event) => setDraft({ ...draft, googleClientId: event.target.value })}
                />
              </label>
              <label>
                <span>Google Client Secret</span>
                <input
                  type="password"
                  value={draft.googleClientSecret || ""}
                  placeholder={env.googleClientSecret ? "Loaded from keys.env" : "Only needed for Web clients"}
                  onChange={(event) => setDraft({ ...draft, googleClientSecret: event.target.value })}
                />
              </label>
              <label>
                <span>Google Redirect URI</span>
                <input
                  value={draft.googleRedirectUri || DEFAULT_GOOGLE_REDIRECT_URI}
                  onChange={(event) => setDraft({ ...draft, googleRedirectUri: event.target.value })}
                />
              </label>
            </div>
          ) : null}
          {googleConnected ? <button className="section-secondary" onClick={() => onDisconnect("google")}>Clear Google</button> : null}
          </div>

        <div className="calendar-settings-subgroup">
          <div className="provider-panel">
            <div>
              <strong>Microsoft Calendar</strong>
              <span>{microsoftConnected ? "Microsoft Graph connected" : "Microsoft 365 / Outlook"}</span>
              <small>Sign in through Microsoft Entra in the system browser</small>
            </div>
            <button onClick={() => saveThenConnect("microsoft")} className={microsoftConnected ? "connected" : ""}>
              {microsoftConnected ? "Microsoft Connected" : "Sign in with Microsoft"}
            </button>
          </div>
          <div className="setup-grid advanced-grid single">
            <label>
              <span>Microsoft Application ID</span>
              <input
                value={draft.microsoftClientId || ""}
                placeholder={env.microsoftClientId ? "Loaded from keys.env" : "Entra application client ID"}
                onChange={(event) => setDraft({ ...draft, microsoftClientId: event.target.value })}
              />
            </label>
            <label>
              <span>Microsoft Tenant</span>
              <input
                value={draft.microsoftTenant || "common"}
                placeholder="common"
                onChange={(event) => setDraft({ ...draft, microsoftTenant: event.target.value })}
              />
            </label>
            <label>
              <span>Microsoft Redirect URI</span>
              <input
                value={draft.microsoftRedirectUri || DEFAULT_MICROSOFT_REDIRECT_URI}
                onChange={(event) => setDraft({ ...draft, microsoftRedirectUri: event.target.value })}
              />
            </label>
          </div>
          {microsoftConnected ? <button className="section-secondary" onClick={() => onDisconnect("microsoft")}>Clear Microsoft</button> : null}
        </div>

        <div className="calendar-settings-subgroup">
          <div className="provider-panel">
            <div>
              <strong>iCalendar</strong>
              <span>{draft.icalCalendarUrl ? "Read-only feed" : "Public calendar feed"}</span>
              <small>No sign-in, application ID, or Microsoft tenant required</small>
            </div>
            {draft.icalCalendarUrl ? <button onClick={() => setDraft({ ...draft, icalCalendarUrl: undefined })}>Clear Feed</button> : null}
          </div>
          <div className="setup-grid single">
            <label>
              <span>iCalendar URL</span>
              <input
                type="url"
                value={draft.icalCalendarUrl || ""}
                placeholder="https://calendar.example.com/public.ics"
                onChange={(event) => setDraft({ ...draft, icalCalendarUrl: event.target.value })}
              />
            </label>
          </div>
          <p className="setup-note">Paste a public .ics or webcal:// link. The calendar is read-only and refreshed with the dashboard.</p>
        </div>
        </section> : null}

        {WIDGET_FEATURE_FLAGS.spotify ? <section id="settings-spotify" hidden={activeSection !== "spotify"} className="settings-section">
          <div className="provider-panel">
            <div>
              <strong>Spotify</strong>
              <span>{spotifyConnected ? "Playback connected" : "Playback controls"}</span>
              <small>{env.spotifyClientId ? "Client defaults loaded from keys.env" : "Client credentials saved in Settings"}</small>
            </div>
            <button onClick={() => saveThenConnect("spotify")} className={spotifyConnected ? "connected" : ""}>
              {spotifyConnected ? "Spotify Connected" : "Connect Spotify"}
            </button>
          </div>
          <div className="setup-grid single music-source-setting"><label><span>Playback controls</span><select value={normalizeSpotifyMode(draft.spotifyControlMode)} onChange={event => setDraft({ ...draft, spotifyControlMode: normalizeSpotifyMode(event.target.value) })}><option value="auto">Automatic · local Spotify first</option><option value="local">Local Spotify only · no Web API</option><option value="api">Spotify Web API</option></select></label></div>
          <p className="setup-note">Local playback and track details work without an API login. Like/save and full controls use the optional Spotify client connector.</p>
          <div className="music-connector-actions"><button onClick={() => invoke<string | null>("export_spotify_connector").then(path => setSaveState(path ? "Connector saved. Follow the setup guide to install it in Spotify." : "")).catch(error => setSaveState(String(error)))}>Export local connector</button><button onClick={() => openUrl("https://github.com/BananaAficionado/DailyDashboard/blob/main/integrations/spotify/README.md")}>Setup guide</button></div>
          <label className="checkbox-setting music-art-setting"><input type="checkbox" checked={Boolean(draft.spotifyHideAlbumArt)} onChange={event => setDraft({ ...draft, spotifyHideAlbumArt: event.target.checked })} /> Hide album art and expand media controls</label>
          <div className="setup-grid">
            <label>
              <span>Spotify Client ID</span>
              <input
                value={draft.spotifyClientId || ""}
                placeholder={env.spotifyClientId ? "Loaded from keys.env" : "Spotify client ID"}
                onChange={(event) => setDraft({ ...draft, spotifyClientId: event.target.value })}
              />
            </label>
            <label>
              <span>Spotify Client Secret</span>
              <input
                type="password"
                value={draft.spotifyClientSecret || ""}
                placeholder={env.spotifyClientSecret ? "Loaded from keys.env" : "Optional for PKCE"}
                onChange={(event) => setDraft({ ...draft, spotifyClientSecret: event.target.value })}
              />
            </label>
          </div>
          <button className="advanced-toggle" onClick={() => setSpotifyAdvancedOpen((open) => !open)}>
            {spotifyAdvancedOpen ? "Hide Spotify Advanced" : "Spotify Advanced"}
          </button>
          {spotifyAdvancedOpen ? (
            <div className="setup-grid advanced-grid single">
              <label>
                <span>Spotify Redirect URI</span>
                <input
                  value={draft.spotifyRedirectUri || DEFAULT_SPOTIFY_REDIRECT_URI}
                  onChange={(event) => setDraft({ ...draft, spotifyRedirectUri: event.target.value })}
                />
              </label>
            </div>
          ) : null}
          {spotifyConnected ? <button className="section-secondary" onClick={() => onDisconnect("spotify")}>Clear Spotify</button> : null}
        </section> : null}

        {WIDGET_FEATURE_FLAGS.weather ? <section id="settings-weather" hidden={activeSection !== "weather"} className="settings-section">
          <div className="provider-panel">
            <div>
              <strong>Weather</strong>
              <span>{draft.weatherLocation ? "Location configured" : "Location needed"}</span>
              <small>{draft.weatherLocation ? `${draft.weatherLocation.name}${draft.weatherLocation.admin1 ? `, ${draft.weatherLocation.admin1}` : ""}` : "Set this from the Weather widget"}</small>
            </div>
            {draft.weatherLocation ? (
              <button onClick={() => setDraft({ ...draft, weatherLocation: undefined })}>Clear Location</button>
            ) : null}
          </div>
          <div className="setup-grid weather-settings-grid">
            <label>
              <span>Weather Location</span>
              <input
                value={weatherDraftQuery}
                placeholder="City or suburb"
                onChange={(event) => setWeatherDraftQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    setManualWeatherLocation();
                  }
                }}
              />
            </label>
            <div className="weather-settings-actions">
              <button onClick={setManualWeatherLocation}>{weatherDraftSearching ? "Searching" : "Search"}</button>
              <button onClick={setCurrentWeatherLocation}>Use Location</button>
            </div>
          </div>
          {weatherDraftError ? <p className="error-line">{weatherDraftError}</p> : null}
        </section> : null}

        {WIDGET_FEATURE_FLAGS.aircraft ? <section id="settings-aircraft" hidden={activeSection !== "aircraft"} className="settings-section">
          <div className="provider-panel">
            <div>
              <strong>Live Aircraft (ADS-B)</strong>
              <span>{draft.adsbLocation ? "Location configured" : draft.weatherLocation ? "Using weather location" : "Location needed"}</span>
              <small>ADSB.lol by default; ADSB Exchange-compatible endpoints can be configured below.</small>
            </div>
            {draft.adsbLocation ? <button onClick={() => setDraft({ ...draft, adsbLocation: undefined })}>Use Weather Location</button> : null}
          </div>
          <div className="setup-grid weather-settings-grid">
            <label>
              <span>Aircraft Map Location</span>
              <input value={adsbDraftQuery} placeholder="City or suburb" onChange={(event) => setAdsbDraftQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setAdsbLocation(); } }} />
            </label>
            <div className="weather-settings-actions">
              <button onClick={() => setAdsbLocation()}>{adsbDraftSearching ? "Searching" : "Search"}</button>
              <button onClick={() => setAdsbLocation(true)}>Use Location</button>
            </div>
          </div>
          <div className="setup-grid">
            <label>
              <span>API URL Template</span>
              <input value={draft.adsbApiUrl || DEFAULT_ADSB_API_URL} onChange={(event) => setDraft({ ...draft, adsbApiUrl: event.target.value })} />
              <small>Use &#123;lat&#125;, &#123;lon&#125; and &#123;radius&#125; placeholders.</small>
            </label>
            <label>
              <span>API Key (optional)</span>
              <input type="password" value={draft.adsbApiKey || ""} placeholder="RapidAPI / provider key" onChange={(event) => setDraft({ ...draft, adsbApiKey: event.target.value })} />
            </label>
          </div>
          <label className="checkbox-setting"><input type="checkbox" checked={Boolean(draft.adsbGraphicOnly)} onChange={(event) => setDraft({ ...draft, adsbGraphicOnly: event.target.checked })} /> Aircraft graphics only by default</label>
          {adsbDraftError ? <p className="error-line">{adsbDraftError}</p> : null}
        </section> : null}

        {WIDGET_FEATURE_FLAGS.codex ? <section id="settings-codex" hidden={activeSection !== "codex"} className="settings-section">
          <div className="provider-panel">
            <div>
              <strong>Codex</strong>
              <span>{draft.codexAccountEmail ? "OpenAI account noted" : "OpenAI account"}</span>
              <small>{draft.codexAccountEmail || "Sign in through Codex"}</small>
            </div>
            <button onClick={saveThenOpenCodex}>Open Codex</button>
          </div>
          <div className="setup-grid">
            <label>
              <span>OpenAI Account Email</span>
              <input
                value={draft.codexAccountEmail || ""}
                placeholder="you@example.com"
                onChange={(event) => setDraft({ ...draft, codexAccountEmail: event.target.value })}
              />
            </label>
            <label>
              <span>Action Approvals</span>
              <select
                value={normalizeCodexApprovalMode(draft.codexApprovalMode)}
                onChange={(event) => setDraft({ ...draft, codexApprovalMode: normalizeCodexApprovalMode(event.target.value) })}
              >
                {Object.entries(CODEX_APPROVAL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="setup-grid advanced-grid single">
            <label>
              <span>Codex Open URL</span>
              <input
                value={draft.codexOpenUrl || DEFAULT_CODEX_OPEN_URL}
                onChange={(event) => setDraft({ ...draft, codexOpenUrl: event.target.value })}
              />
            </label>
            <label>
              <span>Codex Web URL</span>
              <input
                value={draft.codexWebUrl || DEFAULT_CODEX_WEB_URL}
                onChange={(event) => setDraft({ ...draft, codexWebUrl: event.target.value })}
              />
            </label>
          </div>
        </section> : null}

        {WIDGET_FEATURE_FLAGS.terminal ? <section id="settings-terminal" hidden={activeSection !== "terminal"} className="settings-section">
          <div className="provider-panel">
            <div>
              <strong>Command Line</strong>
              <span>System shell</span>
              <small>{draft.terminalWorkingDirectory?.trim() || "Default working directory"}</small>
            </div>
          </div>
          <div className="setup-grid single">
            <label>
              <span>Working Directory</span>
              <input
                value={draft.terminalWorkingDirectory || ""}
                placeholder="Leave blank for the app default"
                onChange={(event) => setDraft({ ...draft, terminalWorkingDirectory: event.target.value })}
              />
            </label>
          </div>
        </section> : null}

        <section id="settings-layout" hidden={activeSection !== "layout"} className="layout-settings">
          <strong>Visible Widgets</strong>
          <div className="widget-order">
            {widgetLayout.order.map((widget) => (
              <button
                key={widget}
                className={widgetLayout.visible.includes(widget) ? "selected" : ""}
                aria-pressed={widgetLayout.visible.includes(widget)}
                onClick={() => {
                  const nextLayout = widgetLayout.visible.includes(widget)
                    ? { ...widgetLayout, visible: widgetLayout.visible.filter((item) => item !== widget) }
                    : addWidgetToLayout(widgetLayout, widget);
                  setDraft((current) => ({ ...current, widgetLayout: nextLayout }));
                  onSaveLayout(nextLayout).catch(() => setSaveState("Could not save widget visibility. Try again."));
                }}
              >
                {widgetLabel(widget)}
              </button>
            ))}
          </div>
        </section>
        {activeSection === "calendar" || activeSection === "spotify" ? <p className="setup-note">Redirect URIs must use http://127.0.0.1 with port 1024 or higher.</p> : null}
        </div>
        </div>
        <footer className="settings-footer">
          <div role="status" aria-live="polite">{error || saveState || status || (activeSection === "layout" ? "Widget visibility saves immediately." : "Changes apply when you save.")}</div>
          <button className="settings-save" onClick={save} disabled={saveState === "Saving…"}>Save settings</button>
        </footer>
      </section>
    </div>
  );
}

function CalendarEventDetails({ event, timeZone, onClose }: { event: CalendarEvent; timeZone: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);
  const attendees = (event.attendees || []).filter((attendee) => !attendee.self);
  return (
    <section className="calendar-event-dialog" role="dialog" aria-label={event.summary || "Event details"} onKeyDown={(key) => { if (key.key === "Escape") { key.stopPropagation(); onClose(); } }}>
      <header><div><small>{event.calendarSummary || "Calendar event"}</small><h2>{event.summary || "Untitled event"}</h2></div><button ref={closeRef} className="icon-button" title="Close event details" onClick={onClose}><X size={18} /></button></header>
      <div className="event-details">
        <div><span>When</span><strong>{new Date(event.start.dateTime || `${event.start.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", ...(event.start.dateTime ? { timeZone } : {}) })}</strong><p>{event.start.dateTime ? `${formatEventTime(event.start.dateTime, event.start.date, timeZone)} – ${formatEventTime(event.end.dateTime, event.end.date, timeZone)}` : "All day"}</p></div>
        {event.location ? <div><span>Location</span><p>{event.location}</p></div> : null}
        {event.organizer?.displayName || event.organizer?.email ? <div><span>Organiser</span><p>{event.organizer.displayName || event.organizer.email}</p></div> : null}
        {attendees.length ? <div><span>Attendees</span><p>{attendees.map((attendee) => attendee.displayName || attendee.email).filter(Boolean).join(", ")}</p></div> : null}
        {event.hangoutLink ? <div><span>Meeting link</span><p>{event.hangoutLink}</p></div> : null}
        {event.description ? <div><span>Notes</span><p>{stripHtml(event.description)}</p></div> : null}
      </div>
    </section>
  );
}

function MeetingReminder({ event, onDismiss }: { event: CalendarEvent; onDismiss: () => void }) {
  const [startX, setStartX] = useState<number | null>(null);
  const start = formatEventTime(event.start.dateTime, event.start.date, normalizeTimeZone());
  return (
    <div
      className="meeting-reminder"
      onPointerDown={(pointerEvent) => setStartX(pointerEvent.clientX)}
      onPointerUp={(pointerEvent) => {
        if (startX !== null && pointerEvent.clientX - startX < -80) {
          onDismiss();
        }
        setStartX(null);
      }}
    >
      <button className="reminder-dismiss" title="Dismiss meeting reminder" onClick={onDismiss}>×</button>
      <strong>{event.summary || "Upcoming meeting"}</strong>
      <span>{start}{event.location ? ` · ${event.location}` : ""}</span>
    </div>
  );
}

async function writeToken(provider: Provider, token: TokenBundle) {
  if (isTauri()) await invoke("save_saved_token", { provider, token });
  localStorage.removeItem(TOKEN_KEYS[provider]);
}

function normalizeToken(token: { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }, fallbackRefresh?: string): TokenBundle {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || fallbackRefresh,
    expiresAt: Date.now() + (token.expires_in || 3600) * 1000,
    scope: token.scope,
  };
}

function spotifyMediaFromItem(item: unknown): SpotifyMediaItem | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  const candidate = item as {
    id?: unknown;
    uri?: unknown;
    name?: unknown;
    type?: unknown;
    artists?: unknown;
    album?: unknown;
    show?: unknown;
    duration_ms?: unknown;
  };
  if (typeof candidate.id !== "string" || typeof candidate.name !== "string" || typeof candidate.duration_ms !== "number") {
    return null;
  }

  if (candidate.type === "episode") {
    const show = objectValue(candidate.show);
    const showName = stringValue(show?.name) || "Podcast";
    const publisher = stringValue(show?.publisher);
    return {
      id: candidate.id,
      uri: stringValue(candidate.uri) || `spotify:episode:${candidate.id}`,
      name: candidate.name,
      type: "episode",
      subtitle: showName,
      caption: publisher || "Podcast episode",
      images: imageArray(show?.images),
      duration_ms: candidate.duration_ms,
    };
  }

  if (candidate.type && candidate.type !== "track") {
    return null;
  }
  const album = objectValue(candidate.album);
  const artists = Array.isArray(candidate.artists)
    ? candidate.artists.map((artist) => stringValue(objectValue(artist)?.name)).filter(Boolean)
    : [];
  const albumName = stringValue(album?.name) || "Spotify";
  if (!album || !artists.length) {
    return null;
  }
  return {
    id: candidate.id,
    uri: stringValue(candidate.uri) || `spotify:track:${candidate.id}`,
    name: candidate.name,
    type: "track",
    subtitle: artists.join(", "),
    caption: albumName,
    images: imageArray(album.images),
    duration_ms: candidate.duration_ms,
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function imageArray(value: unknown): SpotifyImage[] {
  return Array.isArray(value) ? value.filter(isSpotifyImage) : [];
}

function isSpotifyImage(value: unknown): value is SpotifyImage {
  const image = objectValue(value);
  return Boolean(
    image &&
      typeof image.url === "string" &&
      typeof image.height === "number" &&
      typeof image.width === "number"
  );
}

function normalizeAircraft(value: unknown): Aircraft[] {
  const root = objectValue(value);
  const candidates = Array.isArray(root?.ac) ? root.ac : Array.isArray(root?.aircraft) ? root.aircraft : [];
  return candidates.flatMap((entry): Aircraft[] => {
    const item = objectValue(entry);
    const latitude = numberValue(item?.lat ?? item?.latitude);
    const longitude = numberValue(item?.lon ?? item?.longitude);
    if (!item || latitude == null || longitude == null) return [];
    return [{
      id: stringValue(item.hex) || stringValue(item.icao) || `${latitude}-${longitude}`,
      flight: stringValue(item.flight).trim() || stringValue(item.callsign).trim(),
      registration: stringValue(item.r) || stringValue(item.registration),
      aircraftType: stringValue(item.t) || stringValue(item.type),
      latitude,
      longitude,
      altitude: numberValue(item.alt_baro ?? item.altitude),
      onGround: item.alt_baro === "ground" || item.altitude === "ground",
      speed: numberValue(item.gs ?? item.speed),
      heading: numberValue(item.track ?? item.heading) || 0,
      verticalRate: numberValue(item.baro_rate ?? item.vertical_rate),
    }];
  });
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && value !== "ground") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatAltitude(value: number | null) {
  return value == null ? "—" : `${Math.round(value).toLocaleString()} ft`;
}

function formatSpeed(value: number | null) {
  return value == null ? "—" : `${Math.round(value)} kt`;
}

function normalizeAppScale(value?: number): AppScale {
  return APP_SCALES.includes(value as AppScale) ? value as AppScale : 100;
}

function normalizeIdleBackground(value?: string): IdleBackgroundKind {
  if (value === "reactive") return "stars";
  return ["waves", "fish", "stars", "topographic", "slideshow"].includes(value || "") ? value as IdleBackgroundKind : "waves";
}

function normalizeSlideshowFit(value?: string): SlideshowFit {
  return value === "contain" ? "contain" : "crop";
}

function normalizeUpdatePreference(value?: string): UpdatePreference {
  return ["notify", "auto-download", "auto-install", "ignore"].includes(value || "") ? value as UpdatePreference : "notify";
}

function normalizeClockTimeZone(value?: string) {
  if (!value || value === "system") return "system";
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value }).format();
    return value;
  } catch {
    return "system";
  }
}

function normalizeClockFaceMode(value?: string): ClockFaceMode | undefined {
  return value === "analog" || value === "digital" ? value : undefined;
}

function normalizeSettings(settings: StoredSettings): StoredSettings {
  return {
    ...settings,
    googleClientId: settings.googleClientId?.trim(),
    googleClientSecret: settings.googleClientSecret?.trim(),
    microsoftClientId: settings.microsoftClientId?.trim(),
    microsoftTenant: settings.microsoftTenant?.trim() || "common",
    googleRedirectUri: settings.googleRedirectUri?.trim(),
    microsoftRedirectUri: settings.microsoftRedirectUri?.trim() || DEFAULT_MICROSOFT_REDIRECT_URI,
    googleCalendarTimeZone: normalizeTimeZone(settings.googleCalendarTimeZone),
    calendarStyle: normalizeCalendarStyle(settings.calendarStyle),
    calendarViewMode: normalizeCalendarView(settings.calendarViewMode),
    icalCalendarUrl: normalizeIcalCalendarUrl(settings.icalCalendarUrl),
    spotifyHideAlbumArt: Boolean(settings.spotifyHideAlbumArt),
    spotifyControlMode: normalizeSpotifyMode(settings.spotifyControlMode),
    spotifyClientId: settings.spotifyClientId?.trim(),
    spotifyClientSecret: settings.spotifyClientSecret?.trim(),
    spotifyRedirectUri: normalizeSpotifyRedirect(settings.spotifyRedirectUri),
    codexAccountEmail: settings.codexAccountEmail?.trim(),
    codexApprovalMode: normalizeCodexApprovalMode(settings.codexApprovalMode),
    codexOpenUrl: normalizeCodexOpenUrl(settings.codexOpenUrl),
    codexWebUrl: normalizeCodexWebUrl(settings.codexWebUrl),
    terminalWorkingDirectory: settings.terminalWorkingDirectory?.trim(),
    calendarId: settings.calendarId?.trim() || "primary",
    weatherLocation: settings.weatherLocation,
    appScale: normalizeAppScale(settings.appScale),
    adsbLocation: settings.adsbLocation,
    adsbApiUrl: settings.adsbApiUrl?.trim() || DEFAULT_ADSB_API_URL,
    adsbApiKey: settings.adsbApiKey?.trim(),
    adsbGraphicOnly: Boolean(settings.adsbGraphicOnly),
    idleBackground: normalizeIdleBackground(settings.idleBackground),
    idleMapLocation: settings.idleMapLocation,
    idleSlideshowFolder: settings.idleSlideshowFolder?.trim(),
    idleSlideshowFit: normalizeSlideshowFit(settings.idleSlideshowFit),
    updatePreference: normalizeUpdatePreference(settings.updatePreference),
    startupUpdatePolicyVersion: 2,
    githubUpdateToken: settings.githubUpdateToken?.trim(),
    clockTimeZone: normalizeClockTimeZone(settings.clockTimeZone),
    clockFaceMode: normalizeClockFaceMode(settings.clockFaceMode),
    widgetLayout: normalizeWidgetLayout(settings.widgetLayout),
    selectedCalendarIds: Array.isArray(settings.selectedCalendarIds)
      ? settings.selectedCalendarIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())
      : undefined,
  };
}

function normalizeCalendarStyle(_style?: string): CalendarStyle {
  return "outlook";
}

function normalizeWidgetLayout(layout?: WidgetLayout): WidgetLayout {
  const storedMode = (layout?.mode as string | undefined) || DEFAULT_WIDGET_LAYOUT.mode;
  const mode: WidgetLayoutMode = storedMode === "focus" ? "focus" : "thirds";
  const order = (layout?.order || DEFAULT_WIDGET_LAYOUT.order).filter(isEnabledWidgetId);
  const legacyLayout = Boolean(layout) && !layout?.order?.includes("calendar");
  const visible = (layout?.visible || DEFAULT_WIDGET_LAYOUT.visible).filter(isEnabledWidgetId);
  if (legacyLayout && !visible.includes("calendar")) {
    visible.unshift("calendar");
  }
  const enabledDefaults = DEFAULT_WIDGET_LAYOUT.order.filter(isEnabledWidgetId);
  const withMissing = [...order, ...enabledDefaults.filter((widget) => !order.includes(widget))];
  const visibleWithOrder = withMissing.filter((widget) => visible.includes(widget));
  const thirdsStacked = storedMode === "side-stack" || (layout ? Boolean(layout.thirdsStacked) : Boolean(DEFAULT_WIDGET_LAYOUT.thirdsStacked));
  const sizes = withMissing.reduce<Partial<Record<WidgetId, WidgetSize>>>((next, widget) => {
    const size = layout?.sizes?.[widget];
    next[widget] = isWidgetSize(size) ? size : DEFAULT_WIDGET_SIZES[widget];
    return next;
  }, {});
  const normalizedVisible = layout ? visibleWithOrder : DEFAULT_WIDGET_LAYOUT.visible.filter(isEnabledWidgetId);
  const stacks = packWidgetStacks(withMissing, normalizedVisible, layout?.stacks || DEFAULT_WIDGET_LAYOUT.stacks, sizes);
  return {
    mode,
    order: withMissing.slice(0, enabledDefaults.length),
    visible: normalizedVisible,
    thirdsStacked,
    sizes,
    stacks,
  };
}

function buildDashboardEntries(layout: WidgetLayout): DashboardEntry[] {
  const visible = layout.order.filter((widget) => layout.visible.includes(widget));
  const stacks = cleanWidgetStacks(layout.stacks, visible);
  const stackedWidgets = new Set(stacks.flat());
  const groups: WidgetId[][] = [];

  visible.forEach((widget) => {
    if (stackedWidgets.has(widget)) {
      const stack = stacks.find((pair) => pair.includes(widget));
      if (stack && stack[0] === widget) {
        groups.push(stack);
      }
      return;
    }
    groups.push([widget]);
  });

  if (!groups.length) {
    return [];
  }
  const requestedWide = (widget: WidgetId) => layout.sizes?.[widget] === "wide";
  const singleEntry = (widget: WidgetId, size: WidgetSize, column: number, row = 1): DashboardEntry => ({
    widget,
    size,
    gridColumn: size === "full" ? "1 / -1" : size === "wide" ? `${column} / span 2` : String(column),
    gridRow: size === "half" ? String(row) : "1 / span 2",
  });
  const stackedEntries = (group: WidgetId[], column: number) => (
    group.map((widget, index) => singleEntry(widget, "half", column, index + 1))
  );

  if (groups.length === 1 && groups[0].length === 1) {
    return [singleEntry(groups[0][0], "full", 1)];
  }
  if (groups.length === 1 && groups[0].length === 2) {
    return [
      singleEntry(groups[0][0], "wide", 1),
      singleEntry(groups[0][1], "tall", 3),
    ];
  }
  if (groups.length === 2 && groups.every((group) => group.length === 1)) {
    const requestedWideIndex = groups.findIndex((group) => requestedWide(group[0]));
    const wideIndex = requestedWideIndex === -1 ? 0 : requestedWideIndex;
    return groups.map((group, index) => (
      index === wideIndex
        ? singleEntry(group[0], "wide", index === 0 ? 1 : 2)
        : singleEntry(group[0], "tall", index === 0 ? 1 : 3)
    ));
  }
  if (groups.length === 2 && groups.some((group) => group.length === 2) && groups.some((group) => group.length === 1)) {
    return groups.flatMap((group, index) => (
      group.length === 2
        ? stackedEntries(group, index === 0 ? 1 : 3)
        : [singleEntry(group[0], "wide", index === 0 ? 1 : 2)]
    ));
  }

  return groups.flatMap((group, index) => (
    group.length === 2
      ? stackedEntries(group, index + 1)
      : [singleEntry(group[0], "tall", index + 1)]
  ));
}

function mockWidgetLayout(widget: WidgetId, size: WidgetSize): WidgetLayout {
  const peers = DEFAULT_WIDGET_LAYOUT.order.filter(id => id !== widget);
  const [first, second] = peers;
  const order = [widget, ...peers];
  if (size === "full") return { ...DEFAULT_WIDGET_LAYOUT, order, visible: [widget], sizes: { ...DEFAULT_WIDGET_SIZES, [widget]: "full" }, stacks: [] };
  if (size === "wide") return { ...DEFAULT_WIDGET_LAYOUT, order, visible: [widget, first], sizes: { ...DEFAULT_WIDGET_SIZES, [widget]: "wide", [first]: "tall" }, stacks: [] };
  if (size === "tall") return { ...DEFAULT_WIDGET_LAYOUT, order, visible: [widget, first], sizes: { ...DEFAULT_WIDGET_SIZES, [widget]: "tall", [first]: "wide" }, stacks: [] };
  return { ...DEFAULT_WIDGET_LAYOUT, order, visible: [widget, first, second], sizes: { ...DEFAULT_WIDGET_SIZES, [widget]: "half", [first]: "half", [second]: "wide" }, stacks: [[widget, first]] };
}

function mockClockWidgetLayout(size: WidgetSize): WidgetLayout {
  const order: WidgetId[] = ["clock", "calendar", "weather", ...DEFAULT_WIDGET_LAYOUT.order.filter((widget) => widget !== "clock" && widget !== "calendar" && widget !== "weather")];
  if (size === "full") return { ...DEFAULT_WIDGET_LAYOUT, order, visible: ["clock"], sizes: { ...DEFAULT_WIDGET_SIZES, clock: "full" }, stacks: [] };
  if (size === "wide") return { ...DEFAULT_WIDGET_LAYOUT, order, visible: ["clock", "weather"], sizes: { ...DEFAULT_WIDGET_SIZES, clock: "wide", weather: "tall" }, stacks: [] };
  if (size === "tall") return { ...DEFAULT_WIDGET_LAYOUT, order, visible: ["clock", "calendar"], sizes: { ...DEFAULT_WIDGET_SIZES, clock: "tall", calendar: "wide" }, stacks: [] };
  return { ...DEFAULT_WIDGET_LAYOUT, order, visible: ["clock", "weather", "calendar"], sizes: { ...DEFAULT_WIDGET_SIZES, clock: "half", weather: "half", calendar: "wide" }, stacks: [["clock", "weather"]] };
}

function addWidgetToLayout(layout: WidgetLayout, widget: WidgetId): WidgetLayout {
  if (layout.visible.includes(widget)) {
    return normalizeWidgetLayout(layout);
  }
  const visible = [...layout.visible, widget];
  const activeBefore = buildDashboardEntries(layout);
  const stacks = cleanWidgetStacks(layout.stacks, visible);

  const wideEntry = activeBefore.find((entry) => entry.size === "wide");
  const tallEntry = activeBefore.find((entry) => entry.size === "tall");
  if (activeBefore.length === 2 && wideEntry && tallEntry) {
    const sizes = { ...layout.sizes };
    [...layout.visible, widget].forEach((item) => {
      sizes[item] = "tall";
    });
    return normalizeWidgetLayout({ ...layout, visible, sizes, stacks: [] });
  }

  const isThreeFullHeightThirds = activeBefore.length === 3 && activeBefore.every((entry) => entry.size === "tall");
  if (isThreeFullHeightThirds) {
    const farRight = activeBefore[activeBefore.length - 1].widget;
    return stackWidgets({ ...layout, visible, stacks }, farRight, widget, "bottom");
  }

  return normalizeWidgetLayout({ ...layout, visible, stacks });
}

function placeWidgetInGrid(layout: WidgetLayout, dragged: WidgetId, mode: GridDropMode): WidgetLayout {
  const visible = Array.from(new Set([...layout.visible, dragged])).filter(isWidgetId);
  const remainingVisible = visible.filter((widget) => widget !== dragged);
  const remainingOrder = layout.order.filter((widget) => widget !== dragged);
  const orderedRemaining = remainingOrder.filter((widget) => remainingVisible.includes(widget));
  const insertIndex = mode === "third-left" ? 0 : mode === "third-right" ? orderedRemaining.length : Math.min(1, orderedRemaining.length);
  const visibleOrder = [
    ...orderedRemaining.slice(0, insertIndex),
    dragged,
    ...orderedRemaining.slice(insertIndex),
  ];
  const order = [
    ...visibleOrder,
    ...DEFAULT_WIDGET_LAYOUT.order.filter((widget) => !visibleOrder.includes(widget)),
  ];
  const sizes = { ...layout.sizes };
  visibleOrder.forEach((widget) => {
    if (widget === dragged) {
      sizes[widget] = mode === "wide-centre" ? "wide" : "tall";
      return;
    }
    sizes[widget] = mode !== "wide-centre" && visibleOrder.length === 2 ? "wide" : "tall";
  });

  return normalizeWidgetLayout({
    ...layout,
    order,
    visible: visibleOrder,
    sizes,
    stacks: cleanWidgetStacks(layout.stacks, remainingVisible),
  });
}

function moveWidgetBesideTarget(layout: WidgetLayout, dragged: WidgetId, target: WidgetId, side: WidgetBumpSide): WidgetLayout {
  const visible = Array.from(new Set([...layout.visible, dragged, target])).filter(isWidgetId);
  const remainingVisible = visible.filter((widget) => widget !== dragged);
  const remainingOrder = layout.order.filter((widget) => widget !== dragged);
  const orderedRemaining = remainingOrder.filter((widget) => remainingVisible.includes(widget));
  const targetStack = cleanWidgetStacks(layout.stacks, remainingVisible).find((stack) => stack.includes(target));
  const targetIndexes = targetStack
    ? targetStack.map((widget) => orderedRemaining.indexOf(widget)).filter((index) => index >= 0)
    : [orderedRemaining.indexOf(target)];
  const fallbackIndex = side === "before" ? 0 : orderedRemaining.length;
  const insertIndex = targetIndexes.length
    ? side === "before" ? Math.min(...targetIndexes) : Math.max(...targetIndexes) + 1
    : fallbackIndex;
  const visibleOrder = [
    ...orderedRemaining.slice(0, insertIndex),
    dragged,
    ...orderedRemaining.slice(insertIndex),
  ];
  const sizes = { ...layout.sizes };
  visibleOrder.forEach((widget) => {
    sizes[widget] = "tall";
  });

  return normalizeWidgetLayout({
    ...layout,
    order: [
      ...visibleOrder,
      ...DEFAULT_WIDGET_LAYOUT.order.filter((widget) => !visibleOrder.includes(widget)),
    ],
    visible: visibleOrder,
    sizes,
    stacks: cleanWidgetStacks(layout.stacks, remainingVisible),
  });
}

function stackWidgets(layout: WidgetLayout, target: WidgetId, dragged: WidgetId, position: "top" | "bottom" = "bottom"): WidgetLayout {
  const visible = Array.from(new Set([...layout.visible, target, dragged])).filter(isWidgetId);
  const pair: WidgetId[] = position === "top" ? [dragged, target] : [target, dragged];
  const orderWithoutDragged = layout.order.filter((widget) => widget !== dragged);
  const targetIndex = orderWithoutDragged.indexOf(target);
  const order = targetIndex === -1
    ? [...orderWithoutDragged, dragged]
    : [
        ...orderWithoutDragged.slice(0, targetIndex),
        ...pair,
        ...orderWithoutDragged.slice(targetIndex + 1).filter((widget) => !pair.includes(widget)),
      ];
  const stacks = cleanWidgetStacks(layout.stacks, visible)
    .filter((stack) => !stack.includes(target) && !stack.includes(dragged));
  stacks.push(pair);
  return normalizeWidgetLayout({ ...layout, order, visible, stacks });
}

function cleanWidgetStacks(stacks: WidgetId[][] | undefined, visible: WidgetId[]) {
  const visibleSet = new Set(visible);
  const used = new Set<WidgetId>();
  return (stacks || [])
    .map((stack) => stack.filter((widget): widget is WidgetId => isWidgetId(widget) && visibleSet.has(widget)))
    .filter((stack) => stack.length === 2)
    .filter((stack) => {
      if (stack.some((widget) => used.has(widget))) {
        return false;
      }
      stack.forEach((widget) => used.add(widget));
      return true;
    });
}

function packWidgetStacks(
  order: WidgetId[],
  visible: WidgetId[],
  stacks: WidgetId[][] | undefined,
  sizes?: Partial<Record<WidgetId, WidgetSize>>,
) {
  const packed = cleanWidgetStacks(stacks, visible);
  const visibleInOrder = order.filter((widget) => visible.includes(widget));

  if (visibleInOrder.length === 3 && packed.length === 0) {
    const wide = visibleInOrder.filter((widget) => sizes?.[widget] === "wide");
    const neighbours = visibleInOrder.filter((widget) => widget !== wide[0]);
    if (wide.length === 1 && neighbours.length === 2) {
      packed.push(neighbours);
    }
  }

  while (visibleInOrder.length - packed.length > 3) {
    const stacked = new Set(packed.flat());
    const singles = visibleInOrder.filter((widget) => !stacked.has(widget));
    if (singles.length < 2) {
      break;
    }
    packed.push(singles.slice(-2));
  }

  return packed;
}

function isWidgetId(value: unknown): value is WidgetId {
  return value === "calendar" || value === "clock" || value === "spotify" || value === "weather" || value === "aircraft" || value === "codex" || value === "terminal";
}

function isEnabledWidgetId(value: unknown): value is WidgetId {
  return isWidgetId(value) && WIDGET_FEATURE_FLAGS[value];
}

function isWidgetSize(value: unknown): value is WidgetSize {
  return value === "full" || value === "wide" || value === "tall" || value === "half";
}

function widgetLabel(widget: WidgetId) {
  if (widget === "calendar") {
    return "Calendar";
  }
  if (widget === "clock") {
    return "Clock";
  }
  if (widget === "spotify") {
    return "Spotify";
  }
  if (widget === "weather") {
    return "Weather";
  }
  if (widget === "aircraft") {
    return "Live Aircraft";
  }
  if (widget === "terminal") {
    return "Command Line";
  }
  return "Codex";
}

function isMyCalendarSource(source: CalendarSource) {
  return Boolean(source.primary) || source.accessRole === "owner" || source.accessRole === "writer";
}

function microsoftCalendarColor(color?: string) {
  const colors: Record<string, string> = {
    lightBlue: "#68a5ff",
    lightGreen: "#81c995",
    lightOrange: "#f6ad55",
    lightGray: "#aeb4bd",
    lightYellow: "#fdd663",
    lightTeal: "#5eead4",
    lightPink: "#f28b82",
  };
  return colors[color || ""] || "#8ab4f8";
}

function microsoftDateTime(value: string) {
  return value.endsWith("Z") ? value : `${value}Z`;
}

function microsoftEventToCalendarEvent(event: MicrosoftGraphEvent, source: CalendarSource): CalendarEvent {
  const start = event.isAllDay
    ? { date: event.start.dateTime.slice(0, 10) }
    : { dateTime: microsoftDateTime(event.start.dateTime) };
  const end = event.isAllDay
    ? { date: event.end.dateTime.slice(0, 10) }
    : { dateTime: microsoftDateTime(event.end.dateTime) };
  return {
    id: `${source.id}:${event.id}`,
    summary: event.subject || "Untitled",
    description: event.bodyPreview,
    location: event.location?.displayName,
    calendarId: source.id,
    calendarSummary: source.summary,
    calendarColor: source.backgroundColor,
    start,
    end,
    attendees: event.attendees?.map((attendee) => ({
      email: attendee.emailAddress?.address,
      displayName: attendee.emailAddress?.name,
      responseStatus: attendee.status?.response,
    })),
    organizer: event.organizer?.emailAddress
      ? { email: event.organizer.emailAddress.address, displayName: event.organizer.emailAddress.name }
      : undefined,
    htmlLink: event.webLink,
  };
}

function normalizeIcalCalendarUrl(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("webcal://")) {
    return `https://${trimmed.slice("webcal://".length)}`;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function parseIcalendarFeed(text: string, feedUrl: string, visibleDays: Date[] = []): { source: CalendarSource; events: CalendarEvent[] } {
  const lines = text
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/);
  const calendarName = lines
    .map((line) => parseIcalProperty(line))
    .find((property) => property?.name === "X-WR-CALNAME")?.value;
  const calendarColor = lines
    .map((line) => parseIcalProperty(line))
    .find((property) => property?.name === "X-APPLE-CALENDAR-COLOR")?.value;
  const source: CalendarSource = {
    id: "ical",
    summary: calendarName || icalHostName(feedUrl),
    backgroundColor: calendarColor || "#c084fc",
    selected: true,
    readOnly: true,
    accessRole: "reader",
  };
  const components: Record<string, IcalProperty[]>[] = [];
  let current: Record<string, IcalProperty[]> | null = null;

  const finishEvent = () => {
    if (current) components.push(current);
    current = null;
  };

  lines.forEach((line) => {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = {};
      return;
    }
    if (upper === "END:VEVENT") {
      finishEvent();
      return;
    }
    if (current) {
      const property = parseIcalProperty(line);
      if (property) {
        (current[property.name] ||= []).push(property);
      }
    }
  });
  finishEvent();
  const firstVisible = visibleDays[0] || addDays(startOfDay(new Date()), -366);
  const lastVisible = visibleDays[visibleDays.length - 1] || addDays(startOfDay(new Date()), 366);
  const windowStart = addDays(startOfDay(firstVisible), -1);
  const windowEnd = addDays(startOfDay(lastVisible), 2);
  const firstProperty = (component: Record<string, IcalProperty[]>, name: string) => component[name]?.[0];
  const uidOf = (component: Record<string, IcalProperty[]>, index = 0) => firstProperty(component, "UID")?.value || `${dateKey(new Date())}-${index}`;
  const exceptionComponents = components.filter((component) => firstProperty(component, "RECURRENCE-ID"));
  const exceptions = new Map<string, Record<string, IcalProperty[]>>();
  exceptionComponents.forEach((component, index) => {
    const recurrenceId = firstProperty(component, "RECURRENCE-ID");
    const parsed = recurrenceId ? parseIcalDate(recurrenceId) : null;
    if (parsed) exceptions.set(`${uidOf(component, index)}:${icalDateKey(parsed)}`, component);
  });
  const usedExceptions = new Set<Record<string, IcalProperty[]>>();
  const events: CalendarEvent[] = [];

  const addComponentEvent = (component: Record<string, IcalProperty[]>, start: CalendarEvent["start"], end: CalendarEvent["end"], id: string, fallback?: Record<string, IcalProperty[]>) => {
    const property = (name: string) => firstProperty(component, name) || (fallback ? firstProperty(fallback, name) : undefined);
    if (property("STATUS")?.value.toUpperCase() === "CANCELLED") return;
    events.push({
      id,
      summary: property("SUMMARY")?.value || "Untitled",
      description: property("DESCRIPTION")?.value,
      location: property("LOCATION")?.value,
      calendarId: source.id,
      calendarSummary: source.summary,
      calendarColor: source.backgroundColor,
      start,
      end,
      htmlLink: property("URL")?.value,
    });
  };

  components.filter((component) => !firstProperty(component, "RECURRENCE-ID")).forEach((component, index) => {
    const startProperty = firstProperty(component, "DTSTART");
    const start = startProperty ? parseIcalDate(startProperty) : null;
    if (!start) return;
    const endProperty = firstProperty(component, "DTEND");
    const end = endProperty ? parseIcalDate(endProperty) || start : start;
    const uid = uidOf(component, index);
    const exdates = (component.EXDATE || []).flatMap((property) => property.value.split(",").map((value) => parseIcalDate({ ...property, value })).filter((value): value is CalendarEvent["start"] => Boolean(value)));
    const occurrences = expandIcalRecurrence({
      start,
      end,
      rrule: firstProperty(component, "RRULE")?.value,
      exdates,
      windowStart,
      windowEnd,
    });
    occurrences.forEach((occurrence) => {
      const exception = exceptions.get(`${uid}:${occurrence.key}`);
      if (exception) {
        usedExceptions.add(exception);
        const exceptionStartProperty = firstProperty(exception, "DTSTART");
        const exceptionStart = exceptionStartProperty ? parseIcalDate(exceptionStartProperty) : occurrence.start;
        const exceptionEndProperty = firstProperty(exception, "DTEND");
        const exceptionEnd = exceptionEndProperty ? parseIcalDate(exceptionEndProperty) || occurrence.end : occurrence.end;
        if (exceptionStart && exceptionEnd) addComponentEvent(exception, exceptionStart, exceptionEnd, `ical:${uid}:${occurrence.key}`, component);
        return;
      }
      addComponentEvent(component, occurrence.start, occurrence.end, `ical:${uid}:${occurrence.key}`);
    });
  });

  exceptionComponents.filter((component) => !usedExceptions.has(component)).forEach((component, index) => {
    const startProperty = firstProperty(component, "DTSTART");
    const start = startProperty ? parseIcalDate(startProperty) : null;
    const endProperty = firstProperty(component, "DTEND");
    const end = endProperty ? parseIcalDate(endProperty) : start;
    if (!start || !end) return;
    const startDate = new Date(start.dateTime || `${start.date}T00:00:00`);
    const endDate = new Date(end.dateTime || `${end.date}T00:00:00`);
    if (startDate < windowEnd && endDate >= windowStart) addComponentEvent(component, start, end, `ical:${uidOf(component, index)}:${icalDateKey(start)}`);
  });
  return { source, events };
}

type IcalProperty = {
  name: string;
  value: string;
  params: Record<string, string>;
};

function parseIcalProperty(line: string): IcalProperty | null {
  const separator = line.indexOf(":");
  if (separator < 1) {
    return null;
  }
  const head = line.slice(0, separator).split(";");
  const params: Record<string, string> = {};
  head.slice(1).forEach((part) => {
    const equals = part.indexOf("=");
    if (equals > 0) {
      params[part.slice(0, equals).toUpperCase()] = part.slice(equals + 1).replace(/^"|"$/g, "");
    }
  });
  return {
    name: head[0].toUpperCase(),
    value: icalTextValue(line.slice(separator + 1)),
    params,
  };
}

function icalTextValue(value: string) {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseIcalDate(property: IcalProperty): { date?: string; dateTime?: string; timeZone?: string } | null {
  const value = property.value.trim();
  if (property.params.VALUE === "DATE" || /^\d{8}$/.test(value)) {
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    return match ? { date: `${match[1]}-${match[2]}-${match[3]}` } : null;
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!match) {
    return null;
  }
  const dateTime = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7] ? "Z" : ""}`;
  return { dateTime, timeZone: property.params.TZID };
}

function icalHostName(feedUrl: string) {
  try {
    return new URL(feedUrl).hostname || "iCalendar";
  } catch {
    return "iCalendar";
  }
}

function normalizeSpotifyRedirect(uri?: string) {
  const trimmed = uri?.trim();
  if (!trimmed || trimmed === LEGACY_SPOTIFY_REDIRECT_URI) {
    return DEFAULT_SPOTIFY_REDIRECT_URI;
  }
  return trimmed;
}

function normalizeCodexApprovalMode(mode?: string): CodexApprovalMode {
  return mode === "auto-review" || mode === "never" ? mode : "on-request";
}

function normalizeCodexOpenUrl(url?: string) {
  const trimmed = url?.trim();
  if (!trimmed) {
    return DEFAULT_CODEX_OPEN_URL;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "codex:" || parsed.protocol === "https:" ? trimmed : DEFAULT_CODEX_OPEN_URL;
  } catch {
    return DEFAULT_CODEX_OPEN_URL;
  }
}

function normalizeCodexWebUrl(url?: string) {
  const trimmed = url?.trim();
  if (!trimmed) {
    return DEFAULT_CODEX_WEB_URL;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" ? trimmed : DEFAULT_CODEX_WEB_URL;
  } catch {
    return DEFAULT_CODEX_WEB_URL;
  }
}

function codexPromptUrl(baseUrl: string, prompt: string) {
  const url = new URL(baseUrl);
  if (url.protocol === "codex:" && (url.hostname === "threads" || url.hostname === "new")) {
    url.pathname = url.hostname === "threads" ? "/new" : url.pathname;
    url.searchParams.set("prompt", prompt);
    return url.toString();
  }
  if (url.protocol === "codex:") {
    const next = new URL(DEFAULT_CODEX_OPEN_URL);
    next.searchParams.set("prompt", prompt);
    return next.toString();
  }
  url.searchParams.set("prompt", prompt);
  return url.toString();
}

function summarisePrompt(prompt: string) {
  const singleLine = prompt.replace(/\s+/g, " ").trim();
  return singleLine.length > 92 ? `${singleLine.slice(0, 89)}...` : singleLine;
}

function formatElapsed(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return minutes ? `${minutes}m ${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
}

function mockTerminalCommand(command: string): TerminalRunResult {
  return {
    command,
    cwd: "/mock/dashboard",
    stdout: command === "pwd" ? "/mock/dashboard\n" : `mock$ ${command}\nBrowser preview cannot access the system shell.\n`,
    stderr: "",
    exitCode: 0,
    durationMs: 18,
  };
}

function maskClientId(clientId: string) {
  const trimmed = clientId.trim();
  if (!trimmed) {
    return "missing";
  }
  const [prefix, suffix = ""] = trimmed.split(".apps.googleusercontent.com");
  if (prefix.length <= 14) {
    return `${prefix}...apps.googleusercontent.com`;
  }
  return `${prefix.slice(0, 12)}...${prefix.slice(-6)}${suffix ? "" : ".apps.googleusercontent.com"}`;
}

function friendlyAuthError(message: string, googleClientId = "", googleClientSource = "Not configured") {
  if (message.includes("client_secret is missing")) {
    return `Google rejected the token exchange because the active OAuth client is behaving like a confidential client. The app is using ${googleClientSource}: ${maskClientId(googleClientId)}. Clear Google, confirm this is the Desktop client ID in Settings > Advanced, then sign in again.`;
  }
  return message;
}

function friendlyWeatherError(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const geoError = error as GeolocationPositionError;
    if (geoError.code === 1) {
      return "Location permission was denied. Search for a city instead or allow location access for Daily Dashboard.";
    }
    if (geoError.code === 2) {
      return "Your current location is unavailable. Search for a city instead.";
    }
    if (geoError.code === 3) {
      return "Location lookup timed out. Search for a city instead.";
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function parseLocalRedirectUri(uri: string) {
  let parsed: URL;
  try {
    parsed = new URL(uri.trim());
  } catch {
    throw new Error("Redirect URI must be a valid URL.");
  }

  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error("Redirect URI must use http://127.0.0.1 or http://localhost.");
  }

  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Redirect URI must include a valid localhost port.");
  }
  if (port < 1024) {
    throw new Error("Redirect URI port must be 1024 or higher. Use http://127.0.0.1:4200/callback for Spotify.");
  }

  return {
    port,
    path: `${parsed.pathname}${parsed.search}`,
    host: parsed.hostname,
  };
}

function googleAuthUrl(clientId: string, redirectUri: string, codeChallenge: string, state: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}

function microsoftAuthUrl(tenant: string, clientId: string, redirectUri: string, codeChallenge: string, state: string) {
  const safeTenant = tenant.trim() || "common";
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(safeTenant)}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", MICROSOFT_SCOPE);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}

function spotifyAuthUrl(clientId: string, redirectUri: string, codeChallenge: string, state: string) {
  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SPOTIFY_SCOPE);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}

async function pkceChallenge(verifier: string) {
  const bytes = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomString(length: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date) {
  const day = date.getDay();
  return addDays(startOfDay(date), -day);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addHours(date: Date, hours: number) {
  const next = new Date(date);
  next.setHours(next.getHours() + hours);
  return next;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function eventOverlapsDay(event: CalendarEvent, day: Date, timeZone = normalizeTimeZone()) {
  const key = dateKey(day);
  const startKey = eventDateKey(event.start.dateTime, event.start.date, timeZone);
  const endKey = eventDateKey(event.end.dateTime, event.end.date, timeZone);
  if (event.start.date && event.end.date) {
    return key >= startKey && key < endKey;
  }
  return key >= startKey && key <= endKey;
}

function eventStartDate(event: CalendarEvent) {
  return new Date(event.start.dateTime || `${event.start.date}T00:00:00`);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function eventDateKey(dateTime?: string, date?: string, timeZone = normalizeTimeZone()) {
  if (dateTime) {
    return dateKeyInTimeZone(new Date(dateTime), timeZone);
  }
  return date || dateKeyInTimeZone(new Date(), timeZone);
}

function formatEventTime(dateTime?: string, date?: string, timeZone = normalizeTimeZone()) {
  if (!dateTime) {
    return date || "All day";
  }
  return new Date(dateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone });
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeTimeZone(timeZone?: string) {
  const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  if (!timeZone) {
    return fallback;
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return fallback;
  }
}

function calendarTimeZoneOptions() {
  const current = normalizeTimeZone();
  const preferred = [
    current,
    "Australia/Melbourne",
    "Australia/Sydney",
    "Australia/Brisbane",
    "Australia/Adelaide",
    "Australia/Perth",
    "Europe/London",
    "UTC",
  ];
  const intlWithSupportedValues = Intl as typeof Intl & { supportedValuesOf?: (value: "timeZone") => string[] };
  const supported = typeof intlWithSupportedValues.supportedValuesOf === "function" ? intlWithSupportedValues.supportedValuesOf("timeZone") : [];
  return Array.from(new Set([...preferred, ...supported])).sort((a, b) => a.localeCompare(b));
}

function dateTimePartsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const rawHour = value("hour");
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: value("minute"),
    second: value("second"),
  };
}

function dateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = dateTimePartsInTimeZone(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function zonedIsoWithOffset(dayKey: string, timeZone: string, hour = 0, minute = 0, second = 0) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const approximateUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = timeZoneOffsetMinutes(new Date(approximateUtc), timeZone);
  const actualUtc = approximateUtc - firstOffset * 60_000;
  const offsetMinutes = timeZoneOffsetMinutes(new Date(actualUtc), timeZone);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  return `${dayKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}${offset}`;
}

function timeZoneOffsetMinutes(date: Date, timeZone: string) {
  const parts = dateTimePartsInTimeZone(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

function mockCalendarEvents(): CalendarEvent[] {
  const monday = addDays(startOfWeek(new Date()), 1);
  const timed = (dayOffset: number, hour: number, minute = 0) => {
    const date = addDays(monday, dayOffset);
    date.setHours(hour, minute, 0, 0);
    return date.toISOString();
  };
  const day = (dayOffset: number) => dateKey(addDays(monday, dayOffset));
  const stress: CalendarEvent[] = new URLSearchParams(location.search).has("calendarStress") ? [
    ...[["opening", 9, 0, 9, 30], ["overlap-a", 9, 15, 10, 0], ["overlap-b", 9, 20, 10, 30], ["short", 9, 30, 9, 35], ["midday", 12, 0, 13, 30], ["adjacent-a", 13, 30, 13, 45], ["adjacent-b", 13, 45, 14, 0], ["evening", 17, 30, 18, 0], ["six-pm", 18, 0, 18, 30], ["long", 8, 0, 19, 0], ["outside", 7, 0, 8, 0]].map(([id, sh, sm, eh, em]) => ({
      id: `mock:stress-${id}`, summary: `Stress ${id}`, calendarId: "primary", calendarSummary: "Primary", calendarColor: "#a8c7fa", start: { dateTime: timed(0, Number(sh), Number(sm)) }, end: { dateTime: timed(0, Number(eh), Number(em)) },
    })),
    ...[1, 2, 3, 4].map(index => ({ id: `mock:stress-all-day-${index}`, summary: `All day ${index}`, calendarId: "primary", start: { date: day(0) }, end: { date: day(1) } })),
  ] : [];
  return [
    ...stress,
    {
      id: "mock:project-sync",
      summary: "Project Sync",
      location: "Video call",
      calendarSummary: "Primary",
      calendarColor: "#d064e8",
      calendarId: "primary",
      start: { dateTime: timed(0, 9) },
      end: { dateTime: timed(0, 9, 30) },
    },
    {
      id: "mock:timezone-standup",
      summary: "Timezone Standup",
      location: "HW desks",
      calendarSummary: "Primary",
      calendarColor: "#d064e8",
      calendarId: "primary",
      start: { dateTime: timed(0, 9, 30) },
      end: { dateTime: timed(0, 10) },
      organizer: { displayName: "Ops Lead" },
      attendees: [{ displayName: "Alex" }, { displayName: "Sam" }],
      description: "This meeting is stored as Sunday UTC but should appear on Monday in the selected calendar timezone.",
    },
    ...["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((label, dayOffset) => ({
      id: `mock:weekday-${label.toLowerCase()}`,
      summary: label,
      location: "HW desks",
      calendarSummary: "Primary",
      calendarColor: "#d064e8",
      calendarId: "primary",
      start: { dateTime: timed(dayOffset, 10, 30) },
      end: { dateTime: timed(dayOffset, 11) },
    })),
    {
      id: "mock:design-review",
      summary: "Design Review",
      location: "Office",
      calendarSummary: "Work",
      calendarColor: "#e8c957",
      calendarId: "work",
      start: { dateTime: timed(1, 13) },
      end: { dateTime: timed(1, 14) },
    },
    {
      id: "mock:team-planning",
      summary: "Shared Team Planning",
      location: "Shared calendar",
      calendarSummary: "Team Shared",
      calendarColor: "#45d48a",
      calendarId: "team",
      start: { dateTime: timed(1, 15) },
      end: { dateTime: timed(1, 16, 30) },
    },
    {
      id: "mock:launch-window",
      summary: "Launch window",
      calendarSummary: "Primary",
      calendarColor: "#45d48a",
      calendarId: "primary",
      start: { date: day(0) },
      end: { date: day(1) },
    },
    {
      id: "mock:on-call",
      summary: "On-call cover",
      calendarSummary: "Work",
      calendarColor: "#e8c957",
      calendarId: "work",
      start: { date: day(0) },
      end: { date: day(1) },
    },
    {
      id: "mock:office-day",
      summary: "Office day",
      calendarSummary: "Team Shared",
      calendarColor: "#45d48a",
      calendarId: "team",
      start: { date: day(0) },
      end: { date: day(1) },
    },
  ];
}

function mockCalendarSources(): CalendarSource[] {
  return [
    {
      id: "primary",
      summary: "Primary",
      backgroundColor: "#d064e8",
      selected: true,
      primary: true,
      accessRole: "owner",
    },
    {
      id: "work",
      summary: "Work",
      backgroundColor: "#e8c957",
      selected: true,
      accessRole: "writer",
    },
    {
      id: "team",
      summary: "Team Shared",
      backgroundColor: "#45d48a",
      selected: true,
      accessRole: "reader",
    },
  ];
}

function mockPlayback(backend?: string | null): PlaybackState {
  return {
    is_playing: true,
    progress_ms: 42_000,
    device: { name: "mock device", is_active: true, volume_percent: 62 },
    source: backend ? "local" : "active",
    controls: backend ? {toggle:true,previous:true,next:true,seek:true,volume:backend === "connector",shuffle:true,repeat:true,save:backend === "connector"} : undefined,
    sampledAt: backend ? Date.now() : undefined,
    shuffle_state: false, repeat_state: 0,
    status: backend === "connector" ? "Local Spotify · Connected" : backend ? "Local Spotify · Windows" : "Playing on mock device",
    item: {
      id: "mock-track",
      uri: "spotify:track:mock-track",
      name: "Mock Dashboard Track",
      type: "track",
      subtitle: "Daily Dashboard",
      caption: "Smoke Test Sessions",
      images: [],
      duration_ms: 180_000,
    },
  };
}

function mockWeather(): WeatherData {
  const days = mockWeatherDays();
  return {
    timezone: "Australia/Melbourne",
    currentTemp: 18,
    feelsLikeTemp: 17,
    minTemp: days[0].minTemp,
    maxTemp: days[0].maxTemp,
    uvIndex: days[0].uvIndex,
    precipTotal: days[0].precipTotal,
    precipProbability: days[0].precipProbability,
    alert: "Rain likely",
    hourlyPrecip: days[0].hourly.map((hour) => ({ time: hour.time, value: hour.precip })),
    rainHistory: days[0].hourly.map((hour) => ({ time: hour.time, value: hour.precip })).slice(-24),
    days,
  };
}

function mockWeatherDays(): WeatherDay[] {
  return Array.from({ length: 5 }, (_, dayIndex) => {
    const date = `2026-07-${String(7 + dayIndex).padStart(2, "0")}`;
    return {
      date,
      sunrise: `${date}T07:30`,
      sunset: `${date}T17:15`,
      minTemp: 11 + dayIndex,
      maxTemp: 21 + dayIndex,
      uvIndex: 3 + (dayIndex % 3),
      precipTotal: dayIndex === 0 ? 2.4 : dayIndex * 0.8,
      precipProbability: dayIndex === 0 ? 64 : 25 + dayIndex * 10,
      hourly: Array.from({ length: 24 }, (_, index) => ({
        time: `${date}T${String(index).padStart(2, "0")}:00`,
        temp: 12 + dayIndex + Math.round(Math.sin(index / 24 * Math.PI) * 8),
        feelsLike: 11 + dayIndex + Math.round(Math.sin(index / 24 * Math.PI) * 8),
        precip: index % (4 + dayIndex) === 0 ? 1.4 : index % 3 === 0 ? 0.5 : 0,
        precipProbability: index % (4 + dayIndex) === 0 ? 64 : index % 3 === 0 ? 35 : 8,
      })),
    };
  });
}

function mockWeatherLocation(): WeatherLocation {
  return {
    name: "Melbourne",
    admin1: "Victoria",
    country: "Australia",
    latitude: -37.8136,
    longitude: 144.9631,
  };
}

function mockAircraft(location: WeatherLocation): Aircraft[] {
  const phase = Date.now() / 12_000;
  return [
    { id: "mock:vh-vyi", flight: "QFA432", registration: "VH-VYI", aircraftType: "B738", latitude: location.latitude + 0.16 + Math.sin(phase) * 0.035, longitude: location.longitude - 0.12 + Math.cos(phase) * 0.045, altitude: 18_450 + Math.round(Math.sin(phase) * 1_200), onGround: false, speed: 342, heading: 72, verticalRate: 1_280 },
    { id: "mock:vh-ueb", flight: "VOZ841", registration: "VH-UEB", aircraftType: "B38M", latitude: location.latitude - 0.09 + Math.cos(phase * 0.8) * 0.025, longitude: location.longitude + 0.21 - Math.sin(phase * 0.8) * 0.04, altitude: 8_900, onGround: false, speed: 251, heading: 318, verticalRate: -640 },
    { id: "mock:vh-ykq", flight: "JST512", registration: "VH-YKQ", aircraftType: "A320", latitude: location.latitude + 0.03 - Math.sin(phase * 0.6) * 0.018, longitude: location.longitude + 0.05 + Math.cos(phase * 0.6) * 0.026, altitude: 3_200, onGround: false, speed: 168, heading: 195, verticalRate: -920 },
  ];
}

function weatherAlertText(precipMm: number, uvIndex: number, probability: number) {
  if (precipMm >= 20) {
    return "Heavy rain expected";
  }
  if (uvIndex >= 8) {
    return "High UV";
  }
  if (precipMm > 0 || probability >= 50) {
    return "Rain likely";
  }
  return "";
}

async function resolveWeatherLocation(latitude: number, longitude: number): Promise<WeatherLocation> {
  try {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/reverse");
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("count", "1");
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      const result = data.results?.[0];
      if (result?.name) {
        return {
          name: result.name,
          latitude,
          longitude,
          country: result.country,
          admin1: result.admin1,
        };
      }
    }
  } catch {
    // Fall back to coordinates if reverse geocoding is unavailable.
  }

  return {
    name: `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
    latitude,
    longitude,
  };
}

function formatForecastDay(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function formatGraphHour(value: string, compact = false, timeZone?: string) {
  const formatted = formatWeatherTime(value, timeZone, true);
  return compact ? formatted.replace(/\s/g, "").toLowerCase() : formatted;
}

function solarTimeX(value: string | undefined, hourly: WeatherDay["hourly"]) {
  if (!value || hourly.length < 2) {
    return null;
  }
  const target = weatherLocalTime(value);
  const start = weatherLocalTime(hourly[0].time);
  const end = weatherLocalTime(hourly[hourly.length - 1].time);
  if (!target || !start || !end || end.minutes <= start.minutes) return null;
  return Math.max(0, Math.min(100, (target.minutes - start.minutes) / (end.minutes - start.minutes) * 100));
}

function weatherCurrentTimeX(now: Date, timeZone: string | undefined, hourly: WeatherDay["hourly"]) {
  if (hourly.length < 2) return null;
  const current = weatherLocalTime(now, timeZone);
  const start = weatherLocalTime(hourly[0].time, timeZone);
  const end = weatherLocalTime(hourly[hourly.length - 1].time, timeZone);
  if (!current || !start || !end || current.date !== start.date || end.minutes <= start.minutes) return null;
  return Math.max(0, Math.min(100, (current.minutes - start.minutes) / (end.minutes - start.minutes) * 100));
}

function smoothPath(points: { x: number; y: number }[]) {
  if (!points.length) {
    return "";
  }
  if (points.length === 1) {
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`;
  }

  const path = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] || points[index];
    const current = points[index];
    const next = points[index + 1];
    const afterNext = points[index + 2] || next;
    const controlOne = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    };
    const controlTwo = {
      x: next.x - (afterNext.x - current.x) / 6,
      y: next.y - (afterNext.y - current.y) / 6,
    };
    path.push(`C ${controlOne.x.toFixed(2)} ${controlOne.y.toFixed(2)}, ${controlTwo.x.toFixed(2)} ${controlTwo.y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`);
  }
  return path.join(" ");
}

function temperatureGradientStops(minTemp: number, maxTemp: number) {
  const range = maxTemp - minTemp;
  const stopCount = 96;
  if (range <= 0.1) {
    const colour = temperatureColour(minTemp);
    return [
      { offset: "0%", colour },
      { offset: "100%", colour },
    ];
  }

  return Array.from({ length: stopCount + 1 }, (_, index) => {
    const ratio = index / stopCount;
    const temp = minTemp + range * ratio;
    return {
      offset: `${(ratio * 100).toFixed(1)}%`,
      colour: temperatureColour(temp),
    };
  });
}

function temperatureColour(temp: number) {
  if (temp <= 14) {
    return "#2f80ff";
  }
  if (temp < 20) {
    return mixHex("#2f80ff", "#ffe066", smoothRatio((temp - 14) / 6));
  }
  if (temp < 26) {
    return mixHex("#ffe066", "#ff9f43", smoothRatio((temp - 20) / 6));
  }
  if (temp < 32) {
    return mixHex("#ff9f43", "#ef476f", smoothRatio((temp - 26) / 6));
  }
  return "#ef476f";
}

function smoothRatio(ratio: number) {
  const clamped = Math.max(0, Math.min(1, ratio));
  return clamped * clamped * (3 - 2 * clamped);
}

function mixHex(from: string, to: string, ratio: number) {
  const parse = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  const [fromRed, fromGreen, fromBlue] = parse(from);
  const [toRed, toGreen, toBlue] = parse(to);
  const mix = (start: number, end: number) => Math.round(start + (end - start) * Math.max(0, Math.min(1, ratio)));
  return `#${[mix(fromRed, toRed), mix(fromGreen, toGreen), mix(fromBlue, toBlue)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function formatMs(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function shortTimeZone(timeZone = normalizeTimeZone()) {
  const parts = new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: "short" }).formatToParts(new Date());
  return parts.find((part) => part.type === "timeZoneName")?.value || "Local";
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default App;
