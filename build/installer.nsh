!macro customInstall
  ; Explicitly create per-user shell entries. This also covers Windows systems
  ; where the standard electron-builder shortcut step is skipped or stale.
  SetShellVarContext current
  CreateShortCut "$DESKTOP\Pine Launcher.lnk" "$INSTDIR\Pine Launcher.exe" "" "$INSTDIR\Pine Launcher.exe" 0 SW_SHOWNORMAL "" "Pine Launcher"
  CreateShortCut "$SMPROGRAMS\Pine Launcher.lnk" "$INSTDIR\Pine Launcher.exe" "" "$INSTDIR\Pine Launcher.exe" 0 SW_SHOWNORMAL "" "Pine Launcher"

  ; App Paths makes the installed executable discoverable by the Windows shell
  ; in addition to the Start Menu shortcut indexed by Windows Search.
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\Pine Launcher.exe" "" "$INSTDIR\Pine Launcher.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\Pine Launcher.exe" "Path" "$INSTDIR"
!macroend

!macro customUnInstall
  SetShellVarContext current
  Delete "$DESKTOP\Pine Launcher.lnk"
  Delete "$SMPROGRAMS\Pine Launcher.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\Pine Launcher.exe"
!macroend
