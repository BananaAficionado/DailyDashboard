use super::{Action, Controls, Snapshot};
use base64::{engine::general_purpose, Engine as _};
use std::sync::{Mutex, OnceLock};
use windows::{
    Media::{Control::*, MediaPlaybackAutoRepeatMode},
    Storage::Streams::DataReader,
    Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
};
struct Apartment(bool);
impl Apartment {
    fn new() -> Self {
        Self(unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.is_ok())
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        if self.0 {
            unsafe { RoUninitialize() }
        }
    }
}
fn session() -> Result<Option<GlobalSystemMediaTransportControlsSession>, String> {
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .and_then(|op| op.get())
        .map_err(|e| e.to_string())?;
    let sessions = manager.GetSessions().map_err(|e| e.to_string())?;
    // Never use GetCurrentSession: that could target a browser or another music app.
    for session in sessions {
        let id = session
            .SourceAppUserModelId()
            .map_err(|e| e.to_string())?
            .to_string()
            .to_ascii_lowercase();
        if is_spotify(&id) {
            return Ok(Some(session));
        }
    }
    Ok(None)
}
fn is_spotify(id: &str) -> bool {
    id == "spotify.exe"
        || id == "spotify"
        || id.starts_with("spotifyab.spotifymusic_") && id.ends_with("!spotify")
}
fn artwork(session: &GlobalSystemMediaTransportControlsSession, key: &str) -> String {
    static CACHE: OnceLock<Mutex<(String, String)>> = OnceLock::new();
    let mut cache = match CACHE.get_or_init(|| Mutex::new(Default::default())).lock() {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    if cache.0 == key {
        return cache.1.clone();
    }
    let read = || -> windows::core::Result<String> {
        let thumb = session.TryGetMediaPropertiesAsync()?.get()?.Thumbnail()?;
        let stream = thumb.OpenReadAsync()?.get()?;
        let size = stream.Size()?;
        if size == 0 || size > 2 * 1024 * 1024 {
            return Ok(String::new());
        }
        let mime = stream.ContentType()?.to_string();
        if !["image/png", "image/jpeg", "image/webp", "image/gif"].contains(&mime.as_str()) {
            return Ok(String::new());
        }
        let reader = DataReader::CreateDataReader(&stream)?;
        let loaded = reader.LoadAsync(size as u32)?.get()?;
        let mut bytes = vec![0u8; loaded as usize];
        reader.ReadBytes(&mut bytes)?;
        Ok(format!(
            "data:{mime};base64,{}",
            general_purpose::STANDARD.encode(bytes)
        ))
    };
    let image = read().unwrap_or_default();
    *cache = (key.into(), image.clone());
    image
}
pub fn snapshot() -> Result<Snapshot, String> {
    let _apartment = Apartment::new();
    let Some(session) = session()? else {
        return Ok(Snapshot {
            provider: "windows".into(),
            status: "Open Spotify and start a track to connect local controls".into(),
            ..Default::default()
        });
    };
    let info = session.GetPlaybackInfo().map_err(|e| e.to_string())?;
    let controls = info.Controls().map_err(|e| e.to_string())?;
    let media = session
        .TryGetMediaPropertiesAsync()
        .and_then(|op| op.get())
        .map_err(|e| e.to_string())?;
    let title = media.Title().map(|v| v.to_string()).unwrap_or_default();
    let artist = media.Artist().map(|v| v.to_string()).unwrap_or_default();
    let album = media
        .AlbumTitle()
        .map(|v| v.to_string())
        .unwrap_or_default();
    let timeline = session.GetTimelineProperties().map_err(|e| e.to_string())?;
    let start = timeline.StartTime().map(|v| v.Duration).unwrap_or(0);
    let end = timeline.EndTime().map(|v| v.Duration).unwrap_or(start);
    let duration_ms = (end.saturating_sub(start).max(0) / 10_000) as u64;
    let progress_ms = (timeline
        .Position()
        .map(|v| v.Duration)
        .unwrap_or(start)
        .saturating_sub(start)
        .max(0)
        / 10_000) as u64;
    let is_playing = info
        .PlaybackStatus()
        .map(|v| v == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
        .unwrap_or(false);
    let shuffle = info.IsShuffleActive().and_then(|v| v.Value()).ok();
    let repeat = info.AutoRepeatMode().and_then(|v| v.Value()).ok().map(|m| {
        if m == MediaPlaybackAutoRepeatMode::Track {
            2
        } else if m == MediaPlaybackAutoRepeatMode::List {
            1
        } else {
            0
        }
    });
    // Windows publishes a timestamped position, not necessarily a new position each poll.
    let elapsed_ms = if is_playing {
        use std::time::{SystemTime, UNIX_EPOCH};
        let now_ticks = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
            / 100
            + 116_444_736_000_000_000u128;
        let updated = timeline
            .LastUpdatedTime()
            .map(|v| v.UniversalTime)
            .unwrap_or(0);
        if updated > 0 {
            now_ticks
                .saturating_sub(updated as u128)
                .min(u64::MAX as u128) as u64
                / 10_000
        } else {
            0
        }
    } else {
        0
    };
    let rate = info
        .PlaybackRate()
        .and_then(|v| v.Value())
        .unwrap_or(1.0)
        .clamp(0.0, 4.0);
    let progress_ms = progress_ms.saturating_add((elapsed_ms as f64 * rate) as u64);
    let artwork_url = artwork(&session, &format!("{title}\n{artist}\n{album}"));
    Ok(Snapshot {
        available: true,
        provider: "windows".into(),
        title,
        artist,
        album,
        artwork_url,
        duration_ms,
        progress_ms: progress_ms.min(duration_ms),
        is_playing,
        shuffle,
        repeat,
        controls: Controls {
            toggle: controls.IsPlayEnabled().unwrap_or(false)
                || controls.IsPauseEnabled().unwrap_or(false),
            previous: controls.IsPreviousEnabled().unwrap_or(false),
            next: controls.IsNextEnabled().unwrap_or(false),
            seek: duration_ms > 0 && controls.IsPlaybackPositionEnabled().unwrap_or(false),
            shuffle: shuffle.is_some() && controls.IsShuffleEnabled().unwrap_or(false),
            repeat: repeat.is_some() && controls.IsRepeatEnabled().unwrap_or(false),
            ..Default::default()
        },
        status: "Local Spotify · Windows".into(),
        ..Default::default()
    })
}
pub fn command(action: Action, value: Option<f64>) -> Result<(), String> {
    let _apartment = Apartment::new();
    let Some(session) = session()? else {
        return Err("Spotify is no longer available on this PC".into());
    };
    let controls = session
        .GetPlaybackInfo()
        .and_then(|i| i.Controls())
        .map_err(|e| e.to_string())?;
    let operation = match action {
        Action::Toggle if value == Some(1.) && controls.IsPlayEnabled().unwrap_or(false) => {
            session.TryPlayAsync()
        }
        Action::Toggle if value == Some(0.) && controls.IsPauseEnabled().unwrap_or(false) => {
            session.TryPauseAsync()
        }
        Action::Next if controls.IsNextEnabled().unwrap_or(false) => session.TrySkipNextAsync(),
        Action::Previous if controls.IsPreviousEnabled().unwrap_or(false) => {
            session.TrySkipPreviousAsync()
        }
        Action::Seek if controls.IsPlaybackPositionEnabled().unwrap_or(false) => {
            let timeline = session.GetTimelineProperties().map_err(|e| e.to_string())?;
            let start = timeline.StartTime().map(|v| v.Duration).unwrap_or(0);
            let end = timeline.EndTime().map(|v| v.Duration).unwrap_or(start);
            session.TryChangePlaybackPositionAsync(
                start
                    .saturating_add((value.unwrap_or(0.) * 10_000.) as i64)
                    .min(end),
            )
        }
        Action::Shuffle if controls.IsShuffleEnabled().unwrap_or(false) => {
            session.TryChangeShuffleActiveAsync(value == Some(1.))
        }
        Action::Repeat if controls.IsRepeatEnabled().unwrap_or(false) => session
            .TryChangeAutoRepeatModeAsync(match value.unwrap_or(0.) as u8 {
                1 => MediaPlaybackAutoRepeatMode::List,
                2 => MediaPlaybackAutoRepeatMode::Track,
                _ => MediaPlaybackAutoRepeatMode::None,
            }),
        _ => {
            return Err("This control needs the local Spotify connector (Settings → Music)".into())
        }
    };
    if operation
        .and_then(|op| op.get())
        .map_err(|e| e.to_string())?
    {
        Ok(())
    } else {
        Err("Spotify declined this control".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_spotify_sessions() {
        assert!(is_spotify("spotify.exe"));
        assert!(is_spotify("spotifyab.spotifymusic_zpdnekdrzrea0!spotify"));
        assert!(!is_spotify("chrome.exe"));
        assert!(!is_spotify("notspotify.exe"));
    }
}
