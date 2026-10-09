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
5. Check the dashboard and terminal ports on both Windows and WSL. A holder is
   classified from its command line, working directory and cgroup (`ports.rs`):
   DevHub's own leftover sidecar or app, `devhub.service`, Paseo, or something
   else. Only DevHub's own leftover gets a **Free the port** stop. The service,
   Paseo and anything else are named and left running. If the defaults are taken
   and both ports are automatic, saved fallback ports are reused when they are
   free; otherwise free ports are chosen. Explicit `DEVHUB_PORT` and
   `DEVHUB_TERMINAL_PORT` stay pinned, and a failure lists every clash. Reinstall
   stops DevHub.exe and the WSL supervisor under this install's runtime before
   replacing files (`DevHubStopOwnProcesses`). It does not stop `devhub.service`
   or Paseo, and a missing WSL does not fail the install.
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

## Plugins

Plugin downloads, Git, and the GitHub CLI run inside the selected WSL
distribution, because that is where the dashboard service runs. A `gh auth login`
performed only in Windows PowerShell is not visible there. Sign in with GitHub
CLI inside the distro, or point the distro's Git at Windows Git Credential
Manager. The Plugins page shows the distro name and the commands to run. Skill
and agent copies are written in the distro home (for example `~/.claude`), not
in the Windows user profile.

Plugin path overrides must be absolute Linux paths inside that distro.
Windows drive paths, UNC paths and `/mnt/<drive>` locations are rejected for
plugin storage and targets. After changing Git credentials or PATH, restart
the DevHub service if its access check still differs from the distro terminal.

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

A profile configured by an older build (a linked checkout or content repo, or
saved paths and keys, but no `first-run.json`) is recorded as finished on first
read, so an upgrade opens Today, never the wizard. A silent or updater upgrade
keeps a Desktop shortcut the user deleted deleted (`installer-hooks.nsh`).

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
versioned runtime. The npm prefix that points there is scoped to DevHub's own
installs (the dashboard server and the `install-paseo` call). It is **not**
exported to interactive shells: DevHub's terminal drops every `npm_config_*`
variable and puts the bundled Node and `tools/bin` last on `PATH`, and the
Paseo unit exports no prefix and lists neither payload directories nor the
bundled Node first, so `nvm` loads and `npm -g` lands where the user expects.

A daemon installed from the app keeps its own Node executable
(`~/.local/share/devhub/paseo/runtime/node`). On every launch, before old
payloads are removed, the shell reads `devhub-paseo.service`; if it still runs a
node from `runtime/<payload-id>/`, that binary is copied to the durable path,
the unit is rewritten (and stripped of the old npm prefix and payload `PATH`
entries) and `systemd --user daemon-reload` runs. The shell never restarts the
daemon itself, because it cannot see whether a chat is running. The shell log
says what changed: "moved the Paseo service off …" when the node binary moved,
"cleaned the Paseo service environment (npm prefix, payload PATH)" when the unit
already ran the durable node and only its env/PATH was cleaned. If that fails the
old payloads are kept.

When (and only when) a unit was rewritten, the shell leaves
`~/.local/share/devhub/paseo/restart-pending`. On start the dashboard reads it:
if Paseo is up and idle (the same active-work check Restart uses) it runs
`systemctl --user try-restart devhub-paseo.service` and clears the marker; if
chats are running, or activity can't be verified, it leaves the marker and
Agents → Connection shows **Restart Paseo to apply the update**. A manual
Restart clears the marker once the daemon is healthy. If the daemon never comes
up it is cleared too, since it starts on the new unit anyway. A unit whose executable is missing is
logged by the shell and flagged in Agents → Connection, where **Reinstall**
repairs it with the existing password.

DevHub's agent launch and Connection screens keep diagnostic logs behind
**Details**: a one-line summary and the single next action (a **Sign in to
Cursor** or **Repair DevHub MCP entry** button, in the card and in the dialog),
with the raw log below, collapsed, ANSI codes stripped, and a labelled copy
button. Agents → Usage cards follow the same shape: a headline, the one command
as code with a copy button, Retry, and the long explanation and a short failure
reason (for example why z.ai could not be read) behind Details. **Repair DevHub MCP** repairs only
OpenCode's existing `mcp.devhub` entry and keeps the original config in
`opencode.json.devhub-backup`. It uses OpenCode's
[local MCP schema](https://opencode.ai/docs/mcp-servers/#local).
Errors rendered inside Paseo's own embedded chat UI remain owned by Paseo.
After a repair DevHub asks Paseo to refresh its provider list; if that fails it
says to restart Paseo. Restart (and turning off phone access) refuse while a
chat is running, like setup and update.

Paseo setup failures that are safe to show (existing daemon needs its password,
port in use, systemd missing) reach the UI as written; other installer output
stays in the server log.

## Behaviour to know

- Closing the window **hides** it to a notification-area icon; the server, agents
  and scheduled jobs keep running until "Quit DevHub" in the tray menu.
- The tray offers Open, Hide, Restart Backend, Rebuild from Checkout…, Open
  Logs Folder and Check for Updates. Restart Backend relaunches the shell and
  its owned backend. Rebuild from Checkout opens System → Maintenance; it does
  not run `npm` on Windows.
- View → Rebuild Dashboard (native `npm`) and Attach to Dev Server stay hidden.
  **Rebuild from checkout** (Maintenance, and the same tray item) is the Windows
  path. It runs inside WSL when the server is the packaged app, or on the
  machine when `devhub.service` is what is answering. A checkout dev server
  keeps Rebuild & restart. Pull is `--ff-only`. Uncommitted changes, a
  merge/rebase in progress, and a diverged branch are refused; nothing is
  stashed or reset. Install follows the lockfile (`npm ci` for a new payload,
  `npm install` for the live service). If the service install rewrites
  `package-lock.json`, that file is restored and the rebuild stops; the running
  build stays up. The service builds into `dashboard/.next-rebuild` and swaps
  it in only after the new build answers, putting the previous build back if
  the restart fails. The packaged app assembles `runtime/local-<commit>` beside
  the installed payload and asks for a restart; the next launch uses it when it
  matches this install and is complete. Pruning old payloads keeps `local-*`.
  Review sync offers **Pull and rebuild** when the checkout is behind, clean,
  and this rebuild can run. Check for Updates offers it when the checkout is
  ahead of the running build (the running commit is an ancestor of HEAD, so an
  unrelated public history is not treated as ahead).
- Check for Updates always reports a result: an update, up to date, no published
  release yet, or the error. A missing release is not silence. Signature checks
  stay required.
- Scoped content sync skips a folder that is not in the checkout unless that
  folder is still tracked. A missing `diagrams/` does not fail `git add`.
- The dashboard's offline service worker is not used in the desktop shell and
  is unregistered there. On Windows a registered worker held the bootstrap
  navigation for ~60s on every launch after the first (0.5s without it).
- If a `systemd --user` DevHub service already holds the default ports, it stays
  running. The app uses free ports. It disables its own scheduler only when that
  service works on the same content (its checkout is the app's linked repo); a
  fresh profile with its own data keeps its jobs. The service's checkout is its
  `WorkingDirectory`, read as `<repo>` (`npm start` at the root) or
  `<repo>/dashboard`, and accepted only if it has `package.json` and `dashboard/`.
  If it can't be determined the app assumes the content is shared, which is the
  safe side (no duplicate jobs). The startup log records the decision and why, for
  example `secondary=false (the running service uses a different checkout
  (service checkout: /home/me/dev/devhub-private))`. The fallback ports are
  remembered in `%APPDATA%\DevHub\config\fallback-ports.txt` and reused while the
  defaults stay taken, because WebView settings (Focus vs Dashboard, terminal
  history) are keyed by origin. Native commands are permitted at
  the selected dashboard origin, rather than every loopback port.
- Shortcuts show Ctrl on Windows (`useModifierKey()` / `ShortcutKbd`), and the
  terminal prompt bar's ask chord is Ctrl+Shift+Enter there. The window is
  un-minimized when it first shows, so a saved off-screen state cannot hide it.
- Setup's folder fields: an empty optional code folder is not an error, and
  `\\server\share` and `//server/share` paths say network shares are
  unsupported (`//wsl.localhost/…` and `//wsl$/…` are translated like their
  backslash forms).
- The Today view (Focus or Dashboard) is saved on the machine in
  `~/.config/devhub/ui-prefs.json` (`/api/ui-prefs/today-view`), not only in
  browser storage, so it survives a change of port. localStorage stays as a fast
  cache and fallback; a choice made before the server copy existed is uploaded
  once. The file is per Linux user, so a `devhub.service` running under the same
  user (and a checkout dev server) reads and writes the same choice: changing it
  in one changes it in the others.
- Release builds hide the stale-bundle checkout notice. That notice is separate
  from Rebuild from Checkout, which a linked source checkout can still run.
- Two machines that both import tasks before either has pulled can conflict on
  `tasks/items/<id>.json` or a run sidecar. Update one machine, let it import
  and sync, then pull on the other before updating. See [Tasks](tasks.md).
  Task profiles (`docs/guides/task-profiles.md`) still split writes by profile;
  the active profile is per machine (`~/.config/devhub/profile.json` or
  `DEVHUB_PROFILE`) and is not committed. A prompt that notices the other
  machine and suggests a profile is not built.

## No fork, no GitHub, no Git

DevHub does not need a fork, a GitHub account or Git to run, and setup never
waits on a repo.

- **Content lives in app data first.** On the desktop app notes, tasks,
  collections and diagrams default to `~/.local/share/devhub/` in the distro
  (`setupCoreDefaults`). The repo-root field stays empty. Finishing setup (or
  **Set up later**) works with the GitHub step skipped.
- **The private repo is optional.** Setup → GitHub has *Back up to a private
  GitHub repo*. It says what the repo is for, and **Do this later** skips it. It is
  not a fork: a fork of a public repo stays public. **Create my private DevHub
  repo** makes a private repo in the user's account, clones the public core
  (`upstream`), points `origin` at the private repo, copies the current notes,
  tasks and diagrams in, commits with a noreply identity and pushes. Tokens stay in `gh`'s credential store and
  are never committed. *Clone my private repo* and *Link existing checkout* sit
  under the same disclosure and reuse the same code (`setupPrivateRepo`).
- **The one-click defaults are checked first.** The default is always
  `<login>/devhub-private` in `~/dev/devhub-private` (`~/Developer/…` on macOS).
  `GET /api/setup/private-repo` looks at the local folder and runs
  `gh repo view <login>/<name>` before the UI picks the leading action, and
  `setupPrivateRepo` repeats the GitHub check before cloning anything:
  - a git checkout is already there → **Link my existing checkout** leads;
  - the repo exists, is private and has content → **Clone my private repo**
    leads, pre-filled;
  - the repo exists and is public → DevHub says so and never offers to clone it
    or put content in it;
  - a non-checkout folder is in the way → create is hidden, with the reason;
  - in the last three cases a free name is suggested (`devhub-private-2`…, free
    on GitHub and as a sibling folder) as **Create a new private repo named … instead**;
  - an *empty private* repo (an interrupted earlier attempt) counts as free and
    is reused: origin is pointed at it instead of calling `gh repo create`.
  
  If a run fails before the first push, it removes only the folder it created
  (it checked the path did not exist first), so a retry works; a pre-existing
  folder is never touched, and after a successful push the folder is kept. The
  error says which of these happened. If `gh` can't be asked (signed out,
  offline) the form still works and the create attempt reports the problem.
- **Sign-in is DevHub's own device flow** (the same thing `gh auth login --web`
  does): a one-time code and the GitHub URL, then the token is handed to the
  bundled `gh`. The bundled `gh` is only used for create, clone and the check that
  `origin` is private; nothing else in the app needs it.
- **Git is detected where DevHub runs** (`/api/setup/git`): the Ubuntu distro on
  Windows, the Mac on macOS. If it is missing the repo section shows
  `sudo apt-get update && sudo apt-get install -y git` (Ubuntu) or
  `xcode-select --install` (macOS) with a copy button and **Re-check Git**. Git is
  not bundled: it needs the distro's own exec path and libraries, and an
  apt-managed git is the one every other tool in the distro expects.
  `setupPrivateRepo` checks git and `gh` first and stops before creating
  anything. Any other `git` call that cannot start now reports "Git isn't
  installed" with the same command, instead of `spawn git ENOENT`.
- **Connect later.** After setup finishes, Today shows a dismissible strip
  (*Your notes and tasks are stored only on this PC… optional*) with **Set up
  private repo**, which opens `/setup?step=github`. **Not now** is remembered in the
  setup record and the strip disappears once a repo is linked. Setup is also
  always in the toolbar.

Linking changes the content root, so DevHub asks to quit and reopen afterwards.

## Installer smoke test (CI)

The `windows-smoke` job in `release-desktop.yml` downloads the
`devhub-x86_64-pc-windows-msvc` artifact the `windows` job just built (the same
file `publish` ships; nothing is rebuilt) and runs
`desktop/scripts/windows-install-smoke.ps1` on a clean `windows-latest` runner.
It runs on tag pushes and on `workflow_dispatch` (including **windows_only**),
beside the other builds, and is not in `publish`'s `needs`: a failure turns the
run red without holding the release.

What it checks:

- The silent installer (`/S /D=<temp>\install`) exits 0 within five minutes. The
  install is per-user, so it needs no elevation.
- `devhub-desktop.exe`, `uninstall.exe`, `wsl/devhub-payload.tar.gz` and
  `wsl/payload-id.txt` are on disk, and the per-user uninstall entry exists
  under `HKCU`.
- The installed exe starts with a temporary `DEVHUB_APP_DATA`, writes
  `[startup] DevHub <version> starting` to `logs/shell.log`, reports the version
  the workflow built, and is still running five seconds later.

What it does not cover:

- **WSL and the server.** The runner has no distro, so the WSL discovery,
  payload unpack, sidecar start and dashboard load never run. The startup line
  is written before any of that; the app is expected to sit on its "WSL
  missing" screen. `--self-test` is not used because Windows bundles no server.
- **A real user session**: setup wizard, repo linking, tray, window rendering,
  WebView2 bootstrap on a machine without it, SmartScreen, Authenticode.
- **Upgrade, uninstall and reinstall.** Only a fresh install is exercised, and
  the pre-install hook's WSL `pkill` has nothing to stop. Uninstall runs only as
  best-effort cleanup and is not a check.
- **Updates**: signing, `latest.json` and the in-app updater.
- **Elevation, per-machine installs and other Windows versions.**

It passes on a machine where DevHub is unusable for a WSL reason, so it
complements the manual retest below rather than replacing it. Run it outside CI
only with `-Force`, and never on a machine with a DevHub you are using: the
installer's pre-install hook stops DevHub's own WSL supervisor.

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
- Upgrade over an install whose Paseo unit still points at an old payload, and
  over a configured profile (it must open Today, not Setup); `nvm current` in
  DevHub's terminal; Usage cards and the Details dialogs; the no-fork / no-Git
  path on a fresh profile.

## Known gaps

- No Authenticode signature, so SmartScreen warns on first run (optional to fix).
- Cursor's install hint is the generic download page; launching Windows Cursor
  from WSL needs WSL interop (`[interop] enabled=true`), which some distros turn off.
- WSL `localhostForwarding=false` in `.wslconfig` breaks the window's connection.
- Distro `$SHELL` interactive startup noise lands in the sidecar log.
- The sidecar's `peers` process exits 0 at startup in the payload; identical to
  the native packaged path, not investigated here.
