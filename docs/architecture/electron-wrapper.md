# Electron Wrapper Architecture

The Electron wrapper is an optional desktop launcher for DevHub.

It starts and manages the local dashboard rather than replacing it.

## Responsibilities

| Responsibility   | Description                                          |
| ---------------- | ---------------------------------------------------- |
| Locate DevHub    | Finds the repo or bundled app resources              |
| Start services   | Runs the dashboard in development or production mode |
| Open a window    | Loads the local dashboard URL in a native window     |
| Manage processes | Restarts or stops dashboard, OpenChamber, OpenCode; restart also clears terminal peer on `1339` |
| Port health      | Probes `1337` / `1336` / `1338` / `1339` before start/restart |
| Show logs        | Provides a simple log viewer for launched processes  |
| Auto-update      | Packaged builds check GitHub Releases via `electron-updater` |

## How It Fits

```text
Electron app
  -> starts DevHub scripts
  -> waits for dashboard to be ready
  -> opens local dashboard in a BrowserWindow
```

The browser and Electron app both use the same dashboard.

## When It Helps

The wrapper is useful when you want a native app experience, a single launcher, or simple controls for restarting DevHub services.

It is not required for development.

## Packaging

The wrapper can be packaged for desktop platforms. Packaged builds include the launcher and enough project resources to start DevHub locally.

CI release builds trigger on version tags (`v*`) and publish macOS DMG plus Linux deb/AppImage artifacts from `electron-wrapper/`.

## OpenChamber Environment

When the launcher starts OpenChamber directly, it sets `OPENCODE_SKIP_START=true` and `OPENCODE_PORT` so Chamber uses DevHub's shared OpenCode on port `1338`, matching `dashboard/scripts/start-chamber.ts`.

## Contributor Notes

Keep the wrapper focused on process management. Most product features should live in the dashboard, not in Electron-specific UI.
