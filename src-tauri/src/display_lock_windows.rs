use super::{
    platform,
    recovery::{recovery_frame, LaunchAction, Recovery},
    resolve, validate_placement, Bounds, DisplayBinding, DisplayLockInfo, DisplayTarget,
};
use std::sync::{atomic::Ordering, Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
};
use windows::Win32::Foundation::HWND;

#[derive(Clone)]
struct NormalFrame {
    size: PhysicalSize<u32>,
}
#[derive(Default)]
struct Inner {
    binding: Option<DisplayBinding>,
    last_target: Option<DisplayTarget>,
    normal: Option<NormalFrame>,
    engaged: bool,
    force_show: bool,
    status: String,
    fault: Option<String>,
    recovery: Recovery,
    revision: u64,
    quiet_recovery: bool,
}
#[derive(Default)]
pub struct DisplayLock {
    inner: Mutex<Inner>,
    guard: Arc<platform::Guard>,
}
fn reconcile(app: &AppHandle) -> Result<(), String> {
    let service = app.state::<DisplayLock>();
    let window = app
        .get_webview_window("main")
        .ok_or("Dashboard window unavailable")?;
    let mut state = service
        .inner
        .lock()
        .map_err(|_| "Display lock state unavailable")?;
    if let Some(error) = &state.fault {
        window.hide().map_err(|e| e.to_string())?;
        return Err(error.clone());
    }
    let invalidated = service.guard.invalidated.swap(false, Ordering::AcqRel);
    if let Some(binding) = state.binding.clone() {
        let target = platform::inventory().and_then(|targets| resolve(&binding, &targets).cloned());
        match target {
            Err(error) => {
                service.guard.allow_show.store(false, Ordering::Release);
                window.hide().map_err(|e| e.to_string())?;
                state.last_target = None;
                state.status =
                    format!("{error} Dashboard is hidden until the selected screen is available.");
                return Ok(());
            }
            Ok(target) => {
                let changed = invalidated
                    || !service.guard.allow_show.load(Ordering::Acquire)
                    || state.force_show
                    || state
                        .last_target
                        .as_ref()
                        .is_none_or(|last| last.id != target.id || last.bounds != target.bounds);
                if !changed {
                    return Ok(());
                }
                service.guard.allow_show.store(false, Ordering::Release);
                window.hide().map_err(|e| e.to_string())?;
                if !state.engaged {
                    state.normal = Some(NormalFrame {
                        size: window.inner_size().map_err(|e| e.to_string())?,
                    });
                    state.engaged = true;
                }
                // Native guard constrains every intervening placement, including fullscreen transitions.
                window
                    .set_min_size(None::<LogicalSize<f64>>)
                    .map_err(|e| e.to_string())?;
                window.set_fullscreen(false).map_err(|e| e.to_string())?;
                window.unminimize().map_err(|e| e.to_string())?;
                window.unmaximize().map_err(|e| e.to_string())?;
                window.hide().map_err(|e| e.to_string())?;
                // Tao reserves DPI-scaled left/right/bottom client insets for
                // undecorated shadows, even when the outer window fills a monitor.
                window.set_shadow(false).map_err(|e| e.to_string())?;
                window.set_decorations(false).map_err(|e| e.to_string())?;
                window.set_resizable(false).map_err(|e| e.to_string())?;
                window
                    .set_position(PhysicalPosition::new(target.bounds.x, target.bounds.y))
                    .map_err(|e| e.to_string())?;
                window
                    .set_size(PhysicalSize::new(target.bounds.width, target.bounds.height))
                    .map_err(|e| e.to_string())?;
                // Borderless bounds avoid Tao retaining a stale fullscreen monitor after hotplug.
                // Revalidate immediately before permitting visibility; failures stay hidden.
                let verified = platform::inventory()
                    .and_then(|targets| resolve(&binding, &targets).cloned())?;
                if verified.bounds != target.bounds {
                    return Err(
                        "Display configuration changed during placement; waiting to reconnect"
                            .into(),
                    );
                }
                service.guard.allow_show.store(true, Ordering::Release);
                window.unminimize().map_err(|e| e.to_string())?;
                window.show().map_err(|e| e.to_string())?;
                if !service.guard.allow_show.load(Ordering::Acquire) {
                    return Err("Display placement was invalidated; retrying".into());
                }
                let position = window.outer_position().map_err(|e| e.to_string())?;
                let size = window.outer_size().map_err(|e| e.to_string())?;
                let client_position = window.inner_position().map_err(|e| e.to_string())?;
                let client_size = window.inner_size().map_err(|e| e.to_string())?;
                validate_placement(
                    target.bounds,
                    Bounds {
                        x: position.x,
                        y: position.y,
                        width: size.width,
                        height: size.height,
                    },
                    Bounds {
                        x: client_position.x,
                        y: client_position.y,
                        width: client_size.width,
                        height: client_size.height,
                    },
                )?;
                if state.force_show {
                    let _ = window.set_focus();
                }
                state.force_show = false;
                state.status = format!("Locked to {}", target.name);
                state.last_target = Some(target);
            }
        }
    } else {
        if state.engaged {
            window.hide().map_err(|e| e.to_string())?;
            window.set_fullscreen(false).map_err(|e| e.to_string())?;
            // Restore first: moving an iconic/maximized window can leave its old
            // normal placement intact, which Windows would otherwise restore later.
            window.unminimize().map_err(|e| e.to_string())?;
            window.unmaximize().map_err(|e| e.to_string())?;
            window.hide().map_err(|e| e.to_string())?;
            window.set_decorations(true).map_err(|e| e.to_string())?;
            window.set_shadow(true).map_err(|e| e.to_string())?;
            window.set_resizable(true).map_err(|e| e.to_string())?;
            let monitor = window
                .primary_monitor()
                .map_err(|e| e.to_string())?
                .or_else(|| window.available_monitors().ok()?.into_iter().next());
            if let Some(monitor) = monitor {
                let area = monitor.work_area();
                let scale = monitor.scale_factor();
                let frame = recovery_frame(
                    super::Bounds {
                        x: area.position.x,
                        y: area.position.y,
                        width: area.size.width,
                        height: area.size.height,
                    },
                    scale,
                    state
                        .normal
                        .take()
                        .map(|frame| (frame.size.width, frame.size.height)),
                );
                let (width, height) = (frame.width, frame.height);
                window
                    .set_min_size(None::<LogicalSize<f64>>)
                    .map_err(|e| e.to_string())?;
                window
                    .set_size(PhysicalSize::new(width, height))
                    .map_err(|e| e.to_string())?;
                window
                    .set_position(PhysicalPosition::new(frame.x, frame.y))
                    .map_err(|e| e.to_string())?;
                window
                    .set_min_size(Some(LogicalSize::new(
                        (width as f64 / scale).min(960.),
                        (height as f64 / scale).min(360.),
                    )))
                    .map_err(|e| e.to_string())?;
            } else {
                window.center().map_err(|e| e.to_string())?;
            }
            state.engaged = false;
            state.last_target = None;
        }
        if state.force_show {
            window.show().map_err(|e| e.to_string())?;
            window.unminimize().map_err(|e| e.to_string())?;
            let _ = window.set_focus();
            state.force_show = false;
        }
        state.status = "Monitor lock is off".into();
    }
    Ok(())
}
fn tick(app: &AppHandle) {
    if let Err(error) = reconcile(app) {
        let service = app.state::<DisplayLock>();
        service.guard.allow_show.store(false, Ordering::Release);
        service.guard.invalidated.store(true, Ordering::Release);
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
        if let Ok(mut state) = service.inner.lock() {
            state.status = error;
            state.last_target = None;
        };
    }
    offer_recovery(app, false);
}
pub fn changed(app: &AppHandle, binding: Option<DisplayBinding>) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let service = handle.state::<DisplayLock>();
        if let Ok(mut state) = service.inner.lock() {
            let recovered_fault = state.fault.take().is_some();
            service.guard.fault.store(false, Ordering::Release);
            if state.binding != binding || recovered_fault {
                state.revision = state.revision.wrapping_add(1);
                state.recovery.healthy();
                state.quiet_recovery = false;
                state.binding = binding.clone();
                state.last_target = None;
                state.force_show = true;
                service.guard.set_binding(binding);
            }
        }
        tick(&handle);
    })
    .map_err(|e| e.to_string())
}
pub fn info(app: &AppHandle) -> Result<DisplayLockInfo, String> {
    let service = app.state::<DisplayLock>();
    let (binding, status) = {
        let state = service
            .inner
            .lock()
            .map_err(|_| "Display lock state unavailable")?;
        (state.binding.clone(), state.status.clone())
    };
    match platform::inventory() {
        Ok(displays) => {
            let current_id = app
                .get_webview_window("main")
                .and_then(|w| w.hwnd().ok())
                .and_then(|h| platform::current_id(HWND(h.0), &displays));
            Ok(DisplayLockInfo {
                supported: true,
                displays,
                current_id,
                binding,
                status,
            })
        }
        Err(error) => Ok(DisplayLockInfo {
            supported: true,
            displays: vec![],
            current_id: None,
            binding,
            status: error,
        }),
    }
}
fn notify_error(error: String) {
    std::thread::spawn(move || {
        rfd::MessageDialog::new()
            .set_title("Daily Dashboard")
            .set_description(error)
            .show();
    });
}
fn offer_recovery(app: &AppHandle, immediate: bool) {
    let service = app.state::<DisplayLock>();
    let request = service.inner.lock().ok().and_then(|mut state| {
        let failed =
            state.fault.is_some() || (state.binding.is_some() && state.last_target.is_none());
        if !failed {
            state.recovery.healthy();
            return None;
        }
        if state.quiet_recovery || !state.recovery.claim(std::time::Instant::now(), immediate) {
            return None;
        }
        Some((
            state.revision,
            format!(
                "The selected Dashboard display could not be used.\n{}",
                state.status
            ),
        ))
    });
    let Some((revision, description)) = request else {
        return;
    };
    let handle = app.clone();
    std::thread::spawn(move || {
        // Unparented native dialog appears on an available desktop, not the missing target.
        // The Dashboard event loop and reconnect watcher remain responsive while it is open.
        let open_unlocked = platform::ask_recovery(&description);
        let result_handle = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            let service = result_handle.state::<DisplayLock>();
            let current = if let Ok(mut state) = service.inner.lock() {
                state.recovery.finished();
                state.revision == revision
            } else {
                false
            };
            if current && open_unlocked {
                if let Err(error) = unlock(&result_handle) {
                    notify_error(error);
                }
            }
        });
    });
}
fn unlock(app: &AppHandle) -> Result<(), String> {
    let service = app.state::<DisplayLock>();
    {
        let mut state = service
            .inner
            .lock()
            .map_err(|_| "Display lock state unavailable")?;
        state.binding = None;
        state.fault = None;
        state.revision = state.revision.wrapping_add(1);
        state.recovery.healthy();
        state.quiet_recovery = false;
        state.engaged = true;
        state.force_show = true;
        service.guard.fault.store(false, Ordering::Release);
        service.guard.set_binding(None);
    }
    // Always release the native guard, even when disk settings cannot be updated.
    let saved = (|| {
        let app_state = app.state::<crate::AppState>();
        let _write = app_state
            .settings_write
            .lock()
            .map_err(|_| "Settings are busy")?;
        let mut settings = crate::read_settings(app)?;
        settings.display_lock = None;
        crate::write_settings(app, &settings)
    })();
    tick(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(r#"window.dispatchEvent(new Event("dashboard-display-unlocked"))"#);
    }
    saved.map_err(|error| format!("Display lock is off for this session, but the change could not be saved: {error}. The settings file was not reset. Use --unlock-display again on the next launch."))
}
pub fn relaunched(app: &AppHandle, args: Vec<String>) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let action = LaunchAction::from_args(&args);
        if action == LaunchAction::Unlock {
            if let Err(error) = unlock(&handle) {
                notify_error(error);
            }
            return;
        }
        if let Ok(mut state) = handle.state::<DisplayLock>().inner.lock() {
            state.force_show = true;
            state.quiet_recovery = action == LaunchAction::KeepLocked;
            state.recovery.retry();
        }
        tick(&handle);
        offer_recovery(&handle, true);
    });
}
pub fn setup(app: &AppHandle) -> Result<(), String> {
    let action = LaunchAction::from_args(&std::env::args().collect::<Vec<_>>());
    let show = MenuItem::with_id(
        app,
        "dashboard-show",
        "Show Dashboard on selected display",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let reset = MenuItem::with_id(
        app,
        "dashboard-unlock",
        "Unlock display and show Dashboard",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(app, "dashboard-quit", "Quit Dashboard", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&show, &reset, &quit]).map_err(|e| e.to_string())?;
    let mut builder = TrayIconBuilder::with_id("dashboard-recovery")
        .tooltip("Daily Dashboard")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "dashboard-show" => {
                if let Ok(mut state) = app.state::<DisplayLock>().inner.lock() {
                    state.force_show = true;
                    state.quiet_recovery = false;
                    state.recovery.retry();
                }
                tick(app);
                offer_recovery(app, true);
            }
            "dashboard-unlock" => {
                if let Err(error) = unlock(app) {
                    notify_error(error);
                }
            }
            "dashboard-quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .build(app)
        .map_err(|e| format!("Cannot create the recovery tray menu: {e}"))?;
    let window = app
        .get_webview_window("main")
        .ok_or("Dashboard window unavailable")?;
    let service = app.state::<DisplayLock>();
    service
        .guard
        .install(HWND(window.hwnd().map_err(|e| e.to_string())?.0))?;
    let loaded = crate::read_settings(app);
    {
        let mut state = service
            .inner
            .lock()
            .map_err(|_| "Display lock state unavailable")?;
        state.quiet_recovery = action == LaunchAction::KeepLocked;
        match loaded {
            Ok(settings) => {
                state.binding = settings.display_lock.clone();
                state.force_show = true;
                service.guard.set_binding(settings.display_lock);
            }
            Err(error) => {
                state.status=format!("Cannot load display preference: {error}. Recovery can open an unlocked window for this session without replacing the settings file.");
                state.fault = Some(state.status.clone());
                service.guard.fault.store(true, Ordering::Release);
            }
        }
    }
    if action == LaunchAction::Unlock {
        if let Err(error) = unlock(app) {
            notify_error(error);
        }
    } else {
        tick(app);
        offer_recovery(app, true);
    }
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let tick_handle = handle.clone();
        if handle
            .run_on_main_thread(move || tick(&tick_handle))
            .is_err()
        {
            break;
        }
    });
    Ok(())
}
