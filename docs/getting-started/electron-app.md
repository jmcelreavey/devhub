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
