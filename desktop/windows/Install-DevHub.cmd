@echo off
rem DevHub for Windows: one file that installs prerequisites, builds, and installs.
rem Double-click it. Safe to re-run: it refreshes from WSL and rebuilds.
rem (cmd header + PowerShell body; the body starts after the last marker below.)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = Get-Content -Raw -LiteralPath '%~f0'; Invoke-Expression $t.Substring($t.LastIndexOf('#PS-' + 'BEGIN') + 9)"
exit /b %ERRORLEVEL%
#PS-BEGIN
$ErrorActionPreference = 'Stop'
$Root = 'C:\devhub-desktop'
# Where the payload/icons/shell source were built. Refreshed from here when reachable.
$WslSource = '\\wsl.localhost\Ubuntu\home\john\dev\devhub-private\desktop'

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User') + ';' +
                "$env:USERPROFILE\.cargo\bin"
}
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Run($exe, [string[]]$argv) {
    & $exe @argv
    if ($LASTEXITCODE -ne 0) { throw "$exe exited with $LASTEXITCODE" }
}

try {
    Step 'Checking WSL 2'
    if (-not (Has 'wsl.exe')) { throw 'WSL is not installed. Run "wsl --install" in an admin PowerShell, reboot, then re-run this.' }
    $distros = (& wsl.exe -l -q) -join '' -replace "`0", ''
    if (-not $distros.Trim()) { throw 'No WSL distro installed. Run "wsl --install", reboot, then re-run this.' }

    Step 'Refreshing build inputs from WSL'
    if (Test-Path $WslSource) {
        New-Item -ItemType Directory -Force -Path $Root | Out-Null
        # Explicit fields, not positional arrays: `@($a + 'x', $b)` parses as
        # $a + ('x', $b), which glues everything into one string.
        $jobs = @(
            @{ Src = "$WslSource\src-tauri";       Dst = "$Root\src-tauri";       Extra = @('/XD', 'target', 'gen', 'binaries') },
            @{ Src = "$WslSource\boot";            Dst = "$Root\boot";            Extra = @() },
            @{ Src = "$WslSource\staging\icons";  Dst = "$Root\staging\icons";  Extra = @() },
            @{ Src = "$WslSource\staging\wsl";    Dst = "$Root\staging\wsl";    Extra = @() }
        )
        foreach ($j in $jobs) {
            $roboArgs = @($j.Src, $j.Dst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP') + $j.Extra
            & robocopy @roboArgs
            # robocopy: 0-7 are success (bit flags), 8+ are failures.
            if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE) for $($j.Src)" }
        }
        $global:LASTEXITCODE = 0
    } elseif (-not (Test-Path "$Root\staging\wsl\devhub-payload.tar.gz")) {
        throw "Neither $WslSource nor a local payload exists. Start the WSL distro, run 'npm run stage:wsl' in desktop/, and re-run."
    } else {
        Write-Host "WSL source not reachable; using the copy already in $Root"
    }
    # tauri.conf.json names these; the Windows overlay drops them from the bundle.
    foreach ($d in 'staging\server', 'staging\services', 'staging\resources', 'src-tauri\binaries') {
        New-Item -ItemType Directory -Force -Path "$Root\$d" | Out-Null
    }

    Step 'Checking Rust'
    Refresh-Path
    if (-not (Has 'cargo')) {
        Run 'winget' @('install', '--id', 'Rustlang.Rustup', '-e', '--accept-source-agreements', '--accept-package-agreements')
        Refresh-Path
        if (-not (Has 'cargo')) { throw 'Rust installed but cargo is not on PATH yet. Close this window and run the file again.' }
    }

    Step 'Checking MSVC build tools'
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    $hasMsvc = (Test-Path $vswhere) -and
        [bool](& $vswhere -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
    if (-not $hasMsvc) {
        Write-Host 'Installing Visual Studio Build Tools (C++). Accept the admin prompt; this takes a few minutes.'
        Run 'winget' @('install', '--id', 'Microsoft.VisualStudio.2022.BuildTools', '-e',
            '--accept-source-agreements', '--accept-package-agreements',
            '--override', '--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended')
    }

    Step 'Checking tauri-cli'
    # Continue, not Stop: PowerShell 5.1 turns any native stderr into a
    # terminating error, and "no such command" is exactly what we expect here.
    $ErrorActionPreference = 'Continue'
    & cargo tauri --version *> $null
    $tauriMissing = ($LASTEXITCODE -ne 0)
    $ErrorActionPreference = 'Stop'
    if ($tauriMissing) {
        Write-Host 'Installing tauri-cli (first run only, ~5-10 minutes)...'
        Run 'cargo' @('install', 'tauri-cli', '--version', '^2', '--locked')
    }

    Step 'Building DevHub (first build is slow)'
    Push-Location "$Root\src-tauri"
    try { Run 'cargo' @('tauri', 'build') } finally { Pop-Location }

    Step 'Installing'
    $installer = Get-ChildItem "$Root\src-tauri\target\release\bundle\nsis\*-setup.exe" |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $installer) { throw 'Build finished but no installer was produced.' }
    Write-Host "Running $($installer.FullName)"
    Start-Process -FilePath $installer.FullName -Wait
    Write-Host "`nDone. Launch DevHub from the Start menu." -ForegroundColor Green
} catch {
    Write-Host "`nFAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Copy the message above to Claude if you want it fixed.'
    $failed = $true
}
Read-Host "`nPress Enter to close"
if ($failed) { exit 1 }
