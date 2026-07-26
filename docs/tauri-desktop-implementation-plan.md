# Tauri desktop migration and first-run experience

Status: implementation-ready plan

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

| Variable           | Installed value                           | Development fallback    |
| ------------------ | ----------------------------------------- | ----------------------- |
| `REPO_ROOT`        | Read-only packaged resource root          | Current checkout root   |
| `DEVHUB_ENV_FILE`  | `<app-data>/config/.env.local`            | `dashboard/.env.local`  |
| `DEVHUB_REPOS_DIR` | User-selected code folder                 | Parent of `REPO_ROOT`   |
| `NOTES_DIR`        | `<app-data>/notes` or migrated path       | `REPO_ROOT/notes`       |
| `TASKS_DIR`        | `<app-data>/tasks` or migrated path       | `REPO_ROOT/tasks`       |
| `COLLECTIONS_DIR`  | `<app-data>/collections` or migrated path | `REPO_ROOT/collections` |
| `UPSTARTS_DIR`     | `<app-data>/upstarts` or migrated path    | `REPO_ROOT/upstarts`    |
| `DOCS_DIR`         | `<app-data>/docs` or migrated path        | `REPO_ROOT/docs`        |
| `DEVHUB_DESKTOP`   | `1`                                       | unset                   |

Keep `REPO_ROOT` for checkout compatibility because existing MCP, sync, plugin,
and terminal commands consume it. Stop using its parent as an implicit repos
folder. `DEVHUB_REPOS_DIR` is the one new path concept the UI needs.

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
   definitions. Generated tool configs must point to the packaged Node runtime
   and staged server, not to `npm` or a source checkout.
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
Tauri updater signing key backup, and Windows signing provider. An unsigned build
can be a development artifact, never a first-class public installer.

### Phase 0: baseline and risk spikes

Goal: answer the two questions capable of killing the migration before adding a
real shell.

Tasks:

- Add a WebKit project to `dashboard/playwright.config.ts` and install WebKit in
  `.github/workflows/verify.yml`.
- Run the existing smoke suite against Chromium and WebKit.
- Add focused WebKit journeys for BlockNote editing, tldraw pointer interaction,
  xterm input/resize/clipboard behavior, Mermaid rendering, command palette,
  file downloads, OAuth redirects, and external links.
- Add `output: "standalone"` behind `DEVHUB_DESKTOP_BUILD=1` in
  `dashboard/next.config.ts`.
- Create a throwaway staging script that builds the standalone server, copies
  static/public assets, launches it with a pinned Node runtime, hits a dedicated
  health route, and shuts it down.
- Verify on macOS arm64 first, then Linux x64. Verify macOS x64 and Windows x64
  before claiming support for those artifacts.
- Record actual installer size, cold start, idle RSS, and time-to-first-window.
  Replace the estimates in `ROADMAP.md` with measurements.

Exit gate:

- Core editor/canvas/terminal journeys pass in WebKit or every failure has a
  small accepted fix.
- The staged server runs on a clean machine without global Node/npm.
- Closing the supervisor leaves no listener on `1337` or `1339`.
- A failed startup returns a useful status and log instead of a blank window.

Stop condition:

- Stop the migration if BlockNote or tldraw has a core WebKit failure without a
  reasonable fix, or if standalone tracing requires shipping the development
  dependency tree.

### Phase 1: separate installed resources, user data, and repositories

Goal: make auto-update safe before building auto-update.

Tasks:

- Add `DEVHUB_ENV_FILE` support to
  `dashboard/lib/dashboard-env-local.ts`; create parent directories with `0700`
  and write the file with `0600` permissions where supported.
- Add `DEVHUB_REPOS_DIR` to `dashboard/lib/repos/index.ts#getReposScanDir` with
  the current parent-of-`REPO_ROOT` behavior as the development fallback.
- Add it to the managed setup schema/status/save flow and rename the setup field
  from ambiguous "Repo root" to "Code folder".
- Keep `REPO_ROOT` out of the normal installed-user form. It is an internal app
  resource path in desktop mode.
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

### Phase 2: Tauri shell and sidecar lifecycle

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
- Add an authenticated `/api/desktop/health` response with an instance token
  passed only through the sidecar environment. The Rust shell must not treat an
  arbitrary service on `1337` as DevHub.
- Give the dashboard and terminal/WebSocket bridge a per-launch session token
  and validate both token and `Origin`. Localhost is transport, not an
  authentication mechanism; an arbitrary web page must not be able to drive the
  user's PTY on `1339`.
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

Exit gate:

- Fresh app launch reaches the dashboard with no terminal interaction.
- Second launch focuses the existing window.
- External URLs never replace the dashboard.
- Normal quit, forced sidecar failure, app crash, and update restart leave no
  owned child process or bound port.
- Startup failure UI shows the last useful log lines, Retry, Open Logs, and Quit.

### Phase 3: first-run and migration wizard

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
   - Stream phases and logs in the dashboard: analyze, generate, review, install
     dependencies, start services, health check.
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
- Present the discovered paths before import. Copy configuration into
  `DEVHUB_ENV_FILE`; keep notes/tasks/collections/Upstarts at their existing
  paths. Do not move or delete source data.
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
- Existing Electron configuration imports twice without duplication or data
  movement.

### Phase 4: signed installers, updater, and update UX

Goal: make installation and upgrades trustworthy and boring.

Packaging targets:

- macOS: signed/notarized/stapled DMG plus updater tarball. Build arm64 first;
  add x64 or universal only after testing the Node/native sidecar for that target.
- Linux: AppImage for updater support plus `.deb` for native installation.
- Windows: NSIS user-level installer first; MSI only if an actual deployment
  customer needs it. Do not make users require admin for a per-user app.

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
- Windows: sign the installer before calling it first-class. Use Azure Artifact
  Signing or another maintained certificate path; unsigned SmartScreen warnings
  are a release blocker.
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
- Add rollback documentation. Tauri compares versions upward by default; do not
  enable downgrades in code unless an incident requires a deliberately signed
  rollback release.

Release gates:

- `npm run verify`, Chromium/WebKit E2E, `cargo test`, `cargo clippy -- -D warnings`,
  and `cargo fmt --check` pass.
- macOS: `codesign --verify --deep --strict`, `spctl -a -vv`, notarization, and
  staple validation pass on the downloaded DMG/app, not just the CI workspace.
- Windows: signature validates and a clean Windows account installs without an
  avoidable SmartScreen/UAC mess.
- Linux: AppImage launches on the oldest supported distro and updates while
  preserving app data.
- Version N to N+1 update passes for each advertised OS/architecture.
- Release notes include installer choice, supported OS/architecture, migration
  note, and manual recovery link.

### Phase 5: cutover and cleanup

Goal: remove dual-shell debt only after Tauri is proven.

Tasks:

- Run Tauri and Electron in parallel for at least one canary release cycle.
- Publish the final Electron 1.x release with an in-app Tauri migration notice
  and direct signed-installer link.
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
- Tauri build smoke on macOS and Linux; Windows once supported.

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
- Keyboard, screen reader, reduced motion, 200% zoom, and narrow window.

### Manual release checklist

- Install from the downloaded release artifact on a clean OS account.
- Verify publisher identity and OS trust UI.
- Complete the wizard without opening a terminal.
- Generate and run one Upstart after reviewing the script.
- Quit and confirm all DevHub-owned child processes exit.
- Relaunch and confirm state/data persist.
- Apply the canary update and repeat the checks.

## Risks and decisions

| Risk                                        | Decision/mitigation                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Next standalone misses dynamic/native files | Make it Phase 0; assert required staged files and run on clean machines.                                                  |
| `node-pty` breaks packaging/signing         | Ship target-specific native module, test terminal E2E, sign nested binary. Port to Rust only if this remains the blocker. |
| WKWebView differs from Chromium             | WebKit CI and focused editor/canvas/terminal journeys before shell work.                                                  |
| Auto-update overwrites personal data        | All writes go to OS app data or explicit external paths; update test checks checksums.                                    |
| Localhost page gets powerful Tauri IPC      | Exact main-window origin, minimal capabilities, narrow custom commands, no generic shell access.                          |
| A website connects to the local PTY         | Per-launch token plus strict WebSocket origin validation; never expose the terminal through LAN mode.                     |
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

Work phase by phase and obey every exit gate. Start with Phase 0 only; do not
scaffold the full shell until WebKit and the packaged Next sidecar spike pass.
After a phase passes, continue to the next phase unless a documented stop
condition is hit. Keep commits/changes phase-sized and keep Electron working
until the signed Tauri canary update has passed.

Important constraints:
- Keep the existing Next.js dashboard and APIs; do not rewrite product logic in Rust.
- The installed app must run without a checkout, global Node, npm, or npm install.
- Use a pinned platform Node runtime plus Next standalone resources for the first
  reliable release. Do not switch to pkg/SEA unless the spike proves it safer.
- Separate read-only packaged resources from writable app data before adding
  auto-update.
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
