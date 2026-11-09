# Lock Dashboard to a chosen display (Windows)

V0.5.6 adds a Windows-only dedicated-display mode. macOS omits this control and keeps its normal window/fullscreen behaviour. A Windows display binding copied into macOS settings is ignored there.

## Set it up

1. Keep the target display enabled as part of the **extended Windows desktop**. Leave “Remove display from desktop” off; Dashboard uses an ordinary desktop window, rather than a specialized-display compositor.
2. Open **Settings → General → Dedicated display**.
3. Choose the screen in the list. Alternatively, move the unlocked Dashboard window onto the desired screen and select **Use current screen**. This is useful when two monitors have the same model name.
4. Select **Save**. Dashboard fills that display without a title bar. The normal fullscreen toggle is disabled while the lock is selected.

The binding uses the monitor's Windows device path, rather than a display number, label or resolution. A port/dock/driver change can change that identity; explicitly reselect the screen if that happens. The app never guesses another same-model monitor.

Locked mode disables the borderless window shadow, which otherwise reserves space on the left, right and bottom on Windows. Both the outer window and its content area must match the full monitor rectangle in physical pixels, including at different Windows scaling settings. Unlocking restores the normal decorated window and shadow.

## Disconnects and recovery

If the chosen screen is missing, inactive, mirrored, shares its desktop area with another output, or cannot be identified safely, the locked Dashboard stays hidden while it checks for the same display returning. V0.5.10 restores a minimized window after reconnect and uses borderless display bounds without retaining a stale native fullscreen monitor.

On startup or relaunch, an unavailable target immediately opens a native **Display recovery** prompt on an available desktop. Choose **Yes** to clear the saved binding and open a normal window on the main display, or **No** to keep the binding and wait. If a running Dashboard cannot restore its display for 10 seconds, it offers the same choice. Brief disconnects recover automatically. The prompt runs separately from the Dashboard event loop, so it can continue reconnecting while the choice is open. It appears once per outage; relaunching or choosing Show from the tray offers the choice again.

The Windows tray menu offers:

- **Show Dashboard on selected display**: rechecks the saved screen; it does not bypass the lock or select a fallback.
- **Unlock display and show Dashboard**: explicitly clears the saved binding and restores a normal desktop window. This is the recovery path if the selected screen is unavailable.
- **Quit Dashboard**.

The installer adds **Daily Dashboard - Recover display** to the Windows Start menu. It runs `--unlock-display` and works even when a V0.5.10-or-later Dashboard is already running: the launch is forwarded to that instance rather than starting a second Dashboard.

From PowerShell in the installation folder:

```powershell
.\V0.5.14_Daily-Dashboard.exe --unlock-display
```

Or use the executable's actual path, including quotes for spaces:

```powershell
& "C:\path\to\V0.5.14_Daily-Dashboard.exe" --unlock-display
```

- `--unlock-display`: clear the saved monitor binding, remove confinement, restore a normal window in the main monitor's work area, unminimize and show it. Other saved settings are preserved.
- `--reset-display-lock`: alias for `--unlock-display`; it does not reset the rest of Settings.
- `--keep-display-lock`: keep the saved binding and wait without automatic recovery prompts for this session. The tray Unlock command and an unlock relaunch remain available. A normal relaunch restores the recovery prompt.

Unlock flags take priority if combined with `--keep-display-lock`. These commands and the recovery prompt are Windows-only; macOS keeps its normal window behaviour.

If settings cannot be read or written, explicit recovery still removes confinement for the current session and reports the save failure. It does not replace an unreadable settings file with defaults. Repair the file or use the unlock command again next time. Stale recovery answers cannot undo a newer binding or another unlock action.

For an older hidden instance, quit it from its tray menu before installing the update. If a process is truly unresponsive rather than merely hidden, end that Dashboard process in Windows Task Manager, then launch the updated executable with `--unlock-display`. A hung Windows UI thread cannot process relaunch messages.

On normal startup, the main window is created hidden. Windows loads the saved binding, installs the native placement guard and validates/places the window before allowing it to appear. Movement and show requests are checked in a Windows window subclass; topology/DPI/power notifications invalidate placement, with a periodic check as a backup.

## Scope

This confines the Dashboard main window. The screen remains part of the Windows desktop, so other apps can still use it. External browsers, Spotify, installers and Windows-owned dialogs follow their own placement rules. This is not specialized-display ownership, a kiosk/security boundary or a guarantee against every possible transient OS composition/capture/mirroring behaviour.

## Verification

Native tests cover exact identity, reordering, negative coordinates, unavailable/ambiguous targets, settings migration, mirrored/overlapping outputs and pre-placement show/move constraints. The full Windows implementation is cross-compiled; Windows CI also builds the installer and runs native tests. macOS compiles/tests the supported path with the Windows controller and tray dependencies omitted. Browser checks cover the monitor Settings at all 19 documented resolution/scaling configurations, save/reopen, validation failure, missing displays, recovery synchronization and macOS omission, plus existing widget/layout regressions.

Physical Windows tests are still needed for your monitor/GPU/dock: startup and upgrade relaunch, unplug/replug, sleep/resume, display order/primary/DPI changes, duplicate monitors, Win+Shift+Arrow/Snap and tray recovery. This development machine cannot exercise those Windows hardware transitions.
