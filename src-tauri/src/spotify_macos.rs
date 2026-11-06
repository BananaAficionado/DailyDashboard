use super::{Action, Controls, Snapshot};
use std::process::Command;
fn script(value: &str) -> Result<String, String> {
    let output = Command::new("osascript")
        .args(["-l", "JavaScript", "-e", value])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("Allow Daily Dashboard to control Spotify in System Settings → Privacy & Security → Automation".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}
pub fn snapshot() -> Result<Snapshot, String> {
    let data = script(
        r#"const app=Application('Spotify');
if (!app.running()) JSON.stringify({available:false,status:'Open Spotify to connect local controls'});
else {let track;try{track=app.currentTrack()}catch(e){};
let result={available:true,provider:'macos',isPlaying:app.playerState()==='playing',progressMs:Math.max(0,Math.round(app.playerPosition()*1000)),volumePercent:app.soundVolume(),shuffle:app.shuffling(),status:'Local Spotify · macOS'};
if(track){try{result.title=track.name();result.artist=track.artist();result.album=track.album();result.uri=track.spotifyUrl();result.durationMs=track.duration();result.artworkUrl=track.artworkUrl()}catch(e){}}
JSON.stringify(result)}"#,
    )?;
    let mut snapshot: Snapshot = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    // Spotify's scripting duration is milliseconds (its dictionary's description is outdated).
    snapshot.controls = Controls {
        toggle: snapshot.available,
        previous: snapshot.available,
        next: snapshot.available,
        seek: snapshot.duration_ms > 0,
        volume: snapshot.available,
        shuffle: snapshot.available,
        ..Default::default()
    };
    snapshot.progress_ms = snapshot.progress_ms.min(snapshot.duration_ms);
    if !super::valid_artwork_url(&snapshot.artwork_url) {
        snapshot.artwork_url.clear();
    }
    Ok(snapshot)
}
pub fn command(action: Action, value: Option<f64>) -> Result<(), String> {
    let command = match action {
        Action::Toggle => {
            if value == Some(1.) {
                "app.play()".into()
            } else {
                "app.pause()".into()
            }
        }
        Action::Previous => "app.previousTrack()".into(),
        Action::Next => "app.nextTrack()".into(),
        Action::Seek => format!("app.playerPosition={}", value.unwrap_or(0.) / 1000.),
        Action::Volume => format!("app.soundVolume={}", value.unwrap_or(0.).round()),
        Action::Shuffle => format!("app.shuffling={}", value == Some(1.)),
        _ => {
            return Err("This control needs the local Spotify connector (Settings → Music)".into())
        }
    };
    script(&format!("const app=Application('Spotify');if(!app.running())throw Error('Spotify closed');{command};'ok'"))?;
    Ok(())
}
