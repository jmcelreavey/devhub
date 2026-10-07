; Tauri NSIS hooks. Silent and passive installs (the updater, `/S`) always call
; CreateOrUpdateDesktopShortcut, which brings back a Desktop shortcut the user
; deleted. Upgrading over an install that had none keeps it that way.
Var DevHubSkipDesktopShortcut

!macro NSIS_HOOK_PREINSTALL
  StrCpy $DevHubSkipDesktopShortcut "0"
  ${If} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    ${IfNot} ${FileExists} "$DESKTOP\${PRODUCTNAME}.lnk"
      StrCpy $DevHubSkipDesktopShortcut "1"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $DevHubSkipDesktopShortcut == "1"
    Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  ${EndIf}
!macroend
