---
title: Windows app (WSL2)
description: "The Windows build is a native Tauri window in front of a DevHub server running in WSL2."
order: 13
icon: AppWindow
tags: [architecture, desktop, windows]
related:
  - architecture/desktop-shell
---

# Windows app (WSL2 backend)

Status: **installed and run on real Windows 11 (Oct 2026)**, from the CI
installer of `Release desktop` (`windows_only`), on a machine with an existing
Ubuntu WSL2 distro (systemd on) and WebView2 already present.

Verified there, by shell, HTTP and logs:

- Silent NSIS install (`DevHub_*-setup.exe /S`) → `%LOCALAPPDATA%\DevHub`,
  per-user uninstall entry, Start-menu and desktop shortcuts.
- Launch from the Start-menu shortcut: distro picked (Ubuntu, `docker-desktop`
  skipped), payload extracted in ~5s, bundled Node/Next/PTY started, health
  check and bootstrap handoff, dashboard on `127.0.0.1:1337` through WSL
  localhost forwarding.
- Closing the window hides it and keeps the server; a second launch re-shows
  the running instance; killing the app takes the WSL supervisor, Next and PTY
  down within ~2s.
- Setup APIs: dependency detection (bundled `gh`/`node` used), path validation,
  config save, and the private-repo create / clone / link flows against a real
  private GitHub repo, including content sync of root `diagrams/`.

Tray **Quit DevHub** was also checked interactively: it left no desktop process.

Not verified: SmartScreen and the installer UI interactively (an unattended
launch of the browser-downloaded copy, which carries Mark-of-the-Web, sat on a
security prompt; the same file without it installed silently), the WebView2
bootstrapper (already installed), the "Set up Windows support" path on a machine
without WSL, the native folder dialog, an interactive terminal
session, and the updater (no release published yet).
Earlier: the Rust type-checks for `x86_64-pc-windows-msvc` (via `cargo xwin`)
and its unit tests pass; the payload serves the same handshake on Linux.

## Shape

```
Windows                                   WSL2 distro
─────────────────────────                 ─────────────────────────────────────
DevHub.exe (Tauri, WebView2)   wsl.exe    ~/.local/share/devhub/
  window, menu, updater        ───────►     runtime/<payload-id>/
  boots WSL, installs payload               bin/devhub-wsl-launch
  loads http://localhost:1337 ◄──────────   runtime/node, server/, services/
        (WSL localhost forwarding)          supervisor.mjs → Next, PTY :1339,
                                            agents, git, everything else
```

The window is the only Windows-native part. The terminal (PTY on `:1339`) and
every agent CLI run in WSL, so they see your real Linux home, PATH and repos.
Data (`notes/`, `tasks/`, `config/.env.local`, logs) lives on the distro's ext4
filesystem, not `/mnt/c` — 9P is far too slow for `git` and `node_modules`.

## Startup

`run_wsl_startup` in `lib.rs`, on a worker thread:

1. `wsl -l -v` → pick the distro (`DEVHUB_WSL_DISTRO`, then
   `%APPDATA%\DevHub\config\wsl-distro.txt`, then the default WSL2 distro;
   `docker-desktop` and WSL1 are never picked).
2. `wsl -d <distro> --exec /bin/true` — this **boots the VM if it is stopped**.
3. Create the app-data tree, `0700`.
4. If `runtime/<payload-id>/.complete` is missing, extract the bundled
   `devhub-payload.tar.gz` into it (`.partial` + rename; older builds removed).
5. Check the dashboard and terminal ports on both Windows and WSL. If the
   defaults are occupied, choose distinct free ports. Explicit `DEVHUB_PORT`
   and `DEVHUB_TERMINAL_PORT` settings remain pinned; a failure lists all clashes.
6. Start `bin/devhub-wsl-launch`, which execs the supervisor under your login
   shell (`$SHELL -lic`) so `claude`, `codex`, nvm/volta tools resolve as in
   your terminal.
7. Same authenticated health check and bootstrap-cookie handoff as macOS.

The payload is prebuilt. A normal launch runs no npm install and reuses the
unpacked content hash. Shell logs record `phase`, `duration_ms` and the result
for WSL discovery, app-data creation, payload extraction, port selection,
supervisor launch and health checks. The existing handoff log measures navigation.

Config crosses the boundary through `WSLENV`, never argv, so the bootstrap token
does not appear in a process listing.

## Shutdown

Quitting the app closes the supervisor's stdin; its orphan guard SIGTERMs its
own tree. If it has not exited after 10s, `pkill -f <payload>/services/supervisor.mjs`
— scoped to this payload path, never by port.

## Paths

`wsl.rs` maps `C:\x` → `/mnt/c/x` and `\\wsl.localhost\Distro\home\me` →
`/home/me`. The folder picker opens in the distro home and returns the WSL path,
so the setup wizard's "code folder" works. Network shares have no mapping and
are rejected (logged). Paths typed or pasted into the wizard get the same
mapping on the server (`lib/setup/input-path.ts`), so `C:\Users\me\code` and
`\\wsl.localhost\Ubuntu\home\me\code` validate and save as WSL paths.

## Getting an installer without building it

`Actions → Release desktop → Run workflow`, tick **windows_only**, then download
the `devhub-x86_64-pc-windows-msvc` artifact (or
`gh run download <run-id> -n devhub-x86_64-pc-windows-msvc`). No key is needed:
without `TAURI_SIGNING_PRIVATE_KEY` it builds a plain installer with no updater
artifacts. The installer is not publisher-signed (Authenticode), so Windows
SmartScreen may show "Windows protected your PC". After checking that the file
came from the expected build, use *More info → Run anyway* if offered.

Two different signatures, often confused:

- **Publisher signing (Authenticode)** — optional. It only quiets SmartScreen;
  DevHub does not require or plan a paid certificate.
- **Updater signatures** — required for auto-update. The release job signs the
  NSIS installer with `TAURI_SIGNING_PRIVATE_KEY` (free minisign key, public half
  in `tauri.conf.json`) and uploads the `.sig` next to the `-setup.exe`; CI
  artifacts already include it when the secret is set.

## Installing a release

Run the downloaded `DevHub_*-setup.exe`. It installs the app for the current
Windows user and installs WebView2 if needed. DevHub includes the server and
Node runtime; Rust, MSVC, npm and a checkout are not needed.

On first launch, if WSL or a user distro is missing, choose **Set up Windows
support**. Windows asks for administrator permission, then installs WSL and
Ubuntu. Finish the Linux account setup in Ubuntu, restart if Windows asks, and
open DevHub again. DevHub then installs its bundled payload in the distro and
opens the dashboard. An existing user WSL2 distro is reused.

An unfinished desktop setup opens **Set up DevHub** automatically. The wizard
remembers its step and goals across reloads; **Your folders → Browse…** opens
the native code-folder picker. **Set up later** opens the dashboard and keeps
Setup available in the toolbar. The default Today layout is Dashboard; an
explicit Focus preference is kept.

If a DevHub checkout
exists in the distro (`~/dev/devhub-private` and friends), the app links it
automatically; put `none` in `%APPDATA%\DevHub\config\wsl-repo.txt` to stop that.

WSL1 or an explicitly configured missing distro needs to be repaired separately;
DevHub does not convert or replace existing distros.

## Local developer build helper

Double-click `desktop/windows/Install-DevHub.cmd` (copy it anywhere on Windows).
It checks WSL, refreshes `C:\devhub-desktop` from the WSL checkout (path baked
in at the top of the file), installs Rust / MSVC Build Tools / `tauri-cli` via
winget and cargo if missing, builds, and runs the installer. Re-running it
rebuilds with whatever `npm run stage:wsl` last produced. The build steps below
are what it automates.

## Building

The payload holds Linux native modules, so it is built **in WSL**:

```bash
cd desktop && npm run stage:wsl        # → staging/wsl/devhub-payload.tar.gz + payload-id.txt
```

Then on Windows (Rust + `cargo install tauri-cli`), with `desktop/staging/wsl`
present (copy from `\\wsl.localhost\…` if you built in WSL) and icons staged:

```powershell
cd desktop\src-tauri; cargo tauri build     # tauri.windows.conf.json → NSIS
```

Local builds need no signing key: the Windows overlay sets
`createUpdaterArtifacts: false`, and the release job re-enables it with
`--config`. (Without a signature, `build-updater-manifest.mjs` fails the publish
rather than shipping a broken update entry.)

CI: `release-desktop.yml` has `wsl-payload` (Linux) → `windows` jobs; `publish`
waits on both. A `workflow_dispatch` run builds them without publishing. The
Windows updater entry (`windows-x86_64`) comes from the NSIS `-setup.exe` and is
generated by `build-updater-manifest.mjs`; a new installer carries a new payload,
which is unpacked on next launch. For iterating on the shell without
re-extracting, set `DEVHUB_WSL_PAYLOAD_DIR` to an unpacked payload path in WSL.

## Agents (Paseo) in WSL

Agent chat needs the managed Paseo daemon (it serves the chat UI on `:6767`).
Use **Setup → AI Provider → Set up Paseo**, **Agents → Connection → Set up Paseo**,
or `npm run agents:install` in
the checkout; it registers `devhub-paseo.service` under `systemd --user`, so
WSL needs `systemd=true` in `/etc/wsl.conf`. The window reaches `:6767` through
the same localhost relay as the dashboard. A Paseo you installed yourself
(older than 0.8) has no web UI and shows `Cannot GET /`.

A new managed install generates a local password when none is configured and
stores it in `~/.config/devhub/paseo-password` with owner-only permissions. A
fresh DevHub app can reuse it. Older daemons still need their existing Agents
password entered in Setup; a running but unreachable daemon is reported as a
connection problem, without asking the user to install another one.

Managed agent tools install under `~/.local/share/devhub/tools`, outside the
versioned runtime. Reinstall managed Paseo once to update an older service's
npm prefix. A daemon installed from the app keeps its own Node executable so
an app update cannot remove the executable its service uses.

DevHub's agent launch and Connection screens keep diagnostic logs behind
**Details**, with sign-in or repair guidance. **Repair DevHub MCP** repairs only
OpenCode's existing `mcp.devhub` entry and keeps the original config in
`opencode.json.devhub-backup`. It uses OpenCode's
[local MCP schema](https://opencode.ai/docs/mcp-servers/#local).
Errors rendered inside Paseo's own embedded chat UI remain owned by Paseo.

## Behaviour to know

- Closing the window **hides** it to a notification-area icon; the server, agents
  and scheduled jobs keep running until "Quit DevHub" in the tray menu.
- The tray also offers Open, Hide, Restart Backend, Open Logs Folder and Check
  for Updates. Restart Backend relaunches the shell and its owned backend.
- "Attach to Dev Server" and "Rebuild Dashboard" are hidden — they spawn a
  native `npm`.
- The dashboard's offline service worker is not used in the desktop shell and
  is unregistered there. On Windows a registered worker held the bootstrap
  navigation for ~60s on every launch after the first (0.5s without it).
- If a `systemd --user` DevHub service already holds the default ports, it stays
  running. The app uses free ports and disables its own scheduler to avoid
  duplicate jobs against the same content. Native commands are permitted at
  the selected dashboard origin, rather than every loopback port.
- Release builds hide checkout rebuild notices. Linking a private content repo
  does not mean the bundled application needs a developer rebuild.

## Next installer retest

These changes have local regression coverage; they still need a new CI
installer tested on Windows before tagging a release:

- Repeat launch with `devhub.service` holding both default ports; verify the
  fallback dashboard, terminal, Browse dialog and updates control.
- Check first-run routing, reload during setup, private-repo create/clone/link,
  and reopening after completion. Preserve real data when testing a fresh setup.
- Confirm the setup executable's bottle icon and record the interactive
  SmartScreen behaviour. Check the macOS DMG's icon and installation window too.
- Re-test existing Paseo discovery, a fresh optional installation, Pi installs,
  OpenCode repair and provider sign-ins. Check startup phase timings on cold
  and subsequent launches.

## Known gaps

- No Authenticode signature, so SmartScreen warns on first run (optional to fix).
- Cursor's install hint is the generic download page; launching Windows Cursor
  from WSL needs WSL interop (`[interop] enabled=true`), which some distros turn off.
- WSL `localhostForwarding=false` in `.wslconfig` breaks the window's connection.
- Distro `$SHELL` interactive startup noise lands in the sidecar log.
- The sidecar's `peers` process exits 0 at startup in the payload; identical to
  the native packaged path, not investigated here.
