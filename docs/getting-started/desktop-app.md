---
title: The desktop app
description: Install and run DevHub as a native macOS app — no terminal, no checkout required.
order: 3
icon: Monitor
tags: [setup, desktop]
related:
  - architecture/desktop-shell
  - guides/desktop-recovery
---

# The DevHub desktop app

DevHub ships as a macOS application. You do not need a terminal, a copy of this
repository, or Node.js installed — the app brings its own.

## Installing

1. Download the latest `DevHub_*.dmg` from
   [Releases](https://github.com/jmcelreavey/devhub/releases/latest).
2. Open it and drag DevHub to Applications.
3. Launch it.

### "DevHub can't be opened because Apple cannot check it"

Builds are currently signed **ad-hoc**, which means macOS can confirm the app
has not been tampered with but cannot confirm who made it. Gatekeeper blocks
double-clicking on that basis.

Right-click the app → **Open** → **Open**. macOS remembers the decision, so this
is a one-time step.

This goes away once releases are signed with an Apple Developer ID. Until then
it is the honest trade-off: no Apple Developer Program membership, one extra
click on first launch.

## First launch

The window shows a short startup screen while DevHub starts its own server.
Two to five seconds is normal on first launch. If it takes longer or fails,
you will get a real error, the last few log lines, and buttons to retry, open
the logs, or quit — not a blank window.

Then setup asks for three things:

**What do you want DevHub for.** This only decides which of the later steps you
are shown. Every feature stays available regardless; a wrong answer costs
nothing.

**Your code folder.** The directory your projects live in — `~/Developer`,
`~/code`, whatever you use. DevHub looks one level inside it for Git
repositories and tells you how many it found. **It never writes anything
there.** Leaving it empty is fine if you are here for notes and tasks.

**Which tools you have.** Git, GitHub CLI, Docker, cloud CLIs, agent CLIs. Only
Git is required, and only if you picked a code-related goal — everything else
unlocks a specific feature and is described by what it unlocks. DevHub shows
you install commands; it never runs a package manager for you.

Progress is saved after every step, so quitting halfway and coming back does not
start you over.

## Coming from the old Electron app

On first launch DevHub notices an existing installation and offers to import it.

It shows you every location it found — your notes, tasks, collections, Upstart
scripts, docs, and personal identity — with the real paths and file counts, and
for each one you choose:

- **Keep it where it is.** DevHub points at your existing folder. Nothing is
  copied. This is the default if your data lives in a Git checkout with a
  remote, because copying would fork your notes away from the history you push.
- **Copy it into the app.** DevHub takes a copy into its own data folder. The
  default for a checkout you were only using to run DevHub.

Configuration — Jira, Datadog, Calendar, and so on — is imported automatically.
Anything DevHub does not recognise is written to
`config/imported-unrecognised.env` for you to read, rather than being loaded
blind.

**Your old installation is never modified.** Nothing is moved and nothing is
deleted. If the import goes wrong you have lost nothing, and you can run it
again — it records what it did, so a second run is not a second copy.

## Where your data lives

```
~/Library/Application Support/DevHub/
  config/.env.local     your settings and API tokens
  notes/  tasks/  collections/  upstarts/  docs/
  persona/identity.txt  your AI tone/identity file
  logs/                 startup and service logs
```

This directory is **never replaced by an update**. The app's own files live
inside `DevHub.app` and get replaced wholesale every time; your data does not
live there and cannot be affected by it.

If you chose "keep in place" during migration, the relevant folders stay
wherever they already were and DevHub simply points at them.

## Updates

DevHub checks for an update shortly after it finishes starting — never during
startup, and never in a dialog you have to dismiss before working. If one is
available, a banner appears at the top of the window.

You choose when to download, and you choose when to restart. A failed update
leaves the version you are running completely untouched.

Updates are cryptographically signed. If a downloaded update does not verify,
it is refused rather than installed.

You can also check manually: **DevHub → Check for Updates…**

## Running your projects

Pick a repository, and DevHub either finds an existing Upstart script or offers
to generate one with your agent CLI.

**A generated script is always shown to you before it runs.** You read it, and
you approve it. That approval covers those exact bytes — if the script is
regenerated or edited afterwards, it goes back for review rather than silently
inheriting your earlier approval.

Scripts are stored in DevHub's own folder, not inside your repository, so
nothing unexpected appears in your `git status`.

## When something goes wrong

**"Port 1337 is in use by another program."** Something else is already
listening — often a `npm run dev` you left running. DevHub will not kill it,
because on a developer's machine that port belongs to your own work at least as
often as it belongs to DevHub. Quit the other program and hit Retry.

**"Another DevHub is already using port 1337."** You have a second copy
running. Use the window that is already open.

**The window shows a startup error.** Click **Open logs**. The last twenty lines
are also shown in the window itself. Logs are at
`~/Library/Application Support/DevHub/logs/`; grab `shell.log`, `sidecar.log`,
and `renderer.log` when reporting the failure.

**The terminal will not connect.** The terminal is deliberately unavailable when
you open DevHub from another device over your network — it hands out a real
shell, and that is not something to expose to a network. Use it on the machine
DevHub is running on.

**Nothing works and you want to start clean.** Quit DevHub and move
`~/Library/Application Support/DevHub/config` aside. Your notes and tasks are in
sibling folders and are not affected.

## Uninstalling

Delete `/Applications/DevHub.app`.

Your data in `~/Library/Application Support/DevHub` is left alone deliberately —
deleting an app should not delete your notes. Remove that folder by hand if you
genuinely want it gone.
