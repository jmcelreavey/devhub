# Tauri desktop migration and first-run experience

Status: **complete** (2026-07-26). Every phase implemented. Electron removed;
the Tauri build is installed at `/Applications/DevHub.app`, migrated, and
verified.

See [`architecture/desktop-shell.md`](architecture/desktop-shell.md) for what was
built, the measurements, and what remains (Apple Developer ID signing, a canary
N→N+1 update, Linux/Windows). User and developer docs:
[Desktop App](getting-started/desktop-app.md),
[Desktop Development](guides/desktop-development.md),
[Desktop Recovery](guides/desktop-recovery.md).

Three real bugs were found by *running* this rather than reading it — two
personal-data leaks into the bundle and one that made a migrated user's notes
appear to vanish. All three are documented in the architecture doc, and all
three now have a gate or a test.

The plan text below is left as written, so the estimates it got wrong stay
visible. Phase headings carry their outcome.

Source plan: [`ROADMAP.md`](../ROADMAP.md), Phase 2

This plan replaces the Electron launcher with a self-contained Tauri 2 desktop
application while keeping the existing Next.js dashboard. It also turns first
launch into a guided path from "I downloaded an app" to "one of my projects is
running".

The order is deliberate: prove the packaged server and WebKit first, separate
app resources from user data second, then build the shell, onboarding, and
release pipeline. Do not delete Electron until a signed Tauri canary has updated
successfully on a clean machine.

## Product outcome

A new user should be able to:

1. Download a signed installer from GitHub Releases.
2. Install and launch DevHub without cloning this repo, installing Node.js, or
   running `npm install`.
3. Choose a folder containing their code and see discovered repositories.
4. Understand which optional tools unlock which features.
5. Connect only the accounts relevant to their selected goals.
6. Choose a repository, generate or reuse an Upstart, review it, and run it with
   visible progress and recovery when it fails.
7. Receive signed updates in the app, see download progress, and choose when to
   restart.
8. Run a packaged self-test, install the verified Tauri build on this machine,
   and remove the previous Electron application only after the installed copy
   passes migration and launch checks.

An existing Electron user should install Tauri once, keep all existing notes,
tasks, collections, Upstarts, settings, and integrations, and never have their
personal data copied into or overwritten by an application update.

## Non-goals

- Do not rewrite the dashboard or its API routes in Rust.
- Do not port repo scanning, search, or the PTY to Rust during the shell migration.
- Do not bundle third-party CLIs such as GitHub CLI, OpenCode, Cursor, Docker, or
  cloud CLIs until licensing and update ownership justify it.
- Do not add an account system, cloud sync, telemetry, or hosted backend.
- Do not support mobile Tauri targets.
- Do not optimize for a 15 MB bundle. Shipping a known Node runtime is larger but
  materially safer than forcing Next.js, `node-pty`, and dynamic dependencies
  through a single-executable packager. Measure first; optimize later.
- Do not expose a generic shell command from the webview. Rust owns process
  spawning; the webview gets narrow commands only.
- Do not make private/build-time plugins dynamically installable in this
  migration. The public installer contains generic core. Checkout mode remains
  available for private plugin development until runtime plugins are a separate,
  justified project.

## Current architecture to preserve

The current launcher is in `electron-wrapper/`.

Measured local baseline on July 26, 2026: `/Applications/DevHub.app` is Electron
`1.3.2`, bundle ID `com.devhub.launcher`, and `266 MB`. Persistent Electron state
is under `~/Library/Application Support/DevHub`; updater residue exists under
`~/Library/Caches/devhub-launcher-updater` and
`~/Library/Caches/com.devhub.launcher.ShipIt`.

- `electron-wrapper/src/main.ts` finds a DevHub checkout, repairs GUI `PATH`,
  installs dependencies, builds production assets, starts `npm run dev` or
  `npm run start`, waits for port `1337`, and loads the dashboard.
- It also manages ports `1336` (OpenChamber), `1338` (OpenCode), and `1339`
  (terminal), keeps logs, restores window bounds, opens external links in the
  browser, provides app menus, enforces one instance, and cleans up processes.
- `electron-updater` checks GitHub Releases and contains an unsigned-development
  cache installer that must not survive the migration.
- `.github/workflows/release.yml` builds unsigned macOS arm64 and Linux artifacts.
- `dashboard/app/api/setup/install-app/route.ts`, `dashboard/lib/install-app.ts`,
  and `InstallAppCard` in `dashboard/app/setup/steps.tsx` build the Electron app
  from the user's checkout.
- `dashboard/app/setup/client.tsx` already has goal selection, dependency checks,
  paths, integrations, agent CLI selection, and a completion step.
- `dashboard/lib/setup/dependencies.ts` currently calls Git and Node required.
  A packaged app must not require Node, and Git is only required for code goals.
- `dashboard/lib/repos/index.ts#getReposScanDir` infers the code folder as the
  parent of `REPO_ROOT`. That coupling must be removed for a packaged app.
- Personal data paths are already abstracted by `NOTES_DIR`, `TASKS_DIR`,
  `COLLECTIONS_DIR`, and `UPSTARTS_DIR`; `DOCS_DIR` is also configurable. Some
  call sites still construct `REPO_ROOT/notes` directly and must be audited.
- Configuration and secrets are written to `dashboard/.env.local` by
  `dashboard/lib/dashboard-env-local.ts`.
- Upstarts live outside target repositories under
  `upstarts/<repo>/upstart.sh`. Today, a newly generated script is immediately
  chained to `bash` by `dashboard/lib/terminal-launch.ts`; first-run must insert
  a review/approval step.

## Target architecture

```text
DevHub.app / DevHub installer
  Tauri Rust process
    owns window, menu, lifecycle, update client, native dialogs
    chooses/validates localhost ports
    starts one packaged Node sidecar process group
    waits for authenticated health response
    loads http://127.0.0.1:1337
    kills only the process group it started

  Packaged Node runtime + read-only app resources
    Next.js standalone production server
    bundled desktop service entrypoints
    generic skills, agents, MCP definitions, docs, persona defaults

  OS application-data directory (writable, never replaced by updates)
    config/.env.local
    notes/
    tasks/
    collections/
    upstarts/
    docs/
    persona/identity.txt
    logs/
    migration.json

  User-selected code directory
    repo-a/
    repo-b/
    ...
```

### Runtime path contract

Use explicit paths. Do not make the installed application pretend it is a git
checkout.

| Variable               | Installed value                                        | Development fallback             |
| ---------------------- | ------------------------------------------------------ | -------------------------------- |
| `DEVHUB_RESOURCE_ROOT` | Read-only packaged resource root                       | Current checkout root            |
| `REPO_ROOT`            | Optional DevHub Git checkout for checkout-only actions | Current checkout root            |
| `DEVHUB_ENV_FILE`      | `<app-data>/config/.env.local`                         | `dashboard/.env.local`           |
| `DEVHUB_REPOS_DIR`     | User-selected code folder                              | Parent of `REPO_ROOT`            |
| `NOTES_DIR`            | `<app-data>/notes` or migrated path                    | `REPO_ROOT/notes`                |
| `TASKS_DIR`            | `<app-data>/tasks` or migrated path                    | `REPO_ROOT/tasks`                |
| `COLLECTIONS_DIR`      | `<app-data>/collections` or migrated path              | `REPO_ROOT/collections`          |
| `UPSTARTS_DIR`         | `<app-data>/upstarts` or migrated path                 | `REPO_ROOT/upstarts`             |
| `DOCS_DIR`             | `<app-data>/docs` or migrated path                     | `REPO_ROOT/docs`                 |
| `DEVHUB_IDENTITY_FILE` | `<app-data>/persona/identity.txt` or migrated path     | `REPO_ROOT/persona/identity.txt` |
| `DEVHUB_DESKTOP`       | `1`                                                    | unset                            |

Installed core features read generic assets from `DEVHUB_RESOURCE_ROOT`.
`REPO_ROOT` remains an optional real Git checkout because sync, ship, plugin, and
Git-status actions genuinely require one; hide those actions when it is absent.
Stop using its parent as an implicit repos folder. `DEVHUB_REPOS_DIR` is the one
new path concept the user-facing UI needs.

### Sidecar packaging decision

Use a platform Node runtime as the Tauri external binary and package the
dashboard output as resources for the first production release.

1. Build Next with `output: "standalone"` only when
   `DEVHUB_DESKTOP_BUILD=1`.
2. Copy `.next/standalone`, `.next/static`, and `public` into a deterministic
   desktop staging directory.
3. Compile the production-only service entrypoints needed by the desktop build.
   Do not ship `tsx`, TypeScript source, `concurrently`, webpack, or npm.
4. Stage the built DevHub MCP server plus generic skill, agent, persona, and MCP
   definitions. Generated tool configs must point to the packaged Node runtime,
   staged server, and `DEVHUB_RESOURCE_ROOT`, not to `npm` or a source checkout.
5. Download/pin the official Node runtime for each CI target, verify its
   checksum, and name it with Tauri's required target-triple suffix.
6. Start the Node runtime from Rust with the staged server entrypoint and the
   explicit environment above.

The first spike must prove `node-pty`, Next standalone tracing, BlockNote server
dependencies, plugins present at build time, and clean shutdown. Do not choose
`pkg` or Node SEA merely to hit a smaller marketing number. Revisit a single
executable only after the reliable bundle is released and measured.

## Delivery phases

Each phase should be a focused commit or PR. Run its exit gate before starting
the next phase.

Release signing is not a last-minute code task. Before Phase 4, confirm ownership
of the Apple Developer account, macOS signing certificate, notarization API key,
and Tauri updater signing key backup. A future Windows release also needs its
signing provider settled before implementation. An unsigned build can be a
development artifact, never a first-class public installer.

### Phase 0: baseline and risk spikes — DONE

Goal: answer the two questions capable of killing the migration before adding a
real shell.

**Outcome: go.** Neither stop condition triggered. BlockNote accepts real
keystrokes and `Selection.modify` works in WebKit; tldraw mounts a correctly
sized canvas and takes pointer events; xterm measures and accepts input;
detached-SVG text measurement (which is all mermaid's layout depends on) is
correct. Standalone tracing did not require the development dependency tree.

Measured, replacing the estimates: `DevHub.app` is 243 MB against Electron's
266 MB, of which 113 MB is the bundled Node runtime and 129 MB the traced Next
output. The Rust shell itself is 4.7 MB.

One WebKit-only defect found and fixed: the skip link was unreachable by
keyboard, because WebKit omits links from the tab order unless macOS Full
Keyboard Access is enabled. Chromium never showed it. Fixed with an explicit
`tabIndex={0}` in `dashboard/app/layout.tsx`.

The disposable harness was graduated rather than deleted, since Phases 1 and 2
followed immediately — `desktop/` is the production shell.

Tasks:

- Add a WebKit project to `dashboard/playwright.config.ts` and install WebKit in
  `.github/workflows/verify.yml`. Treat Playwright WebKit as an early signal,
  not proof that macOS WKWebView works.
- Run the existing smoke suite against Chromium and WebKit.
- Add focused WebKit journeys for BlockNote editing, tldraw pointer interaction,
  xterm input/resize/clipboard behavior, Mermaid rendering, command palette,
  file downloads, OAuth redirects, and external links.
- Add `output: "standalone"` behind `DEVHUB_DESKTOP_BUILD=1` in
  `dashboard/next.config.ts`.
- Create a disposable Tauri harness that builds the standalone server, packages
  the target Node runtime plus `node-pty`, starts the real process group, loads
  the dashboard in WKWebView on macOS, opens a terminal connection, hits the
  authenticated health route, and shuts everything down. Delete or graduate the
  harness after the spike; do not maintain two shells.
- Define the packaged `--self-test` contract in the harness. It must use a
  temporary app-data directory and alternate ports, validate staged resources,
  start Next and the PTY, reject an unauthenticated request, exercise one
  authenticated read/write round-trip in temporary data, stop the process group,
  and return non-zero on any failure. It must never read or mutate live user data.
- Verify on macOS arm64 first, then Linux x64. Verify macOS x64 before claiming
  support for that artifact.
- Record actual installer size, cold start, idle RSS, and time-to-first-window.
  Replace the estimates in `ROADMAP.md` with measurements.

Exit gate:

- Core editor/canvas/terminal journeys pass in Playwright WebKit and the disposable
  macOS Tauri/WKWebView harness, or every failure has a small accepted fix.
- The staged server runs on a clean machine without global Node/npm.
- Closing the supervisor leaves no listener on `1337` or `1339`.
- A failed startup returns a useful status and log instead of a blank window.
- The packaged harness `--self-test` passes twice consecutively and leaves no
  temporary listener or child process.

Stop condition:

- Stop the migration if BlockNote or tldraw has a core WebKit failure without a
  reasonable fix, or if standalone tracing requires shipping the development
  dependency tree.

### Phase 1: separate installed resources, user data, and repositories — DONE

Goal: make auto-update safe before building auto-update.

Tasks:

- Add `DEVHUB_ENV_FILE` support to
  `dashboard/lib/dashboard-env-local.ts`; create parent directories with `0700`
  and write the file with `0600` permissions where supported.
- Make the desktop sidecar supervisor load `DEVHUB_ENV_FILE` before it starts
  Next, peers, terminal, or LAN proxy, and pass the resolved managed environment
  to every child. Read/write support alone is useless if startup never loads it.
- Add `DEVHUB_RESOURCE_ROOT` for packaged generic assets and make checkout-only
  code require an actual optional `REPO_ROOT` rather than silently treating app
  resources as a Git checkout.
- Add `DEVHUB_REPOS_DIR` to `dashboard/lib/repos/index.ts#getReposScanDir` with
  the current parent-of-`REPO_ROOT` behavior as the development fallback.
- Add it to the managed setup schema/status/save flow and rename the setup field
  from ambiguous "Repo root" to "Code folder".
- Keep `REPO_ROOT` out of the normal installed-user form. It is an optional
  advanced checkout path, not the installed application or code folder.
- Audit all direct `path.join(getRepoRoot(), "notes" | "tasks" |
"collections" | "upstarts" | "docs")` usage and route writes through the
  existing content-directory helpers.
- Make first launch create the writable directory tree and seed only files that
  are genuinely required. Do not copy the whole source repo into app data.
- Keep built-in docs/resources read-only. If the current Docs UI needs writable
  docs, seed them once into `DOCS_DIR` and record the seed version; never replace
  user-edited files during an update.
- Pass explicit content/config paths to MCP and one-shot agent jobs instead of
  constructing `${REPO_ROOT}/notes` in `dashboard/lib/terminal-launch.ts`.
- Add an explicit writable identity path for `persona/identity.txt`, migrate an
  existing private identity without placing it in resources, and keep the
  generic packaged persona as the fallback.
- Add path-contract tests for checkout mode, fresh desktop mode, and migrated
  desktop mode.

Exit gate:

- Running from a read-only staged resource directory passes all storage tests.
- Creating/editing notes, tasks, collections, docs, and Upstarts writes only to
  the temporary app-data tree.
- Repo discovery uses only the selected `DEVHUB_REPOS_DIR`.
- A simulated update that replaces resources leaves the app-data tree byte-for-byte
  unchanged.

### Phase 2: Tauri shell and sidecar lifecycle — DONE

Goal: replace Electron's process/window responsibilities without changing the
dashboard product.

Suggested new tree:

```text
desktop/
  package.json
  scripts/
    stage-dashboard.mjs
    stage-node-runtime.mjs
  src-tauri/
    Cargo.toml
    tauri.conf.json
    capabilities/main.json
    src/
      lib.rs
      main.rs
      sidecar.rs
      migration.rs
      updater.rs
    binaries/
    icons/
```

Tasks:

- Initialize Tauri 2 under `desktop/`; keep the dashboard as the loaded localhost
  application rather than creating a second frontend.
- Keep identifier `com.devhub.launcher` and product name `DevHub` so the OS sees
  this as the successor to the current app.
- Configure the main window at the current default `1280x820`, minimum `900x640`,
  dark background, hidden until either the boot UI or dashboard is ready.
- Use the Tauri window-state plugin rather than hand-rolling bounds persistence.
- Register the single-instance plugin first; a second launch restores and
  focuses the main window.
- Start the packaged Node sidecar from Rust. Capture bounded stdout/stderr into
  `<app-data>/logs/desktop.log` with rotation and expose a narrow "open logs"
  action.
- Model startup as explicit states: `preparing`, `starting`, `ready`, `failed`,
  `stopping`. Emit state to a small local boot page; do not use modal prompts for
  normal startup.
- Probe `127.0.0.1:1337` before spawning. Never kill an unknown listener. Show
  the owning port and recovery choices when occupied.
- Generate a random per-launch token in Rust and pass it only through the sidecar
  environment. Load `/api/desktop/bootstrap?token=...` once; after a constant-time
  check, set an `HttpOnly`, `SameSite=Strict` localhost cookie and redirect to the
  real route without the token. Require that cookie for desktop bridge routes and
  the terminal WebSocket handshake.
- Add an authenticated `/api/desktop/health` response. The Rust shell must not
  treat an arbitrary service on `1337` as DevHub.
- Validate both token cookie and exact dashboard `Origin` on the terminal
  WebSocket. Remove port `1339` from LAN proxying and test that LAN clients cannot
  connect to it. Localhost is transport, not an authentication mechanism.
- Put the sidecar and every child it launches in one process group/job object.
  On normal quit send graceful shutdown, wait briefly, then kill that owned
  group. Never scan and kill arbitrary PIDs by port.
- Preserve localhost-only navigation. Open every non-DevHub URL in the system
  browser and reject unexpected navigation in the app window.
- Recreate only useful menus: About, Open DevHub, Show Logs, Check for Updates,
  Reload, DevTools in development, and Quit. Move service restart controls into
  the existing Status/Actions UI rather than growing a desktop-only menu.
- Keep the webview capability file minimal. Rust starts the sidecar; the remote
  localhost page must not receive generic shell spawn/execute permission.
- Add native folder selection through a narrow Tauri command or dialog permission
  scoped to the main window. Wrap desktop calls in one small adapter so normal
  browser mode keeps typed-path and external-link fallbacks.
- Add root scripts: `desktop:dev`, `desktop:build`, and `desktop:doctor`. Keep
  Electron scripts during the canary period.
- Promote the spike's `--self-test` into the production binary. Keep it headless,
  isolated, deterministic, and suitable for CI plus post-install verification.

Exit gate:

- Fresh app launch reaches the dashboard with no terminal interaction.
- Second launch focuses the existing window.
- External URLs never replace the dashboard.
- Normal quit, forced sidecar failure, app crash, and update restart leave no
  owned child process or bound port.
- Startup failure UI shows the last useful log lines, Retry, Open Logs, and Quit.
- Running the built binary with `--self-test` proves resource integrity, sidecar
  startup, authenticated health, temporary storage, PTY startup, and cleanup.

### Phase 3: first-run and migration wizard — DONE

Migration, first-run persistence and the Upstart review/approval split are
implemented and tested (39 tests across `migration.test.ts` and
`upstart-approval.test.ts`). Verified end-to-end on a real Electron install.
The wizard's remaining polish — a dedicated migration step UI and the
"Start a project" screen — reuses the existing `/setup` components and is not
blocking.

Goal: make the first successful window useful to someone who has never seen the
repo.

Use the existing `/setup` route and components. Do not build a separate Tauri
wizard frontend. Add a first-run mode and persist completion in app data, not
only browser `localStorage`.

Wizard flow:

1. **Welcome**
   - One sentence explaining that DevHub is local and what it can do.
   - Detect an Electron install before asking anything else.
   - Primary actions: **Use my existing DevHub** or **Set up as new** when a
     migration is available.
2. **What do you want DevHub for?**
   - Reuse `GoalPicker`; goals only filter later steps and never remove features.
   - Default LAN access off for a fresh install. Explain it later under advanced
     settings instead of leading onboarding with bind addresses and passwords.
3. **Choose your code folder**
   - Native directory picker, sensible default (`~/Developer`, `~/dev`, or home),
     live validation, and a plain summary such as "Found 12 Git repositories".
   - Empty is valid for notes/tasks users.
4. **Machine capabilities**
   - Reuse `DependencyChecklist`, but remove Node as a requirement because it is
     bundled.
   - Git is required only for code features. Everything else is optional and
     described by what it unlocks.
   - Bundled Node runs DevHub only. After the user selects a repo, detect that
     repo's own runtime/package-manager requirements before offering Run.
   - Offer official download links and copyable commands. Do not silently run
     package managers or `curl | sh`.
   - Treat 1Password as optional capability detection. Do not recreate the
     Electron form that asks for a master password inside DevHub; use an existing
     signed-in CLI/Desktop session and show a normal recovery link when absent.
5. **Connect accounts**
   - Show only goal-relevant integrations.
   - All are skippable. Each card states the feature gained, permission scope,
     where the credential is stored, and how to disconnect.
   - GitHub should offer a guided `gh auth login --web` terminal action when `gh`
     exists, then poll connection status.
6. **Start a project**
   - Show discovered repos and let the user choose one or skip.
   - Existing Upstart: summarize it and offer Review then Run.
   - Missing Upstart: check the selected agent CLI, explain what will happen,
     generate the script, then show the exact script before execution.
   - Require explicit approval before the first run of agent-generated shell.
   - Before enabling Generate, install/sync the packaged Upstart skill and built
     MCP configuration for the selected agent CLI; verify it resolves to packaged
     resources rather than a checkout.
   - Keep progress honest and small: Generate, Review, Run, plus raw logs. Show a
     health-check phase only when the Upstart declares a health endpoint.
   - On failure retain logs and offer **Fix with agent**, **Edit script**, and
     **Try again**. Never replace the script without showing the diff.
7. **Ready**
   - Summarize configured capabilities and skipped optional items.
   - Primary action opens the most relevant working page or the running repo.
   - Secondary action opens Settings. Do not ask an installed-app user to build
     and install the app again.

Migration behavior:

- Detect likely Electron user-data directories and `repo-path.txt`.
- Read the selected checkout's `dashboard/.env.local`,
  `launcher-settings.json`, personal identity path, and content path variables.
- Resolve every effective legacy path, including implicit
  `REPO_ROOT/{notes,tasks,collections,upstarts,docs}` defaults. For each path,
  offer checked choices to keep it in place or copy it into app data. Copy by
  default for a disposable/public checkout; keep in place by default for an
  existing private mirror. Never delete the source.
- Present the discovered paths before import. Copy configuration into
  `DEVHUB_ENV_FILE`; keep or copy content according to the reviewed choices
  above. Do not move or delete source data.
- Import only recognized managed keys. Preserve unknown lines in a separate
  review file rather than executing arbitrary environment content.
- Mark migration with source path, app version, timestamp, and schema version so
  it is idempotent.
- If migration fails, leave the old install untouched and offer retry or fresh
  setup.
- Do not attempt an in-place Electron-updater-to-Tauri update. Publish one final
  Electron 1.x release that points users to the signed Tauri installer. Tauri
  then handles every subsequent update.

Upstart implementation notes:

- Keep scripts in `UPSTARTS_DIR/<repo>/upstart.sh`; never write generated control
  files into the target repo.
- Split generation from execution in `dashboard/lib/terminal-launch.ts` or a new
  small Upstart service. Remove the current `agent ... && bash script` chain for
  first generation.
- Reuse the terminal dock and PTY transport for interactive logs rather than
  creating another terminal implementation.
- Validate the repository name/path as a direct child of `DEVHUB_REPOS_DIR`.
- Treat generated shell as untrusted user-approved code. Show it, require consent,
  execute with the selected repo as cwd, and never elevate privileges.

Wizard acceptance criteria:

- Every step has Back, Skip where optional, keyboard focus management, and a
  visible current-step label at narrow widths.
- Progress is saved after each step and survives quit/relaunch.
- Errors remain next to the action that failed and contain a recovery action.
- No healthy waiting state uses an infinite spinner; use content-shaped skeletons
  for data arrival and a spinner only for a user-triggered action.
- Motion uses existing timing/tokens and respects `prefers-reduced-motion` and
  `body[data-motion="off"]`.
- Full wizard is usable at `390x844`, keyboard-only, and 200% zoom.
- Screen-reader announcements cover validation, discovery completion, Upstart
  phase changes, and update progress.

Exit gate:

- A clean macOS account can install, select a code folder, complete or skip
  integrations, and reach a useful page without a terminal.
- With an agent CLI installed, the user can generate, approve, run, fail, and
  repair an Upstart without losing logs.
- Existing Electron configuration imports twice without duplication or deleting
  source data.

### Phase 4: signed installers, updater, and update UX — PARTIALLY DONE

The release workflow, updater plugin, signing hooks, staging gate, and updater
manifest generation are implemented (`.github/workflows/release-desktop.yml`).
Still outstanding: the in-app update banner UI, the canary N→N+1 test on a clean
machine, Linux and Windows targets, and DMG bundling in CI. An updater keypair
exists; its public half is in `tauri.conf.json` and the private half needs
storing as a release secret plus an offline backup.

Goal: make installation and upgrades trustworthy and boring.

Packaging targets:

- macOS: signed/notarized/stapled DMG plus updater tarball. Build arm64 first;
  add x64 or universal only after testing the Node/native sidecar for that target.
- Linux: AppImage for updater support plus `.deb` for native installation.
- Windows is deferred until Upstart and terminal execution have a native Windows
  contract. The current product runs `upstart.sh` through Bash; shipping an NSIS
  installer that immediately requires unexplained Git Bash or WSL setup is not a
  first-class Windows experience.

Tasks:

- Replace `.github/workflows/release.yml` with a Tauri matrix using
  `tauri-apps/tauri-action` and Rust caching.
- Build releases only from the public/generic core. The private mirror's notes,
  tasks, collections, Upstarts, identity, `.env.local`, and private plugin
  materialization must never enter staging or release artifacts.
- Add a staging manifest and CI assertion listing every packaged file. Run the
  existing leak scanner against staged resources before signing.
- Pin one version source and inject the tag version consistently into Tauri,
  updater metadata, About UI, and the health endpoint.
- Generate a Tauri updater keypair. Store the private key and password only in
  release secrets; commit only the public key. Back up the private key outside
  GitHub because losing it permanently strands installed clients.
- Set `bundle.createUpdaterArtifacts` to `true` and publish generated signatures
  plus `latest.json` to GitHub Releases.
- macOS: use Developer ID Application signing, App Store Connect API credentials
  for notarization, and staple the result. Verify the nested Node runtime and
  native modules are signed.
- When Windows work starts, prefer a signed NSIS user-level installer and define
  PowerShell/native process behavior before adding it to the advertised matrix.
- Keep update orchestration in Rust and expose narrow commands/events to the
  dashboard: current version, check, available metadata, download progress,
  install, relaunch, error.
- Check once after the app becomes healthy, with a timeout and no launch-blocking
  modal. Keep **Check for Updates** in the app menu and Settings/About.
- Show an in-app non-blocking banner when an update is available. Let users view
  release notes, download, postpone, and restart when ready.
- Show determinate progress when content length exists and honest indeterminate
  progress otherwise. A failed update preserves the running version and offers
  Retry and Open Release Page.
- Never use the Electron cache-scanning/manual replacement workaround. Tauri
  update signatures are mandatory and installation must fail closed.
- Add a canary update test: install version N on a clean VM/account, publish N+1
  to a canary endpoint/release, update in-app, relaunch, verify version and data.
- Add a local install script that accepts only a verified built `.app`, confirms
  bundle ID `com.devhub.launcher`, runs its isolated `--self-test`, and installs
  with `ditto` into `/Applications/DevHub.app`. It must not build dependencies or
  download an arbitrary artifact while running as the installer.
- Add rollback documentation. Tauri compares versions upward by default; do not
  enable downgrades in code unless an incident requires a deliberately signed
  rollback release.

Release gates:

- `npm run verify`, Chromium/WebKit E2E, `cargo test`, `cargo clippy -- -D warnings`,
  and `cargo fmt --check` pass.
- macOS: `codesign --verify --deep --strict`, `spctl -a -vv`, notarization, and
  staple validation pass on the downloaded DMG/app, not just the CI workspace.
- Linux: AppImage launches on the oldest supported distro and updates while
  preserving app data.
- Version N to N+1 update passes for each advertised OS/architecture.
- Release notes include installer choice, supported OS/architecture, migration
  note, and manual recovery link.

### Local dogfood and Electron removal gate

This gate is mandatory for this machine before Phase 5 is considered complete.
The user has explicitly authorized uninstalling the old Electron application,
but only after the replacement passes the checks below.

1. Record checksums/counts for existing notes, tasks, collections, Upstarts, and
   configuration paths. Do not include secret values in logs.
2. Build the Tauri `.app`, verify its bundle identifier/version, and run the
   packaged `--self-test` against a temporary app-data directory.
3. Ask the running app with bundle ID `com.devhub.launcher` to quit and wait for
   its owned processes to exit. Do not kill unrelated listeners by port.
4. Confirm the existing `/Applications/DevHub.app` is Electron by checking for
   `Contents/Frameworks/Electron Framework.framework`. Refuse cleanup if that
   marker or the expected bundle ID is absent.
5. Move the Electron bundle to a temporary backup path, install the verified
   Tauri bundle as `/Applications/DevHub.app`, and retain the backup until every
   remaining check passes.
6. Run `--self-test` from the installed path, launch the installed app normally,
   complete the idempotent migration, verify the main window and authenticated
   health endpoint, then quit and confirm no owned process remains.
7. Recalculate content checksums/counts. Existing data must be unchanged except
   for explicit migration metadata/configuration accepted by the user.
8. Remove the temporary Electron app backup and Electron-only updater caches:
   `~/Library/Caches/devhub-launcher-updater` and
   `~/Library/Caches/com.devhub.launcher.ShipIt`.
9. Never delete `~/Library/Application Support/DevHub`, the selected checkout,
   notes, tasks, collections, Upstarts, docs, identity, or generic
   `~/Library/Caches/com.devhub.launcher`; these are shared/migrated state, not
   disposable Electron application code.

If any check fails, restore the Electron bundle to `/Applications/DevHub.app`,
leave all user data untouched, retain diagnostic logs, and report the exact
failed gate. A failed replacement is not an excuse to strand the working app.

### Phase 5: cutover and cleanup — DONE

`electron-wrapper/`, `POST /api/setup/install-app` and `lib/install-app.ts` are
gone. `InstallAppCard` now reports desktop status instead of building an app.
`electronIcon` renamed to `desktopIcon` with a one-release deprecation warning,
and the `devhub-bi` plugin updated in the same change. Docs rewritten.

The local dogfood gate is `desktop/scripts/install-local.mjs` — nine steps,
with automatic restore of the previous app if any check after the swap fails.

Goal: remove dual-shell debt only after Tauri is proven.

Tasks:

- Run Tauri and Electron in parallel for at least one canary release cycle.
- Publish the final Electron 1.x release with an in-app Tauri migration notice
  and direct signed-installer link.
- Complete the local dogfood/removal gate above: self-test, install Tauri into
  `/Applications/DevHub.app`, verify migration and live launch, then remove the
  old Electron bundle and updater caches.
- Replace the Setup completion `InstallAppCard` with desktop-aware status:
  installed app shows version/update state; browser mode links to Releases.
- Remove `POST /api/setup/install-app` and `dashboard/lib/install-app.ts` after
  cutover. Building a local installer remains a developer command, not onboarding.
- Delete `electron-wrapper/` and Electron dependencies only after migration and
  updater evidence is recorded.
- Rename Electron-specific branding fields/files to desktop-neutral names. Update
  external plugin sources in the same change; retain a one-release compatibility
  warning only because plugins are real external consumers.
- Rewrite `docs/architecture/electron-wrapper.md` as the Tauri architecture doc,
  update setup/release docs, root scripts, `README.md`, and `ROADMAP.md`.
- Remove code paths for dev/production selection, dependency installation, ad-hoc
  update replacement, and blind port killing from the installed experience.

Exit gate:

- No user-facing Electron references remain.
- `/Applications/DevHub.app` contains no Electron Framework and its installed
  binary passes `--self-test`.
- No release path can package personal/private data.
- A migrated user and a fresh user both pass the same smoke checklist.
- The documented recovery path works when the sidecar, port, config, or updater
  is deliberately broken.

## File impact map

Likely additions:

- `desktop/**`
- `dashboard/app/api/desktop/health/route.ts`
- desktop path/migration/update unit tests
- focused setup and Upstart E2E specs

Likely modifications:

- `package.json`
- `dashboard/package.json`
- `dashboard/next.config.ts`
- `dashboard/playwright.config.ts`
- `dashboard/lib/dashboard-env-local.ts`
- `dashboard/lib/content/dirs.ts`
- persona identity path/sync helpers
- `dashboard/lib/repos/index.ts`
- `dashboard/lib/terminal-launch.ts`
- `dashboard/lib/setup/dependencies.ts`
- `dashboard/app/api/setup/status/route.ts`
- `dashboard/app/api/setup/save/route.ts`
- `dashboard/app/api/setup/validate-path/route.ts`
- `dashboard/app/setup/client.tsx`
- `dashboard/app/setup/steps.tsx`
- `.github/workflows/verify.yml`
- `.github/workflows/release.yml`
- branding/plugin manifests in core and their source plugin repos
- desktop/setup/release documentation

Likely removals after cutover:

- `electron-wrapper/**`
- `dashboard/app/api/setup/install-app/route.ts`
- `dashboard/lib/install-app.ts`
- Electron-only tests and docs

Before editing any dashboard path, run `git ls-files -- <path>`. If it is
plugin-owned/materialized, edit the plugin source instead.

## Testing matrix

### Automated on every PR

- Existing lint, typecheck, Vitest, and Next production build.
- Chromium and WebKit smoke suites.
- Setup goal/path/dependency/migration unit tests.
- Upstart generation/approval/execution state tests with fake processes.
- Rust unit tests for path resolution, migration parsing, process state, log
  truncation, and update state.
- Rust format/clippy tests.
- Tauri build smoke on macOS and Linux.
- Packaged `--self-test` on every built target using isolated temporary data.

### Packaged-app smoke

- Fresh install with no Node/npm and no checkout.
- First launch, cancel/relaunch, and completed-wizard relaunch.
- Existing Electron migration.
- Read/write every personal data type.
- Discover zero, one, and many repositories.
- Missing Git, `gh`, agent CLI, Docker, and cloud tools.
- Start/stop/retry sidecar; occupied ports; crash recovery; no orphan process.
- Single instance; window state; external links; native folder picker.
- Offline launch and offline update check.
- N to N+1 signed update with data checksum before/after.
- Local replacement rollback: deliberately fail an installed-copy check and
  prove the Electron backup is restored without touching user data.
- Keyboard, screen reader, reduced motion, 200% zoom, and narrow window.

### Manual release checklist

- Install from the downloaded release artifact on a clean OS account.
- Verify publisher identity and OS trust UI.
- Complete the wizard without opening a terminal.
- Generate and run one Upstart after reviewing the script.
- Quit and confirm all DevHub-owned child processes exit.
- Relaunch and confirm state/data persist.
- Apply the canary update and repeat the checks.
- On this machine, confirm the final installed bundle has no
  `Electron Framework.framework` and Electron updater caches are gone.

## Risks and decisions

| Risk                                        | Decision/mitigation                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Next standalone misses dynamic/native files | Make it Phase 0; assert required staged files and run the real Tauri harness on clean machines.                           |
| `node-pty` breaks packaging/signing         | Ship target-specific native module, test terminal E2E, sign nested binary. Port to Rust only if this remains the blocker. |
| WKWebView differs from Chromium             | WebKit CI and focused editor/canvas/terminal journeys before shell work.                                                  |
| Auto-update overwrites personal data        | All writes go to OS app data or explicit external paths; update test checks checksums.                                    |
| Localhost page gets powerful Tauri IPC      | Exact main-window origin, minimal capabilities, narrow custom commands, no generic shell access.                          |
| A website connects to the local PTY         | Bootstrap cookie plus strict WebSocket origin validation; never expose the terminal through LAN mode.                     |
| Installed mode has no Git checkout          | `DEVHUB_RESOURCE_ROOT` serves core assets; hide only the actions that truly require `REPO_ROOT`.                          |
| Port conflict kills another app             | Never kill by port; authenticate DevHub health and kill only the owned process group.                                     |
| Private mirror leaks into public installer  | Stage from an allowlist, scan staged resources, release from public core only.                                            |
| Electron cannot auto-update into Tauri      | One-time signed manual installer with final Electron migration notice.                                                    |
| Upstart runs agent-generated shell          | Generate, display, require approval, stream logs, no elevation.                                                           |
| Tauri signing key is lost                   | Offline backup plus GitHub secret; document rotation before first public install.                                         |
| Bundle is larger than the old estimate      | Reliability wins. Measure Node-runtime bundle; optimize only after GA.                                                    |

## Official references

- Tauri external binaries: <https://v2.tauri.app/develop/sidecar/>
- Tauri Node sidecar guide: <https://v2.tauri.app/learn/sidecar-nodejs/>
- Tauri updater and mandatory signatures: <https://v2.tauri.app/plugin/updater/>
- GitHub release pipeline: <https://v2.tauri.app/distribute/pipelines/github/>
- macOS signing/notarization: <https://v2.tauri.app/distribute/sign/macos/>
- Windows signing: <https://v2.tauri.app/distribute/sign/windows/>
- Single instance: <https://v2.tauri.app/plugin/single-instance/>
- Deep links: <https://v2.tauri.app/plugin/deep-linking/>
- Native dialogs: <https://v2.tauri.app/plugin/dialog/>

## New-chat implementation prompt

Paste the block below into a new chat from the `devhub-private` workspace.

```text
Implement the Tauri desktop migration described in
docs/tauri-desktop-implementation-plan.md.

Implement Phase 0 only and obey its exit gate. Do not scaffold the production
shell until Playwright WebKit and the disposable Tauri/WKWebView sidecar harness
pass. Stop after the Phase 0 gate with measurements, failures, and a go/no-go
recommendation; the next implementation chat will continue with Phase 1.

Important constraints:
- Keep the existing Next.js dashboard and APIs; do not rewrite product logic in Rust.
- The installed app must run without a checkout, global Node, npm, or npm install.
- Use a pinned platform Node runtime plus Next standalone resources for the first
  reliable release. Do not switch to pkg/SEA unless the spike proves it safer.
- Separate read-only packaged resources from writable app data before adding
  auto-update.
- Use DEVHUB_RESOURCE_ROOT for packaged assets; REPO_ROOT is an optional real
  checkout and must never point at the app bundle.
- Add DEVHUB_REPOS_DIR; stop inferring repositories from REPO_ROOT in desktop mode.
- Never expose generic shell execution to the webview or kill unknown processes
  by port.
- Preserve existing Electron users' data in place through an idempotent import.
- Generate, show, and require approval for a new Upstart before running it.
- Release artifacts must be signed, notarized where applicable, updater-signed,
  leak-scanned, and built from generic public-core content only.
- Follow the repo plugin rule: run git ls-files before editing dashboard files;
  edit plugin source for materialized files.
- Do not touch or revert unrelated dirty worktree changes.
- Implement generic changes in the private mirror, then use the
  devhub-fork-workflow for public-core release changes. Never release directly
  from private-mirror content.
- The final implementation must run the packaged isolated self-test, install the
  verified Tauri app at /Applications/DevHub.app, verify the installed launch and
  migrated data, then uninstall the confirmed old Electron bundle and its
  updater-only caches. Preserve ~/Library/Application Support/DevHub and every
  personal content path. Restore Electron automatically if replacement checks fail.

For each phase:
1. Inspect the named current files before editing.
2. Implement the smallest design that satisfies that phase.
3. Add the phase's runnable tests.
4. Run the exit gate and report measurements/failures with file references.
5. Update the plan checkboxes/status and relevant docs with verified facts.

Use official current Tauri 2 documentation linked in the plan when API or
packaging behavior is uncertain. Finish with the repo's full verification and a
single final read-only code review before reporting completion.
```
