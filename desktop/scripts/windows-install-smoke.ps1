<#
.SYNOPSIS
  Smoke-test the built DevHub Windows (NSIS) installer: silent install into a
  throwaway directory, confirm it landed, then start the installed app once.

.DESCRIPTION
  Runs against the installer the release workflow already built; it never
  builds anything. Everything happens under one temporary work directory:

    <WorkDir>\install    the install target (NSIS /D=)
    <WorkDir>\app-data   DEVHUB_APP_DATA for the launched app

  Checks, in order (a later one is meaningless if an earlier one failed):
    1. The silent installer exits 0 within the timeout.
    2. The app exe, the uninstaller and the bundled WSL payload are on disk,
       and the per-user uninstall entry is registered.
    3. The installed exe starts: it writes its "[startup] DevHub <v> starting"
       line to logs/shell.log, and is still running a few seconds later.

  It deliberately does NOT need, and does not touch, a signed-in user's data,
  WSL, or elevation. The installer is per-user (`installMode: currentUser`).

  CI only. The installer's pre-install hook stops DevHub's own WSL supervisor
  (`pkill` under ~/.local/share/devhub/runtime), which on a developer machine
  would stop their real running DevHub. Pass -Force to override.
#>
[CmdletBinding()]
param(
  # The *-setup.exe, or a directory searched recursively for exactly one.
  [Parameter(Mandatory = $true)][string]$Installer,
  # Version the build was cut as (no leading v). Empty skips the comparison.
  [string]$ExpectedVersion = '',
  [string]$WorkDir = '',
  [int]$InstallTimeoutSeconds = 300,
  [int]$StartTimeoutSeconds = 60,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') { throw 'Windows only.' }
if (-not $env:GITHUB_ACTIONS -and -not $Force) {
  throw 'Refusing to run outside GitHub Actions: installing stops DevHub''s own WSL supervisor. Use -Force to override.'
}

# The Cargo package name; Tauri names the installed exe after it (no
# `mainBinaryName` override in tauri.conf.json).
$MainExe = 'devhub-desktop.exe'
# Resources the Windows overlay (tauri.windows.conf.json) bundles for the WSL backend.
$PayloadFiles = @('wsl\devhub-payload.tar.gz', 'wsl\payload-id.txt')
$ProductName = 'DevHub'

$failures = New-Object System.Collections.Generic.List[string]
function Pass([string]$name, [string]$detail = '') {
  if ($detail) { Write-Host "PASS  $name - $detail" } else { Write-Host "PASS  $name" }
}
function Fail([string]$name, [string]$detail = '') {
  $failures.Add($name)
  if ($detail) { Write-Host "FAIL  $name - $detail" } else { Write-Host "FAIL  $name" }
  if ($env:GITHUB_ACTIONS) { Write-Host "::error title=Installer smoke::$name $detail" }
}

function Resolve-Installer([string]$path) {
  if (Test-Path -LiteralPath $path -PathType Leaf) { return (Resolve-Path -LiteralPath $path).Path }
  $found = @(Get-ChildItem -LiteralPath $path -Recurse -File -Filter '*-setup.exe' -ErrorAction SilentlyContinue)
  if ($found.Count -ne 1) { throw "Expected exactly one *-setup.exe under '$path', found $($found.Count)." }
  return $found[0].FullName
}

# Stop only processes whose image lives under $dir; never match by name alone.
function Stop-UnderDir([string]$dir) {
  $prefix = $dir.TrimEnd('\') + '\'
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

$setup = Resolve-Installer $Installer
if (-not $WorkDir) { $WorkDir = Join-Path ([IO.Path]::GetTempPath()) ('devhub-smoke-' + [guid]::NewGuid().ToString('N').Substring(0, 8)) }
$installDir = Join-Path $WorkDir 'install'
$appData = Join-Path $WorkDir 'app-data'
New-Item -ItemType Directory -Force -Path $WorkDir, $appData | Out-Null
Write-Host "installer: $setup"
Write-Host "work dir:  $WorkDir"

function Invoke-Smoke {
  $app = $null
  try {
    # --- 1. Install --------------------------------------------------------------
    # NSIS: /S is silent, /D sets the target and must be last and unquoted. A single
    # string (not an array) so PowerShell does not re-quote it.
    $install = Start-Process -FilePath $setup -ArgumentList "/S /D=$installDir" -PassThru
    $null = $install.Handle # cache the handle so ExitCode is readable after exit
    if (-not $install.WaitForExit($InstallTimeoutSeconds * 1000)) {
      Stop-Process -Id $install.Id -Force -ErrorAction SilentlyContinue
      Fail 'install' "installer still running after ${InstallTimeoutSeconds}s"
      return
    }
    if ($install.ExitCode -ne 0) { Fail 'install' "installer exited $($install.ExitCode)"; return }
    Pass 'install' 'silent installer exited 0'

    # --- 2. Install landed -------------------------------------------------------
    $exe = Join-Path $installDir $MainExe
    if (Test-Path -LiteralPath $exe -PathType Leaf) { Pass 'app executable' $MainExe } else { Fail 'app executable' "missing: $exe" }

    if (Test-Path -LiteralPath (Join-Path $installDir 'uninstall.exe') -PathType Leaf) { Pass 'uninstaller' } else { Fail 'uninstaller' 'uninstall.exe missing' }

    foreach ($rel in $PayloadFiles) {
      $file = Get-Item -LiteralPath (Join-Path $installDir $rel) -ErrorAction SilentlyContinue
      if ($file -and $file.Length -gt 0) { Pass "payload: $rel" ('{0:N0} bytes' -f $file.Length) } else { Fail "payload: $rel" 'missing or empty' }
    }

    # Per-user installs register under HKCU, which is also proof no elevation was used.
    $entry = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
      ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue } |
      Where-Object { $_.DisplayName -eq $ProductName } | Select-Object -First 1
    if ($entry) { Pass 'uninstall entry (HKCU)' "version $($entry.DisplayVersion)" } else { Fail 'uninstall entry (HKCU)' "no '$ProductName' under HKCU Uninstall" }

    if ($failures.Count -gt 0) { return } # nothing installed to start

    # --- 3. Start check ----------------------------------------------------------
    # Hermetic env for the child: temp app data, and nothing that would point it at
    # a checkout, a dev server or a particular WSL distro.
    $saved = @{}
    foreach ($name in 'DEVHUB_WSL_DISTRO', 'DEVHUB_WSL_REPO', 'DEVHUB_WSL_PAYLOAD_DIR', 'DEVHUB_DEV_SERVER_URL', 'DEVHUB_REPO_ROOT', 'DEVHUB_APP_DATA') {
      $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
      [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    [Environment]::SetEnvironmentVariable('DEVHUB_APP_DATA', $appData, 'Process')
    try { $app = Start-Process -FilePath $exe -WorkingDirectory $installDir -PassThru }
    finally { foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') } }

    # The shell logs this line right after it resolves paths and before it opens a
    # window or looks for WSL, so it proves the exe loads and runs - and works on a
    # runner with no WSL distro and possibly no WebView2.
    $shellLog = Join-Path $appData 'logs\shell.log'
    $started = $null
    $deadline = (Get-Date).AddSeconds($StartTimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
      if (Test-Path -LiteralPath $shellLog) {
        $hit = Select-String -LiteralPath $shellLog -Pattern '\[startup\] DevHub (\S+) starting' | Select-Object -First 1
        if ($hit) { $started = $hit.Matches[0].Groups[1].Value; break }
      }
      if ($app.HasExited) { break }
      Start-Sleep -Milliseconds 500
    }

    if (-not $started) {
      $why = if ($app.HasExited) { "exited with code $($app.ExitCode) before logging startup" } else { "no startup line within ${StartTimeoutSeconds}s" }
      Fail 'app starts' $why
    } else {
      Pass 'app starts' "logged startup, version $started"
      if ($ExpectedVersion -and $started -ne $ExpectedVersion) { Fail 'app version' "installed app reports $started, expected $ExpectedVersion" }
      elseif ($ExpectedVersion) { Pass 'app version' "matches $ExpectedVersion" }

      # Still alive a moment later: catches a crash straight after the first log line.
      Start-Sleep -Seconds 5
      if ($app.HasExited) { Fail 'app stays up' "exited with code $($app.ExitCode) within 5s of starting" } else { Pass 'app stays up' '5s after startup' }
    }

    if (Test-Path -LiteralPath $shellLog) {
      Write-Host '--- last shell.log lines (temporary app data) ---'
      Get-Content -LiteralPath $shellLog -Tail 15 | ForEach-Object { Write-Host $_ }
      Write-Host '--- end ---'
    }
  }
  finally {
    if ($app -and -not $app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $installDir) { Stop-UnderDir $installDir }

    # Best-effort uninstall so a local -Force run does not leave an install behind.
    # `_?=` keeps the uninstaller in-process so -Wait is meaningful. Not a check.
    $uninstaller = Join-Path $installDir 'uninstall.exe'
    if (Test-Path -LiteralPath $uninstaller) {
      try {
        $u = Start-Process -FilePath $uninstaller -ArgumentList "/S _?=$installDir" -PassThru
        if (-not $u.WaitForExit(60000)) { Stop-Process -Id $u.Id -Force -ErrorAction SilentlyContinue }
      } catch { Write-Host "cleanup: uninstall skipped ($($_.Exception.Message))" }
    }
  }
}

# A function so the early `return`s above still reach the exit-code decision.
Invoke-Smoke

if ($failures.Count -gt 0) {
  Write-Host "`ninstaller smoke FAILED: $($failures -join ', ')"
  exit 1
}
Write-Host "`ninstaller smoke passed"
