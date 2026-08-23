; Relaunch only for silent installs initiated by Daily Dashboard's updater.
; Interactive installers retain Tauri's normal finish-page launch control.
!macro NSIS_HOOK_POSTINSTALL
  IfSilent 0 +2
  nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
!macroend
