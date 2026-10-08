---
title: Windows WSL2 setup (design note)
description: "Can the Windows installer enable and configure WSL2 the way Docker Desktop does? What it takes, what needs admin and a reboot, and what DevHub should never touch."
order: 14
icon: AppWindow
tags: [architecture, desktop, windows, design]
related:
  - architecture/desktop-windows-wsl
  - architecture/desktop-shell
---

# Windows WSL2 setup (design note)

Status: **research and recommendation. Nothing here is implemented**, and this
note changes no installer code. It answers one question: can DevHub's Windows
installer enable and configure WSL2 as part of setup, the way Docker Desktop
does?

Short answer: **yes, but not inside the NSIS installer.** DevHub already has the
right shape, a per-user installer plus an elevated, consented WSL step in the
app. The work is to harden that step, not to move it.

## How sure each claim is

Microsoft Learn and Docker's docs were not reachable from the environment this
note was written in (network egress was blocked), so those pages were read only
as search-result excerpts. Claims are tagged:

- **[repo]** read in this repository's code.
- **[docs]** seen in a Microsoft or Docker documentation excerpt.
- **[reported]** from forum posts or third-party guides; plausible, not authoritative.
- **[recalled]** from background knowledge only. **Verify on a real machine
  before building on it.** Each is repeated under [Open questions](#open-questions).

## What `wsl --install` does

On Windows 10 version 2004 (build 19041) or later, and on Windows 11 **[docs]**:

1. Enables the optional components *Windows Subsystem for Linux* and *Virtual
   Machine Platform* **[docs]**.
2. Downloads and installs the current WSL package and Linux kernel, and makes
   WSL 2 the default version **[docs]**.
3. Installs a distribution, Ubuntu unless `-d <name>` says otherwise, and a
   reboot "may be required" **[docs]**.

Microsoft's instructions are to run it from an **elevated** PowerShell and then
restart **[docs]**. The page also says the bare command **only works when WSL is
not installed at all**; otherwise it prints help, and you add a distro with
`wsl --list --online` and `wsl --install -d <name>` **[docs]**.

Flags that matter to us **[docs]**: `--no-distribution` (enable WSL, install no
distro), `--no-launch` (install the distro but do not open it), `-d` /
`--distribution`, `--web-download` (fetch from the web instead of the Store; the
suggested fix when the download hangs at 0.0%), `--location`, and `--inbox`
(install WSL as a Windows component instead of the Store package; only valid
when WSL is not yet installed).

| Step | Admin | Reboot |
|------|-------|--------|
| Enable WSL + Virtual Machine Platform features | Yes **[docs]** | Usually yes. Scripts treat exit codes 3010 and 1641 as "succeeded, restart pending" **[reported]** |
| Install or update the Store WSL package (`wsl --update`) | Possibly; a UAC prompt is reported on some machines **[recalled]** | Not for the package; a running VM needs `wsl --shutdown` to pick it up **[recalled]** |
| Install a distro once WSL is already enabled (`wsl --install -d Ubuntu`) | Not known to be required **[recalled]** | No |
| Create the Linux user (Ubuntu's first run) | No | No, but it is **interactive** |
| BIOS/firmware virtualization | Cannot be done from Windows at all | Yes (firmware) |

Things `wsl --install` cannot fix: virtualization disabled in firmware (WSL
reports it as a Virtual Machine Platform or `0x80370102`-style error
**[recalled]**), a hypervisor that blocks nested virtualization, and a Group
Policy or managed device that forbids optional-feature changes or the Store. A
build whose image lacks the `VirtualMachinePlatform` feature fails with
`0x800f080c` **[reported]**.

## What Docker Desktop does

Docker's Windows installer is the best-known precedent. What can be stated:

- **Backend and privileges.** WSL 2 is the default backend and "works for most
  users without administrator privileges"; Hyper-V is available only with an
  all-users install **[docs]**. So a per-user Docker install is possible **only
  because WSL is already enabled** (my inference: enabling the Windows features
  is the part that needs admin, per Microsoft's instructions).
- **Version floor.** It needs a recent WSL, 2.1.5 or later by one guide
  **[reported]**. When WSL is older, Docker runs `wsl --update` itself. Users
  report that call failing on builds that reject the `--web-download` flag it
  passes **[reported]**. Docker's own moderators point out that "I have v2 distros"
  does not prove WSL is current; `wsl --version` is the check **[reported]**.
- **Its own distro.** It creates a private `docker-desktop` distro (formerly also
  `docker-desktop-data`) **[reported]**. This is why DevHub's `choose_distro`
  skips `docker-desktop*` and `rancher-desktop*` **[repo]**.
- **`wsl --shutdown` hurts it.** Users trace "WSL distro terminated abruptly" to
  something shutting the WSL VM down underneath Docker **[reported]**. Relevant to
  the do-not list below.
- **Reboot and resume.** Installing the features ends with a restart prompt
  **[reported]**. I could not confirm from a primary source whether Docker
  schedules itself to resume after the restart. My recollection is that it does
  **not**: the user opens Docker Desktop again and its first start does the
  remaining work **[recalled]**. The precise installer commands and any
  registered resume task are likewise unverified.

What to take from it: the precedent is *consent, one elevation, restart if
Windows asks, then continue on next launch*. It is not silent, and it does not
bundle WSL itself.

## How DevHub installs today

All **[repo]**.

**The installer is per-user and unelevated.** `tauri.windows.conf.json` sets NSIS
`installMode: currentUser` and `webviewInstallMode: downloadBootstrapper` (silent
WebView2). The only NSIS hooks, `desktop/src-tauri/windows/installer-hooks.nsh`,
are `PREINSTALL` (stop DevHub's own app and its own WSL supervisor) and
`POSTINSTALL` (keep a deleted Desktop shortcut deleted). Neither touches Windows
features. The Tauri updater runs the same installer with `installMode: passive`.

**WSL is handled on first launch, not at install time.** `run_wsl_startup`
(`lib.rs`) calls `wsl::resolve_backend`:

1. `wsl -l -v` (`list_distros`). Failure to run `wsl.exe` becomes "WSL is not
   installed".
2. `choose_distro`: an explicit `DEVHUB_WSL_DISTRO` / `wsl-distro.txt`, else the
   default WSL 2 distro, else the first one. `docker-desktop*` and WSL 1 are never
   picked. A WSL-1-only machine gets "run `wsl --set-version <distro> 2`" as text.
3. `ensure_running` boots the distro, then `$HOME` is read from it.

When there is no WSL, or no user distro, and nothing was chosen explicitly, the
failure carries `install_available`. The boot page shows **Set up Windows
support**, which calls the `install_wsl` command. It is only honoured while the
boot state is the failure that offered it. `wsl::launch_installer` runs:

```
powershell Start-Process %SystemRoot%\System32\wsl.exe
  -ArgumentList '--install','-d','Ubuntu' -Verb RunAs
```

That raises one UAC prompt and leaves Windows' own console visible, because the
restart and Ubuntu's username prompt cannot be completed by a hidden process. The
page then tells the user to finish setup, restart if asked, and reopen DevHub or
press Try again. There is **no automatic resume** after a restart.

Existing installs are respected: with any user distro present the install is
never offered, and `desktop-windows-wsl.md` states that DevHub "does not convert
or replace existing distros".

`desktop-windows-wsl.md` lists this "Set up Windows support" path as **not yet
verified on a machine without WSL**. Everything below is therefore a design
against an untested path.

CI builds a single target, `x86_64-pc-windows-msvc`, with an x64 Linux payload
(`release-desktop.yml`). Windows on ARM is not shipped, so this note is x64 only.

## Why not enable WSL from the NSIS installer

It is tempting, since that is where "installer" lives. It is the wrong place:

1. **It forces elevation onto every install and update.** Features need admin.
   `currentUser` with no UAC is a deliberate property, and the updater re-runs
   this installer passively on every update. A UAC prompt or a reboot there would
   be hostile and would break unattended (`/S`) installs.
2. **WSL is machine state, not app state.** The user may already have it, with
   their own distros and Docker's. The right moment to decide is when DevHub
   learns what is actually there, which it does at launch.
3. **A reboot ends the installer.** NSIS cannot show progress across a restart,
   and the user would come back to a finished-looking install that cannot run.
4. **The interesting step is interactive.** Ubuntu's first run asks for a username
   and password. No installer can do that for the user, and DevHub should not.
5. **It cannot be tested in CI.** The Windows runner has no nested virtualization
   to exercise the feature enablement.

An optional, off-by-default NSIS page that merely *explains* the requirement is
fine. Doing the enablement there is not recommended.

## Recommended approach

Keep the installer as it is. Make the in-app step an explicit, resumable
readiness check.

### 1. Classify the machine instead of guessing from one error

Replace "`wsl.exe` failed, so WSL is missing" with a small set of states the boot
page can word precisely and act on. Each is decided from `wsl --status` /
`wsl --version` / `wsl -l -v` exit codes and text, not by matching English
(`parse_distro_list` already skips header text because it is localised):

| State | Meaning | Offered action |
|-------|---------|----------------|
| `Ready` | A usable WSL 2 user distro with a normal user | Continue |
| `NoWsl` | Features or WSL package absent | **Set up Windows support** (elevated) |
| `NoDistro` | WSL present, only internal distros (`docker-desktop`) | Install Ubuntu (see below) |
| `RestartPending` | Features enabled, restart not done | **Restart now** / "I'll restart later" |
| `UserSetupIncomplete` | Distro registered, no Linux user created | "Open Ubuntu to finish". See the root-home risk. |
| `Wsl1Only` | Only WSL 1 distros | Explain; never convert (unchanged) |
| `VirtualizationOff` | Firmware or hypervisor blocks WSL 2 | Explain with a link; nothing to run |
| `Blocked` | Policy or Store unavailable | Show the error; link to Microsoft's manual and offline steps |

On `wsl.exe`: current Windows ships a `wsl.exe` stub even when WSL is not
enabled **[recalled]**, so "could not run `wsl.exe`" may rarely fire, and the
raw output then reaches the user. The new classification should not depend on it.

### 2. One elevation, two calls, a restart in between

- **Enable:** elevated `wsl.exe --install --no-distribution`. This turns on both
  features and installs the WSL package without choosing a distro for the
  user. Treat exit 0 as done and 3010/1641 as `RestartPending`. Wait for the
  elevated process to exit and read the code, rather than the current
  fire-and-forget `Start-Process` without `-Wait`.
- **Distro:** once enabled, `wsl.exe --install -d Ubuntu` (a different distro only if the
  user picks one). Whether this second call needs elevation is open. Do not
  elevate it unless it is shown to be necessary.
- **Do not use `--no-launch`.** It would skip Ubuntu's account creation and leave
  a distro whose default user is root. DevHub would then install itself into
  `/root`.
- **Do not hardcode a Store-only path.** If the Store is unavailable, offer
  `--web-download` as the fallback Microsoft documents.

The current one-shot `wsl --install -d Ubuntu` is also acceptable and is one UAC
prompt. Splitting it is only worthwhile if testing shows the distro step runs
unelevated, because that is what lets DevHub show real progress and restart
state between the two.

### 3. Resume after the restart without an installer

- Windows' own distro finishing step after a restart is **Microsoft's** to run
  **[recalled]**; DevHub does not need to reproduce it.
- DevHub should resume *itself*. Two options, in order of preference:
  1. **Do nothing special.** The boot page says to reopen DevHub, as it does
     today, and the state machine makes the next launch land on the right step
     (`UserSetupIncomplete` instead of a generic failure).
  2. **A per-user `HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce` value**
     written by the app, only after an elevated step reported a pending restart
     and only with the user's consent. It needs no admin and runs once. The app
     must poll and wait on a half-finished Ubuntu rather than fail, since it may
     start before the Ubuntu window finishes.
- Never register a scheduled task or a permanent Run key for this.

### 4. Keep the user informed and in control

- Say what will happen before the UAC prompt: it enables two Windows features,
  installs Ubuntu, may need a restart, and takes a few minutes.
- Show **Restart now** and **Later**; never restart the machine for the user.
- Keep the failure reasons honest: virtualization disabled is a firmware setting,
  not something DevHub can fix, and the text should say so plainly.
- Silent and updater installs (`/S`, passive) must never reach this code.

### 5. Minimum WSL version

Add a version check (`wsl --version`) next to the distro checks and decide a
floor from what DevHub actually uses. Known candidates: systemd support
(`/etc/wsl.conf`, Paseo's `systemd --user` unit), `localhostForwarding`, and
mirrored networking. `wsl --update` is offered, with consent, only when below the
floor. See the do-not list: it changes WSL for every distro and for Docker.

## What DevHub should deliberately not do

- **Never remove, unregister or reset anything WSL.** No `wsl --unregister`,
  `wsl --uninstall`, `wsl --terminate` on a distro we did not start, and no
  deleting `docker-desktop`, Rancher or user distros. This includes the
  uninstaller: uninstalling DevHub leaves WSL, every distro, and the user's
  `~/.local/share/devhub` content alone (that data is theirs; a separate, explicit
  "delete my data" action is a different feature).
- **Never convert or replace a distro.** No `wsl --set-version`, no
  `--import`/`--export` round-trips, no renaming. Today's behaviour (explain and
  stop) stays.
- **Never change the default distro** (`wsl --set-default`) or the default WSL
  version silently. `wsl --install` sets WSL 2 as the default; that is
  Microsoft's behaviour and should be disclosed before the prompt.
- **Never run `wsl --shutdown`** automatically. It stops every distro, including
  Docker Desktop's, which then reports its VM "terminated abruptly" **[reported]**,
  and it ends the user's other terminals. If a restart of the WSL VM is needed
  (for a new `.wslconfig`, or after `wsl --update`), say so and let the user do
  it.
- **Never edit `.wslconfig`, `/etc/wsl.conf`, the user's shell rc files or
  Windows firewall/Hyper-V settings automatically.** Systemd, `localhostForwarding`
  and `[interop]` are already documented as known gaps; show the exact line to
  add and let the user apply it.
- **Never enable more than the two features.** No Hyper-V, no "Windows Hypervisor
  Platform", no Containers, no Hyper-V Services.
- **Never touch firmware/BIOS settings,** and never claim virtualization is on
  without WSL saying so.
- **Never elevate the app or the installer permanently.** No
  `requireAdministrator` manifest, no per-machine install, no elevated
  background service. The elevation is a single, visible `RunAs` for one
  `wsl.exe` call.
- **Never create the Linux account for the user, or accept `root` as the home.**
  Ubuntu's own setup creates the user. `resolve_backend` currently accepts any
  `$HOME` beginning with `/`, which includes `/root`; treat a root default user
  as `UserSetupIncomplete`.
- **Never silently reboot, and never reboot from a silent install.**
- **Never fetch anything from a mirror we invent.** Distro and WSL packages come
  from Microsoft's own channels (`wsl --install`, the Store, or Microsoft's
  documented `--web-download`).
- **Never claim the machine is ready on an old-state cache.** Re-probe at each
  launch; a user can remove a distro at any time.

## Open questions

Each needs a real Windows test, ideally a throwaway VM per row.

1. **Does `wsl --install -d Ubuntu` need elevation once WSL is enabled?** This
   decides whether the two-call design is worth it. **[recalled]**
2. **What does `wsl.exe` print, and exit with, on a machine with no WSL, a
   machine with features enabled but a restart pending, and one with WSL but no
   distro?** The state classifier depends on these, and none was observed. Note
   the output is UTF-16 on stderr and stdout (`decode_wsl_output`) and localised.
3. **Does Windows resume the distro install after a restart on its own?** If so,
   how, and does that window race DevHub's relaunch? **[recalled]**
4. **What is the default user when Ubuntu's account creation is interrupted?**
   Expected `root`, which `resolve_backend` would accept. **[recalled]**
5. **Does `wsl.exe --exec` in the NSIS `PREINSTALL` hook boot the distro VM?**
   Any `--exec` call does (see `ensure_running`), so installing or updating on a
   machine with WSL may start a stopped distro just to run `pkill`. Harmless
   today, but worth confirming and, if cheap, guarding with a "running?" check.
6. **What WSL version should the floor be?** Needs a list of the features DevHub
   depends on and the first release that has each.
7. **Windows 10.** Which builds does the Store WSL package support, and how much
   of the 19041-era manual path (a separate kernel update MSI) do we still owe
   users? Docker's own supported floor is a useful guide, but the page I could
   read is a search excerpt (22H2 / build 19045) **[reported]**.
8. **Managed machines.** What do Group Policy or MDM-locked devices show? Is
   `--web-download` or Microsoft's offline MSI worth documenting?
9. **Restart prompt UX.** Should DevHub offer a one-click restart (`shutdown /r`
   with a countdown) or only instruct? The note leans to a button the user
   presses, never automatic.
10. **Docker coexistence.** If Docker Desktop's WSL 2 backend is active, does the
    elevated `wsl --install` or a later `wsl --update` disturb it? Test with
    Docker running.
11. **Windows on ARM.** Out of scope while CI ships x64 only, but `wsl --install`
    works there; decide before an ARM build is considered.

## Verification plan

Before any code lands: a clean Windows 11 VM and a Windows 10 22H2 VM with
nested virtualization on, plus one with it off. On each, record the output and
exit code of `wsl --status`, `wsl --version`, `wsl -l -v`, `wsl --install
--no-distribution` and `wsl --install -d Ubuntu` (elevated and not), and what
survives a restart. This answers questions 1 to 4 and 7 directly, and gives
the state table above real fixtures for unit tests, in the style of
the existing `parse_distro_list` tests. Also update the "Not verified" list in
[Windows app (WSL2)](desktop-windows-wsl.md) when the no-WSL path has been run.
