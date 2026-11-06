use crate::{AvailableUpdate, DownloadedUpdate, StoredSettings};
use serde::Serialize;
use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupUpdateStatus {
    busy: bool,
    finished: bool,
    message: String,
    available_update: Option<AvailableUpdate>,
    downloaded_update: Option<DownloadedUpdate>,
    can_auto_install: bool,
}
impl Default for StartupUpdateStatus {
    fn default() -> Self {
        Self {
            busy: false,
            finished: false,
            message: String::new(),
            available_update: None,
            downloaded_update: None,
            can_auto_install: cfg!(target_os = "windows"),
        }
    }
}
#[derive(Default)]
pub struct StartupUpdater {
    status: Mutex<StartupUpdateStatus>,
}

// Version 1 could enable installation without consent. Reset legacy policies to
// notification-only; only preferences saved under version 2 express opt-in.
pub fn migrate_policy(settings: &mut StoredSettings, windows: bool) -> bool {
    if settings.startup_update_policy_version.unwrap_or(0) >= 2 {
        if !windows && settings.update_preference.as_deref() == Some("auto-install") {
            settings.update_preference = Some("auto-download".into());
            return true;
        }
        return false;
    }
    settings.update_preference = Some(
        if settings.update_preference.as_deref() == Some("ignore") {
            "ignore"
        } else {
            "notify"
        }
        .into(),
    );
    settings.startup_update_policy_version = Some(2);
    true
}
fn set_status(app: &AppHandle, message: impl Into<String>, finished: bool) {
    if let Ok(mut status) = app.state::<StartupUpdater>().status.lock() {
        status.message = message.into();
        status.finished = finished;
        status.busy = !finished;
    }
}
#[tauri::command]
pub fn startup_update_status(app: AppHandle) -> Result<StartupUpdateStatus, String> {
    app.state::<StartupUpdater>()
        .status
        .lock()
        .map(|value| value.clone())
        .map_err(|_| "Startup update status unavailable".into())
}
fn settings(app: &AppHandle) -> Result<StoredSettings, String> {
    let mut settings = crate::read_settings(app)?;
    migrate_policy(&mut settings, cfg!(target_os = "windows"));
    Ok(settings)
}
fn retryable(error: &str) -> bool {
    error.starts_with("Could not check GitHub releases:")
        || error.contains("HTTP 5")
        || error.contains("HTTP 429")
}
fn verified_digest(value: Option<&str>) -> bool {
    value
        .and_then(|digest| digest.strip_prefix("sha256:"))
        .is_some_and(|digest| digest.len() == 64 && digest.bytes().all(|b| b.is_ascii_hexdigit()))
}
pub fn start(app: &AppHandle) {
    if cfg!(debug_assertions) {
        set_status(
            app,
            "Automatic startup updates run in installed builds.",
            true,
        );
        return;
    }
    if std::env::args().skip(1).any(|arg| {
        matches!(
            arg.as_str(),
            "--unlock-display" | "--reset-display-lock" | "--skip-update"
        )
    }) {
        set_status(
            app,
            "Startup update skipped for this recovery launch.",
            true,
        );
        return;
    }
    let prepared = (|| {
        let state = app.state::<crate::AppState>();
        let _write = state
            .settings_write
            .lock()
            .map_err(|_| "Settings are busy")?;
        let mut settings = crate::read_settings(app)?;
        if migrate_policy(&mut settings, cfg!(target_os = "windows")) {
            crate::write_settings(app, &settings)?;
        }
        Ok::<_, String>(settings)
    })();
    match prepared {
        Err(error) => {
            set_status(
                app,
                format!("Startup update could not load/save preferences: {error}"),
                true,
            );
            return;
        }
        Ok(settings) if settings.update_preference.as_deref() == Some("ignore") => {
            set_status(app, "Automatic startup updates are off.", true);
            return;
        }
        _ => {}
    }
    set_status(app, "Checking for updates shortly…", false);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(2)).await;
        if let Err(error) = run(&handle).await {
            set_status(&handle, format!("Startup update: {error}"), true);
        }
    });
}
async fn run(app: &AppHandle) -> Result<(), String> {
    let version = format!("V{}", env!("CARGO_PKG_VERSION"));
    let mut found = None;
    for attempt in 0..3 {
        let current = settings(app)?;
        if current.update_preference.as_deref() == Some("ignore") {
            set_status(app, "Automatic startup updates are off.", true);
            return Ok(());
        }
        set_status(app, "Checking GitHub for a startup update…", false);
        match crate::check_for_updates(version.clone(), current.github_update_token).await {
            Ok(update) => {
                found = update;
                break;
            }
            Err(error) if attempt < 2 && retryable(&error) => {
                set_status(app, "Startup update check could not connect. Retrying shortly; Dashboard remains available.", false);
                tokio::time::sleep(Duration::from_secs(if attempt == 0 { 5 } else { 15 })).await;
            }
            Err(error) => return Err(error),
        }
    }
    let Some(update) = found else {
        set_status(app, format!("{version} is up to date."), true);
        return Ok(());
    };
    if let Ok(mut status) = app.state::<StartupUpdater>().status.lock() {
        status.available_update = Some(update.clone());
    }
    let current = settings(app)?;
    let preference = current.update_preference.as_deref().unwrap_or("notify");
    if !matches!(preference, "auto-install" | "auto-download") {
        set_status(
            app,
            format!(
                "{} is available. Automatic installation is off.",
                update.version
            ),
            true,
        );
        return Ok(());
    }
    let (Some(url), Some(name)) = (update.asset_url.clone(), update.asset_name.clone()) else {
        set_status(app, format!("{} is available, but no installer is published for this operating system. Open the GitHub release to update manually.", update.version), true);
        return Ok(());
    };
    if !verified_digest(update.asset_digest.as_deref()) {
        set_status(
            app,
            format!(
                "{} is available, but its SHA-256 is unavailable. Automatic update was skipped.",
                update.version
            ),
            true,
        );
        return Ok(());
    }
    set_status(
        app,
        format!("Downloading and verifying {}…", update.version),
        false,
    );
    let downloaded = crate::download_update(
        app.clone(),
        url,
        name,
        update.asset_digest,
        current.github_update_token,
    )
    .await?;
    if let Ok(mut status) = app.state::<StartupUpdater>().status.lock() {
        status.downloaded_update = Some(downloaded.clone());
    }
    // Re-read before installing so a changed policy takes effect during a download.
    let current = settings(app)?;
    if current.update_preference.as_deref() == Some("auto-install") && cfg!(target_os = "windows") {
        set_status(
            app,
            format!("Installing {} and restarting Dashboard…", update.version),
            false,
        );
        crate::install_update(app.clone(), downloaded.path, false, Some(false))?;
        set_status(app, "The update installer has started.", true);
    } else {
        set_status(
            app,
            format!(
                "{} is downloaded and verified. Install it when ready.",
                update.version
            ),
            true,
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_policies_require_fresh_opt_in() {
        for windows in [true, false] {
            for policy_version in [None, Some(1)] {
                for preference in [
                    None,
                    Some("notify"),
                    Some("ignore"),
                    Some("auto-download"),
                    Some("auto-install"),
                    Some("invalid"),
                ] {
                    let mut settings = StoredSettings::default();
                    settings.calendar_id = Some("team".into());
                    settings.update_preference = preference.map(str::to_string);
                    settings.startup_update_policy_version = policy_version;
                    assert!(migrate_policy(&mut settings, windows));
                    assert_eq!(
                        settings.update_preference.as_deref(),
                        Some(if preference == Some("ignore") {
                            "ignore"
                        } else {
                            "notify"
                        })
                    );
                    assert_eq!(settings.startup_update_policy_version, Some(2));
                    assert_eq!(settings.calendar_id.as_deref(), Some("team"));
                }
            }
        }
    }
    #[test]
    fn explicit_public_release_choices_survive() {
        for preference in ["notify", "ignore", "auto-download", "auto-install"] {
            let mut settings = StoredSettings::default();
            settings.update_preference = Some(preference.into());
            settings.startup_update_policy_version = Some(2);
            assert!(!migrate_policy(&mut settings, true));
            assert_eq!(settings.update_preference.as_deref(), Some(preference));
        }
        let mut copied = StoredSettings::default();
        copied.update_preference = Some("auto-install".into());
        copied.startup_update_policy_version = Some(2);
        assert!(migrate_policy(&mut copied, false));
        assert_eq!(copied.update_preference.as_deref(), Some("auto-download"));
    }
    #[test]
    fn only_transport_and_temporary_server_failures_retry() {
        assert!(retryable(
            "Could not check GitHub releases: connection refused"
        ));
        assert!(retryable(
            "GitHub release check returned HTTP 503 Service Unavailable"
        ));
        assert!(!retryable(
            "GitHub release check returned HTTP 401 Unauthorized"
        ));
        assert!(verified_digest(Some(&format!("sha256:{}", "a".repeat(64)))));
        assert!(!verified_digest(None));
        assert!(!verified_digest(Some("sha256:bad")));
    }
}
