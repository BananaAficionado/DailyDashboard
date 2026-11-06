//! Recovery decisions are independent of Win32 so hotplug timing is testable.
use super::Bounds;
use std::time::{Duration, Instant};

pub fn recovery_frame(area: Bounds, scale: f64, preferred: Option<(u32, u32)>) -> Bounds {
    let scale = if scale.is_finite() {
        scale.clamp(0.5, 8.)
    } else {
        1.
    };
    let margin_x = ((16. * scale) as u32).min(area.width.saturating_sub(1));
    let margin_y = ((16. * scale) as u32).min(area.height.saturating_sub(1));
    let (width, height) = preferred.unwrap_or(((1280. * scale) as u32, (400. * scale) as u32));
    Bounds {
        x: area.x.saturating_add(margin_x as i32),
        y: area.y.saturating_add(margin_y as i32),
        width: width.min(area.width.saturating_sub(margin_x * 2).max(1)),
        height: height.min(area.height.saturating_sub((64. * scale) as u32).max(1)),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LaunchAction {
    Show,
    Unlock,
    KeepLocked,
}
impl LaunchAction {
    pub fn from_args(args: &[String]) -> Self {
        if args
            .iter()
            .skip(1)
            .any(|arg| matches!(arg.as_str(), "--unlock-display" | "--reset-display-lock"))
        {
            Self::Unlock
        } else if args.iter().skip(1).any(|arg| arg == "--keep-display-lock") {
            Self::KeepLocked
        } else {
            Self::Show
        }
    }
}

#[derive(Default)]
pub struct Recovery {
    since: Option<Instant>,
    offered: bool,
    pending: bool,
}
impl Recovery {
    pub fn claim(&mut self, now: Instant, immediate: bool) -> bool {
        let since = *self.since.get_or_insert(now);
        if self.pending
            || self.offered
            || (!immediate && now.duration_since(since) < Duration::from_secs(10))
        {
            return false;
        }
        self.offered = true;
        self.pending = true;
        true
    }
    pub fn healthy(&mut self) {
        self.since = None;
        self.offered = false;
    }
    pub fn finished(&mut self) {
        self.pending = false;
    }
    pub fn retry(&mut self) {
        self.offered = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_window_fits_available_work_area_at_high_dpi_and_negative_coordinates() {
        for scale in [1., 1.25, 1.5, 2., 4.] {
            let area = Bounds {
                x: -1920,
                y: -400,
                width: 1280,
                height: 400,
            };
            let frame = recovery_frame(area, scale, Some((3840, 2160)));
            assert!(frame.x >= area.x && frame.y >= area.y);
            assert!(frame.x as i64 + frame.width as i64 <= area.x as i64 + area.width as i64);
            assert!(frame.y as i64 + frame.height as i64 <= area.y as i64 + area.height as i64);
        }
    }
    #[test]
    fn unlock_flags_override_keep_and_ignore_executable_name() {
        for flag in ["--unlock-display", "--reset-display-lock"] {
            assert_eq!(
                LaunchAction::from_args(&[
                    "app.exe".into(),
                    "--keep-display-lock".into(),
                    flag.into()
                ]),
                LaunchAction::Unlock
            );
        }
        assert_eq!(
            LaunchAction::from_args(&["--unlock-display".into()]),
            LaunchAction::Show
        );
        assert_eq!(
            LaunchAction::from_args(&["app.exe".into(), "--keep-display-lock".into()]),
            LaunchAction::KeepLocked
        );
    }
    #[test]
    fn short_disconnects_do_not_prompt_and_repeated_failures_prompt_once() {
        let now = Instant::now();
        let mut recovery = Recovery::default();
        assert!(!recovery.claim(now, false));
        assert!(!recovery.claim(now + Duration::from_secs(9), false));
        assert!(recovery.claim(now + Duration::from_secs(10), false));
        assert!(!recovery.claim(now + Duration::from_secs(20), true));
        recovery.finished();
        assert!(!recovery.claim(now + Duration::from_secs(30), false));
        recovery.healthy();
        assert!(!recovery.claim(now + Duration::from_secs(40), false));
        assert!(recovery.claim(now + Duration::from_secs(50), false));
    }
    #[test]
    fn startup_and_relaunch_can_offer_immediate_recovery_without_duplicate_dialogs() {
        let now = Instant::now();
        let mut recovery = Recovery::default();
        assert!(recovery.claim(now, true));
        recovery.retry();
        assert!(!recovery.claim(now, true));
        recovery.finished();
        assert!(recovery.claim(now, true));
    }
}
