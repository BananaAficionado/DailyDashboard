use base64::{engine::general_purpose::STANDARD, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    ChaCha20Poly1305, Nonce,
};
use std::{collections::HashMap, fs, io::Write, path::Path, sync::Mutex};
use tauri::{AppHandle, Manager};

const SERVICE: &str = "com.bananaaficionado.daily-dashboard.credentials";
const KEY_ACCOUNT: &str = "encryption-key-v1";
const FILE_NAME: &str = "credentials.enc";
static PRIVATE_WRITE_LOCK: Mutex<()> = Mutex::new(());
static STORE_LOCK: Mutex<()> = Mutex::new(());
type Secrets = HashMap<String, String>;

fn cipher_error() -> String {
    "Could not unlock saved credentials. Check the operating system credential store.".into()
}

fn key(existing: bool) -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new(SERVICE, KEY_ACCOUNT).map_err(|_| cipher_error())?;
    match entry.get_password() {
        Ok(value) => STANDARD
            .decode(value)
            .map_err(|_| cipher_error())?
            .try_into()
            .map_err(|_| cipher_error()),
        Err(keyring::Error::NoEntry) if !existing => {
            let mut key = [0u8; 32];
            getrandom::fill(&mut key).map_err(|_| cipher_error())?;
            entry
                .set_password(&STANDARD.encode(key))
                .map_err(|_| cipher_error())?;
            Ok(key)
        }
        Err(_) => Err(cipher_error()),
    }
}

fn encrypt(key: &[u8; 32], secrets: &Secrets) -> Result<Vec<u8>, String> {
    let mut nonce = [0u8; 12];
    getrandom::fill(&mut nonce).map_err(|_| cipher_error())?;
    let json = serde_json::to_vec(secrets).map_err(|_| "Could not encode credentials")?;
    let cipher = ChaCha20Poly1305::new(key.into());
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &json,
                aad: SERVICE.as_bytes(),
            },
        )
        .map_err(|_| cipher_error())?;
    let mut output = vec![1];
    output.extend(nonce);
    output.extend(ciphertext);
    Ok(output)
}

fn decrypt(key: &[u8; 32], bytes: &[u8]) -> Result<Secrets, String> {
    if bytes.len() < 29 || bytes[0] != 1 {
        return Err(cipher_error());
    }
    let cipher = ChaCha20Poly1305::new(key.into());
    let json = cipher
        .decrypt(
            Nonce::from_slice(&bytes[1..13]),
            Payload {
                msg: &bytes[13..],
                aad: SERVICE.as_bytes(),
            },
        )
        .map_err(|_| cipher_error())?;
    serde_json::from_slice(&json).map_err(|_| cipher_error())
}

pub fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let _guard = PRIVATE_WRITE_LOCK
        .lock()
        .map_err(|_| "Application data is busy")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| "Could not create application data directory")?;
    }
    let pending = path.with_extension("pending");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&pending)
        .map_err(|_| "Could not write application data")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| "Could not restrict application data permissions")?;
    }
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "Could not write application data")?;
    drop(file);
    fs::rename(&pending, path).map_err(|_| "Could not save application data".into())
}

fn load(path: &Path) -> Result<(Option<[u8; 32]>, Secrets), String> {
    if !path.exists() {
        return Ok((None, HashMap::new()));
    }
    let bytes = fs::read(path).map_err(|_| "Could not read saved credentials")?;
    let key = key(true)?;
    Ok((Some(key), decrypt(&key, &bytes)?))
}

pub fn read(app: &AppHandle, name: &str) -> Result<Option<String>, String> {
    let _guard = STORE_LOCK.lock().map_err(|_| "Credentials are busy")?;
    let path = app
        .path()
        .app_config_dir()
        .map_err(|_| "Could not locate application data")?
        .join(FILE_NAME);
    Ok(load(&path)?.1.remove(name))
}

pub fn write(app: &AppHandle, name: &str, value: Option<&str>) -> Result<(), String> {
    let _guard = STORE_LOCK.lock().map_err(|_| "Credentials are busy")?;
    let path = app
        .path()
        .app_config_dir()
        .map_err(|_| "Could not locate application data")?
        .join(FILE_NAME);
    let (existing_key, mut secrets) = load(&path)?;
    match value {
        Some(value) => {
            secrets.insert(name.into(), value.into());
        }
        None => {
            secrets.remove(name);
        }
    }
    if existing_key.is_none() && secrets.is_empty() {
        return Ok(());
    }
    let key = match existing_key {
        Some(key) => key,
        None => key(false)?,
    };
    write_private(&path, &encrypt(&key, &secrets)?)
}

fn provider_key(provider: &str) -> Result<String, String> {
    match provider {
        "google" | "microsoft" | "spotify" => Ok(format!("oauth-{provider}")),
        _ => Err("Unknown credential provider".into()),
    }
}

#[tauri::command]
pub fn load_saved_tokens(app: AppHandle) -> Result<HashMap<String, serde_json::Value>, String> {
    let mut tokens = HashMap::new();
    for provider in ["google", "microsoft", "spotify"] {
        if let Some(value) = read(&app, &provider_key(provider)?)? {
            tokens.insert(
                provider.into(),
                serde_json::from_str(&value).map_err(|_| "Invalid saved token")?,
            );
        }
    }
    Ok(tokens)
}

#[tauri::command]
pub fn save_saved_token(
    app: AppHandle,
    provider: String,
    token: Option<serde_json::Value>,
) -> Result<(), String> {
    let name = provider_key(&provider)?;
    if let Some(token) = &token {
        if token.get("accessToken").and_then(|v| v.as_str()).is_none() {
            return Err("Invalid saved token".into());
        }
    }
    let json = token.map(|value| value.to_string());
    write(&app, &name, json.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encrypted_credentials_roundtrip_and_reject_tampering() {
        let key = [7; 32];
        let secrets = HashMap::from([("oauth-google".into(), "example-refresh-token".into())]);
        let encrypted = encrypt(&key, &secrets).unwrap();
        assert!(!encrypted
            .windows(21)
            .any(|window| window == b"example-refresh-token"));
        assert_eq!(decrypt(&key, &encrypted).unwrap(), secrets);
        assert!(decrypt(&[8; 32], &encrypted).is_err());
        let mut tampered = encrypted.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(decrypt(&key, &tampered).is_err());
        for len in 0..29 {
            assert!(decrypt(&key, &encrypted[..len]).is_err());
        }
    }
    #[test]
    fn only_dashboard_providers_can_access_saved_tokens() {
        assert!(provider_key("google").is_ok());
        assert!(provider_key("../../settings").is_err());
        assert!(provider_key("settings").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn private_writes_restrict_existing_pending_files() {
        use std::os::unix::fs::PermissionsExt;
        let dir =
            std::env::temp_dir().join(format!("dashboard-credential-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        let pending = path.with_extension("pending");
        fs::write(&pending, b"old").unwrap();
        fs::set_permissions(&pending, fs::Permissions::from_mode(0o644)).unwrap();
        write_private(&path, b"new").unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(fs::read(&path).unwrap(), b"new");
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&dir).unwrap();
    }
}
