use super::{resolve, Bounds, DisplayBinding, DisplayTarget};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use windows::core::BOOL;
use windows::Win32::{
    Devices::Display::*,
    Foundation::*,
    Graphics::Gdi::*,
    UI::{Shell::*, WindowsAndMessaging::*},
};

fn wide(value: &[u16]) -> String {
    String::from_utf16_lossy(&value[..value.iter().position(|c| *c == 0).unwrap_or(value.len())])
}
pub fn ask_recovery(description: &str) -> bool {
    let title: Vec<u16> = "Daily Dashboard — Display recovery"
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let body: Vec<u16> = format!("{description}\n\nOpen Dashboard as an unlocked window on your main screen?\n\nYes: remove the saved display binding and show Dashboard.\nNo: keep the binding and wait for the selected screen.\n\nYou can also relaunch with --unlock-display at any time.").encode_utf16().chain(Some(0)).collect();
    unsafe {
        MessageBoxW(
            None,
            windows::core::PCWSTR(body.as_ptr()),
            windows::core::PCWSTR(title.as_ptr()),
            MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2 | MB_SETFOREGROUND | MB_TOPMOST,
        ) == IDYES
    }
}
unsafe extern "system" fn monitor_callback(
    monitor: HMONITOR,
    _: HDC,
    _: *mut RECT,
    data: LPARAM,
) -> BOOL {
    let list = &mut *(data.0 as *mut Vec<(String, Bounds)>);
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if GetMonitorInfoW(monitor, &mut info.monitorInfo).as_bool() {
        let r = info.monitorInfo.rcMonitor;
        list.push((
            wide(&info.szDevice),
            Bounds {
                x: r.left,
                y: r.top,
                width: (r.right - r.left).max(0) as u32,
                height: (r.bottom - r.top).max(0) as u32,
            },
        ));
    }
    BOOL(1)
}
fn source_key(path: &DISPLAYCONFIG_PATH_INFO) -> (i32, u32, u32) {
    (
        path.sourceInfo.adapterId.HighPart,
        path.sourceInfo.adapterId.LowPart,
        path.sourceInfo.id,
    )
}
pub fn inventory() -> Result<Vec<DisplayTarget>, String> {
    let flags = QDC_ONLY_ACTIVE_PATHS | QDC_VIRTUAL_MODE_AWARE;
    let mut paths = Vec::new();
    let mut success = false;
    for _ in 0..4 {
        let (mut pc, mut mc) = (0, 0);
        let result = unsafe { GetDisplayConfigBufferSizes(flags, &mut pc, &mut mc) };
        if result != ERROR_SUCCESS {
            return Err(format!("Cannot read display configuration ({})", result.0));
        }
        if pc > 256 || mc > 1024 {
            return Err("Unexpected display configuration size".into());
        }
        paths = vec![DISPLAYCONFIG_PATH_INFO::default(); pc as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mc as usize];
        let result = unsafe {
            QueryDisplayConfig(
                flags,
                &mut pc,
                paths.as_mut_ptr(),
                &mut mc,
                modes.as_mut_ptr(),
                None,
            )
        };
        if result == ERROR_INSUFFICIENT_BUFFER {
            continue;
        }
        if result != ERROR_SUCCESS {
            return Err(format!("Cannot read display configuration ({})", result.0));
        }
        paths.truncate(pc as usize);
        success = true;
        break;
    }
    if !success {
        return Err("Display configuration is changing; waiting for it to settle".into());
    }
    let mut rectangles = Vec::<(String, Bounds)>::new();
    if !unsafe {
        EnumDisplayMonitors(
            None,
            None,
            Some(monitor_callback),
            LPARAM(&mut rectangles as *mut _ as isize),
        )
    }
    .as_bool()
    {
        return Err("Cannot enumerate desktop monitors".into());
    }
    let mut counts = HashMap::new();
    for path in &paths {
        *counts.entry(source_key(path)).or_insert(0usize) += 1;
    }
    let mut targets = Vec::new();
    for path in paths {
        let mut source = DISPLAYCONFIG_SOURCE_DEVICE_NAME::default();
        source.header = DISPLAYCONFIG_DEVICE_INFO_HEADER {
            r#type: DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
            size: std::mem::size_of_val(&source) as u32,
            adapterId: path.sourceInfo.adapterId,
            id: path.sourceInfo.id,
        };
        let mut target = DISPLAYCONFIG_TARGET_DEVICE_NAME::default();
        target.header = DISPLAYCONFIG_DEVICE_INFO_HEADER {
            r#type: DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
            size: std::mem::size_of_val(&target) as u32,
            adapterId: path.targetInfo.adapterId,
            id: path.targetInfo.id,
        };
        if unsafe { DisplayConfigGetDeviceInfo(&mut source.header) } != 0
            || unsafe { DisplayConfigGetDeviceInfo(&mut target.header) } != 0
        {
            return Err(
                "Cannot identify every connected display; Dashboard remains hidden while locked"
                    .into(),
            );
        }
        let source_name = wide(&source.viewGdiDeviceName);
        let bounds = rectangles
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(&source_name))
            .map(|(_, r)| *r)
            .ok_or("Display geometry is changing; waiting for it to settle")?;
        let path_id = wide(&target.monitorDevicePath).to_lowercase();
        let name = wide(&target.monitorFriendlyDeviceName);
        let blocked_reason = if path_id.is_empty() {
            Some("This display has no reliable device identity".into())
        } else if counts.get(&source_key(&path)).copied().unwrap_or(0) != 1 {
            Some("This screen is mirrored. Extend the desktop to lock Dashboard to one physical display.".into())
        } else {
            None
        };
        targets.push(DisplayTarget {
            id: format!("windows:{path_id}"),
            name: if name.is_empty() {
                source_name.clone()
            } else {
                name
            },
            bounds,
            blocked_reason,
            source_name,
        });
    }
    // Virtual/driver clone groups can span source IDs; overlapping desktop areas are unsafe too.
    for i in 0..targets.len() {
        for j in i + 1..targets.len() {
            if overlaps(targets[i].bounds, targets[j].bounds) {
                let reason=Some("This display shares its desktop area with another output. Extend the desktop before locking Dashboard.".into());
                targets[i].blocked_reason = reason.clone();
                targets[j].blocked_reason = reason;
            }
        }
    }
    targets.sort_by_key(|t| (t.bounds.x, t.bounds.y, t.id.clone()));
    Ok(targets)
}
fn overlaps(a: Bounds, b: Bounds) -> bool {
    (a.x as i64) < b.x as i64 + b.width as i64
        && (b.x as i64) < a.x as i64 + a.width as i64
        && (a.y as i64) < b.y as i64 + b.height as i64
        && (b.y as i64) < a.y as i64 + a.height as i64
}
pub fn current_id(hwnd: HWND, targets: &[DisplayTarget]) -> Option<String> {
    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONULL) };
    if monitor.is_invalid() {
        return None;
    }
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of_val(&info) as u32;
    if !unsafe { GetMonitorInfoW(monitor, &mut info.monitorInfo) }.as_bool() {
        return None;
    }
    let name = wide(&info.szDevice);
    let mut matches = targets
        .iter()
        .filter(|t| t.source_name.eq_ignore_ascii_case(&name) && t.blocked_reason.is_none());
    let id = matches.next()?.id.clone();
    if matches.next().is_some() {
        None
    } else {
        Some(id)
    }
}
#[derive(Default)]
pub struct Guard {
    binding: Mutex<Option<DisplayBinding>>,
    pub invalidated: AtomicBool,
    pub allow_show: AtomicBool,
    in_hook: AtomicBool,
    pub fault: AtomicBool,
}
impl Guard {
    pub fn binding(&self) -> Option<DisplayBinding> {
        self.binding.lock().ok().and_then(|v| v.clone())
    }
    pub fn set_binding(&self, binding: Option<DisplayBinding>) {
        self.allow_show.store(binding.is_none(), Ordering::Release);
        if let Ok(mut stored) = self.binding.lock() {
            *stored = binding;
        }
        self.invalidated.store(true, Ordering::Release);
    }
    pub fn install(self: &Arc<Self>, hwnd: HWND) -> Result<(), String> {
        let retained = Arc::into_raw(self.clone());
        if !unsafe { SetWindowSubclass(hwnd, Some(subclass), 0x44444c4b, retained as usize) }
            .as_bool()
        {
            unsafe {
                drop(Arc::from_raw(retained));
            }
            return Err("Could not install the display movement guard".into());
        }
        Ok(())
    }
}
fn constrain(position: &mut WINDOWPOS, bounds: Bounds, allow_show: bool) {
    position.x = bounds.x;
    position.y = bounds.y;
    position.cx = bounds.width as i32;
    position.cy = bounds.height as i32;
    position.flags &= !(SWP_NOMOVE | SWP_NOSIZE);
    if !allow_show {
        position.flags &= !SWP_SHOWWINDOW;
        position.flags |= SWP_HIDEWINDOW;
    }
}
unsafe fn handle(guard: &Guard, hwnd: HWND, message: u32, lparam: LPARAM) {
    let Some(binding) = guard.binding() else {
        if guard.fault.load(Ordering::Acquire) && message == WM_WINDOWPOSCHANGING && lparam.0 != 0 {
            let position = &mut *(lparam.0 as *mut WINDOWPOS);
            position.flags &= !SWP_SHOWWINDOW;
            position.flags |= SWP_HIDEWINDOW;
        }
        return;
    };
    if matches!(
        message,
        WM_DISPLAYCHANGE | WM_DPICHANGED | WM_POWERBROADCAST
    ) {
        guard.allow_show.store(false, Ordering::Release);
        guard.invalidated.store(true, Ordering::Release);
        let _ = ShowWindow(hwnd, SW_HIDE);
    }
    if message == WM_WINDOWPOSCHANGING && lparam.0 != 0 {
        let position = &mut *(lparam.0 as *mut WINDOWPOS);
        match inventory().and_then(|targets| resolve(&binding, &targets).cloned()) {
            Ok(target) => constrain(
                position,
                target.bounds,
                guard.allow_show.load(Ordering::Acquire),
            ),
            Err(_) => {
                guard.allow_show.store(false, Ordering::Release);
                guard.invalidated.store(true, Ordering::Release);
                position.flags &= !SWP_SHOWWINDOW;
                position.flags |= SWP_HIDEWINDOW;
                let _ = ShowWindow(hwnd, SW_HIDE);
            }
        }
    }
}
unsafe extern "system" fn subclass(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id: usize,
    data: usize,
) -> LRESULT {
    let guard = &*(data as *const Guard);
    if message == WM_NCDESTROY {
        let _ = RemoveWindowSubclass(hwnd, Some(subclass), id);
        drop(Arc::from_raw(data as *const Guard));
        return DefSubclassProc(hwnd, message, wparam, lparam);
    }
    if !guard.in_hook.swap(true, Ordering::AcqRel) {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            handle(guard, hwnd, message, lparam)
        }));
        if result.is_err() {
            guard.allow_show.store(false, Ordering::Release);
            guard.invalidated.store(true, Ordering::Release);
            let _ = ShowWindow(hwnd, SW_HIDE);
        }
        guard.in_hook.store(false, Ordering::Release);
    }
    DefSubclassProc(hwnd, message, wparam, lparam)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn position_guard_constrains_show_and_move_before_placement() {
        let mut p = WINDOWPOS {
            x: 5000,
            y: 2000,
            cx: 800,
            cy: 600,
            flags: SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            ..Default::default()
        };
        let b = Bounds {
            x: -1280,
            y: 0,
            width: 1280,
            height: 400,
        };
        constrain(&mut p, b, false);
        assert_eq!((p.x, p.y, p.cx, p.cy), (-1280, 0, 1280, 400));
        assert!(!p.flags.contains(SWP_SHOWWINDOW));
        assert!(p.flags.contains(SWP_HIDEWINDOW));
        assert_eq!((p.flags & (SWP_NOMOVE | SWP_NOSIZE)).0, 0);
    }
    #[test]
    fn identical_or_overlapping_outputs_are_rejected_but_adjacent_screens_are_valid() {
        let a = Bounds {
            x: -1280,
            y: 0,
            width: 1280,
            height: 400,
        };
        assert!(overlaps(a, a));
        assert!(!overlaps(a, Bounds { x: 0, ..a }));
        assert!(overlaps(a, Bounds { x: -1, ..a }));
    }
    #[test]
    fn cloned_outputs_share_source_identity() {
        let mut a = DISPLAYCONFIG_PATH_INFO::default();
        a.sourceInfo.id = 4;
        let mut b = a;
        b.targetInfo.id = 8;
        assert_eq!(source_key(&a), source_key(&b));
        b.sourceInfo.id = 5;
        assert_ne!(source_key(&a), source_key(&b));
    }
}
