import {
  Bot,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudSun,
  ExternalLink,
  Grip,
  Heart,
  LayoutGrid,
  ListMusic,
  Maximize2,
  Pause,
  Play,
  RefreshCcw,
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

type ViewMode = "week" | "day";
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
  icalCalendarUrl?: string;
  spotifyRedirectUri?: string;
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
};

type WidgetId = "calendar" | "spotify" | "weather" | "codex" | "terminal";
type WidgetLayoutMode = "thirds" | "focus";
type WidgetSize = "full" | "wide" | "tall" | "half";
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
  source?: "active" | "currently-playing" | "recently-played";
  status?: string;
};

type WeatherLocation = {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
};

type WeatherData = {
  currentTemp: number;
  feelsLikeTemp: number;
  minTemp: number;
  maxTemp: number;
  uvIndex: number;
  precipTotal: number;
  precipProbability: number;
  hourlyPrecip: { time: string; value: number }[];
  days: WeatherDay[];
  alert: string;
};

type WeatherDay = {
  date: string;
  sunrise?: string;
  sunset?: string;
  minTemp: number;
  maxTemp: number;
  uvIndex: number;
  precipTotal: number;
  precipProbability: number;
  hourly: { time: string; temp: number; feelsLike: number; precip: number }[];
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
const APP_VERSION = "V0.3";
const RAIL_HIDE_DELAY_MS = 3_000;
const EMPTY_DASHBOARD_IDLE_DELAY_MS = 15_000;
const DEFAULT_WIDGET_SIZES: Record<WidgetId, WidgetSize> = {
  calendar: "wide",
  spotify: "half",
  weather: "half",
  codex: "tall",
  terminal: "tall",
};
const DEFAULT_WIDGET_LAYOUT: WidgetLayout = {
  mode: "thirds",
  order: ["calendar", "spotify", "weather", "codex", "terminal"],
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
  const [googleToken, setGoogleToken] = useState<TokenBundle | null>(() => readToken("google"));
  const [microsoftToken, setMicrosoftToken] = useState<TokenBundle | null>(() => readToken("microsoft"));
  const [spotifyToken, setSpotifyToken] = useState<TokenBundle | null>(() => readToken("spotify"));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendarSources, setCalendarSources] = useState<CalendarSource[]>([]);
  const [calendarSourcePanelOpen, setCalendarSourcePanelOpen] = useState(true);
  const [calendarSourceGroupsOpen, setCalendarSourceGroupsOpen] = useState({ my: true, other: true });
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [isSavedTrack, setIsSavedTrack] = useState(false);
  const [volumePercent, setVolumePercent] = useState(50);
  const [codexPrompt, setCodexPrompt] = useState("");
  const [codexActivity, setCodexActivity] = useState<CodexActivity>(DEFAULT_CODEX_ACTIVITY);
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherQuery, setWeatherQuery] = useState("");
  const [weatherSearching, setWeatherSearching] = useState(false);
  const [now, setNow] = useState(new Date());
  const [currentDate, setCurrentDate] = useState(() => startOfDay(new Date()));
  const [viewMode, setViewMode] = useState<ViewMode>("week");
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
  const railWidgetActive = (widget: WidgetId) => visibleWidgetSet.has(widget);

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

  const visibleDays = useMemo(() => {
    if (viewMode === "day") {
      return [startOfDay(currentDate)];
    }
    const start = startOfWeek(currentDate);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }, [currentDate, viewMode]);

  const calendarSourceGroups = useMemo(() => ({
    my: calendarSources.filter(isMyCalendarSource),
    other: calendarSources.filter((source) => !isMyCalendarSource(source)),
  }), [calendarSources]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

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
          setSettings({ calendarId: "primary", weatherLocation: mockWeatherLocation() });
          setEvents(mockCalendarEvents());
          setCalendarSources(mockCalendarSources());
          setPlayback(mockPlayback());
          setWeather(mockWeather());
          setSpotifyToken({ accessToken: "mock", expiresAt: Date.now() + 3_600_000 });
          setVolumePercent(mockPlayback().device?.volume_percent || 50);
          setSetupOpen(false);
        } else {
          setSettings({ calendarId: "primary" });
          setSetupOpen(true);
        }
      } catch (err) {
        setError(String(err));
      }
    }
    boot();
  }, []);

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
        writeToken(provider, next);
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

  const loadMicrosoftCalendar = useCallback(async (token: TokenBundle) => {
    const headers = { Authorization: `Bearer ${token.accessToken}` };
    const timeMin = new Date(zonedIsoWithOffset(dateKey(visibleDays[0]), credentials.googleCalendarTimeZone)).toISOString();
    const timeMax = new Date(zonedIsoWithOffset(dateKey(addDays(visibleDays[visibleDays.length - 1], 1)), credentials.googleCalendarTimeZone)).toISOString();
    const sourceResponse = await fetch("https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,color,canEdit&$top=100", { headers });
    if (!sourceResponse.ok) {
      throw new Error(`Microsoft calendar list failed: ${sourceResponse.status}`);
    }
    const sourceData = await sourceResponse.json();
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
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`${source.summary}: ${response.status}`);
      }
      const data = await response.json();
      return (data.value || []).map((event: MicrosoftGraphEvent) => microsoftEventToCalendarEvent(event, source));
    }));
    const loadedEvents = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length && !loadedEvents.length) {
      throw new Error(`Microsoft calendar request failed: ${failures.map((result) => String((result as PromiseRejectedResult).reason)).join(", ")}`);
    }
    setEvents(loadedEvents);
  }, [credentials.googleCalendarTimeZone, settings.selectedCalendarIds, visibleDays]);

  const loadIcalCalendar = useCallback(async () => {
    const feedUrl = normalizeIcalCalendarUrl(settings.icalCalendarUrl);
    if (!feedUrl) {
      return;
    }
    const feedText = isTauri()
      ? await invoke<string>("fetch_icalendar", { url: feedUrl })
      : await fetch(feedUrl).then(async (response) => {
          if (!response.ok) {
            throw new Error(`iCalendar feed returned HTTP ${response.status}`);
          }
          return response.text();
        });
    const parsed = parseIcalendarFeed(feedText, feedUrl);
    setCalendarSources([parsed.source]);
    setEvents(parsed.events);
  }, [settings.icalCalendarUrl]);

  const loadCalendar = useCallback(async () => {
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
        await loadIcalCalendar();
      } catch (err) {
        setError(String(err));
      }
      return;
    }

    const microsoft = await ensureToken("microsoft", microsoftToken);
    if (microsoft && credentials.microsoftClientId) {
      try {
        await loadMicrosoftCalendar(microsoft);
      } catch (err) {
        setError(String(err));
      }
      return;
    }

    const token = await ensureToken("google", googleToken);
    if (!token || !credentials.googleClientId) {
      return;
    }
    try {
      const timeMin = zonedIsoWithOffset(dateKey(visibleDays[0]), credentials.googleCalendarTimeZone);
      const timeMax = zonedIsoWithOffset(dateKey(addDays(visibleDays[visibleDays.length - 1], 1)), credentials.googleCalendarTimeZone);
      const headers = { Authorization: `Bearer ${token.accessToken}` };
      const sourceResponse = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader", { headers });
      let sources: CalendarSource[] = [];

      if (sourceResponse.ok) {
        const sourceData = await sourceResponse.json();
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
        const response = await fetch(url, { headers });
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
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length && !loadedEvents.length) {
        throw new Error(`Calendar request failed: ${failures.map((result) => String((result as PromiseRejectedResult).reason)).join(", ")}`);
      }
      setEvents(loadedEvents);
    } catch (err) {
      setError(String(err));
    }
  }, [credentials.calendarId, credentials.googleCalendarTimeZone, credentials.googleClientId, credentials.microsoftClientId, ensureToken, googleToken, loadIcalCalendar, loadMicrosoftCalendar, microsoftToken, settings.icalCalendarUrl, settings.selectedCalendarIds, visibleDays]);

  const loadSpotify = useCallback(async () => {
    if (isMockMode()) {
      return;
    }
    const token = await ensureToken("spotify", spotifyToken);
    if (!token || !credentials.spotifyClientId) {
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${token.accessToken}` };
      const response = await fetch("https://api.spotify.com/v1/me/player?additional_types=track,episode", {
        headers,
      });
      if (response.status === 204) {
        await loadCurrentlyPlayingOrRecent(token.accessToken);
        return;
      }
      if (!response.ok) {
        throw new Error(`Spotify request failed: ${response.status}`);
      }
      const data = await response.json();
      const currentLoaded = await loadCurrentlyPlayingOrRecent(token.accessToken, data);
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
        status: data.device?.name ? `Playing on ${data.device.name}` : "Active Spotify playback",
      });
      if (typeof data.device?.volume_percent === "number") {
        setVolumePercent(data.device.volume_percent);
      }
      await loadSavedItemState(token.accessToken, mediaItem.uri);
    } catch (err) {
      setError(String(err));
    }
  }, [credentials.spotifyClientId, ensureToken, spotifyToken]);

  async function loadCurrentlyPlayingOrRecent(accessToken: string, playerState?: { device?: PlaybackState["device"] }): Promise<boolean> {
    const response = await fetch("https://api.spotify.com/v1/me/player/currently-playing?additional_types=track,episode", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 204) {
      return false;
    }
    if (!response.ok) {
      throw new Error(`Spotify currently-playing request failed: ${response.status}`);
    }
    const data = await response.json();
    const mediaItem = spotifyMediaFromItem(data.item);
    if (!mediaItem) {
      return false;
    }
    setPlayback({
      is_playing: Boolean(data.is_playing),
      progress_ms: data.progress_ms || 0,
      item: mediaItem,
      device: playerState?.device,
      source: "currently-playing",
      status: data.is_playing ? "Currently playing" : "Current Spotify item",
    });
    await loadSavedItemState(accessToken, mediaItem.uri);
    return true;
  }

  async function loadRecentlyPlayed(accessToken: string) {
    const response = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=1", {
      headers: { Authorization: `Bearer ${accessToken}` },
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
      status: "Last played on Spotify",
    });
    await loadSavedItemState(accessToken, mediaItem.uri);
  }

  async function loadSavedItemState(accessToken: string, uri: string) {
    const savedResponse = await fetch(`https://api.spotify.com/v1/me/library/contains?uris=${encodeURIComponent(uri)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (savedResponse.ok) {
      const [saved] = await savedResponse.json();
      setIsSavedTrack(Boolean(saved));
    }
  }

  useEffect(() => {
    loadCalendar();
  }, [loadCalendar]);

  useEffect(() => {
    loadSpotify();
    const timer = window.setInterval(loadSpotify, 15_000);
    return () => window.clearInterval(timer);
  }, [loadSpotify]);

  useEffect(() => {
    if (isMockMode()) {
      return;
    }
    if (!settings.weatherLocation) {
      setWeather(null);
      return;
    }
    loadWeather(settings.weatherLocation).catch((err) => setError(String(err)));
  }, [settings.weatherLocation]);

  async function refreshDashboard() {
    setIsRefreshing(true);
    setError("");
    try {
      await Promise.all([loadCalendar(), loadSpotify()]);
      setAuthStatus("Refreshed");
    } finally {
      window.setTimeout(() => setIsRefreshing(false), 250);
    }
  }

  async function toggleFullscreen() {
    if (!isTauri()) {
      return;
    }
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
      .sort((a, b) => eventStartDate(a).getTime() - eventStartDate(b).getTime());

    if (!matches.length) {
      setError(`No calendar matches for "${query}"`);
      return;
    }

    const nextCursor = (searchCursor + 1) % matches.length;
    const nextEvent = matches[nextCursor];
    setSearchCursor(nextCursor);
    setCurrentDate(dateFromKey(eventDateKey(nextEvent.start.dateTime, nextEvent.start.date, credentials.googleCalendarTimeZone)));
    setViewMode("day");
    setError("");
  }

  async function saveSettings(next: StoredSettings) {
    const normalized = normalizeSettings(next);
    setSettings(normalized);
    if (isTauri()) {
      await invoke("save_settings", { settings: normalized });
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

  function disconnect(provider: Provider) {
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
    writeToken(provider, bundle);
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

  async function spotifyCommand(action: "previous" | "toggle" | "next" | "save" | "seek" | "volume", value?: number) {
    const token = await ensureToken("spotify", spotifyToken);
    if (!token) {
      return;
    }
    const headers = { Authorization: `Bearer ${token.accessToken}` };
    const playing = playback?.is_playing;
    const itemUri = playback?.item?.uri;
    const calls = {
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
    await calls[action]();
    if (action === "save") {
      setIsSavedTrack((current) => !current);
    }
    if (action === "volume") {
      setVolumePercent(Math.max(0, Math.min(100, Math.round(value || 0))));
    }
    window.setTimeout(loadSpotify, 500);
  }

  async function loadWeather(location: WeatherLocation) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(location.latitude));
    url.searchParams.set("longitude", String(location.longitude));
    url.searchParams.set("current", "temperature_2m,apparent_temperature,precipitation");
    url.searchParams.set("hourly", "temperature_2m,apparent_temperature,precipitation,precipitation_probability");
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_sum,precipitation_probability_max,sunrise,sunset");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("forecast_days", "5");
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Weather request failed: ${response.status}`);
    }
    const data = await response.json();
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
    setWeather({
      currentTemp: Math.round(data.current?.temperature_2m ?? 0),
      feelsLikeTemp: Math.round(data.current?.apparent_temperature ?? data.current?.temperature_2m ?? 0),
      minTemp: today.minTemp,
      maxTemp: today.maxTemp,
      uvIndex: today.uvIndex,
      precipTotal: today.precipTotal,
      precipProbability: today.precipProbability,
      hourlyPrecip: today.hourly.map((hour) => ({ time: hour.time, value: hour.precip })),
      days,
      alert: weatherAlertText(
        today.precipTotal,
        today.uvIndex,
        today.precipProbability
      ),
    });
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
  const allDayEvents = filteredEvents.filter((event) => !event.start.dateTime);
  const timedEvents = filteredEvents.filter((event) => event.start.dateTime);
  const timedEventsByDay = visibleDays.map((day) => ({
    day,
    events: timedEvents.filter((event) => eventOverlapsDay(event, day, credentials.googleCalendarTimeZone)),
  }));
  const visibleTimedEvents = timedEventsByDay.flatMap((entry) => entry.events);
  const calendarTimeRange = expandCalendarTimeRangeForNow(
    getCalendarTimeRange(visibleTimedEvents, credentials.googleCalendarTimeZone),
    visibleDays,
    now,
    credentials.googleCalendarTimeZone
  );
  const hourLabels = Array.from(
    { length: calendarTimeRange.endHour - calendarTimeRange.startHour + 1 },
    (_, index) => calendarTimeRange.startHour + index
  );
  const upcomingReminder = useMemo(() => {
    const nowMs = now.getTime();
    return events
      .filter((event) => event.start.dateTime && !dismissedReminderIds.includes(event.id))
      .map((event) => ({ event, startsAt: eventStartDate(event).getTime() }))
      .filter(({ startsAt }) => startsAt >= nowMs && startsAt - nowMs <= 5 * 60_000)
      .sort((a, b) => a.startsAt - b.startsAt)[0]?.event || null;
  }, [dismissedReminderIds, events, now]);
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
    <main className={`app-shell ${railPeekOpen ? "rail-peek-open" : "rail-peek-closed"} ${rearrangeMode ? "rearrange-mode" : ""} ${draggedWidget ? "dragging-widget" : ""}`}>
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
        <button className={`rail-button ${railWidgetActive("calendar") ? "active" : ""}`} title="Calendar" onClick={() => toggleWidget("calendar")}>
          <CalendarDays size={20} />
        </button>
        <button className={`rail-button ${railWidgetActive("spotify") ? "active" : ""}`} title="Spotify" onClick={() => toggleWidget("spotify")}>
          <ListMusic size={20} />
        </button>
        <button className={`rail-button ${railWidgetActive("weather") ? "active" : ""}`} title="Weather" onClick={() => toggleWidget("weather")}>
          <CloudSun size={20} />
        </button>
        <button className={`rail-button ${railWidgetActive("codex") ? "active" : ""}`} title="Codex" onClick={() => toggleWidget("codex")}>
          <Bot size={20} />
        </button>
        <button className={`rail-button ${railWidgetActive("terminal") ? "active" : ""}`} title="Terminal" onClick={() => toggleWidget("terminal")}>
          <Terminal size={20} />
        </button>
        <button className={`rail-button rail-arrange ${rearrangeMode ? "active" : ""}`} title="Arrange widgets" onClick={() => setRearrangeMode((mode) => !mode)}>
          <LayoutGrid size={19} />
        </button>
        <button className="rail-button bottom rail-settings" title="Settings" onClick={() => setSetupOpen(true)}>
          <Settings size={19} />
        </button>
      </aside>

      <section
        className={`dashboard-grid widget-count-${dashboardWidgets.length} ${dragPreview?.type === "grid" ? `grid-preview-${dragPreview.mode}` : ""}`}
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
        {!dashboardWidgets.length ? (
          <div className="empty-dashboard">
            <div className="empty-wave-field" aria-hidden="true">
              <svg className="empty-wave-svg" viewBox="0 0 1600 520" preserveAspectRatio="none" focusable="false">
                <path className="empty-wave-line wave-one" pathLength="1" d="M -120 280 C 160 120 340 390 620 238 S 1040 116 1320 286 S 1710 346 1840 194" />
                <path className="empty-wave-line wave-two" pathLength="1" d="M -160 350 C 120 190 376 428 650 304 S 1010 206 1286 334 S 1700 424 1860 276" />
                <path className="empty-wave-line wave-three" pathLength="1" d="M -180 210 C 110 74 350 300 590 182 S 970 86 1230 218 S 1630 298 1830 138" />
                <path className="empty-wave-line wave-four" pathLength="1" d="M -130 426 C 180 296 390 494 650 400 S 1040 300 1310 430 S 1660 494 1840 376" />
                <path className="empty-wave-line wave-five" pathLength="1" d="M -180 142 C 120 30 380 210 610 116 S 1000 22 1270 152 S 1660 216 1830 88" />
                <path className="empty-wave-line wave-six" pathLength="1" d="M -150 78 C 130 -20 360 150 620 72 S 1010 -6 1278 96 S 1620 172 1840 42" />
                <path className="empty-wave-line wave-seven" pathLength="1" d="M -170 482 C 100 368 380 552 642 468 S 1018 382 1288 496 S 1668 558 1852 438" />
                <path className="empty-wave-line wave-eight" pathLength="1" d="M -160 316 C 146 218 346 414 606 328 S 984 236 1254 346 S 1612 420 1848 296" />
                <path className="empty-wave-line wave-nine" pathLength="1" d="M -140 246 C 106 164 328 330 584 254 S 968 168 1218 266 S 1638 360 1842 230" />
              </svg>
            </div>
            <div className={`empty-dashboard-content ${emptyDashboardContentVisible ? "" : "is-hidden"}`}>
              <span className="empty-dashboard-icon">
                <LayoutGrid size={34} />
              </span>
              <strong>No widgets open</strong>
              <span>Use the left rail to show Calendar, Spotify, Weather, Codex, or Command Line.</span>
            </div>
          </div>
        ) : null}
        {dashboardWidgets.map((widget) => (
          <div
            key={widget}
            data-widget={widget}
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
            {widget === "calendar" ? (
              <section className={`calendar-panel calendar-widget-size-${widgetSize(widget)} calendar-style-${calendarStyle}`}>
                <header className="topbar">
                  <div className="brand">
                    <span className="date-tile">{new Date().getDate()}</span>
                    <span>Calendar</span>
                  </div>
                  <button className="today-button" onClick={() => setCurrentDate(startOfDay(new Date()))}>Today</button>
                  <button className="icon-button" title="Previous" onClick={() => setCurrentDate(addDays(currentDate, viewMode === "week" ? -7 : -1))}>
                    <ChevronLeft size={21} />
                  </button>
                  <button className="icon-button" title="Next" onClick={() => setCurrentDate(addDays(currentDate, viewMode === "week" ? 7 : 1))}>
                    <ChevronRight size={21} />
                  </button>
                  <div className="date-heading">
                    <h1>{monthLabel}</h1>
                    <span className="current-time">
                      <span aria-hidden="true">|</span>
                      <span>{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                    </span>
                  </div>
                  <div className="topbar-spacer" />
                  <button className={`icon-button ${isRefreshing ? "spinning" : ""}`} title="Refresh" onClick={refreshDashboard}>
                    <RefreshCcw size={18} />
                  </button>
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
                  <div className="segmented">
                    <button className={viewMode === "day" ? "selected" : ""} onClick={() => setViewMode("day")}>Day</button>
                    <button className={viewMode === "week" ? "selected" : ""} onClick={() => setViewMode("week")}>Week</button>
                  </div>
                  <button className="icon-button" title="Hide Calendar" onClick={() => hideWidget("calendar")}>
                    <X size={18} />
                  </button>
                </header>

                <div className={`calendar-card ${calendarSourcePanelOpen ? "sources-open" : "sources-collapsed"}`}>
                  <aside className="calendar-source-sidebar">
                    <button
                      className="source-panel-toggle"
                      title={calendarSourcePanelOpen ? "Hide calendars" : "Show calendars"}
                      onClick={() => setCalendarSourcePanelOpen((open) => !open)}
                    >
                      <CalendarDays size={17} />
                      {calendarSourcePanelOpen ? <span>Calendars</span> : null}
                    </button>
                    {calendarSourcePanelOpen ? (
                      <div className="source-panel-content">
                        {renderCalendarSourceGroup("my", "My calendars", calendarSourceGroups.my)}
                        {renderCalendarSourceGroup("other", "Other calendars", calendarSourceGroups.other)}
                      </div>
                    ) : null}
                  </aside>
                  <div className="calendar-scroll">
                    <div className="day-header" style={{ gridTemplateColumns: `72px repeat(${visibleDays.length}, 1fr)` }}>
                      <div className="timezone">{shortTimeZone(credentials.googleCalendarTimeZone)}</div>
                      {visibleDays.map((day) => (
                        <div className="day-heading" key={day.toISOString()}>
                          <span>{day.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}</span>
                          <strong className={dateKey(day) === dateKeyInTimeZone(new Date(), credentials.googleCalendarTimeZone) ? "today-dot" : ""}>{day.getDate()}</strong>
                        </div>
                      ))}
                    </div>

                    <div className="all-day-row" style={{ gridTemplateColumns: `72px repeat(${visibleDays.length}, 1fr)` }}>
                      <div />
                      {visibleDays.map((day) => {
                        const dayEvents = allDayEvents.filter((event) => eventOverlapsDay(event, day, credentials.googleCalendarTimeZone));
                        return (
                          <div className="all-day-cell" key={day.toISOString()}>
                            <div className="all-day-preview">
                              {dayEvents.slice(0, 2).map((event, index) => (
                                <EventPill key={event.id} event={event} index={index} compact />
                              ))}
                            </div>
                            {dayEvents.length > 2 ? (
                              <div className="all-day-expanded">
                                {dayEvents.map((event, index) => (
                                  <EventPill key={`${event.id}-expanded`} event={event} index={index} compact />
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    <div
                      className="time-grid"
                      style={{
                        gridTemplateColumns: `72px repeat(${visibleDays.length}, 1fr)`,
                        minHeight: hourLabels.length * 48,
                        height: hourLabels.length * 48,
                      }}
                    >
                      {hourLabels.map((hour) => (
                        <div className="time-label" key={hour}>{formatHour(hour)}</div>
                      ))}
                      {timedEventsByDay.map(({ day, events: dayTimedEvents }, dayIndex) => (
                        <div
                          className="day-column"
                          key={day.toISOString()}
                          style={{ gridColumn: dayIndex + 2, gridRow: `1 / span ${hourLabels.length}` }}
                        >
                          {dateKey(day) === dateKeyInTimeZone(now, credentials.googleCalendarTimeZone) ? (
                            <CurrentTimeMarker now={now} startHour={calendarTimeRange.startHour} endHour={calendarTimeRange.endHour} timeZone={credentials.googleCalendarTimeZone} />
                          ) : null}
                          {dayTimedEvents.map((event, index) => (
                            <TimedEvent
                              key={event.id}
                              event={event}
                              index={index}
                              dayIndex={dayIndex}
                              dayCount={visibleDays.length}
                              startHour={calendarTimeRange.startHour}
                              expanded={expandedEventId === event.id}
                              timeZone={credentials.googleCalendarTimeZone}
                              onToggle={() => setExpandedEventId((current) => current === event.id ? null : event.id)}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                  {expandedEventId ? <button className="calendar-event-backdrop" aria-label="Close meeting details" onClick={() => setExpandedEventId(null)} /> : null}
                </div>
              </section>
            ) : widget === "spotify" ? (
              <SpotifyPanel
                playback={playback}
                isSavedTrack={isSavedTrack}
                onCommand={spotifyCommand}
                onConnect={() => connect("spotify").catch((err) => setError(String(err)))}
                connected={Boolean(spotifyToken)}
                onFocus={() => focusWidget("spotify")}
                onClose={() => hideWidget("spotify")}
                volumePercent={volumePercent}
                compact={widgetCompact("spotify")}
              />
            ) : widget === "weather" ? (
              <WeatherPanel
                location={settings.weatherLocation}
                weather={weather}
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
          onDisconnect={disconnect}
          onFindWeatherLocation={findWeatherLocation}
          onResolveCurrentWeatherLocation={resolveCurrentWeatherLocation}
          onSaveLayout={(layout) => saveSettings({ ...settings, widgetLayout: layout })}
          widgetLayout={widgetLayout}
          onOpenCodex={() => openCodexWindow().catch((err) => setError(String(err)))}
          onToggleFullscreen={() => toggleFullscreen().catch((err) => setError(String(err)))}
        />
      ) : null}
      {upcomingReminder ? (
        <MeetingReminder event={upcomingReminder} onDismiss={() => setDismissedReminderIds((ids) => [...ids, upcomingReminder.id])} />
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
}: {
  playback: PlaybackState | null;
  isSavedTrack: boolean;
  onCommand: (action: "previous" | "toggle" | "next" | "save" | "seek" | "volume", value?: number) => void;
  onConnect: () => void;
  connected: boolean;
  onFocus: () => void;
  onClose: () => void;
  volumePercent: number;
  compact: boolean;
}) {
  const track = playback?.item;
  const image = track?.images[0]?.url;
  const progress = playback && track ? Math.min(playback.progress_ms / track.duration_ms, 1) : 0;

  return (
    <section className={`widget-panel spotify-panel ${compact ? "compact" : ""}`} onDoubleClick={onFocus}>
      <div className="spotify-header">
        <span>Spotify</span>
        <button className="icon-button" title="Hide Spotify" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="cover-wrap">
        {image ? <img src={image} alt="" className="album-cover" /> : <div className="album-cover placeholder" />}
      </div>
      <div className="track-copy">
        {track ? (
          <>
            <strong>{track.name}</strong>
            <span>{track.subtitle}</span>
            <small>{track.caption}</small>
          </>
        ) : (
          <>
            <strong>{connected ? "No track available" : "Spotify not connected"}</strong>
            <span>{connected ? "Open Spotify on a device to start playback." : "Connect Spotify to show playback."}</span>
            <small>{connected ? playback?.status || "Waiting for Spotify" : "Not connected"}</small>
          </>
        )}
      </div>
      {!connected ? <button className="spotify-connect-button" onClick={onConnect}>Connect Spotify</button> : null}
      <input
        className="scrubber"
        type="range"
        min={0}
        max={track?.duration_ms || 1}
        value={track ? playback?.progress_ms || 0 : 0}
        onChange={(event) => track ? onCommand("seek", Number(event.currentTarget.value)) : undefined}
        style={{ backgroundSize: `${progress * 100}% 100%` }}
        aria-label="Seek"
        disabled={!track}
      />
      <div className="time-row">
        <span>{formatMs(track ? playback?.progress_ms || 0 : 0)}</span>
        {playback?.status ? <span className="playback-status">{playback.status}</span> : <span />}
        <span>{formatMs(track?.duration_ms || 0)}</span>
      </div>
      <div className="player-controls">
        <div className="extra-controls left">
          <button className={`icon-button ${isSavedTrack ? "liked" : ""}`} title="Favourite" onClick={() => onCommand("save")} disabled={!track}>
            <Heart size={18} fill={isSavedTrack ? "currentColor" : "none"} />
          </button>
        </div>
        <div className="transport-controls">
          <button className="icon-button" title="Previous" onClick={() => onCommand("previous")} disabled={!connected}>
            <SkipBack size={19} />
          </button>
          <button className="play-button" title={playback?.is_playing ? "Pause" : "Play"} onClick={() => onCommand("toggle")} disabled={!connected}>
            {playback?.is_playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <button className="icon-button" title="Next" onClick={() => onCommand("next")} disabled={!connected}>
            <SkipForward size={19} />
          </button>
        </div>
        <div className="extra-controls right">
          <VolumeControl value={volumePercent} disabled={!connected} onChange={(value) => onCommand("volume", value)} />
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
          <span>Codex</span>
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
          <span>Command Line</span>
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
          spellCheck={false}
        />
        <button className="play-button" title="Run command" disabled={!input.trim() || running}>
          <Send size={17} />
        </button>
      </form>
    </section>
  );
}

function WeatherPanel({
  location,
  weather,
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [forecastMode, setForecastMode] = useState<"day" | "five">("day");
  const [forecastDayIndex, setForecastDayIndex] = useState(0);
  const showSetup = !location || settingsOpen;
  const forecastDays = weather?.days?.length ? weather.days : weather ? [{
    date: new Date().toISOString(),
    minTemp: weather.minTemp,
    maxTemp: weather.maxTemp,
    uvIndex: weather.uvIndex,
    precipTotal: weather.precipTotal,
    precipProbability: weather.precipProbability,
    hourly: weather.hourlyPrecip.map((hour) => ({ time: hour.time, temp: weather.currentTemp, feelsLike: weather.feelsLikeTemp, precip: hour.value })),
  }] : [];
  const activeDay = forecastDays[Math.min(forecastDayIndex, Math.max(0, forecastDays.length - 1))];

  useEffect(() => {
    setForecastDayIndex((index) => Math.min(index, Math.max(0, forecastDays.length - 1)));
  }, [forecastDays.length]);

  return (
    <section className={`widget-panel weather-panel ${compact ? "compact" : ""}`} onDoubleClick={onFocus}>
      <div className="weather-header">
        <span>Weather</span>
        <div className="weather-header-actions">
          {showSetup && location ? (
            <button className="icon-button" title="Close weather settings" onClick={() => setSettingsOpen(false)}><X size={16} /></button>
          ) : location ? (
            <button className="icon-button" title="Change location" onClick={() => setSettingsOpen(true)}><Settings size={16} /></button>
          ) : null}
          {!showSetup ? <button className="icon-button" title="Hide Weather" onClick={onClose}><X size={18} /></button> : null}
        </div>
      </div>
      {showSetup ? (
        <div className="weather-setup">
          <strong>{location ? "Change Weather Location" : "Set Weather Location"}</strong>
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
          />
          <div className="weather-actions">
            <button onClick={onSearch}>{searching ? "Searching" : "Search"}</button>
            <button onClick={onUseCurrentLocation}>Use Location</button>
            {location ? <button onClick={onChangeLocation}>Clear</button> : null}
          </div>
        </div>
      ) : weather && activeDay ? (
        <>
          <div className="weather-location">{location.name}{location.admin1 ? `, ${location.admin1}` : ""}</div>
          <div className="weather-main">
            <strong>{forecastDayIndex === 0 ? weather.currentTemp : Math.round((activeDay.minTemp + activeDay.maxTemp) / 2)}°</strong>
            <span>Feels like {forecastDayIndex === 0 ? weather.feelsLikeTemp : Math.round(activeDay.hourly.reduce((total, hour) => total + hour.feelsLike, 0) / Math.max(1, activeDay.hourly.length))}°<br />Min {activeDay.minTemp}° / Max {activeDay.maxTemp}°</span>
          </div>
          <div className="forecast-controls">
            <button onClick={() => setForecastDayIndex((index) => Math.max(0, index - 1))} disabled={forecastDayIndex === 0} title="Previous forecast day">
              <ChevronLeft size={16} />
            </button>
            <span>{formatForecastDay(activeDay.date)}</span>
            <button onClick={() => setForecastDayIndex((index) => Math.min(forecastDays.length - 1, index + 1))} disabled={forecastDayIndex >= forecastDays.length - 1} title="Next forecast day">
              <ChevronRight size={16} />
            </button>
            <button className={forecastMode === "five" ? "selected" : ""} onClick={() => setForecastMode((mode) => mode === "five" ? "day" : "five")}>5 days</button>
          </div>
          <div className="weather-metrics">
            <span>UV {activeDay.uvIndex}</span>
            <span>{activeDay.precipProbability}% rain</span>
            <span>{activeDay.precipTotal.toFixed(1)} mm</span>
          </div>
          {forecastDayIndex === 0 && weather.alert ? <div className="weather-alert">{weather.alert}</div> : null}
          {forecastMode === "five" ? <FiveDayForecast days={forecastDays.slice(0, 5)} /> : <WeatherDayGraph day={activeDay} narrow={narrow} />}
        </>
      ) : (
        <div className="weather-setup">
          <strong>{location.name}</strong>
          <span>Loading forecast</span>
        </div>
      )}
    </section>
  );
}

function WeatherDayGraph({ day, narrow = false }: { day: WeatherDay; narrow?: boolean }) {
  const hourly = day.hourly.slice(0, 24);
  const timeTicks = hourly
    .map((item, sourceIndex) => ({
      ...item,
      x: hourly.length <= 1 ? 50 : (sourceIndex / (hourly.length - 1)) * 100,
      sourceIndex,
    }))
    .filter((item) => !narrow || item.sourceIndex % 2 === 1);
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
  const graphSolarLabel = day.sunrise && day.sunset
    ? `; sunrise ${formatGraphHour(day.sunrise)}, sunset ${formatGraphHour(day.sunset)}`
    : "";

  return (
    <div className={`weather-day-graph ${narrow ? "narrow" : ""}`} aria-label={`Temperature and rain graph${graphSolarLabel}`}>
      {sunriseX !== null && sunsetX !== null ? (
        <div
          className="weather-solar-gradient"
          style={{ left: `${sunriseX}%`, width: `${solarBandWidth}%` }}
          aria-hidden="true"
          title={`Sunrise ${formatGraphHour(day.sunrise || "")}; sunset ${formatGraphHour(day.sunset || "")}`}
        />
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
          <span key={item.time} style={{ left: `${item.x}%` }} title={formatGraphHour(item.time)}>{formatGraphHour(item.time, narrow)}</span>
        ))}
      </div>
    </div>
  );
}

function FiveDayForecast({ days }: { days: WeatherDay[] }) {
  return (
    <div className="five-day-forecast">
      {days.map((day) => (
        <div className="forecast-day" key={day.date}>
          <strong>{new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: "short" })}</strong>
          <span>Min {day.minTemp}°</span>
          <span>Max {day.maxTemp}°</span>
          <span>{day.precipTotal.toFixed(1)} mm</span>
        </div>
      ))}
    </div>
  );
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
  const [calendarAdvancedOpen, setCalendarAdvancedOpen] = useState(false);
  const [spotifyAdvancedOpen, setSpotifyAdvancedOpen] = useState(false);
  const [weatherDraftQuery, setWeatherDraftQuery] = useState("");
  const [weatherDraftSearching, setWeatherDraftSearching] = useState(false);
  const [weatherDraftError, setWeatherDraftError] = useState("");

  useEffect(() => {
    setDraft({
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
  }, [calendarTimeZone, settings]);

  async function save() {
    await onSave(draft);
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

  return (
    <div className="setup-backdrop">
      <section className="setup-panel">
        <header>
          <h2>Dashboard Setup</h2>
          <button className="icon-button settings-close-button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <section className="settings-section">
          <div className="provider-panel">
            <div>
              <strong>Application</strong>
              <span>Window controls</span>
              <small>Version {APP_VERSION}</small>
            </div>
            <button className="settings-action-button" onClick={onToggleFullscreen}>
              <Maximize2 size={16} />
              <span>Toggle Full Screen</span>
            </button>
          </div>
        </section>
        <section className="settings-section calendar-settings-group">
          <div className="calendar-style-setting calendar-style-setting-primary">
            <span>Calendar Style</span>
            <div className="calendar-style-toggle" role="radiogroup" aria-label="Calendar style">
              <button
                type="button"
                role="radio"
                aria-checked={normalizeCalendarStyle(draft.calendarStyle) === "google"}
                className={normalizeCalendarStyle(draft.calendarStyle) === "google" ? "selected" : ""}
                onClick={() => setDraft({ ...draft, calendarStyle: "google" })}
              >
                Google Calendar
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={normalizeCalendarStyle(draft.calendarStyle) === "outlook"}
                className={normalizeCalendarStyle(draft.calendarStyle) === "outlook" ? "selected" : ""}
                onClick={() => setDraft({ ...draft, calendarStyle: "outlook" })}
              >
                Microsoft Outlook
              </button>
            </div>
          </div>
          <div className="calendar-settings-subgroup">
          <div className="provider-panel">
            <div>
              <strong>Google Calendar</strong>
              <span>{googleConnected ? "Live sync connected" : "Live sync"}</span>
              <small>{googleClientSource}: {maskClientId(activeGoogleClientId)}</small>
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
        </section>

        <section className="settings-section">
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
        </section>

        <section className="settings-section">
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
        </section>

        <section className="settings-section">
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
        </section>

        <section className="settings-section">
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
        </section>

        <section className="layout-settings">
          <strong>Visible Widgets</strong>
          <div className="widget-order">
            {widgetLayout.order.map((widget) => (
              <button
                key={widget}
                className={widgetLayout.visible.includes(widget) ? "selected" : ""}
                onClick={() => {
                  const nextLayout = widgetLayout.visible.includes(widget)
                    ? { ...widgetLayout, visible: widgetLayout.visible.filter((item) => item !== widget) }
                    : addWidgetToLayout(widgetLayout, widget);
                  onSaveLayout(nextLayout);
                }}
              >
                {widgetLabel(widget)}
              </button>
            ))}
          </div>
        </section>
        <div className="oauth-row">
          <button onClick={save}>Save Settings</button>
        </div>
        <p className="setup-note">Redirect URIs must use http://127.0.0.1 with port 1024 or higher.</p>
        {status ? <p className="status-line">{status}</p> : null}
        {error ? <p className="error-line">{error}</p> : null}
      </section>
    </div>
  );
}

function EventPill({ event, index, compact = false }: { event: CalendarEvent; index: number; compact?: boolean }) {
  return (
    <div className={`event-pill ${compact ? "compact" : ""}`} style={{ background: event.calendarColor || EVENT_COLORS[index % EVENT_COLORS.length] }} title={event.calendarSummary}>
      {event.summary || "Untitled"}
    </div>
  );
}

function TimedEvent({
  event,
  index,
  dayIndex,
  dayCount,
  startHour: rangeStartHour,
  expanded,
  timeZone,
  onToggle,
}: {
  event: CalendarEvent;
  index: number;
  dayIndex: number;
  dayCount: number;
  startHour: number;
  expanded: boolean;
  timeZone: string;
  onToggle: () => void;
}) {
  const start = eventTimeParts(event.start.dateTime, event.start.date, timeZone);
  const end = eventTimeParts(event.end.dateTime, event.end.date, timeZone);
  const startHour = start.hour + start.minute / 60;
  const endHour = end.hour + end.minute / 60;
  const top = Math.max(0, (startHour - rangeStartHour) * 48);
  const height = Math.max(36, (endHour - startHour) * 48 - 4);
  const longEvent = height >= 42;
  const attendees = (event.attendees || []).filter((attendee) => !attendee.self).slice(0, 3);
  const expandedStyle: CSSProperties = expanded
    ? {
        height: Math.max(height, 190),
        left: dayIndex >= dayCount - 2 ? "auto" : 4,
        right: dayIndex >= dayCount - 2 ? 4 : "auto",
        width: dayCount === 1 ? "calc(100% - 8px)" : "320px",
      }
    : {};

  return (
    <button
      className={`timed-event ${longEvent ? "long" : "short"} ${expanded ? "expanded" : ""}`}
      style={{
        top,
        height,
        background: event.calendarColor || EVENT_COLORS[index % EVENT_COLORS.length],
        ...expandedStyle,
      }}
      title="Show meeting details"
      onClick={onToggle}
    >
      <strong>{event.summary || "Untitled"}</strong>
      <span>{formatEventTime(event.start.dateTime, event.start.date, timeZone)}{event.location ? `, ${event.location}` : ""}</span>
      {expanded ? (
        <div className="event-details">
          {event.location ? <span>Room: {event.location}</span> : null}
          {event.organizer?.displayName || event.organizer?.email ? <span>Organiser: {event.organizer.displayName || event.organizer.email}</span> : null}
          {attendees.length ? <span>Attendees: {attendees.map((attendee) => attendee.displayName || attendee.email).filter(Boolean).join(", ")}</span> : null}
          {event.hangoutLink ? <span>Meet: {event.hangoutLink.replace(/^https?:\/\//, "")}</span> : null}
          {event.description ? <span>{stripHtml(event.description)}</span> : null}
        </div>
      ) : null}
    </button>
  );
}

function CurrentTimeMarker({ now, startHour, endHour, timeZone }: { now: Date; startHour: number; endHour: number; timeZone: string }) {
  const current = dateTimePartsInTimeZone(now, timeZone);
  const currentHour = current.hour + current.minute / 60;
  if (currentHour < startHour || currentHour > endHour + 1) {
    return null;
  }
  const top = Math.max(0, (currentHour - startHour) * 48);
  return (
    <div className="current-time-marker" style={{ top }}>
      <span />
    </div>
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

function readToken(provider: Provider): TokenBundle | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEYS[provider]);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeToken(provider: Provider, token: TokenBundle) {
  localStorage.setItem(TOKEN_KEYS[provider], JSON.stringify(token));
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
    icalCalendarUrl: normalizeIcalCalendarUrl(settings.icalCalendarUrl),
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
    widgetLayout: normalizeWidgetLayout(settings.widgetLayout),
    selectedCalendarIds: Array.isArray(settings.selectedCalendarIds)
      ? settings.selectedCalendarIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())
      : undefined,
  };
}

function normalizeCalendarStyle(style?: string): CalendarStyle {
  return style === "outlook" ? "outlook" : "google";
}

function normalizeWidgetLayout(layout?: WidgetLayout): WidgetLayout {
  const storedMode = (layout?.mode as string | undefined) || DEFAULT_WIDGET_LAYOUT.mode;
  const mode: WidgetLayoutMode = storedMode === "focus" ? "focus" : "thirds";
  const order = (layout?.order || DEFAULT_WIDGET_LAYOUT.order).filter(isWidgetId);
  const legacyLayout = Boolean(layout) && !layout?.order?.includes("calendar");
  const visible = (layout?.visible || DEFAULT_WIDGET_LAYOUT.visible).filter(isWidgetId);
  if (legacyLayout && !visible.includes("calendar")) {
    visible.unshift("calendar");
  }
  const withMissing = [...order, ...DEFAULT_WIDGET_LAYOUT.order.filter((widget) => !order.includes(widget))];
  const visibleWithOrder = withMissing.filter((widget) => visible.includes(widget));
  const thirdsStacked = storedMode === "side-stack" || (layout ? Boolean(layout.thirdsStacked) : Boolean(DEFAULT_WIDGET_LAYOUT.thirdsStacked));
  const sizes = withMissing.reduce<Partial<Record<WidgetId, WidgetSize>>>((next, widget) => {
    const size = layout?.sizes?.[widget];
    next[widget] = isWidgetSize(size) ? size : DEFAULT_WIDGET_SIZES[widget];
    return next;
  }, {});
  const normalizedVisible = layout ? visibleWithOrder : DEFAULT_WIDGET_LAYOUT.visible;
  return {
    mode,
    order: withMissing.slice(0, DEFAULT_WIDGET_LAYOUT.order.length),
    visible: normalizedVisible,
    thirdsStacked,
    sizes,
    stacks: cleanWidgetStacks(layout?.stacks || DEFAULT_WIDGET_LAYOUT.stacks, normalizedVisible),
  };
}

function buildDashboardEntries(layout: WidgetLayout): { widget: WidgetId; size: WidgetSize }[] {
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
  const singleEntry = (widget: WidgetId, size: WidgetSize) => ({ widget, size });
  const stackedEntries = (group: WidgetId[]) => group.map((widget) => ({ widget, size: "half" as WidgetSize }));
  const singleWidePair = (groupsToPack: WidgetId[][]) => {
    const wideIndex = groupsToPack.findIndex((group) => group.length === 1 && requestedWide(group[0]));
    const effectiveWideIndex = wideIndex === -1 ? 0 : wideIndex;
    return groupsToPack.map((group, index) => singleEntry(group[0], index === effectiveWideIndex ? "wide" : "tall"));
  };

  if (groups.length === 1 && groups[0].length === 1) {
    return [singleEntry(groups[0][0], "full")];
  }
  if (groups.length === 1 && groups[0].length === 2) {
    return [
      singleEntry(groups[0][0], "wide"),
      singleEntry(groups[0][1], "tall"),
    ];
  }
  if (groups.length === 2 && groups.every((group) => group.length === 1)) {
    return singleWidePair(groups);
  }
  if (groups.length === 2 && groups.some((group) => group.length === 2) && groups.some((group) => group.length === 1)) {
    return groups.flatMap((group) => (
      group.length === 2
        ? stackedEntries(group)
        : [singleEntry(group[0], "wide")]
    ));
  }

  return groups.flatMap((group) => (
    group.length === 2
      ? stackedEntries(group)
      : [singleEntry(group[0], requestedWide(group[0]) ? "wide" : "tall")]
  ));
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

function isWidgetId(value: unknown): value is WidgetId {
  return value === "calendar" || value === "spotify" || value === "weather" || value === "codex" || value === "terminal";
}

function isWidgetSize(value: unknown): value is WidgetSize {
  return value === "full" || value === "wide" || value === "tall" || value === "half";
}

function widgetLabel(widget: WidgetId) {
  if (widget === "calendar") {
    return "Calendar";
  }
  if (widget === "spotify") {
    return "Spotify";
  }
  if (widget === "weather") {
    return "Weather";
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

function parseIcalendarFeed(text: string, feedUrl: string): { source: CalendarSource; events: CalendarEvent[] } {
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
  const events: CalendarEvent[] = [];
  let current: Record<string, IcalProperty> | null = null;

  const finishEvent = () => {
    if (!current) {
      return;
    }
    const start = current.DTSTART ? parseIcalDate(current.DTSTART) : null;
    if (!start) {
      current = null;
      return;
    }
    const end = current.DTEND ? parseIcalDate(current.DTEND) || start : start;
    const uid = current.UID?.value || `${dateKey(new Date())}-${events.length}`;
    if (current.STATUS?.value.toUpperCase() !== "CANCELLED") {
      events.push({
        id: `ical:${uid}`,
        summary: current.SUMMARY?.value || "Untitled",
        description: current.DESCRIPTION?.value,
        location: current.LOCATION?.value,
        calendarId: source.id,
        calendarSummary: source.summary,
        calendarColor: source.backgroundColor,
        start,
        end,
        htmlLink: current.URL?.value,
      });
    }
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
        current[property.name] = property;
      }
    }
  });
  finishEvent();
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

function getCalendarTimeRange(events: CalendarEvent[], timeZone = normalizeTimeZone()) {
  return events.reduce(
    (range, event) => {
      const start = eventTimeParts(event.start.dateTime, event.start.date, timeZone);
      const end = eventTimeParts(event.end.dateTime, event.end.date, timeZone);
      const startHour = start.hour + start.minute / 60;
      const endHour = end.hour + end.minute / 60;
      return {
        startHour: Math.min(range.startHour, Math.floor(startHour)),
        endHour: Math.max(range.endHour, Math.ceil(endHour)),
      };
    },
    { startHour: 8, endHour: 18 }
  );
}

function expandCalendarTimeRangeForNow(
  range: { startHour: number; endHour: number },
  visibleDays: Date[],
  now: Date,
  timeZone = normalizeTimeZone()
) {
  const todayKey = dateKeyInTimeZone(now, timeZone);
  if (!visibleDays.some((day) => dateKey(day) === todayKey)) {
    return range;
  }
  const current = dateTimePartsInTimeZone(now, timeZone);
  const currentHour = current.hour + current.minute / 60;
  return {
    startHour: Math.min(range.startHour, Math.floor(currentHour)),
    endHour: Math.max(range.endHour, Math.ceil(currentHour)),
  };
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

function eventTimeParts(dateTime?: string, date?: string, timeZone = normalizeTimeZone()) {
  if (dateTime) {
    const parts = dateTimePartsInTimeZone(new Date(dateTime), timeZone);
    return { hour: parts.hour, minute: parts.minute };
  }
  const fallback = new Date(date || "");
  return {
    hour: Number.isNaN(fallback.getTime()) ? 0 : fallback.getHours(),
    minute: Number.isNaN(fallback.getTime()) ? 0 : fallback.getMinutes(),
  };
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

function formatHour(hour: number) {
  const normalized = ((hour % 24) + 24) % 24;
  if (normalized === 0) {
    return "12 AM";
  }
  if (normalized < 12) {
    return `${normalized} AM`;
  }
  if (normalized === 12) {
    return "12 PM";
  }
  return `${normalized - 12} PM`;
}

function mockCalendarEvents(): CalendarEvent[] {
  return [
    {
      id: "mock:project-sync",
      summary: "Project Sync",
      location: "Video call",
      calendarSummary: "Primary",
      calendarColor: "#d064e8",
      calendarId: "primary",
      start: { dateTime: "2026-07-06T09:00:00+10:00" },
      end: { dateTime: "2026-07-06T09:30:00+10:00" },
    },
    {
      id: "mock:timezone-standup",
      summary: "Timezone Standup",
      location: "HW desks",
      calendarSummary: "Primary",
      calendarColor: "#d064e8",
      calendarId: "primary",
      start: { dateTime: "2026-07-05T23:30:00Z" },
      end: { dateTime: "2026-07-06T00:00:00Z" },
      organizer: { displayName: "Ops Lead" },
      attendees: [{ displayName: "Alex" }, { displayName: "Sam" }],
      description: "This meeting is stored as Sunday UTC but should appear on Monday in the selected calendar timezone.",
    },
    ...[
      ["06", "Monday"],
      ["07", "Tuesday"],
      ["08", "Wednesday"],
      ["09", "Thursday"],
      ["10", "Friday"],
    ].map(([day, label]) => ({
      id: `mock:weekday-${label.toLowerCase()}`,
      summary: label,
      location: "HW desks",
      calendarSummary: "Primary",
      calendarColor: "#d064e8",
      calendarId: "primary",
      start: { dateTime: `2026-07-${day}T09:30:00+10:00` },
      end: { dateTime: `2026-07-${day}T10:00:00+10:00` },
    })),
    {
      id: "mock:design-review",
      summary: "Design Review",
      location: "Office",
      calendarSummary: "Work",
      calendarColor: "#e8c957",
      calendarId: "work",
      start: { dateTime: "2026-07-07T13:00:00+10:00" },
      end: { dateTime: "2026-07-07T14:00:00+10:00" },
    },
    {
      id: "mock:team-planning",
      summary: "Shared Team Planning",
      location: "Shared calendar",
      calendarSummary: "Team Shared",
      calendarColor: "#45d48a",
      calendarId: "team",
      start: { dateTime: "2026-07-07T15:00:00+10:00" },
      end: { dateTime: "2026-07-07T16:30:00+10:00" },
    },
    {
      id: "mock:launch-window",
      summary: "Launch window",
      calendarSummary: "Primary",
      calendarColor: "#45d48a",
      calendarId: "primary",
      start: { date: "2026-07-06" },
      end: { date: "2026-07-07" },
    },
    {
      id: "mock:on-call",
      summary: "On-call cover",
      calendarSummary: "Work",
      calendarColor: "#e8c957",
      calendarId: "work",
      start: { date: "2026-07-06" },
      end: { date: "2026-07-07" },
    },
    {
      id: "mock:office-day",
      summary: "Office day",
      calendarSummary: "Team Shared",
      calendarColor: "#45d48a",
      calendarId: "team",
      start: { date: "2026-07-06" },
      end: { date: "2026-07-07" },
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

function mockPlayback(): PlaybackState {
  return {
    is_playing: true,
    progress_ms: 42_000,
    device: { name: "mock device", is_active: true, volume_percent: 62 },
    source: "active",
    status: "Playing on mock device",
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
    currentTemp: 18,
    feelsLikeTemp: 17,
    minTemp: days[0].minTemp,
    maxTemp: days[0].maxTemp,
    uvIndex: days[0].uvIndex,
    precipTotal: days[0].precipTotal,
    precipProbability: days[0].precipProbability,
    alert: "Rain likely",
    hourlyPrecip: days[0].hourly.map((hour) => ({ time: hour.time, value: hour.precip })),
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

function buildWeatherDays(data: any): WeatherDay[] {
  const dates: string[] = data.daily?.time || [];
  return dates.slice(0, 5).map((date, dayIndex) => {
    const hourly = (data.hourly?.time || [])
      .map((time: string, index: number) => ({
        time,
        temp: Number(data.hourly?.temperature_2m?.[index] ?? 0),
        feelsLike: Number(data.hourly?.apparent_temperature?.[index] ?? data.hourly?.temperature_2m?.[index] ?? 0),
        precip: Number(data.hourly?.precipitation?.[index] ?? 0),
      }))
      .filter((hour: { time: string }) => hour.time.startsWith(date));

    return {
      date,
      sunrise: data.daily?.sunrise?.[dayIndex],
      sunset: data.daily?.sunset?.[dayIndex],
      minTemp: Math.round(data.daily?.temperature_2m_min?.[dayIndex] ?? 0),
      maxTemp: Math.round(data.daily?.temperature_2m_max?.[dayIndex] ?? 0),
      uvIndex: Math.round(data.daily?.uv_index_max?.[dayIndex] ?? 0),
      precipTotal: Number(data.daily?.precipitation_sum?.[dayIndex] ?? 0),
      precipProbability: Math.round(data.daily?.precipitation_probability_max?.[dayIndex] ?? 0),
      hourly,
    };
  });
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

function formatGraphHour(value: string, compact = false) {
  const formatted = new Date(value).toLocaleTimeString([], { hour: "numeric" });
  return compact ? formatted.replace(/\s/g, "").toLowerCase() : formatted;
}

function solarTimeX(value: string | undefined, hourly: WeatherDay["hourly"]) {
  if (!value || hourly.length < 2) {
    return null;
  }
  const target = new Date(value).getTime();
  const start = new Date(hourly[0].time).getTime();
  const end = new Date(hourly[hourly.length - 1].time).getTime();
  if (![target, start, end].every(Number.isFinite) || end <= start) {
    return null;
  }
  return Math.max(0, Math.min(100, ((target - start) / (end - start)) * 100));
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
