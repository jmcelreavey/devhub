# Electron App

DevHub includes an optional desktop app. It is a launcher and process manager for the local dashboard.

## What It Does

The Electron app starts DevHub, watches local service ports, opens the dashboard in a desktop window, and helps restart related processes.

It does not replace the dashboard. It runs the same local DevHub app you can open in a browser.

### Local Ports

| Port   | Service     |
| ------ | ----------- |
| `1337` | Dashboard   |
| `1336` | OpenChamber |
| `1338` | OpenCode    |

The launcher can detect whether each port is reachable, start `npm run dev` or `npm run start` when needed, and restart listeners on all three before relaunching.

The Electron app always opens the dashboard through `localhost`. LAN access is handled separately by DevHub's LAN proxy, so enabling network access does not make Electron chase the machine's Wi‑Fi or Tailscale IP.

## Start The App Locally

From the repo root:

```bash
npm run electron
```

The launcher will ask whether to start DevHub in development or production mode if the dashboard is not already running.

## Build The App

```bash
npm run electron:build
```

For distributable packages, run the Electron wrapper's packaging command from its own directory.

You can also build and install from the dashboard: **Setup → DevHub Desktop App → Build & Install**. That runs the same `electron-wrapper` dist step and places the artifact on this machine (see [Setup — DevHub Desktop App](setup.md#devhub-desktop-app-build--install)).

## When To Use It

Use the desktop app if you want:

- A native window for DevHub.
- Simple restart controls.
- A menu for launching or stopping related local services.
- A packaged app you can open without remembering terminal commands.

Use the browser if you prefer:

- The simplest development loop.
- Normal browser devtools and profiles.
- Direct control over the terminal process.

## Closing Behavior

Per-service quit behavior is configurable in the app menu (stored in `launcher-settings.json` under Electron user data):

| Setting                   | Default | Effect on quit                           |
| ------------------------- | ------- | ---------------------------------------- |
| Kill dashboard on close   | on      | Stops the Next.js dev/production process |
| Kill OpenChamber on close | on      | Stops the OpenChamber daemon on `1336`   |
| Kill OpenCode on close    | on      | Stops `opencode serve` on `1338`         |

Turn off individual toggles when you want DevHub to keep supported peer services running after closing the window. Note: OpenChamber is currently still stopped during launcher cleanup even if **Kill OpenChamber on close** is disabled.

Port cleanup uses graceful shutdown with a short wait, then `SIGKILL` fallback when a listener does not exit in time.

## Desktop App Actions

From the dashboard **Actions** page (when the native apps are installed):

- **Launch OpenChamber Desktop** — opens OpenChamber pointed at the existing DevHub OpenCode server (no second embedded OpenCode).
- **Launch OpenCode Desktop** — macOS only; opens `/Applications/OpenCode.app` if present.

## Auto-Updates

Packaged installs (`.dmg`, `.deb`, `.AppImage`) use `electron-updater` with GitHub Releases as the update provider.

| Context                        | Behavior                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| Packaged app                   | On launch, checks for a newer launcher version; prompts before download and before install |
| Manual check                   | **Tools** → **Check for Updates** in the app menu                                          |
| Local dev (`npm run electron`) | No auto-update; manual check explains that only packaged builds update                     |

Updates apply to the **Electron launcher**, not the dashboard code inside the repo. After installing a launcher update, DevHub still runs whatever dashboard version is in your local checkout (or bundled resources in a full release build).

Download is opt-in per prompt; `autoInstallOnAppQuit` applies the downloaded update when you quit.

## Releases

Tagged releases (`v*`) build macOS `.dmg` and Linux `.deb` / `.AppImage` artifacts via `.github/workflows/release.yml` in `electron-wrapper/`.

Publish both the macOS `dmg` and `zip` plus the `electron-builder` update metadata so packaged clients can find new versions. Bump `version` in `electron-wrapper/package.json` before tagging.

## Troubleshooting

### GUI PATH vs terminal PATH

A packaged or dock-launched Electron app inherits a **minimal `PATH`** — not the same environment as an interactive shell where `npm run dev` works. Symptoms:

- Launcher can't start DevHub (`npm` not found).
- Dashboard `preinstall` fails because `safe-chain` is missing.
- OpenChamber or other nvm-global CLIs are unreachable.

The launcher mitigates this in `electron-wrapper/src/main.ts`:

| Mitigation | Behavior |
| ---------- | -------- |
| nvm resolution | Sources `nvm.sh`, runs `nvm use` from the dashboard directory (reads `.nvmrc`, pinned to Node 22), prepends that node's `bin` to `PATH` |
| Safe-Chain search | Scans nvm bin dirs plus Homebrew/MacPorts/`~/.local/bin` and appends wherever `safe-chain` is found |
| Binary lookup | Peer-service commands are resolved beyond the inherited `PATH` using the same fallback dirs |

**Fixes that usually work**

1. Install Safe-Chain globally in the **same Node version** nvm selects for DevHub: `npm install -g @aikidosec/safe-chain@1.1.10` after `nvm use`.
2. Keep `openchamber` and other launcher-spawned tools on that node's global bin path.
3. Prefer **Build & Install** from Setup or `npm run electron` from a terminal when debugging — terminals inherit your shell rc; the GUI does not.
4. Check launcher logs for `[devhub] found safe-chain in …` or the warning when it is still missing.

### Blank window

If Electron shows a blank window but the browser works, confirm the dashboard is listening on the resolved port and that `PORT` in `.env.local` matches. See [Dashboard URL Resolution](#dashboard-url-resolution) above.
