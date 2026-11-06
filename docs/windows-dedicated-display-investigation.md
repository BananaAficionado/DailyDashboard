# Windows 11 dedicated display investigation

Investigated 5 November 2026 against Daily Dashboard V0.5.5, its installed Tauri/Wry sources, and Microsoft documentation. This records the original feasibility assessment; no Windows display configuration was changed during that investigation. V0.5.6 subsequently implements the Windows-only desktop-monitor lock described in the [setup guide](dedicated-display.md). Specialized-display composition remains a separate proposal, and Windows hardware transitions still need on-device testing.

## Finding

There are two distinct requirements: keep Dashboard's own window on one chosen desktop monitor, or reserve a monitor outside the Windows desktop so ordinary applications cannot use it. The first fits the existing application. The second requires a separate native rendering path.

| Approach | Dashboard placement | Other desktop apps on the screen | Existing interaction |
| --- | --- | --- | --- |
| Dedicated desktop-monitor mode | Constrain Dashboard to a selected physical display; hide when unavailable | Still possible; fullscreen/always-on-top is not exclusive ownership | Normal mouse, touch and keyboard remain available |
| Specialized display / “Remove display from desktop” | Native compositor acquires and presents to that target | Desktop compositor does not use that target | Ordinary desktop pointer/touch routing is unavailable; needs a separate input/control design |
| Assigned Access / Shell Launcher | Account/device kiosk policies | Changes the signed-in user's environment | Appropriate for a dedicated kiosk PC; does not itself bind this app to one monitor of an otherwise normal workstation |

Microsoft describes specialized monitors as excluded from desktop composition and normal mouse/touch input. Its compositor API is `Windows.Devices.Display.Core`, rather than a fullscreen-window API. These facts make the Windows toggle insufficient for the current Dashboard executable. [Specialized monitor behaviour](https://learn.microsoft.com/en-us/windows-hardware/drivers/display/specialized-monitors), [compositor architecture](https://learn.microsoft.com/en-us/windows-hardware/drivers/display/specialized-monitors-compositor).

## Existing application evidence

- `src-tauri/tauri.conf.json` creates a centered, resizable 1280×400 desktop window. It has no saved target-monitor identity or hidden-until-placed startup policy.
- `src/App.tsx` toggles fullscreen on the current window. It does not select a physical monitor or enforce placement.
- `src-tauri/src/lib.rs` has no display ownership service, topology watcher or window-position guard.
- The installed Wry Windows backend creates a normal HWND-hosted WebView2 controller (`CreateCoreWebView2Controller[WithOptions]`). It does not present Dashboard frames through Display Core.
- Tauri's installed monitor descriptor provides a name, physical position/size, work area and scale factor. A Windows-specific identity layer is needed to distinguish physical monitors reliably across topology changes.

## Recommended first implementation: dedicated desktop monitor

Assuming the calendar hover previews, music controls and Settings should remain directly interactive, implement an opt-in **Dedicated display** setting:

1. Let the user select and identify the actual monitor. Save its Windows device path and available EDID identity/serial evidence, not just “Display 2”, a model name, resolution or coordinates. Treat a changed port/ambiguous identity as requiring explicit reassignment rather than guessing a different monitor. Microsoft PowerToys likewise distinguishes device paths from volatile handles and display numbers. [Monitor identity reference](https://github.com/microsoft/PowerToys/blob/main/doc/devdocs/modules/powerdisplay/design.md), [target device fields](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-displayconfig_target_device_name).
2. Create the Dashboard window hidden. Validate the chosen active target, place/size it in physical pixels, apply its DPI and fullscreen policy, and only then show it. This avoids an ordinary startup flash on the primary monitor.
3. Guard window position/show transitions in native Windows code; do not rely solely on a React timer or moving the window back after it has already moved. Windows permits position changes to be constrained in `WM_WINDOWPOSCHANGING`. Account for move shortcuts, Snap, restore, fullscreen transitions and taskbar activation. [Position-change hook](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-windowposchanging).
4. Revalidate on display/device, DPI, power/session and docking changes. Query topology with retry handling, and map targets back to the current window coordinates. Hide the window if the target is absent, inactive, ambiguous, unqueryable or duplicated to another physical monitor. Do not fall back to the primary display. Resume only after the same target is validated. [Display topology API](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-querydisplayconfig), [resolution notification](https://learn.microsoft.com/en-us/windows/win32/gdi/wm-displaychange).
5. Provide a deliberate recovery path, such as a tray command to clear/reassign the display binding. Recovery UI on another screen must be an explicit exception the user chooses, rather than an automatic Dashboard fallback.
6. Audit native dialogs and auxiliary windows as well as the main window. The app uses file pickers and launches the external browser, Spotify and installers. Dashboard can parent/constrain its own dialogs where supported, but cannot promise confinement of those independently owned applications or Windows security dialogs. A strict display-only mode should suppress/defer desktop dialogs and use a separate control surface.

This is an engineering proposal, not a verified zero-frame guarantee during every Windows topology transition. Clone/mirror mode defeats ordinary monitor placement because one desktop source can feed multiple outputs. Administrative software and intentional screen capture/mirroring are also outside a window-placement policy. Literal exclusive output should use the specialized compositor route.

`SetWindowDisplayAffinity` is also not a monitor selector: it controls capture visibility, and accepts no target-monitor handle. It would not solve this requirement. [Microsoft API reference](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity).

## Specialized-display route

The user-selected Windows setting makes a target eligible for specialized presentation; naming an EXE as a special-purpose app does not convert an HWND into a compositor. The native backend would need to acquire the selected target, establish display modes, allocate GPU output surfaces and submit frames. Microsoft supplies a C++/WinRT Direct3D compositor sample, which is a suitable initial hardware probe. [Microsoft sample](https://github.com/microsoft/Windows-classic-samples/tree/main/Samples/DisplayCoreCustomCompositor).

Keeping the React interface would require an additional, proven WebView-to-GPU-frame bridge. WebView2 offers composition hosting, but that API alone does not connect a webview to Display Core scanout. A prototype must demonstrate composition/capture or another supported frame-extraction path, GPU/adapter interoperability, frame pacing, resizing, rendering while no ordinary host window is visible, and device-loss recovery. Do not assume screenshot polling or WebView2 texture-stream APIs are a complete whole-widget renderer. This feasibility step is separate from the current Tauri configuration. [WebView2 rendering APIs](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/overview-features-apis).

Normal desktop pointer/touch access would be lost. The existing calendar hover previews, map gestures, music buttons and Settings would therefore need separate controls or a deliberately implemented input-routing solution; stock fullscreen does not preserve them on a removed display.

## Edition and hardware checks

The PC's Windows 11 edition/build, GPU/driver, monitor model, connection path and input requirements are not yet confirmed. Microsoft lists Enterprise, Pro for Workstations and IoT Enterprise in the Windows 10 introduction of specialized-display support; that historical entry is not a complete Windows 11 edition/build compatibility matrix. Verify the actual PC's **Settings → System → Display → Advanced display** capability before relying on this mode. Do not recommend purchasing an edition upgrade based only on this assessment.

Also avoid carrying old driver limitations forward as universal Windows 11 rules: the compositor guide's indirect-adapter limitation is explicitly dated to Windows 10 version 2004, while newer API documentation exposes `CreateDisplayDeviceForIndirectAdapter` with a prerelease notice. Direct HDMI/DisplayPort is a sensible first prototype, but USB/dock/indirect support needs a build-and-driver-specific test. [Older limitation](https://learn.microsoft.com/en-us/windows-hardware/drivers/display/specialized-monitors-compositor#known-limitations), [newer API entry](https://learn.microsoft.com/en-us/uwp/api/windows.devices.display.core.displaymanager.createdisplaydeviceforindirectadapter).

Assigned Access configures a kiosk/restricted user experience, while Shell Launcher replaces the user's Explorer shell. Neither is the primary answer for reserving one auxiliary screen while leaving the rest of the same user's desktop normal. [Assigned Access](https://learn.microsoft.com/en-us/windows/configuration/assigned-access/), [Shell Launcher](https://learn.microsoft.com/en-us/windows/configuration/shell-launcher/).

## Validation before promising “only this screen”

Test a two-or-more-monitor Windows 11 machine with recording of the other screen during startup, login/autostart, upgrade relaunch, unplug/replug, display sleep, PC sleep/resume, primary-monitor changes, arrangement changes, DPI changes and Win+Shift+Arrow/Snap operations. Include cloned outputs, two identical monitors, port/dock changes, remote sessions, target identity failure and native dialogs. The expected desktop-mode response to an invalid target is a hidden Dashboard, not migration.

For specialized mode, first prove exclusive test-pattern output and clean release/reacquisition on the exact hardware, then prove webview frame delivery and the input/control strategy. Retain another usable desktop display during the prototype and a documented route to restore normal desktop participation. No live specialized-display or hotplug/flash-confinement test has been performed on this Mac development machine.
