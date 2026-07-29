---
title: Desktop shell
description: "The Tauri 2 wrapper: window lifecycle, the bundled Node server, and the updater."
order: 8
icon: AppWindow
tags: [architecture, desktop]
related:
  - contributing/desktop-development
  - getting-started/desktop-app
---

# Desktop shell (Tauri 2)

Status: **complete**. Phases 0–5 done; Electron removed 2026-07-26.
`/Applications/DevHub.app` is the Tauri build, migrated and verified.

- Users: [Desktop App](../getting-started/desktop-app.md)
- Developers: [Desktop Development](../contributing/desktop-development.md)
- When it breaks: [Desktop Recovery](../guides/desktop-recovery.md)

Outstanding: Apple Developer ID signing (builds are ad-hoc signed, so other
machines need right-click → Open), the canary N→N+1 update test on a clean
machine, and Windows targets.

## What Rust owns, and what it doesn't

Rust owns the window, the process tree, and the update client. It owns no
product logic — the dashboard is the same Next.js app, served over loopback,
and nothing was rewritten in Rust to get here.

```
DevHub.app
  devhub-desktop (Rust)
    window, menu, lifecycle, updater, native folder dialog
    picks and validates ports; never kills a process it did not start
    starts ONE Node sidecar process group
    waits for an authenticated health response
    loads http://127.0.0.1:1337 via a one-shot bootstrap URL

  Contents/MacOS/node          pinned Node 22, checksum-verified
  Contents/Resources/server    Next standalone output
  Contents/Resources/services  supervisor.mjs, terminal-pty-server.cjs, node-pty
  Contents/Resources/resources skills, agents, mcp, persona, docs (read-only)

  ~/Library/Application Support/DevHub   (writable, never replaced by updates)
    config/.env.local  notes/  tasks/  collections/  upstarts/  docs/
    persona/identity.txt  logs/
```

## The path contract

Three roots that used to be one variable. `REPO_ROOT` previously meant "the git
checkout", "where generic assets live", "where your notes live", and "the folder
above your other repos" simultaneously — which works exactly as long as the app
*is* a checkout.

| Variable               | Installed                          | Checkout (unchanged)             |
| ---------------------- | ---------------------------------- | -------------------------------- |
| `DEVHUB_RESOURCE_ROOT` | Read-only bundle resources         | Repo root                        |
| `DEVHUB_APP_DATA`      | OS app-data directory              | Repo root                        |
| `REPO_ROOT`            | Usually absent; optional checkout  | Repo root                        |
| `DEVHUB_REPOS_DIR`     | User's chosen code folder          | Parent of `REPO_ROOT`            |
| `DEVHUB_ENV_FILE`      | `<app-data>/config/.env.local`     | `dashboard/.env.local`           |
| `NOTES_DIR` and peers  | `<app-data>/<name>` or migrated    | `REPO_ROOT/<name>`               |
| `DEVHUB_IDENTITY_FILE` | `<app-data>/persona/identity.txt`  | `REPO_ROOT/persona/identity.txt` |

Implemented twice, deliberately: `dashboard/lib/desktop/runtime-paths.ts` and
`desktop/src-tauri/src/paths.rs`. Rust owns process startup, TypeScript owns
everything after it, and `sidecar_env()` is the single seam between them.

`getCheckoutRoot()` returns `null` unless the path actually contains `.git`.
That check is the point: without it, an installed app with `REPO_ROOT` pointed
at its own bundle would run `git status` against the application.

## Security posture

The page in the window is a **remote origin** (`http://127.0.0.1:1337`).
Anything the webview can call, that origin can call. "It's only localhost" is
not authentication: any process on the machine reaches the same port, and so
does any web page that can be made to fetch it.

- **Bootstrap token.** Rust mints 32 random bytes per launch and passes them
  only through the sidecar environment. It loads
  `/api/desktop/bootstrap?token=…` exactly once; that route compares in
  constant time, sets an `HttpOnly` `SameSite=Strict` cookie, and redirects to a
  clean URL so the token never reaches history or a `Referer` header.
- **Health is authenticated.** Something answering on 1337 is not evidence that
  DevHub is answering on 1337.
- **The PTY requires cookie *and* exact origin.** `SameSite` is not reliably
  applied to WebSocket handshakes, so the origin is checked too — exactly, not
  by prefix (`http://127.0.0.1.evil.com` starts with `http://127.0.0.1`).
- **Port 1339 is no longer LAN-proxied.** It hands out an interactive login
  shell. LAN mode exists so you can read your dashboard from a phone; it was
  never worth a remote shell.
- **No generic shell command is exposed.** The webview gets: boot state, recent
  logs, open-logs, a folder picker, desktop info, retry, and four updater
  commands. Nothing that takes an arbitrary path or command.
- **Never kill by port.** The sidecar and every descendant run in one process
  group. Shutdown signals that group. Port 1337 belongs to somebody's own dev
  server at least as often as it belongs to us.

## Release pipeline

`.github/workflows/release-desktop.yml`, triggered by a `v*` tag.

1. Leak-scan the source tree.
2. `inject-version.mjs` writes the tag version into `tauri.conf.json` and
   `Cargo.toml`. About and `/api/desktop/health` read it at runtime, so they
   cannot drift.
3. `stage-all.mjs` — verified Node runtime, allowlisted resources, Next
   standalone build.
4. **`verify-staging.mjs` — the gate, before signing.** Manifest completeness
   and digests, no personal-data directories, generic packaged identity, no
   credential-shaped files, no build-machine content in prerendered output.
5. `cargo fmt --check`, `clippy -D warnings`, `cargo test`.
6. `tauri-action` builds, signs, notarises (macOS when Apple secrets are set),
   and produces updater artifacts. Linux builds set `APPIMAGE_EXTRACT_AND_RUN=1`
   and `NO_STRIP=1` so AppImage packaging works on GitHub runners.
7. The built app runs its own `--self-test`.
8. `codesign --verify --deep --strict` and `spctl` on macOS.
9. `build-updater-manifest.mjs` generates `latest.json`, refusing to publish a
   platform entry with no signature.

### Secrets the workflow needs

| Secret                               | Purpose                                      |
| ------------------------------------ | -------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | Updater signing. **Back up offline.**         |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the above                        |
| `APPLE_CERTIFICATE`                  | Developer ID Application cert (base64 .p12)   |
| `APPLE_CERTIFICATE_PASSWORD`         | Password for the .p12                         |
| `APPLE_SIGNING_IDENTITY`             | e.g. `Developer ID Application: Name (TEAM)`  |
| `APPLE_ID` / `APPLE_PASSWORD`        | Apple ID + app-specific password              |
| `APPLE_TEAM_ID`                      | Team identifier for notarisation              |

Losing the updater private key permanently strands every installed client: a
new key cannot sign updates that old binaries will accept. It is the one secret
that needs an offline backup, not just a GitHub secret.

## Two leaks this pipeline found and now prevents

Both were real, both were in a bundle that built and ran perfectly.

1. **`dashboard/.env.local` inside the app.** Next copies `.env*` into
   `.next/standalone` and loads them at boot — correct for a server deployment,
   catastrophic here, where that file holds live Jira, Datadog, Google, and AI
   credentials. `stage-dashboard.mjs` now strips them and fails staging if any
   survive.
2. **Real note titles in prerendered HTML.** Next statically prerenders routes
   using the build machine's data, so `/notes` shipped as HTML listing the
   developer's actual notes. The desktop build now runs against an empty
   content tree, and `verify-staging.mjs` greps prerendered output for local
   content names (excluding ones the app hardcodes, like `personal-radar`).

## Measurements (macOS 26.5, arm64, 2026-07-26)

| Metric                        | Value  | Notes                                  |
| ----------------------------- | ------ | -------------------------------------- |
| `DevHub.app`                  | 243 MB | Electron 1.3.2 was 266 MB              |
| Bundled Node runtime          | 113 MB | Largest single component               |
| Next standalone server        | 129 MB | Traced dependency subset               |
| Packaged resources            | 880 KB | skills, agents, mcp, persona, docs     |
| Rust shell binary             | 4.7 MB | release, stripped, LTO                 |
| Updater artifact (`.tar.gz`)  | 70 MB  | signed                                 |

The bundle is smaller than the Electron app it replaces, which was not the
goal — reliability was — but it does retire the "Tauri will be 15 MB"
expectation. Shipping a known Node runtime is the reason, and it is the right
trade while `node-pty` is a native module and Next standalone traces a real
dependency graph.

## Verification status

Passing on this machine:

- 1239 Vitest tests, including 35 new path-contract and bootstrap-auth tests.
- 13 Rust tests; `clippy -D warnings` and `cargo fmt` clean.
- Playwright: 67 passing across Chromium and WebKit.
- Engine journeys in **WebKit**: BlockNote typing and `Selection.modify`,
  tldraw canvas geometry and pointer events, xterm mount/measure/input,
  detached-SVG text measurement, command palette, blob downloads.
- Packaged `--self-test` twice consecutively: staged resources, bundled runtime,
  authenticated health, unauthenticated request rejected, storage round-trip,
  PTY listening, no listener left behind, writes confined to temporary app data.

Live launch of the built `.app` (isolated app data, alternate ports):

- Starts its sidecar and serves the dashboard with no terminal interaction.
- A second launch exits immediately and hands off; one process remains.
- Quitting leaves zero shell processes, zero sidecar processes, and both ports
  released.

Found by the WebKit project and fixed: the skip link was unreachable by
keyboard, because WebKit omits links from the tab order unless macOS Full
Keyboard Access is on. Chromium never showed it.

Found by actually launching the app rather than only building it: the main
window was declared both in `tauri.conf.json` and in `setup()`, which panicked
with "a webview with label `main` already exists". The config's `app.windows` is
now empty on purpose — the window must be built in `setup()` so the navigation
guard is attached to the builder rather than to an already-navigable window.

## Migration and cutover, as performed

Verified on this machine on 2026-07-26:

- Migration detected the Electron install, its recorded checkout, and all six
  content locations — including the four that were only ever at an implicit
  default and which a config-only migration would have missed entirely.
- It correctly defaulted to **keep in place** (the checkout has a git remote,
  so copying would have forked the data away from its history) and copied only
  the personal identity file.
- Unrecognised `.env.local` lines were quarantined to
  `config/imported-unrecognised.env` rather than loaded.
- `install-local.mjs` fingerprinted six content locations before and after and
  confirmed all six byte-identical.
- Electron-only updater caches removed;
  `~/Library/Application Support/DevHub` and the shared
  `com.devhub.launcher` cache deliberately kept.

A third real bug surfaced here, and only because the migration was actually
run: the shell set `NOTES_DIR` unconditionally, so a user who chose "keep my
notes where they are" had that choice recorded and then ignored — opening the
app to an empty vault with their data untouched on disk. The fix splits the
sidecar environment into **infrastructure the shell owns** (app data, resource
root, ports, bootstrap token) and **defaults the user's config overrides**
(content directories). `desktop/sidecar/supervisor.test.mjs` covers both halves,
including that the config file cannot mint itself a bootstrap token.

## Still outstanding

- **Apple Developer ID.** Builds are ad-hoc signed: verifiable but not
  attributable, so Gatekeeper blocks double-click on any machine that did not
  build them. The release workflow already has the signing steps and skips them
  when the secrets are absent.
- **Canary N→N+1 update** on a clean machine or VM. The updater is wired,
  signed and its manifest generator refuses unsigned platform entries, but an
  actual version-to-version update has not been performed end to end.
- **Linux CI.** `release-desktop.yml` now builds on `ubuntu-22.04` (AppImage +
  `.deb`) with self-test on the runner. Staging strips foreign native binaries
  (wrong OS or musl-linked ELF on glibc) so `linuxdeploy` does not fail
  opaquely. End-user Linux install docs are still macOS-first.
- **Windows.** Deferred until Upstart execution has a native contract — the
  product runs `upstart.sh` through Bash today.
