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

Status: **built and checked from Linux; never run on real Windows.**

Verified: the Rust type-checks for `x86_64-pc-windows-msvc` (via `cargo xwin`,
tests included) and its 60 unit tests pass; `npm run stage:wsl` produces the
payload; that payload, started through `bin/devhub-wsl-launch`, serves the
token-authenticated health check, the bootstrap cookie and the PTY port, and
exits cleanly when stdin closes. Not verified: WebView2 loading `localhost`
through WSL forwarding, `wsl.exe` behaviour, the NSIS installer, the updater.
Treat the first Windows install as the real test.

## Shape

```
Windows                                   WSL2 distro
─────────────────────────                 ─────────────────────────────────────
DevHub.exe (Tauri, WebView2)   wsl.exe    ~/.local/share/devhub/
  window, menu, updater-less   ───────►     runtime/<payload-id>/
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
5. Start `bin/devhub-wsl-launch`, which execs the supervisor under your login
   shell (`$SHELL -lic`) so `claude`, `codex`, nvm/volta tools resolve as in
   your terminal.
6. Same authenticated health check and bootstrap-cookie handoff as macOS.

Config crosses the boundary through `WSLENV`, never argv, so the bootstrap token
does not appear in a process listing.

## Shutdown

Closing the window closes the supervisor's stdin; its orphan guard SIGTERMs its
own tree. If it has not exited after 10s, `pkill -f <payload>/services/supervisor.mjs`
— scoped to this payload path, never by port.

## Paths

`wsl.rs` maps `C:\x` → `/mnt/c/x` and `\\wsl.localhost\Distro\home\me` →
`/home/me`. The folder picker opens in the distro home and returns the WSL path,
so the setup wizard's "code folder" works. Network shares have no mapping and
are rejected (logged).

## Getting an installer without building it

`Actions → Release desktop → Run workflow`, tick **windows_only**, then download
the `devhub-x86_64-pc-windows-msvc` artifact (or
`gh run download <run-id> -n devhub-x86_64-pc-windows-msvc`). No key is needed:
without `TAURI_SIGNING_PRIVATE_KEY` it builds a plain installer with no updater
artifacts. It is **unsigned**, so Windows SmartScreen shows "Windows protected
your PC" — click *More info → Run anyway*. That is expected for dev builds; a
release needs an Authenticode certificate to avoid it.

## Installing a release

Run the downloaded `DevHub_*-setup.exe`. It installs the app for the current
Windows user and installs WebView2 if needed. DevHub includes the server and
Node runtime; Rust, MSVC, npm and a checkout are not needed.

On first launch, if WSL or a user distro is missing, choose **Set up Windows
support**. Windows asks for administrator permission, then installs WSL and
Ubuntu. Finish the Linux account setup in Ubuntu, restart if Windows asks, and
open DevHub again. DevHub then installs its bundled payload in the distro and
opens the setup wizard. An existing user WSL2 distro is reused.

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
Run **Agents → Connection → Set up Paseo** once, or `npm run agents:install` in
the checkout; it registers `devhub-paseo.service` under `systemd --user`, so
WSL needs `systemd=true` in `/etc/wsl.conf`. The window reaches `:6767` through
the same localhost relay as the dashboard. A Paseo you installed yourself
(older than 0.8) has no web UI and shows `Cannot GET /`.

## Behaviour to know

- Closing the window **hides** it to a notification-area icon; the server, agents
  and scheduled jobs keep running until "Quit DevHub" in the tray menu.
- "Attach to Dev Server" and "Rebuild Dashboard" are hidden — they spawn a
  native `npm`.

## Known gaps

- The installer is unsigned (SmartScreen will warn); needs an Authenticode cert.
- WSL `localhostForwarding=false` in `.wslconfig` breaks the window's connection.
- Distro `$SHELL` interactive startup noise lands in the sidecar log.
- The sidecar's `peers` process exits 0 at startup in the payload; identical to
  the native packaged path, not investigated here.
