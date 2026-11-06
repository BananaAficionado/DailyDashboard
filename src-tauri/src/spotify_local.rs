use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Condvar, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};

#[cfg(target_os = "windows")]
#[path = "spotify_windows.rs"]
mod platform;
#[cfg(target_os = "macos")]
#[path = "spotify_macos.rs"]
mod platform;

const PORT: u16 = 47691;
const MAX_BODY: usize = 256 * 1024;
const ORIGINS: [&str; 2] = ["https://xpui.app.spotify.com", "https://xpui.spotify.com"];
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Controls {
    pub toggle: bool,
    pub previous: bool,
    pub next: bool,
    pub seek: bool,
    pub volume: bool,
    pub shuffle: bool,
    pub repeat: bool,
    pub save: bool,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Snapshot {
    pub available: bool,
    pub provider: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub uri: String,
    pub artwork_url: String,
    pub duration_ms: u64,
    pub progress_ms: u64,
    pub is_playing: bool,
    pub volume_percent: Option<f64>,
    pub shuffle: Option<bool>,
    pub repeat: Option<u8>,
    pub liked: Option<bool>,
    pub controls: Controls,
    pub status: String,
}
impl Snapshot {
    fn sanitize(mut self) -> Self {
        self.provider = "connector".into();
        for value in [
            &mut self.title,
            &mut self.artist,
            &mut self.album,
            &mut self.status,
        ] {
            *value = value.chars().take(512).collect();
        }
        if !valid_track_uri(&self.uri) {
            self.uri.clear();
            self.controls.save = false;
            self.liked = None;
        }
        if !valid_artwork_url(&self.artwork_url) {
            self.artwork_url.clear();
        }
        self.duration_ms = self.duration_ms.min(7 * 24 * 60 * 60 * 1000);
        self.progress_ms = self.progress_ms.min(self.duration_ms);
        self.volume_percent = self
            .volume_percent
            .filter(|v| v.is_finite())
            .map(|v| v.clamp(0., 100.));
        self.repeat = self.repeat.filter(|v| *v <= 2);
        self.available = true;
        self
    }
}
fn valid_track_uri(uri: &str) -> bool {
    let parts: Vec<_> = uri.split(':').collect();
    parts.len() == 3
        && parts[0] == "spotify"
        && matches!(parts[1], "track" | "episode")
        && parts[2].len() == 22
        && parts[2].bytes().all(|c| c.is_ascii_alphanumeric())
}
fn valid_artwork_url(value: &str) -> bool {
    url::Url::parse(value).ok().is_some_and(|u| {
        u.scheme() == "https"
            && u.username().is_empty()
            && u.password().is_none()
            && u.host_str()
                .is_some_and(|h| h.ends_with(".scdn.co") || h.ends_with(".spotifycdn.com"))
    }) && value.len() <= 4096
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Toggle,
    Previous,
    Next,
    Seek,
    Volume,
    Shuffle,
    Repeat,
    Save,
}
impl Controls {
    fn allows(&self, action: Action) -> bool {
        match action {
            Action::Toggle => self.toggle,
            Action::Previous => self.previous,
            Action::Next => self.next,
            Action::Seek => self.seek,
            Action::Volume => self.volume,
            Action::Shuffle => self.shuffle,
            Action::Repeat => self.repeat,
            Action::Save => self.save,
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Command {
    id: u64,
    pub action: Action,
    pub value: Option<f64>,
    pub expected_uri: String,
    expires_at: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Poll {
    token: String,
    snapshot: Snapshot,
    #[serde(default)]
    acknowledgements: Vec<Acknowledgement>,
}
#[derive(Deserialize)]
struct Acknowledgement {
    id: u64,
    ok: bool,
    #[serde(default)]
    error: String,
}
#[derive(Default)]
struct Inner {
    snapshot: Option<(Instant, Snapshot)>,
    queue: VecDeque<Command>,
    pending: HashSet<u64>,
    results: HashMap<u64, Result<(), String>>,
}
struct Connection {
    token: String,
    inner: Mutex<Inner>,
    changed: Condvar,
    sequence: AtomicU64,
}
#[derive(Default)]
pub struct Bridge {
    connection: Mutex<Option<Arc<Connection>>>,
}
impl Bridge {
    fn connect(&self, app: &AppHandle) -> Result<Arc<Connection>, String> {
        let mut stored = self
            .connection
            .lock()
            .map_err(|_| "Spotify bridge lock failed")?;
        if let Some(connection) = stored.as_ref() {
            return Ok(connection.clone());
        }
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, PORT))
            .map_err(|e| format!("Local Spotify connector port {PORT} is unavailable: {e}"))?;
        let base = app.path().app_config_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&base).map_err(|e| e.to_string())?;
        let token = pairing_token(base.join("spotify-bridge-key"))?;
        let connection = Arc::new(Connection {
            token,
            inner: Mutex::new(Inner::default()),
            changed: Condvar::new(),
            // Keep IDs distinct across Dashboard restarts while a Spotify extension stays loaded.
            // Milliseconds × 256 stays within JavaScript's exact integer range.
            sequence: AtomicU64::new(millis().saturating_mul(256)),
        });
        let server = connection.clone();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let _ = serve(stream, &server);
            }
        });
        *stored = Some(connection.clone());
        Ok(connection)
    }
}
fn pairing_token(path: PathBuf) -> Result<String, String> {
    if let Ok(value) = fs::read_to_string(&path) {
        if value.len() == 64 && value.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Ok(value);
        }
    }
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    let token: String = bytes.iter().map(|v| format!("{v:02x}")).collect();
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .and_then(|mut f| f.write_all(token.as_bytes()))
        .map_err(|e| e.to_string())?;
    Ok(token)
}
fn millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn fresh(inner: &Inner) -> Option<Snapshot> {
    inner
        .snapshot
        .as_ref()
        .filter(|(at, _)| at.elapsed() < Duration::from_secs(6))
        .map(|(_, s)| s.clone())
}
fn authenticated(expected: &str, actual: &str) -> bool {
    expected.len() == actual.len()
        && expected
            .bytes()
            .zip(actual.bytes())
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            == 0
}
fn serve(mut stream: TcpStream, connection: &Connection) -> Result<(), String> {
    stream
        .set_read_timeout(Some(Duration::from_millis(800)))
        .ok();
    stream
        .set_write_timeout(Some(Duration::from_millis(800)))
        .ok();
    let mut data = Vec::new();
    let mut chunk = [0; 4096];
    let header_end = loop {
        let read = stream.read(&mut chunk).map_err(|e| e.to_string())?;
        if read == 0 {
            return Ok(());
        }
        data.extend_from_slice(&chunk[..read]);
        if let Some(index) = data.windows(4).position(|w| w == b"\r\n\r\n") {
            break index + 4;
        }
        if data.len() > 8192 {
            return Err("Oversized connector headers".into());
        }
    };
    if header_end > 8192 {
        return Err("Oversized connector headers".into());
    }
    let headers = String::from_utf8_lossy(&data[..header_end]).into_owned();
    let mut lines = headers.lines();
    let request = lines.next().unwrap_or_default();
    let values: HashMap<String, String> = lines
        .filter_map(|l| {
            l.split_once(':')
                .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_owned()))
        })
        .collect();
    let origin = values.get("origin").map(String::as_str).unwrap_or_default();
    if values.get("host").map(String::as_str) != Some(&format!("127.0.0.1:{PORT}"))
        || !ORIGINS.contains(&origin)
    {
        return reply(&mut stream, 403, "", "{}");
    }
    let origin = origin.to_owned();
    if request == "OPTIONS /poll HTTP/1.1" {
        return reply(&mut stream, 204, &origin, "");
    }
    if request != "POST /poll HTTP/1.1"
        || values
            .get("content-type")
            .is_none_or(|v| !v.starts_with("application/json"))
        || values.contains_key("transfer-encoding")
    {
        return reply(&mut stream, 400, &origin, "{}");
    }
    let length = values
        .get("content-length")
        .and_then(|n| n.parse::<usize>().ok())
        .filter(|n| *n <= MAX_BODY)
        .ok_or("Invalid connector length")?;
    while data.len() < header_end + length {
        let read = stream.read(&mut chunk).map_err(|e| e.to_string())?;
        if read == 0 {
            return Err("Incomplete connector request".into());
        }
        data.extend_from_slice(&chunk[..read]);
        if data.len() > header_end + MAX_BODY {
            return Err("Oversized connector body".into());
        }
    }
    let poll: Poll = serde_json::from_slice(&data[header_end..header_end + length])
        .map_err(|e| e.to_string())?;
    if !authenticated(&connection.token, &poll.token) {
        return reply(&mut stream, 403, &origin, "{}");
    }
    let mut inner = connection
        .inner
        .lock()
        .map_err(|_| "Spotify bridge lock failed")?;
    inner.snapshot = Some((Instant::now(), poll.snapshot.sanitize()));
    for ack in poll.acknowledgements.into_iter().take(16) {
        if inner.pending.contains(&ack.id) {
            inner.results.insert(
                ack.id,
                if ack.ok {
                    Ok(())
                } else {
                    Err(ack.error.chars().take(256).collect())
                },
            );
        }
    }
    let commands: Vec<_> = inner
        .queue
        .drain(..)
        .filter(|c| c.expires_at > millis())
        .collect();
    connection.changed.notify_all();
    drop(inner);
    reply(
        &mut stream,
        200,
        &origin,
        &serde_json::json!({"commands":commands}).to_string(),
    )
}
fn reply(stream: &mut TcpStream, code: u16, origin: &str, body: &str) -> Result<(), String> {
    let cors = if origin.is_empty() {
        String::new()
    } else {
        format!("Access-Control-Allow-Origin: {origin}\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\nVary: Origin\r\n")
    };
    write!(stream,"HTTP/1.1 {code} {}\r\n{cors}Content-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", if code<300 {"OK"} else {"Rejected"},body.len()).map_err(|e|e.to_string())
}
#[tauri::command]
pub async fn local_spotify_snapshot(
    app: AppHandle,
    bridge: State<'_, Bridge>,
) -> Result<Snapshot, String> {
    if let Ok(connection) = bridge.connect(&app) {
        if let Some(snapshot) = fresh(
            &*connection
                .inner
                .lock()
                .map_err(|_| "Spotify bridge lock failed")?,
        ) {
            return Ok(snapshot);
        }
    }
    tauri::async_runtime::spawn_blocking(platform_snapshot)
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn local_spotify_command(
    app: AppHandle,
    bridge: State<'_, Bridge>,
    action: Action,
    value: Option<f64>,
    expected_uri: Option<String>,
) -> Result<(), String> {
    if value.is_some_and(|v| !v.is_finite()) {
        return Err("Invalid control value".into());
    }
    let valid = match action {
        Action::Toggle | Action::Shuffle | Action::Save => {
            value.is_some_and(|v| v == 0. || v == 1.)
        }
        Action::Seek => value.is_some_and(|v| (0. ..=604800000.).contains(&v)),
        Action::Volume => value.is_some_and(|v| (0. ..=100.).contains(&v)),
        Action::Repeat => value.is_some_and(|v| v == 0. || v == 1. || v == 2.),
        _ => value.is_none(),
    };
    if !valid {
        return Err("Invalid control value".into());
    }
    let connection = bridge.connect(&app).ok();
    let snapshot = connection
        .as_ref()
        .and_then(|c| c.inner.lock().ok().and_then(|inner| fresh(&inner)));
    if let (Some(snapshot), Some(connection)) = (snapshot, connection) {
        if !snapshot.controls.allows(action) {
            return Err("This control is unavailable in the Spotify client".into());
        }
        let uri = expected_uri.unwrap_or_default();
        if matches!(action, Action::Save | Action::Seek)
            && (!valid_track_uri(&uri) || uri != snapshot.uri)
        {
            return Err("The track changed; try again".into());
        }
        return tauri::async_runtime::spawn_blocking(move || {
            let id = connection.sequence.fetch_add(1, Ordering::Relaxed);
            let mut inner = connection
                .inner
                .lock()
                .map_err(|_| "Spotify bridge lock failed")?;
            if inner.pending.len() >= 16 {
                return Err("Spotify is busy; try again".into());
            }
            inner.pending.insert(id);
            inner.queue.push_back(Command {
                id,
                action,
                value,
                expected_uri: uri,
                expires_at: millis() + 4000,
            });
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                if let Some(result) = inner.results.remove(&id) {
                    inner.pending.remove(&id);
                    return result;
                }
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    inner.pending.remove(&id);
                    inner.queue.retain(|c| c.id != id);
                    return Err("Spotify did not confirm the command; it was not retried".into());
                }
                inner = connection
                    .changed
                    .wait_timeout(inner, remaining)
                    .map_err(|_| "Spotify bridge lock failed")?
                    .0;
            }
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    if matches!(action, Action::Save) {
        return Err(
            "Like needs the local Spotify connector. Set it up in Settings → Music.".into(),
        );
    }
    tauri::async_runtime::spawn_blocking(move || platform_command(action, value))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn export_spotify_connector(
    app: AppHandle,
    bridge: State<'_, Bridge>,
) -> Result<Option<String>, String> {
    let connection = bridge.connect(&app)?;
    let content = include_str!("../../integrations/spotify/daily-dashboard-bridge.js")
        .replace("__DASHBOARD_PAIRING_TOKEN__", &connection.token);
    tauri::async_runtime::spawn_blocking(move || {
        let path = rfd::FileDialog::new()
            .set_title("Save Spotify local connector")
            .set_file_name("daily-dashboard-bridge.js")
            .add_filter("Spotify extension", &["js"])
            .save_file();
        if let Some(path) = path {
            fs::write(&path, content).map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().to_string()))
        } else {
            Ok(None)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn open_local_spotify(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url("spotify:", None::<&str>)
        .map_err(|e| e.to_string())
}
fn platform_snapshot() -> Result<Snapshot, String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        platform::snapshot()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Ok(Snapshot {
            status: "Set up the local Spotify connector in Settings → Music".into(),
            ..Snapshot::default()
        })
    }
}
fn platform_command(action: Action, value: Option<f64>) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        platform::command(action, value)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (action, value);
        Err("The local Spotify connector is not connected".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_identity_and_artwork() {
        assert!(valid_track_uri("spotify:track:6rqhFgbbKwnb9MLmUQDhG6"));
        assert!(!valid_track_uri("spotify:track:../x"));
        assert!(valid_artwork_url("https://i.scdn.co/image/abc"));
        assert!(!valid_artwork_url("https://i.scdn.co.evil.test/a"));
        assert!(!valid_artwork_url("file:///etc/passwd"));
    }
    #[test]
    fn sanitizes_client_data() {
        let s = Snapshot {
            uri: "fake".into(),
            controls: Controls {
                save: true,
                ..Default::default()
            },
            progress_ms: u64::MAX,
            duration_ms: 100,
            artwork_url: "javascript:alert(1)".into(),
            ..Default::default()
        }
        .sanitize();
        assert!(!s.controls.save);
        assert!(s.uri.is_empty() && s.artwork_url.is_empty());
        assert_eq!(s.progress_ms, 100);
    }
    #[test]
    fn only_accepts_exact_pairing_token() {
        assert!(authenticated("abc", "abc"));
        assert!(!authenticated("abc", "abcd"));
        assert!(!authenticated("abc", "abd"));
    }
    #[test]
    fn stale_connector_does_not_override_native() {
        let mut inner = Inner::default();
        inner.snapshot = Some((Instant::now() - Duration::from_secs(7), Snapshot::default()));
        assert!(fresh(&inner).is_none());
    }
    fn connection() -> Arc<Connection> {
        Arc::new(Connection {
            token: "test-pairing-key".into(),
            inner: Mutex::new(Inner::default()),
            changed: Condvar::new(),
            sequence: AtomicU64::new(1),
        })
    }
    fn exchange(connection: Arc<Connection>, origin: &str, host: &str, token: &str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (socket, _) = listener.accept().unwrap();
            serve(socket, &connection).unwrap();
        });
        let body = serde_json::json!({"token":token,"snapshot": {"title":"Example", "uri":"spotify:track:6rqhFgbbKwnb9MLmUQDhG6"},"acknowledgements":[{"id":3,"ok":true},{"id":99,"ok":true}]}).to_string();
        let mut socket = TcpStream::connect(address).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let request = format!("POST /poll HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",body.len());
        socket.write_all(request.as_bytes()).unwrap();
        let mut response = String::new();
        if let Err(error) = socket.read_to_string(&mut response) {
            // Early rejection can reset TCP after a complete HTTP response.
            assert_eq!(error.kind(), std::io::ErrorKind::ConnectionReset);
        }
        let (headers, body) = response.split_once("\r\n\r\n").expect("complete response headers");
        let length = headers.lines().find_map(|line| line.strip_prefix("Content-Length: ")).unwrap().parse::<usize>().unwrap();
        assert_eq!(body.len(), length, "response body must be complete, even after TCP reset");
        server.join().unwrap();
        response
    }
    #[test]
    fn protocol_rejects_unpaired_or_foreign_requests() {
        for (origin, host, token) in [
            ("https://evil.test", "127.0.0.1:47691", "test-pairing-key"),
            (ORIGINS[0], "evil.test:47691", "test-pairing-key"),
            (ORIGINS[0], "127.0.0.1:47691", "wrong"),
        ] {
            let c = connection();
            assert!(exchange(c.clone(), origin, host, token).starts_with("HTTP/1.1 403"));
            assert!(fresh(&c.inner.lock().unwrap()).is_none());
        }
    }
    #[test]
    fn protocol_delivers_once_and_discards_expired_commands() {
        let c = connection();
        {
            let mut inner = c.inner.lock().unwrap();
            inner.pending.insert(3);
            for (id, expires_at) in [(1, millis() + 4000), (2, 0)] {
                inner.queue.push_back(Command {
                    id,
                    action: Action::Shuffle,
                    value: Some(1.),
                    expected_uri: String::new(),
                    expires_at,
                });
            }
        }
        let response = exchange(c.clone(), ORIGINS[0], "127.0.0.1:47691", "test-pairing-key");
        let value: serde_json::Value =
            serde_json::from_str(response.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(value["commands"].as_array().unwrap().len(), 1);
        assert_eq!(value["commands"][0]["id"], 1);
        {
            let inner = c.inner.lock().unwrap();
            assert!(inner.queue.is_empty());
            assert_eq!(inner.results.get(&3), Some(&Ok(())));
            assert!(!inner.results.contains_key(&99));
            assert_eq!(fresh(&inner).unwrap().title, "Example");
        }
        let again = exchange(c, ORIGINS[0], "127.0.0.1:47691", "test-pairing-key");
        assert!(again.ends_with("{\"commands\":[]}"));
    }
}
