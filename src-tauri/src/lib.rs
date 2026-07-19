use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
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
            start_oauth_listener,
            poll_oauth_listener,
            exchange_oauth_code,
            refresh_access_token,
            fetch_icalendar,
            run_terminal_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
