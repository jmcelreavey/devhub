; Tauri NSIS hooks. Silent and passive installs (the updater, `/S`) always call
; CreateOrUpdateDesktopShortcut, which brings back a Desktop shortcut the user
; deleted. Upgrading over an install that had none keeps it that way.
Var DevHubSkipDesktopShortcut

; Stop DevHub's own running app and its own WSL sidecar before files are
; replaced, so a reinstall never leaves the previous build holding the ports.
;
; Scoped on purpose: the Windows process must live under this install folder,
; and the Linux side matches only the supervisor DevHub unpacks under
; ~/.local/share/devhub/runtime/<payload-id>/. A dev checkout's devhub.service
; and the Paseo daemon run from other paths and units and are never touched.
; Every step ignores failure: no WSL, a stopped distro or no running app is fine.
!macro DevHubStopOwnProcesses
  ; Each command stays well under NSIS's default 1024-character string limit.
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$ErrorActionPreference='SilentlyContinue'; $$dir='$INSTDIR\'; Get-CimInstance Win32_Process -Filter \"Name='${MAINBINARYNAME}.exe'\" | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$dir, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }; exit 0"`
  Pop $0
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$ErrorActionPreference='SilentlyContinue'; $$wslArgs=@(); $$file=Join-Path $$env:APPDATA 'DevHub\config\wsl-distro.txt'; if (Test-Path $$file) { $$name=(Get-Content -Raw $$file).Trim(); if ($$name -match '^[A-Za-z0-9._-]+$$') { $$wslArgs=@('-d',$$name) } }; & wsl.exe @wslArgs --exec /usr/bin/pkill -TERM -f '\.local/share/devhub/runtime/[^ /]+/services/supervisor\.mjs'; exit 0"`
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro DevHubStopOwnProcesses
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
