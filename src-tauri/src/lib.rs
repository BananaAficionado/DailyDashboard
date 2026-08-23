use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    process::Command,
    sync::{mpsc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};
use url::Url;

#[derive(Default)]
struct AppState {
    listeners: Mutex<HashMap<String, mpsc::Receiver<Result<OAuthCallback, String>>>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InitialConfig {
    env: EnvConfig,
    settings: StoredSettings,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvConfig {
    spotify_client_id: Option<String>,
    spotify_client_secret: Option<String>,
    google_client_id: Option<String>,
    google_client_secret: Option<String>,
    microsoft_client_id: Option<String>,
    microsoft_tenant: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSettings {
    spotify_client_id: Option<String>,
    spotify_client_secret: Option<String>,
    google_client_id: Option<String>,
    google_client_secret: Option<String>,
    microsoft_client_id: Option<String>,
    microsoft_tenant: Option<String>,
    calendar_id: Option<String>,
    google_calendar_time_zone: Option<String>,
    spotify_redirect_uri: Option<String>,
    google_redirect_uri: Option<String>,
    microsoft_redirect_uri: Option<String>,
    ical_calendar_url: Option<String>,
    codex_account_email: Option<String>,
    codex_approval_mode: Option<String>,
    codex_open_url: Option<String>,
    codex_web_url: Option<String>,
    terminal_working_directory: Option<String>,
    weather_location: Option<serde_json::Value>,
    widget_layout: Option<serde_json::Value>,
    selected_calendar_ids: Option<Vec<String>>,
    app_scale: Option<u16>,
    adsb_location: Option<serde_json::Value>,
    adsb_api_url: Option<String>,
    adsb_api_key: Option<String>,
    adsb_graphic_only: Option<bool>,
    idle_background: Option<String>,
    idle_map_location: Option<serde_json::Value>,
    idle_slideshow_folder: Option<String>,
    idle_slideshow_fit: Option<String>,
    update_preference: Option<String>,
    github_update_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OAuthStart {
    listener_id: String,
    redirect_uri: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OAuthCallback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenExchangeRequest {
    provider: String,
    code: String,
    redirect_uri: String,
    client_id: String,
    client_secret: Option<String>,
    scope: Option<String>,
    code_verifier: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefreshRequest {
    provider: String,
    refresh_token: String,
    client_id: String,
    client_secret: Option<String>,
    scope: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalCommandRequest {
    command: String,
    cwd: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalCommandResult {
    command: String,
    cwd: String,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    duration_ms: u128,
}

#[derive(Debug, Serialize, Deserialize)]
struct TokenResponse {
    access_token: String,
    token_type: Option<String>,
    scope: Option<String>,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseAsset {
    url: String,
    name: String,
    digest: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<GithubReleaseAsset>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AvailableUpdate {
    version: String,
    name: String,
    notes: String,
    release_url: String,
    asset_name: Option<String>,
    asset_url: Option<String>,
    asset_digest: Option<String>,
    prerelease: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadedUpdate {
    path: String,
    asset_name: String,
}

#[tauri::command]
fn load_initial_config(app: AppHandle) -> Result<InitialConfig, String> {
    Ok(InitialConfig {
        env: read_env_config(),
        settings: read_settings(&app)?,
    })
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: StoredSettings) -> Result<(), String> {
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let json = serde_json::to_string_pretty(&settings).map_err(|err| err.to_string())?;
    fs::write(path, json).map_err(|err| err.to_string())
}

#[tauri::command]
fn select_slideshow_folder() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_slideshow_images(folder: String) -> Result<Vec<String>, String> {
    let folder = fs::canonicalize(folder).map_err(|err| err.to_string())?;
    if !folder.is_dir() {
        return Err("The selected album path is not a folder".into());
    }
    let mut images = Vec::new();
    collect_slideshow_images(&folder, 0, &mut images)?;
    images.sort_by_key(|path| path.to_lowercase());
    Ok(images)
}

fn collect_slideshow_images(
    folder: &std::path::Path,
    depth: u8,
    images: &mut Vec<String>,
) -> Result<(), String> {
    if depth > 3 || images.len() >= 500 {
        return Ok(());
    }
    for entry in fs::read_dir(folder)
        .map_err(|err| err.to_string())?
        .filter_map(Result::ok)
    {
        if images.len() >= 500 {
            break;
        }
        let file_type = entry.file_type().map_err(|err| err.to_string())?;
        let path = entry.path();
        if file_type.is_dir() {
            collect_slideshow_images(&path, depth + 1, images)?;
        } else if file_type.is_file() && slideshow_mime(&path).is_some() {
            images.push(path.to_string_lossy().into_owned());
        }
    }
    Ok(())
}

#[tauri::command]
fn read_slideshow_image(path: String) -> Result<String, String> {
    let path = fs::canonicalize(path).map_err(|err| err.to_string())?;
    let mime =
        slideshow_mime(&path).ok_or_else(|| "Unsupported slideshow image format".to_string())?;
    let metadata = fs::metadata(&path).map_err(|err| err.to_string())?;
    if metadata.len() > 50 * 1024 * 1024 {
        return Err("Slideshow image exceeds the 50 MB limit".into());
    }
    let bytes = fs::read(path).map_err(|err| err.to_string())?;
    Ok(format!(
        "data:{};base64,{}",
        mime,
        general_purpose::STANDARD.encode(bytes)
    ))
}

fn slideshow_mime(path: &std::path::Path) -> Option<&'static str> {
    match path
        .extension()?
        .to_string_lossy()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

#[tauri::command]
async fn check_for_updates(
    current_version: String,
    github_token: Option<String>,
) -> Result<Option<AvailableUpdate>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("DailyDashboard-Updater/0.4.2")
        .build()
        .map_err(|err| err.to_string())?;
    let mut request = client
        .get("https://api.github.com/repos/BananaAficionado/DailyDashboard/releases?per_page=30")
        .header("Accept", "application/vnd.github+json");
    if let Some(token) = github_token.filter(|value| !value.trim().is_empty()) {
        request = request.bearer_auth(token.trim());
    }
    let releases = request
        .send()
        .await
        .map_err(|err| format!("Could not check GitHub releases: {}", err))?;
    if releases.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("DailyDashboard is a private GitHub repository. Add a fine-grained GitHub token with Contents: read access in Settings, or check that the saved token can access BananaAficionado/DailyDashboard.".into());
    }
    if !releases.status().is_success() {
        return Err(format!(
            "GitHub release check returned HTTP {}",
            releases.status()
        ));
    }
    let releases = releases
        .json::<Vec<GithubRelease>>()
        .await
        .map_err(|err| err.to_string())?;
    let next = releases
        .into_iter()
        .filter(|release| {
            !release.draft && compare_versions(&release.tag_name, &current_version).is_gt()
        })
        .max_by(|a, b| compare_versions(&a.tag_name, &b.tag_name));
    Ok(next.map(|release| {
        let asset = release
            .assets
            .iter()
            .find(|asset| preferred_update_asset(&asset.name));
        AvailableUpdate {
            version: release.tag_name.clone(),
            name: release.name.unwrap_or_else(|| release.tag_name.clone()),
            notes: release.body.unwrap_or_default(),
            release_url: release.html_url,
            asset_name: asset.map(|value| value.name.clone()),
            asset_url: asset.map(|value| value.url.clone()),
            asset_digest: asset.and_then(|value| value.digest.clone()),
            prerelease: release.prerelease,
        }
    }))
}

#[tauri::command]
async fn download_update(
    app: AppHandle,
    asset_url: String,
    asset_name: String,
    asset_digest: Option<String>,
    github_token: Option<String>,
) -> Result<DownloadedUpdate, String> {
    let trusted_prefix =
        "https://api.github.com/repos/BananaAficionado/DailyDashboard/releases/assets/";
    if !asset_url.starts_with(trusted_prefix) {
        return Err(
            "The update asset does not belong to the DailyDashboard GitHub repository".into(),
        );
    }
    let safe_name = std::path::Path::new(&asset_name)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Invalid update filename".to_string())?;
    if safe_name != asset_name || !preferred_update_asset(safe_name) {
        return Err("Unsupported update asset".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .user_agent("DailyDashboard-Updater/0.4.2")
        .build()
        .map_err(|err| err.to_string())?;
    let mut request = client
        .get(asset_url)
        .header("Accept", "application/octet-stream");
    if let Some(token) = github_token.filter(|value| !value.trim().is_empty()) {
        request = request.bearer_auth(token.trim());
    }
    let response = request.send().await.map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Update download returned HTTP {}",
            response.status()
        ));
    }
    let bytes = response.bytes().await.map_err(|err| err.to_string())?;
    if let Some(expected) =
        asset_digest.and_then(|value| value.strip_prefix("sha256:").map(str::to_string))
    {
        let actual = format!("{:x}", Sha256::digest(&bytes));
        if !actual.eq_ignore_ascii_case(&expected) {
            return Err("Update checksum verification failed".into());
        }
    }
    let folder = app
        .path()
        .app_cache_dir()
        .map_err(|err| err.to_string())?
        .join("updates");
    fs::create_dir_all(&folder).map_err(|err| err.to_string())?;
    let path = folder.join(safe_name);
    fs::write(&path, bytes).map_err(|err| err.to_string())?;
    Ok(DownloadedUpdate {
        path: path.to_string_lossy().into_owned(),
        asset_name: asset_name.to_string(),
    })
}

#[tauri::command]
fn install_update(app: AppHandle, path: String, install_on_reboot: bool) -> Result<(), String> {
    let path = fs::canonicalize(path).map_err(|err| err.to_string())?;
    let update_folder = app
        .path()
        .app_cache_dir()
        .map_err(|err| err.to_string())?
        .join("updates");
    let update_folder = fs::canonicalize(update_folder).map_err(|err| err.to_string())?;
    if !path.starts_with(update_folder) {
        return Err("The installer is not in DailyDashboard's verified update folder".into());
    }
    if !preferred_update_asset(
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default(),
    ) {
        return Err("Unsupported update installer".into());
    }
    #[cfg(target_os = "windows")]
    {
        if install_on_reboot {
            let command = format!("\"{}\" /S", path.display());
            let status = Command::new("reg")
                .args([
                    "add",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce",
                    "/v",
                    "DailyDashboardUpdate",
                    "/t",
                    "REG_SZ",
                    "/d",
                    &command,
                    "/f",
                ])
                .status()
                .map_err(|err| err.to_string())?;
            if !status.success() {
                return Err("Windows could not schedule the update for the next sign-in".into());
            }
            return Ok(());
        }
        Command::new(&path)
            .arg("/S")
            .spawn()
            .map_err(|err| err.to_string())?;
        app.exit(0);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = install_on_reboot;
        Err("Automatic installation is currently available in the Windows build. Open the GitHub release to install this update on macOS.".into())
    }
}

fn preferred_update_asset(name: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        name.to_ascii_lowercase().ends_with(".exe")
    }
    #[cfg(target_os = "macos")]
    {
        name.to_ascii_lowercase().ends_with(".dmg")
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        false
    }
}

fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    version_key(left).cmp(&version_key(right))
}

fn version_key(value: &str) -> (Vec<u32>, u32) {
    let clean = value
        .trim()
        .trim_start_matches(|character: char| character == 'v' || character == 'V');
    let suffix_start = clean
        .find(|character: char| character.is_ascii_alphabetic())
        .unwrap_or(clean.len());
    let numbers = clean[..suffix_start]
        .split('.')
        .map(|part| part.parse::<u32>().unwrap_or(0))
        .collect::<Vec<_>>();
    let suffix = &clean[suffix_start..];
    let rank = if suffix.is_empty() {
        u32::MAX
    } else {
        suffix.bytes().fold(0u32, |total, byte| {
            total
                .saturating_mul(27)
                .saturating_add((byte.to_ascii_uppercase().saturating_sub(b'A') + 1) as u32)
        })
    };
    (numbers, rank)
}

#[tauri::command]
fn start_oauth_listener(
    state: State<AppState>,
    preferred_port: Option<u16>,
    redirect_path: Option<String>,
    redirect_host: Option<String>,
) -> Result<OAuthStart, String> {
    let bind_target = preferred_port
        .map(|port| format!("127.0.0.1:{}", port))
        .unwrap_or_else(|| "127.0.0.1:0".to_string());
    let listener = TcpListener::bind(bind_target).map_err(|err| err.to_string())?;
    let redirect_path = normalize_redirect_path(redirect_path);
    let redirect_host = match redirect_host.as_deref() {
        Some("localhost") => "localhost",
        _ => "127.0.0.1",
    };
    let redirect_uri = format!(
        "http://{}:{}{}",
        redirect_host,
        listener.local_addr().map_err(|err| err.to_string())?.port(),
        redirect_path
    );
    let listener_id = new_id();
    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        let callback = wait_for_callback(listener);
        let _ = tx.send(callback);
    });

    state
        .listeners
        .lock()
        .map_err(|_| "Could not lock OAuth listeners".to_string())?
        .insert(listener_id.clone(), rx);

    Ok(OAuthStart {
        listener_id,
        redirect_uri,
    })
}

fn normalize_redirect_path(path: Option<String>) -> String {
    match path.map(|value| value.trim().to_string()) {
        Some(path) if !path.is_empty() && path.starts_with('/') => path,
        Some(path) if !path.is_empty() => format!("/{}", path),
        _ => String::new(),
    }
}

#[tauri::command]
fn poll_oauth_listener(
    state: State<AppState>,
    listener_id: String,
) -> Result<Option<OAuthCallback>, String> {
    let mut listeners = state
        .listeners
        .lock()
        .map_err(|_| "Could not lock OAuth listeners".to_string())?;

    let receiver = match listeners.get(&listener_id) {
        Some(receiver) => receiver,
        None => return Err("Unknown OAuth listener".to_string()),
    };

    match receiver.try_recv() {
        Ok(result) => {
            listeners.remove(&listener_id);
            result.map(Some)
        }
        Err(mpsc::TryRecvError::Empty) => Ok(None),
        Err(mpsc::TryRecvError::Disconnected) => {
            listeners.remove(&listener_id);
            Err("OAuth listener closed before receiving a response".to_string())
        }
    }
}

#[tauri::command]
async fn exchange_oauth_code(request: TokenExchangeRequest) -> Result<TokenResponse, String> {
    let client_secret = request
        .client_secret
        .clone()
        .map(|secret| secret.trim().to_string())
        .filter(|secret| !secret.is_empty());
    let (token_url, include_secret) = match request.provider.as_str() {
        "google" => ("https://oauth2.googleapis.com/token", false),
        "microsoft" => (
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            false,
        ),
        "spotify" => (
            "https://accounts.spotify.com/api/token",
            client_secret.is_some(),
        ),
        _ => return Err("Unsupported OAuth provider".to_string()),
    };

    let mut params = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", request.code),
        ("redirect_uri", request.redirect_uri),
        ("client_id", request.client_id.clone()),
        ("code_verifier", request.code_verifier),
    ];

    if !include_secret {
        if let Some(secret) = client_secret.clone() {
            params.push(("client_secret", secret));
        }
    }
    if request.provider == "microsoft" {
        if let Some(scope) = request.scope.filter(|value| !value.trim().is_empty()) {
            params.push(("scope", scope));
        }
    }

    let client = reqwest::Client::new();
    let mut call = client.post(token_url).form(&params);
    if include_secret {
        let secret = client_secret.unwrap_or_default();
        let credential =
            general_purpose::STANDARD.encode(format!("{}:{}", request.client_id, secret));
        call = call.header("Authorization", format!("Basic {}", credential));
    }

    decode_token_response(call.send().await.map_err(|err| err.to_string())?).await
}

#[tauri::command]
async fn fetch_icalendar(url: String) -> Result<String, String> {
    let parsed = Url::parse(url.trim()).map_err(|err| format!("Invalid iCalendar URL: {}", err))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("iCalendar URL must use http:// or https://".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Daily Dashboard iCalendar reader")
        .build()
        .map_err(|err| format!("Could not prepare iCalendar request: {}", err))?;
    let response = client
        .get(parsed)
        .send()
        .await
        .map_err(|err| format!("Could not download iCalendar feed: {}", err))?;
    if !response.status().is_success() {
        return Err(format!(
            "iCalendar feed returned HTTP {}",
            response.status()
        ));
    }
    response
        .text()
        .await
        .map_err(|err| format!("Could not read iCalendar feed: {}", err))
}

#[tauri::command]
async fn refresh_access_token(request: RefreshRequest) -> Result<TokenResponse, String> {
    let client_secret = request
        .client_secret
        .clone()
        .map(|secret| secret.trim().to_string())
        .filter(|secret| !secret.is_empty());
    let token_url = match request.provider.as_str() {
        "google" => "https://oauth2.googleapis.com/token",
        "microsoft" => "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "spotify" => "https://accounts.spotify.com/api/token",
        _ => return Err("Unsupported OAuth provider".to_string()),
    };

    let mut params = vec![
        ("grant_type", "refresh_token".to_string()),
        ("refresh_token", request.refresh_token),
        ("client_id", request.client_id.clone()),
    ];

    let use_basic = request.provider == "spotify" && client_secret.is_some();
    if !use_basic {
        if let Some(secret) = client_secret.clone() {
            params.push(("client_secret", secret));
        }
    }
    if request.provider == "microsoft" {
        if let Some(scope) = request.scope.filter(|value| !value.trim().is_empty()) {
            params.push(("scope", scope));
        }
    }

    let client = reqwest::Client::new();
    let mut call = client.post(token_url).form(&params);
    if use_basic {
        let secret = client_secret.unwrap_or_default();
        let credential =
            general_purpose::STANDARD.encode(format!("{}:{}", request.client_id, secret));
        call = call.header("Authorization", format!("Basic {}", credential));
    }

    decode_token_response(call.send().await.map_err(|err| err.to_string())?).await
}

#[tauri::command]
fn run_terminal_command(request: TerminalCommandRequest) -> Result<TerminalCommandResult, String> {
    let command_text = request.command.trim().to_string();
    if command_text.is_empty() {
        return Err("Command is empty".to_string());
    }

    let cwd = match request
        .cwd
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        Some(path) => PathBuf::from(path),
        None => std::env::current_dir().map_err(|err| err.to_string())?,
    };
    if !cwd.is_dir() {
        return Err(format!(
            "Working directory does not exist: {}",
            cwd.display()
        ));
    }

    let started = Instant::now();
    let output = system_shell_command(&command_text)
        .current_dir(&cwd)
        .output()
        .map_err(|err| err.to_string())?;

    Ok(TerminalCommandResult {
        command: command_text,
        cwd: cwd.display().to_string(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code(),
        duration_ms: started.elapsed().as_millis(),
    })
}

#[cfg(target_os = "windows")]
fn system_shell_command(command_text: &str) -> Command {
    let mut command = Command::new("cmd");
    command.args(["/C", command_text]);
    command
}

#[cfg(not(target_os = "windows"))]
fn system_shell_command(command_text: &str) -> Command {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut command = Command::new(shell);
    command.args(["-lc", command_text]);
    command
}

async fn decode_token_response(response: reqwest::Response) -> Result<TokenResponse, String> {
    let status = response.status();
    let text = response.text().await.map_err(|err| err.to_string())?;
    if !status.is_success() {
        return Err(format!("Token request failed with {}: {}", status, text));
    }
    serde_json::from_str(&text).map_err(|err| err.to_string())
}

#[tauri::command]
async fn fetch_adsb(url: String, api_key: Option<String>) -> Result<serde_json::Value, String> {
    let parsed = Url::parse(&url).map_err(|err| format!("Invalid ADS-B API URL: {err}"))?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("ADS-B API URL must use HTTP or HTTPS".to_string());
    }
    let rapidapi_host = parsed.host_str().map(str::to_string);
    let client = reqwest::Client::builder()
        .user_agent("Daily Dashboard ADS-B viewer")
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|err| err.to_string())?;
    let mut request = client.get(parsed);
    if let Some(key) = api_key
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        request = request.header("x-rapidapi-key", &key);
        if let Some(host) = rapidapi_host {
            request = request.header("x-rapidapi-host", host);
        }
    }
    let response = request
        .send()
        .await
        .map_err(|err| format!("ADS-B request failed: {err}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("ADS-B request failed: {status}"));
    }
    response
        .json()
        .await
        .map_err(|err| format!("Invalid ADS-B response: {err}"))
}

fn read_settings(app: &AppHandle) -> Result<StoredSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(StoredSettings::default());
    }
    let json = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&json).map_err(|err| err.to_string())
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_config_dir().map_err(|err| err.to_string())?;
    Ok(base.join("dashboard-settings.json"))
}

fn read_env_config() -> EnvConfig {
    let values = read_key_value_file("keys.env")
        .into_iter()
        .chain(read_key_value_file("../keys.env"))
        .collect::<HashMap<_, _>>();
    EnvConfig {
        spotify_client_id: values.get("SPOTIFY_CLIENT_ID").cloned(),
        spotify_client_secret: values.get("SPOTIFY_CLIENT_SECRET").cloned(),
        google_client_id: values.get("GOOGLE_CLIENT_ID").cloned(),
        google_client_secret: values.get("GOOGLE_CLIENT_SECRET").cloned(),
        microsoft_client_id: values.get("MICROSOFT_CLIENT_ID").cloned(),
        microsoft_tenant: values.get("MICROSOFT_TENANT").cloned(),
    }
}

fn read_key_value_file(path: &str) -> HashMap<String, String> {
    fs::read_to_string(path)
        .ok()
        .map(|contents| {
            contents
                .lines()
                .filter_map(|line| {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with('#') {
                        return None;
                    }
                    let (key, value) = trimmed.split_once('=')?;
                    Some((
                        key.trim().to_string(),
                        value.trim().trim_matches('"').to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn wait_for_callback(listener: TcpListener) -> Result<OAuthCallback, String> {
    let (mut stream, _) = listener.accept().map_err(|err| err.to_string())?;
    let mut buffer = [0; 4096];
    let read = stream.read(&mut buffer).map_err(|err| err.to_string())?;
    let request = String::from_utf8_lossy(&buffer[..read]);
    let request_line = request
        .lines()
        .next()
        .ok_or_else(|| "Empty OAuth callback request".to_string())?;
    let path = request_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "Malformed OAuth callback request".to_string())?;
    let parsed = Url::parse(&format!("http://localhost{}", path)).map_err(|err| err.to_string())?;
    let mut callback = OAuthCallback {
        code: None,
        state: None,
        error: None,
    };

    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "code" => callback.code = Some(value.to_string()),
            "state" => callback.state = Some(value.to_string()),
            "error" => callback.error = Some(value.to_string()),
            _ => {}
        }
    }

    let html = r#"<!doctype html><html><head><title>Dashboard connected</title></head><body style="background:#111;color:#eee;font-family:system-ui;padding:32px"><h1>Connected</h1><p>You can close this tab and return to Daily Dashboard.</p></body></html>"#;
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    let _ = stream.write_all(response.as_bytes());
    Ok(callback)
}

fn new_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("oauth-{}", nanos)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            load_initial_config,
            save_settings,
            select_slideshow_folder,
            list_slideshow_images,
            read_slideshow_image,
            check_for_updates,
            download_update,
            install_update,
            start_oauth_listener,
            poll_oauth_listener,
            exchange_oauth_code,
            refresh_access_token,
            fetch_icalendar,
            fetch_adsb,
            run_terminal_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod update_tests {
    use super::{collect_slideshow_images, compare_versions};
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };
    #[test]
    fn compares_lettered_dashboard_versions() {
        assert!(compare_versions("V0.6B", "V0.6A").is_gt());
        assert!(compare_versions("V0.6", "V0.6B").is_gt());
        assert!(compare_versions("V0.5", "V0.4").is_gt());
        assert!(compare_versions("V0.4.1", "V0.4").is_gt());
        assert!(compare_versions("V0.4.2", "V0.4.1").is_gt());
    }

    #[test]
    fn discovers_images_in_album_subfolders() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("daily-dashboard-album-{unique}"));
        let nested = root.join("trip").join("day-one");
        fs::create_dir_all(&nested).unwrap();
        fs::write(root.join("cover.jpg"), []).unwrap();
        fs::write(nested.join("photo.png"), []).unwrap();
        fs::write(nested.join("notes.txt"), []).unwrap();
        let mut images = Vec::new();
        collect_slideshow_images(&root, 0, &mut images).unwrap();
        assert_eq!(images.len(), 2);
        fs::remove_dir_all(root).unwrap();
    }
}
