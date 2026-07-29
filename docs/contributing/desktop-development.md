---
title: Working on the desktop app
description: "Everything under `desktop/`: staging, building, signing, and local installs."
order: 3
icon: Hammer
tags: [desktop]
related:
  - architecture/desktop-shell
  - guides/desktop-recovery
---

# Working on the desktop app

Everything under `desktop/`. The dashboard is unchanged — it is still a Next.js
app, still served over loopback, and no product logic lives in Rust.

## Prerequisites

```bash
npm run desktop:doctor
```

Tells you what is missing and the command to fix it. In short: Rust
(<https://rustup.rs>), the Tauri CLI
(`cargo install tauri-cli --version "^2" --locked`), Xcode command line tools,
and `npm install` having been run in `dashboard/`.

## Running against your checkout

The installed app can attach to a checkout dev server from **View → Attach to
Dev Server…**. It checks `http://localhost:1337/api/desktop/health` first; if
no process is listening, it starts `npm run dev` from the checkout recorded in
`~/Library/Application Support/DevHub/repo-path.txt`, waits up to 90 seconds
for health, then attaches. The app restarts against that server and keeps the
choice until **View → Use Packaged Server** is selected. Switching either way
is automatic: Attach stops the packaged sidecar before starting development;
Use Packaged Server stops a shell-managed development process, or a verified
DevHub checkout listener (matching the checkout's `dashboard/` cwd and known
Next/DevHub script), then waits for ports 1337 and 1339 before restarting.
Unknown listeners are left alone and produce a clear failure instead of killing
some unrelated server because it had the bad luck to choose the same port.

```bash
DEVHUB_DEV_SERVER_URL=http://127.0.0.1:1337 \
  /Applications/DevHub.app/Contents/MacOS/devhub-desktop
```

The shell skips the packaged sidecar entirely and loads your dev server, so you
get hot reload _inside the real window_ — which is the only way to work on the
boot page, the folder picker, or the update banner.

Attach first opens a small checkout-owned page that unregisters DevHub's
service worker and deletes its `devhub-*` caches before loading the app. This
matters because Packaged and Attach share `localhost:1337`: production static
assets are immutable and cacheable, but webpack development asset URLs are not.
Without this handoff, a cached stylesheet could make Attach show an older
working tree.

There is no bootstrap token in attach mode, so the bridge routes report browser
mode and the terminal falls back to origin checking. That is the same posture
`npm run dev` already has in a browser tab, which is why it does not weaken
anything.

Dashboard TypeScript, CSS, and `public/` assets hot reload in attach mode; no
desktop rebuild is needed. Rust shell, menu, boot-page, bundled Node/runtime,
or macOS icon/splash changes require `npm run desktop:build` followed by
`npm run desktop:install`.

## Collecting desktop logs

Use **View → Show Logs** in the desktop app, or open:

```text
~/Library/Application Support/DevHub/logs/
```

The directory contains bounded, rotating logs (the previous 2 MiB file ends in
`.log.1`):

- `shell.log` — desktop startup, window, and menu events.
- `sidecar.log` — packaged dashboard/service output, or output from a dev
  server the shell started while attaching.
- `renderer.log` — dashboard-to-Tauri bridge events, including external-link
  interception and `openInBrowser` detection, invocation, and failures.

`renderer.log` is written only when the dashboard is inside the Tauri webview.
In **Attach to Dev Server** mode it still captures bridge events, but if you
started `npm run dev` yourself, its server output remains in that terminal
rather than `sidecar.log`. A normal browser tab has no Tauri bridge, so it
cannot write `renderer.log`.

After an external link or toast CTA fails, reproduce it once, then attach
`renderer.log`, `shell.log`, and `sidecar.log` (plus matching `.log.1` files if
the failure was not recent). The renderer log records timestamps, bridge phase,
URL host, and a scrubbed error message; it deliberately does not record URL
paths, query strings, or credentials.

## The loop

```bash
npm run desktop:stage     # build the dashboard + stage everything the bundle needs
npm run desktop:dev       # stage, then run the shell with a live window
npm run desktop:build     # stage, build a release bundle, ad-hoc sign it
npm run desktop:selftest  # run the built app's own --self-test
npm run desktop:verify    # the pre-signing gate (leak checks, manifest)
npm run desktop:install   # replace /Applications/DevHub.app, safely
```

Staging takes a couple of minutes because it runs a full Next production build.
If you are only changing Rust, stage once and then use `cargo` directly in
`desktop/src-tauri/`.

```bash
cd desktop/src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
cargo fmt
```

## How a launch actually works

1. Rust creates the window (hidden) and loads a self-contained boot page.
2. It creates the app-data tree at `0700` and checks ports 1337 and 1339. If
   either is occupied it **stops and says so** — it never kills a listener.
3. It mints a random 32-byte bootstrap token and spawns
   `services/supervisor.mjs` with the bundled Node, in its own process group.
4. The supervisor loads `DEVHUB_ENV_FILE`, starts the Next standalone server
   and the PTY server, and emits one JSON line per state change on stdout.
5. Rust polls `/api/desktop/health` **with the token** until it answers. A port
   that merely accepts connections is not enough — that is how you get a white
   window.
6. It navigates to `/api/desktop/bootstrap?token=…`, which swaps the token for
   an `HttpOnly` cookie and redirects to `/`.
7. On quit, it signals the process group it created. Nothing else.

## Staging pipeline

`desktop/scripts/stage-all.mjs` runs three steps:

**`stage-node-runtime.mjs`** downloads the Node runtime pinned in
`desktop/node-runtime.json`, verifies it against a committed SHA-256, extracts
only `bin/node`, and names it with the Rust target triple Tauri expects.

**`stage-resources.mjs`** copies generic assets using an **allowlist**. This
repo is the private mirror — notes and a personal identity file are committed
next to the code — so a denylist would be one forgotten pattern away from
shipping somebody's notes in a public installer. It also writes
`MANIFEST.json` with a digest per file.

**`stage-dashboard.mjs`** builds Next with `output: "standalone"` (gated on
`DEVHUB_DESKTOP_BUILD=1`), flattens the output, copies `.next/static` and
`public`, bundles the PTY server with esbuild, and stages the matching
`node-pty` prebuild.

Two things it does that are not obvious, and both exist because they were real
leaks found in a bundle that otherwise looked perfect:

- **It deletes every `.env*` from the standalone output.** Next bundles those
  and loads them at boot. Correct for a server deployment; here it meant
  `dashboard/.env.local` — live Jira, Datadog, Google and AI credentials —
  ended up inside the `.app`.
- **It builds against an empty content tree.** Next prerenders static routes
  using the build machine's data, so `/notes` shipped as HTML listing the
  developer's actual notes.

## The pre-signing gate

`npm run desktop:verify` runs before anything is signed, in CI and locally:

1. Every staged resource file is in the manifest, and digests match.
2. No personal-data directory (`notes/`, `tasks/`, `collections/`, `upstarts/`).
3. The packaged identity is the generic default, not somebody's real one.
4. No credential-shaped files anywhere in the bundle.
5. No build-machine content in prerendered HTML.

A signed public release cannot be taken back. That is the whole reason this
runs before signing rather than after.

## `--self-test`

The shipped binary can verify itself:

```bash
/Applications/DevHub.app/Contents/MacOS/devhub-desktop --self-test
```

It uses a **temporary** app-data directory and kernel-assigned ports, so it
never reads or touches real user data. It checks staged resources, the bundled
runtime, sidecar startup, authenticated health, that an _unauthenticated_
request is rejected, a storage round-trip, the PTY listening, and that nothing
is left holding a port afterwards.

CI runs it on every build. `install-local.mjs` runs it twice — once on the
build, once from `/Applications` after installing.

## Cutting a release

Tag and push:

```bash
git tag v2.1.0 && git push origin v2.1.0
```

`.github/workflows/release-desktop.yml` does the rest: leak scan, version
injection, staging, the pre-signing gate, Rust checks, build + sign + notarise,
self-test, signature verification, and `latest.json` generation.

### Secrets

| Secret                               | Purpose                                   |
| ------------------------------------ | ----------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | Signs updates. **Back this up offline.**  |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the above                    |
| `APPLE_CERTIFICATE`                  | Developer ID cert, base64 `.p12`          |
| `APPLE_CERTIFICATE_PASSWORD`         | Password for the `.p12`                   |
| `APPLE_SIGNING_IDENTITY`             | `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` / `APPLE_PASSWORD`        | Apple ID + app-specific password          |
| `APPLE_TEAM_ID`                      | Team identifier                           |

The Apple secrets are optional — without them the build still succeeds and
skips signing and notarisation. The result is ad-hoc signed and needs
right-click → Open on any machine that did not build it.

The updater key is **not** optional in the same way. Losing it means installed
clients can never be updated again: a new key produces signatures the old
binaries reject, by design. It lives in the GitHub secret, in
`~/.tauri/devhub-updater.key`, and should live in one place that is neither.

### Adding a target

1. Add the Node artifact and its verified SHA-256 to `desktop/node-runtime.json`.
2. Add a matrix leg to `release-desktop.yml`.
3. Run the packaged `--self-test` on that architecture before advertising it.

Do not advertise a target you have not self-tested. Cross-compiled bundles
build cleanly and fail at runtime for reasons that only appear on the target
machine.

## Path contract

Two implementations of one contract, because Rust owns process startup and
TypeScript owns everything after it:

- `dashboard/lib/desktop/runtime-paths.ts`
- `desktop/src-tauri/src/paths.rs`

`sidecar_env()` is the single seam between them. If you add a path, add it in
both and add a test asserting it resolves under app data — the property that
makes auto-update safe is that **nothing writable resolves inside the resource
root**, which gets replaced wholesale on every update.

In a checkout everything falls back to the old behaviour, so `npm run dev` is
unchanged.

## Security notes for contributors

The page in the window is a **remote origin**. Anything the webview can call,
that origin can call, and "it's only localhost" is not authentication — any
local process reaches the same port, and so does any web page that can be
tricked into fetching it.

Practical consequences when adding a feature:

- **Do not add a command that takes an arbitrary path or command string.** The
  existing commands are narrow on purpose: `open_logs` opens one known
  directory; `pick_folder` returns a path _the user chose in an OS dialog_.
- **New desktop bridge routes must check `isAuthenticatedDesktopRequest`.**
- **The terminal WebSocket requires a ticket _and_ exact origin.** Not the
  bootstrap cookie — WKWebView does not attach it to a `ws://` handshake on a
  different port, and assuming it did shipped a completely broken terminal. The
  dashboard fetches a short-lived ticket over same-origin HTTP (where the cookie
  works) and passes it on the WebSocket URL. Origin checks must compare exactly:
  `http://127.0.0.1.evil.com` starts with `http://127.0.0.1`.
- **Never LAN-proxy port 1339.** It is an unauthenticated PTY.
- **Never kill a process merely because it owns a port.** Mode switching may
  stop only a listener verified as this checkout's DevHub development server.

## Testing

```bash
npm run verify                                    # lint, typecheck, ~1280 tests, build
npm run test:e2e --prefix dashboard               # Chromium + WebKit
npx playwright test --project=webkit --prefix dashboard
cd desktop/src-tauri && cargo test
```

WebKit is not optional. The desktop app renders in the OS webview — WKWebView
on macOS, WebKitGTK on Linux — so a Chromium-only suite tests an engine the
product does not use. It has already caught a real defect: the skip link was
unreachable by keyboard, because WebKit omits links from the tab order unless
macOS Full Keyboard Access is enabled.
