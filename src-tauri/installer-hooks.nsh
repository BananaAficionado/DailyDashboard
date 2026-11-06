; Relaunch only for silent installs initiated by Daily Dashboard's updater.
; Interactive installers retain Tauri's normal finish-page launch control.
!macro NSIS_HOOK_POSTINSTALL
  CreateShortCut "$SMPROGRAMS\Daily Dashboard - Recover display.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--unlock-display"
  IfSilent 0 +2
  nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$SMPROGRAMS\Daily Dashboard - Recover display.lnk"
!macroend
