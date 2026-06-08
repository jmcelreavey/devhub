# DevHub Launcher

Local Electron launcher for DevHub.

## Usage

From the repo root:

```sh
npm run electron
```

The launcher can:

- show whether the dashboard (`1337`), OpenChamber (`1336`), and OpenCode (`1338`) ports are reachable
- run or rerun `npm install --prefix ./dashboard`
- start either `npm run dev` or `npm run start`
- reuse an existing dashboard if port `1337` is already serving
- restart DevHub by stopping local listeners on `1337`/`1336`/`1338` first (macOS/Linux)
- open the dashboard in an Electron window at `http://localhost:1337`
- check for packaged app updates from GitHub Releases (`Tools` → `Check for Updates`)

`npm run dev` and `npm run start` use the dashboard `concurrently` scripts: Next.js on `1337`, and chained peer services via `dashboard/scripts/start-peer-services.ts` (OpenCode on `1338`, then OpenChamber on `1336` with `OPENCODE_SKIP_START`). Standalone helpers remain in `start-opencode.ts` and `start-chamber.ts`.

Logs only include processes started by this launcher. If DevHub is already running from an existing terminal, the launcher can detect/open/restart it, but it cannot attach to that process's stdout retroactively.

## Build And Install

From `electron-wrapper/`:

```sh
npm run build
npx electron-builder --mac --arm64 --dir
rm -rf /Applications/DevHub.app
cp -R release/mac-arm64/DevHub.app /Applications/
open /Applications/DevHub.app
```

The packaged app uses native Electron dialogs for startup choices, then opens the real DevHub web app at `http://localhost:1337`. There is no bundled control-panel frontend.

## Updates

The packaged app uses `electron-updater` and the GitHub Releases provider configured in `package.json`.

Release requirements:

- Build a signed/notarized release artifact when distributing beyond local use.
- Publish both the macOS `dmg` and `zip` artifacts plus the generated update metadata from `electron-builder`.
- Bump `version` in `electron-wrapper/package.json` before publishing a new update.

Local development builds do not auto-update. The app shows this if you use `Tools` → `Check for Updates` while running through `npm run electron`.

## Notes

- On macOS, launch the installed app from `/Applications/DevHub.app`, or use `npm run electron` from this repo for development.
- On Windows/WSL, run the command from the same environment that can run the dashboard normally. The launcher uses the repo root scripts, so it inherits the existing dashboard setup.
- Phone access still uses the dashboard's `/status` page QR code. The phone and laptop must be on the same network, and your local firewall must allow inbound traffic to port `1337`.
