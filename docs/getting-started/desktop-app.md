---
title: The desktop app
description: Install DevHub on macOS or Windows and connect your own private Git repo.
order: 3
icon: Monitor
tags: [setup, desktop]
related:
  - getting-started/guided-setup
  - getting-started/faq
  - architecture/desktop-shell
  - guides/desktop-recovery
  - guides/macos-permissions
---

# The DevHub desktop app

The release pipeline builds a macOS `.dmg` and a Windows `-setup.exe`.
Both include DevHub's server, Node.js and GitHub CLI. Running the installed app
needs no development checkout, npm, Rust or compiler.

## Installing

Public installer releases have not been published yet. Build artifacts are
available from successful **Release desktop** workflow runs; tagged releases
will appear under [Releases](https://github.com/jmcelreavey/devhub/releases).

**macOS 13 or later:** choose the `.dmg` for Apple Silicon or Intel, open it,
drag DevHub to Applications, then launch it. The bundled GitHub CLI sets this
minimum version.

**Windows:** run the `-setup.exe`. It installs DevHub for your Windows user
and installs WebView2 if needed. On first launch, choose **Set up Windows
support** if asked. Windows installs WSL 2 and Ubuntu through its own
administrator prompt. Finish Ubuntu's account setup, restart if asked, then
open DevHub again. DevHub uses an existing user WSL2 distro when available.

Windows installs remain unverified on a clean Windows machine. See
[Windows app](../architecture/desktop-windows-wsl.md) for the current limits.

### Unsigned installers

DevHub currently ships without an Apple Developer ID or Windows publisher
certificate. These are optional for building and distributing installers, but
the operating system cannot verify the publisher.

**macOS:** the app has an ad-hoc signature and is not notarised. After trying
to open a download you trust, go to **System Settings → Privacy & Security →
Open Anyway**, then confirm **Open**. macOS saves an exception for that app.
See [Apple's instructions](https://support.apple.com/en-au/102445). Rebuilds can
also trigger permission prompts again; see
[macOS permissions](../guides/macos-permissions.md).

**Windows:** SmartScreen may show **Windows protected your PC**. For a download
you trust, choose **More info → Run anyway** when offered. Smart App Control or
an organisation's policy can block unsigned apps without offering that choice.
On a managed machine, ask your administrator; do not disable system-wide
protection to install DevHub. See
[Microsoft's explanation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

Updater signatures are separate: DevHub still verifies downloaded updates
against its own release key. They do not remove these operating-system prompts.

## First launch

The window shows a short startup screen while DevHub starts its own server.
Two to five seconds is normal on first launch. If it takes longer or fails,
you will get a real error, the last few log lines, and buttons to retry, open
the logs, or quit — not a blank window.

Then the setup wizard covers your goals, tools, folders and private Git repo:

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
you install actions and download links for your platform, including Cursor.
Install actions show the command and ask for confirmation in the terminal.
The optional Agents daemon needs npm and Safe-Chain; both are listed here.
Install npm through Node.js first, then Safe-Chain, set an Agents password in
setup, and choose **Agents → Connection → Set up**.

**Your private DevHub repo.** Sign in to GitHub, then create a private copy,
clone your existing private repo onto a new machine, or link a local checkout. Creating a copy keeps the public repo
as `upstream` and your private repo as `origin`, copies current notes, tasks,
collections, Upstarts, reps and root diagrams, and pushes them to the private
repo. Original files remain in place. Linking an existing checkout uses its
existing content without importing the current local content.

GitHub does not let a fork of a public repo become private, so this creates an
independent private copy. GitHub CLI is bundled. If Git is missing, use its
install action in **Tools** first. You can skip Git setup and work locally.

Quit and reopen DevHub after connecting. The content sync button commits and
pushes to your private repo; app updates still come from public releases.
Integration credentials stay in the app's local config and are not copied
into the repo by this flow.

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

### Git sync and linked checkouts

Notes, tasks, and other content in app-data work without a git checkout. **Pushing
content to git**, pulling updates, syncing `skills/shared/` from the tree, or
porting public-core changes requires a linked DevHub git checkout — attach one
through **Setup → GitHub → Your private DevHub repo**, during migration, or
via **View → Attach to Dev Server…** for development. Without
that link, the top-bar cloud sync button and **Sync skills** fail with "No
linked git checkout". See [Scripts — Linked checkout requirement](../reference/scripts.md#linked-checkout-requirement).

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

**"Port 1337 is held by a leftover DevHub development server…"** A `npm run dev`
or `next start` from your linked checkout is still listening. DevHub can stop
*only* that verified listener and continue, or you can attach to it from
**View → Attach to Dev Server…** instead.

**"Another DevHub is already using port 1337."** A packaged DevHub app is
actually running (detected from the process tree, not from the port's reply).
Use the window that is already open, or quit it first.

**"Port 1337 is in use by PID …"** Some other program owns the port. DevHub will
not kill it — quit that process and hit Retry.

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
