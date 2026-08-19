---
title: Desktop recovery
description: "When the desktop app will not start: a triage order, and how to prove each fix worked."
order: 12
icon: LifeBuoy
tags: [desktop, troubleshooting]
related:
  - contributing/desktop-development
  - getting-started/desktop-app
---

# Desktop recovery

What to do when the desktop app will not start, and how to prove each fix
worked. Every scenario here has been deliberately triggered and verified.

**Your data is never the thing that broke.** Notes, tasks, collections,
Upstarts, docs and settings live in
`~/Library/Application Support/DevHub/` (or wherever you pointed them during
migration), which the app only ever appends to. Nothing below asks you to touch
them, and nothing below will lose them.

## First: read the actual error

DevHub does not show a blank window on failure. It shows what went wrong, the
last twenty log lines, and three buttons: **Try again**, **Open logs**, **Quit**.

Full logs:

```
~/Library/Application Support/DevHub/logs/
```

Grab `shell.log` (desktop), `sidecar.log` (server/service output), and
`renderer.log` (dashboard-to-Tauri bridge events such as external-link opens).
Each rotates at 2 MB and keeps one previous `.log.1` file.

## The port is in use

DevHub decides **who** holds a port from the listener's process tree (`lsof`),
not from whatever the port answers with. A stale `next start` from your checkout
used to claim `{ devhub: true }` and send you hunting for a second app window
that did not exist — the shell now classifies holders as **yours** (this
checkout's dev server), **another packaged app**, or **someone else's process**.

> Port 1337 is held by a leftover DevHub development server (PID …) from your
> checkout. DevHub can stop it and carry on, or you can attach to it instead
> from View → Attach to Dev Server…

A `npm run dev` or `next start` you left running from the linked checkout.
Click **Try again** — DevHub offers to stop only listeners it has verified as
*your* checkout's server, never a stranger's process.

> Another DevHub is already using port 1337. Quit it, or use the window that is
> already open.

A packaged `DevHub.app` instance really is running (the listener's ancestor
chain includes the app bundle). Use that window, or quit it first.

> Port 1337 is in use by PID … (…). DevHub will not stop another program's
> process — quit it, then Retry.

Something else owns the port. Identify it manually when needed:

```bash
lsof -nP -iTCP:1337 -sTCP:LISTEN
```

DevHub deliberately does not kill arbitrary listeners. On a developer's machine
port 1337 belongs to your own work at least as often as it belongs to DevHub.

## It starts, then fails

Look at the log for the sidecar's own output. Common causes:

**A bad value in `config/.env.local`.** Move it aside and restart:

```bash
mv ~/Library/Application\ Support/DevHub/config/.env.local \
   ~/Library/Application\ Support/DevHub/config/.env.local.bak
```

You will need to re-enter integration credentials. Your notes and tasks are in
sibling directories and are untouched.

**A content directory that no longer exists.** If you chose "keep in place"
during migration and later moved or deleted that folder, DevHub is pointing at
nothing. Fix the path in `config/.env.local`, or re-run migration from Settings.

## Is the app itself broken?

The shipped binary can check itself, against a **temporary** data directory —
it never reads or writes your real data:

```bash
/Applications/DevHub.app/Contents/MacOS/devhub-desktop --self-test
```

Nine checks: staged resources, the bundled Node runtime, sidecar startup,
authenticated health, that an unauthenticated request is *rejected*, a storage
round-trip, the PTY listening, no listener left behind, and that writes stayed
inside the temporary directory.

If this passes, the app is fine and the problem is configuration or environment.
If it fails, it names the failing check — reinstall from Releases.

## An update failed

A failed update leaves the running version completely untouched — Tauri stages
the replacement and only swaps on success. The banner offers **Try again** and
**Open release page**.

If updates keep failing, download the latest DMG manually. Your data is not
affected by reinstalling.

Updates are refused if their signature does not verify. That is working as
intended, not a bug to route around — there is deliberately no "install anyway".

## The terminal will not connect

**Over the network:** expected. Port 1339 is an unauthenticated PTY and is
never exposed to your LAN. Use the terminal on the machine running DevHub.

**Locally:** check the log for `rejected connection`. The handshake requires a
short-lived ticket and an exact-origin match. If you reached the dashboard by an
address other than `127.0.0.1:1337` or `localhost:1337`, the origin check fails
by design.

`missing or expired terminal ticket` after the app has been open a long time is
usually a stale page — reload the window (View → Reload) so it fetches a fresh
ticket.

## Processes left behind

Should not happen — the shell signals the process group it created, and the
self-test verifies nothing is left holding a port. If it does:

```bash
pgrep -fl "DevHub.app/Contents/MacOS/devhub-desktop"
pgrep -fl "supervisor.mjs"
```

Kill those PIDs specifically. Do **not** kill by port; you may not own what is
listening.

## Going back to a previous version

Tauri only updates upward — there is no in-app downgrade, deliberately.

Download the older DMG from Releases and install it over the current one. Your
data is version-independent and will be picked up as-is.

## The dashboard looks stale after `git pull`

The installed `.app` ships a **frozen** Next.js build inside `Contents/Resources/server/`. Reopening DevHub does **not** recompile your checkout — you are still running the dashboard that was baked in at install time until you rebuild.

| Situation | Fix |
| --------- | --- |
| Installed app, you pulled dashboard changes | **View → Rebuild Dashboard…** (or **Status → Rebuild & restart** when the shell is *not* supervising the server). The boot page shows a log panel while Rust runs `desktop/scripts/rebuild-installed-server.mjs`, stages a fresh production build from your linked checkout, and relaunches. |
| Installed app, active development | **View → Attach to Dev Server…** and run `npm run dev` in the checkout instead — hot reload without rebuilding the bundle. |
| Browser / checkout `npm run dev` | Restart the dev server, or run `npm run restart` for a production build on port 1337. |

`POST /api/status/dashboard/rebuild` is intentionally unavailable when `DEVHUB_SHELL_SUPERVISED=1` (the desktop sidecar owns the process). Use the menu rebuild in that case — see [Dashboard — Status page runbook](../architecture/dashboard.md#status-page-runbook).

If rebuild fails, open **View → Show Logs** or **System → Logs** (`/logs`) for compiler output before retrying.

## Rebuilding from source

If you have the repository:

```bash
npm run desktop:doctor    # what's missing and how to fix it
npm run desktop:build     # build and ad-hoc sign
npm run desktop:selftest  # verify before installing
npm run desktop:install   # replace /Applications/DevHub.app
```

`desktop:install` fingerprints every content location before and after, refuses
to touch anything that is not the DevHub bundle it expects, and **restores your
previous app automatically** if any check after the swap fails. Use
`--dry-run` to see what it would do without changing anything.

## Nuclear option

```bash
rm -rf /Applications/DevHub.app
```

Then reinstall. `~/Library/Application Support/DevHub` survives on purpose —
deleting an app should not delete your notes. Remove it by hand only if you
genuinely want your data gone.
