---
title: FAQ
description: Short answers about GitHub, forks, other Git hosts, privacy and updating the DevHub app.
order: 5
icon: LifeBuoy
tags: [setup, faq]
related:
  - getting-started/guided-setup
  - getting-started/desktop-app
---

# FAQ

## Do I need GitHub?

No. The desktop app works as soon as it is installed, and keeps your notes, tasks and
diagrams in its own data folder on your computer. GitHub is only needed for the optional
private backup, and only if you use the one-click creation. See
[Getting started without Git](guided-setup.md).

Without a linked checkout, the top-bar sync button and **Sync skills** report "No linked
git checkout". Everything else is unaffected.

## Do I need to know Git?

No. Create, clone and link are buttons. Git itself only has to be installed for the backup
step. DevHub does not bundle it, but tells you if it is missing and shows a command to
copy.

## Do I need a fork?

No. A fork of a public repo cannot be made private on GitHub, so DevHub does not use one.
**Create my private DevHub repo** makes an independent private repository in your account.
The public DevHub code is kept as the `upstream` remote and your private repo is `origin`.
App updates come from DevHub releases, not from your repo.

## Can I use GitLab or Bitbucket?

For syncing, yes. Once a checkout is linked, DevHub's content sync runs ordinary Git
(`fetch`, `pull --rebase`, `push`) against whatever `origin` points to.

For setup, not through the app's buttons. **Create**, **Clone** and **Link** only accept a
github.com repository (HTTPS or SSH), and they use the GitHub CLI to confirm that it is
private. There is no button for another host. A GitLab or Bitbucket user can clone the DevHub
code by hand, point `origin` at their host, and enter that folder as the checkout in
**Setup → Core paths**. DevHub cannot check the privacy of a non-GitHub remote, so that is
up to you. This route is not covered by DevHub's tests, so treat it as unsupported.

## Is my data safe on GitHub?

The repo DevHub creates is private, and DevHub re-checks that it is private immediately
before it pushes your content. It copies notes, tasks, collections, Upstart scripts, reps
and diagrams. Integration credentials stay in the app's local config and are not copied.

## Why does Windows warn me about the installer?

The Windows installer is not signed with a paid publisher certificate, so SmartScreen
cannot recognise the publisher. Choose **More info**, then **Run anyway**, if you trust
where you got the file. The macOS app is likewise not notarised; use **Open Anyway** in
**System Settings → Privacy & Security**. Updates are verified separately against
DevHub's own release key. See [The desktop app](desktop-app.md#unsigned-installers).

## Why does Windows need WSL 2?

On Windows the window is a native app, but the DevHub server, terminal and agent tools run
inside a WSL 2 Ubuntu distro, so they see a normal Linux home and Git. If you have no
WSL, **Set up Windows support** installs it. See [Windows app](../architecture/desktop-windows-wsl.md).

## Where is Git for the backup on Windows?

Inside Ubuntu. Run the install command that DevHub shows in your Ubuntu terminal (Ubuntu
images usually have Git already). Installing Git for Windows does not help, because DevHub
runs in WSL.

## How do I update?

Choose **DevHub → Check for Updates…**. If a newer version exists, DevHub shows a banner;
you decide when to download and restart. If you also keep a linked private checkout that
is ahead of the installed app, rebuild it from there: **Rebuild from Checkout…** on
Windows (then **Pull and rebuild** under **System → Maintenance**), or **View → Rebuild
Dashboard…** on a Mac. Both need a linked checkout. See
[Updating](guided-setup.md#updating).

## Will an update erase my notes?

No. Your data folder is separate from the app's own files and is never replaced by an
update. Uninstalling the app also leaves it in place.

## How do I link a repo later?

Open **Setup → GitHub**, or use **Set up private repo** on the Today strip.
