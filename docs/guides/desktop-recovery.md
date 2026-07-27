---
title: Desktop recovery
description: "When the desktop app will not start: a triage order, and how to prove each fix worked."
order: 15
icon: LifeBuoy
tags: [desktop, troubleshooting]
related:
  - guides/desktop-development
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

> Port 1337 is in use by another program. DevHub will not stop it — quit that
> program and try again.

Something else is listening. Most often a `npm run dev` from a checkout.

```bash
lsof -nP -iTCP:1337 -sTCP:LISTEN
```

Quit whatever that shows, then click **Try again**.

DevHub deliberately does not kill it. On a developer's machine port 1337
belongs to your own work at least as often as it belongs to DevHub, and a
launcher that kills your build to start itself is worse than one that asks.

> Another DevHub is already using port 1337.

A second copy is running — that one answered an authenticated health check.
Use the window that is already open, or quit it first.

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
