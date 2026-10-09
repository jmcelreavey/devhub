---
title: Getting started without Git
description: Install the DevHub app on Mac or Windows and start using it straight away. No fork, no Git knowledge, and no GitHub account needed until you want a backup.
order: 0
icon: Rocket
tags: [setup, desktop]
related:
  - getting-started/faq
  - getting-started/desktop-app
  - architecture/desktop-windows-wsl
---

# Getting started without Git

You can install DevHub, open it and start writing notes and tasks without a GitHub
account, a fork, or any Git commands. A private GitHub backup is a later, optional
step that DevHub does for you with one button.

This guide is for the installed desktop app. If you would rather run DevHub from source,
see [Installation](installation.md).

## What you need

| | Mac | Windows |
| --- | --- | --- |
| System | macOS 13 or later | Windows with WSL 2 and an Ubuntu distro, plus WebView2 (the installer fetches it if missing) |
| Installer | `.dmg` (Apple Silicon or Intel) | `-setup.exe` |
| Node.js and GitHub CLI | Included in the app | Included in the installer |
| Git | Not included. Needed for **Plugins → Add from GitHub** and the optional backup | Not included. Needed for plugins and the optional backup, and it must be inside Ubuntu |

DevHub does not bundle Git. **Plugins → Add from GitHub** needs it, and so does the optional private backup. On a Mac, **Install Git** runs `xcode-select --install`. Nothing else in day-to-day notes and tasks needs it.

## Install on a Mac

1. Drag **DevHub** into **Applications** and eject the DMG, then double-click **DevHub** in **Applications**.
2. macOS says **"DevHub" Not Opened** (Apple could not verify it is free of malware). Click **Done**. Don't click **Move to Trash**.
   Open **System Settings → Privacy & Security**, scroll down to **Security**, and click **Open Anyway** next to *"DevHub" was blocked to protect your Mac*.
   In the next dialog click **Open Anyway** again, then enter your Mac password (or use Touch ID). You only do this once.
   On macOS 15 and later, right-click → Open no longer gets past this.
3. Wait a few seconds for the start-up screen. The setup wizard opens.

## Install on Windows

1. Run the `-setup.exe`. It installs DevHub for your Windows user only, so it does not
   ask for administrator rights, and it installs WebView2 if your PC lacks it.
2. Windows may show **Windows protected your PC**. DevHub's installer is deliberately not
   signed with a paid publisher certificate, so Windows cannot recognise the publisher.
   If you trust where you downloaded the file, choose **More info**, then **Run anyway**.
   On a work PC, Smart App Control or your organisation's policy can block unsigned apps
   with no way past the prompt. Ask your administrator rather than turning protection off.
3. On first launch, DevHub runs inside WSL 2. If you do not have WSL and Ubuntu yet,
   choose **Set up Windows support**. Windows asks for administrator permission once and
   installs both. Finish Ubuntu's account setup, restart if Windows asks, and open DevHub
   again. If you already have a WSL 2 Ubuntu, DevHub uses it.

Your notes and tasks live inside the Ubuntu distro, not on the `C:` drive. See
[Windows app](../architecture/desktop-windows-wsl.md) for why, and for what has been
tested.

## First run

The setup wizard asks what you want DevHub for, which tools you have, and where your code
lives. Every step can be skipped. **Set up later** in the top corner closes the wizard and
leaves Setup available in the toolbar. Progress is saved after each step.

From that point, DevHub already works. Notes, tasks and diagrams are saved in DevHub's own
data folder on your computer. Nothing is uploaded.

## Optional: back up to a private GitHub repo

Do this when you want a backup, a history of your changes, or the same content on a second
machine. You can do it on day one, or never.

1. Open **Setup → GitHub** (or choose **Set up private repo** on the strip at the top of
   Today).
2. **Sign in with GitHub.** DevHub uses the GitHub CLI it ships with, so you install
   nothing for this.
3. If Git is missing you will see **Git isn't installed**, an **Install Git** button on a Mac, and
   a **Re-check Git** button. On a Mac that runs `xcode-select --install`; on Windows
   run the command in your Ubuntu terminal.
4. Choose **Create my private DevHub repo**.

DevHub then creates a private repository named `devhub-private` in your GitHub account,
downloads the DevHub code into a new folder, copies your current notes, tasks and
diagrams into it, and pushes them. You never fork anything: a fork of a public repo stays
public on GitHub, so DevHub makes an independent private copy instead. The public DevHub
code stays attached as `upstream`, and your private repo is `origin`. Your original files are
left where they are, and passwords and tokens are not copied. When it finishes, quit and
reopen DevHub to start using the new folder.

### If the name or folder is taken

DevHub checks GitHub and your disk before it changes anything, then offers only what can
work:

| What it finds | What you are offered |
| --- | --- |
| A private repo with that name that already has content | **Clone my private repo** to download it, **Link** a checkout you already have, or create a new repo under a free name such as `devhub-private-2` |
| A public repo with that name | Only a free name. DevHub never puts your content in a public repo. Rename or delete the public one on GitHub if you want the original name |
| An empty private repo with that name, such as one left by an interrupted attempt | It is reused |
| A folder already at the suggested location that is not a DevHub checkout | A different folder or a free name. DevHub will not write into it |
| A DevHub checkout already at the suggested location | **Link my existing checkout** |

**Use a different name or folder, or a repo I already have** lets you choose these by hand.
If setup fails before your content is pushed, DevHub removes the new local folder it
created, so you can try again.

### Linking a checkout you already have

If you already keep DevHub in a Git checkout, choose **Link existing checkout**. DevHub
uses the notes and tasks already in it and does not import what is in the app's data
folder. In this app the link is not completely free of GitHub: the checkout's `origin`
must be a github.com repository, and DevHub asks GitHub whether that repository is
private. It refuses a public one.

Day-to-day syncing afterwards is ordinary Git against `origin`. See the
[FAQ](faq.md#can-i-use-gitlab-or-bitbucket).

### If you skip it

The Today page shows a strip: *Your notes and tasks are stored only on this computer. A private
GitHub repo gives them a backup and a history. It's optional.* Choose **Set up private
repo** to continue, or **Not now** to dismiss it for good. It appears only after setup is
finished, and disappears once a repo is linked.

Until a repo is linked, features that need a Git checkout, such as the sync button in the
top bar and **Sync skills**, report "No linked git checkout". Notes, tasks and the rest
of the app are unaffected.

## Updating

Choose **DevHub → Check for Updates…** (also in the tray menu). DevHub also
checks shortly after it starts, and shows a banner if something is available. You choose
when to download and when to restart. Updates are signed, and a failed update leaves the
running version untouched. Your data folder is never replaced by an update.

If you linked a private repo, the checkout can be ahead of the installed app. Rebuild
from it with:

- **Windows:** **Rebuild from Checkout…** in the tray or View menu, which opens
  **System → Maintenance** where **Pull and rebuild** runs.
- **Mac:** **View → Rebuild Dashboard…**.

Without a linked checkout there is nothing to rebuild from, so **Check for Updates** is the
only route.

## When something goes wrong

See [The desktop app](desktop-app.md#when-something-goes-wrong) and
[Desktop recovery](../guides/desktop-recovery.md). The [FAQ](faq.md) covers the common
questions.
