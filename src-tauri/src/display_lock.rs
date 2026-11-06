use serde::{Deserialize, Serialize};
use tauri::AppHandle;
#[cfg(not(target_os = "windows"))]
use tauri::Manager;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayBinding {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayTarget {
    pub id: String,
    pub name: String,
    pub bounds: Bounds,
    pub blocked_reason: Option<String>,
    #[serde(skip)]
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub source_name: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayLockInfo {
    pub supported: bool,
    pub displays: Vec<DisplayTarget>,
    pub current_id: Option<String>,
    pub binding: Option<DisplayBinding>,
    pub status: String,
}

// Physical IDs must resolve uniquely; never fall back to a name, ordinal or resolution.
#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
pub fn resolve<'a>(
    binding: &DisplayBinding,
    targets: &'a [DisplayTarget],
) -> Result<&'a DisplayTarget, String> {
    let mut matches = targets.iter().filter(|target| target.id == binding.id);
    let target = matches.next().ok_or("Selected display is unavailable.")?;
    if matches.next().is_some() {
        return Err("Display identity is ambiguous.".into());
    }
    if let Some(reason) = &target.blocked_reason {
        return Err(reason.clone());
    }
    if target.bounds.width == 0 || target.bounds.height == 0 {
        return Err("Selected display has no usable desktop area.".into());
    }
    Ok(target)
}

// All rectangles are physical screen pixels. Outer bounds alone can pass while
// the webview is inset by an undecorated Windows shadow or a taskbar work area.
#[cfg(any(target_os = "windows", test))]
fn validate_placement(target: Bounds, outer: Bounds, client: Bounds) -> Result<(), String> {
    if outer != target {
        return Err("Windows did not restore the selected display bounds; retrying".into());
    }
    if client != target {
        return Err("Dashboard content did not fill the selected display; retrying".into());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
#[path = "display_lock_windows.rs"]
mod controller;
#[cfg(target_os = "windows")]
#[path = "display_windows.rs"]
mod platform;
#[cfg(any(target_os = "windows", test))]
#[path = "display_recovery.rs"]
mod recovery;
#[cfg(target_os = "windows")]
pub use controller::relaunched;
#[cfg(target_os = "windows")]
pub use controller::DisplayLock;
#[cfg(not(target_os = "windows"))]
#[derive(Default)]
pub struct DisplayLock;

pub fn setup(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        controller::setup(app)
    }
    #[cfg(not(target_os = "windows"))]
    {
        app.get_webview_window("main")
            .ok_or("Dashboard window unavailable")?
            .show()
            .map_err(|e| e.to_string())
    }
}
pub fn validate_change(
    app: &AppHandle,
    previous: &Option<DisplayBinding>,
    next: &Option<DisplayBinding>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    if next != previous {
        if let Some(binding) = next {
            if !binding.id.starts_with("windows:")
                || binding.id.len() > 1024
                || binding.name.len() > 512
            {
                return Err("Choose a connected display from the list.".into());
            }
            resolve(binding, &platform::inventory()?)?;
        }
    }
    let _ = (app, previous, next);
    Ok(())
}
pub fn changed(app: &AppHandle, binding: Option<DisplayBinding>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        controller::changed(app, binding)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, binding);
        Ok(())
    }
}
#[tauri::command]
pub fn display_lock_info(app: AppHandle) -> Result<DisplayLockInfo, String> {
    #[cfg(target_os = "windows")]
    {
        controller::info(&app)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(DisplayLockInfo {
            supported: false,
            displays: vec![],
            current_id: None,
            binding: None,
            status: String::new(),
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn target(id: &str) -> DisplayTarget {
        DisplayTarget {
            id: id.into(),
            name: "Same model".into(),
            bounds: Bounds {
                x: -1280,
                y: 30,
                width: 1280,
                height: 400,
            },
            blocked_reason: None,
            source_name: String::new(),
        }
    }
    #[test]
    fn exact_identity_survives_reordering_and_negative_coordinates() {
        let selected = DisplayBinding {
            id: "physical-b".into(),
            name: "Same model".into(),
        };
        let list = vec![target("physical-a"), target("physical-b")];
        assert_eq!(resolve(&selected, &list).unwrap().bounds.x, -1280);
        assert_eq!(
            resolve(&selected, &list.into_iter().rev().collect::<Vec<_>>())
                .unwrap()
                .id,
            "physical-b"
        );
    }
    #[test]
    fn missing_ambiguous_mirrored_and_inactive_targets_fail_closed() {
        let selected = DisplayBinding {
            id: "physical-b".into(),
            name: "Same model".into(),
        };
        assert!(resolve(&selected, &[target("physical-a")]).is_err());
        assert!(resolve(&selected, &[target("physical-b"), target("physical-b")]).is_err());
        let mut mirrored = target("physical-b");
        mirrored.blocked_reason = Some("Mirrored display".into());
        assert!(resolve(&selected, &[mirrored]).is_err());
        let mut inactive = target("physical-b");
        inactive.bounds.width = 0;
        assert!(resolve(&selected, &[inactive]).is_err());
    }
    #[test]
    fn binding_roundtrips_without_relying_on_a_display_number() {
        let binding = DisplayBinding {
            id: r"windows:\\?\display#unique".into(),
            name: "Dashboard screen".into(),
        };
        assert_eq!(
            serde_json::from_str::<DisplayBinding>(&serde_json::to_string(&binding).unwrap())
                .unwrap(),
            binding
        );
    }

    #[test]
    fn locked_content_fills_physical_bounds_at_every_display_scale() {
        for (width, height) in [(1280, 400), (1280, 480), (1920, 600), (2560, 800)] {
            for (x, y) in [(0, 0), (-(width as i32), 30), (1920, -800)] {
                let screen = Bounds {
                    x,
                    y,
                    width,
                    height,
                };
                assert!(validate_placement(screen, screen, screen).is_ok());
                for scale in [75, 100, 125, 150, 175, 200] {
                    // Regression: Tao's shadow left/right/bottom insets grow
                    // with DPI, while the outer window still matches exactly.
                    let border = 8 * scale / 100;
                    let inset = Bounds {
                        x: screen.x + border as i32,
                        width: width - 2 * border,
                        height: height - border,
                        ..screen
                    };
                    assert!(validate_placement(screen, screen, inset).is_err());
                }
            }
        }
    }

    #[test]
    fn locked_placement_rejects_shifted_or_work_area_sized_windows() {
        let screen = target("screen").bounds;
        let shifted = Bounds {
            x: screen.x + 1,
            ..screen
        };
        let work_area = Bounds {
            height: screen.height - 40,
            ..screen
        };
        assert!(validate_placement(screen, shifted, screen).is_err());
        assert!(validate_placement(screen, screen, shifted).is_err());
        assert!(validate_placement(screen, work_area, work_area).is_err());
        assert!(validate_placement(screen, screen, work_area).is_err());
    }
}
