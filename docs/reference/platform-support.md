---
title: Platform support
description: Which platforms run DevHub fully, partially, or read-only.
order: 4
icon: MonitorSmartphone
tags: [reference]
related:
  - getting-started/installation
---

# Platform Requirements

DevHub is designed for local developer machines.

## Supported Platforms

| Platform          | Support Level          | Notes                                                |
| ----------------- | ---------------------- | ---------------------------------------------------- |
| macOS             | Primary                | Best-supported local development path                |
| Windows with WSL2 | Supported              | Use WSL for the repo and Node environment            |
| Linux             | Supported              | Works best with standard Node and Git tooling        |
| iOS and iPadOS    | Read-only or light use | Useful through LAN/PWA access, not for local scripts |

## Required Tools

| Tool        | Purpose                                     |
| ----------- | ------------------------------------------- |
| Node.js 22  | Runs dashboard and tooling (see `.nvmrc`)   |
| npm 10      | Bundled with Node 22; `npm install` refuses other majors |
| Git         | Repo sync, notes history, and status checks |

## Optional Tools

| Tool          | Enables                                   |
| ------------- | ----------------------------------------- |
| GitHub CLI    | PR tracking and GitHub-based standup data |
| 1Password CLI | Local secret loading workflow             |
| AWS CLI       | Optional infrastructure plugin helpers    |
| kubectl       | EKS-related workflows                     |
| Datadog keys  | Datadog alert/event integration           |

## Network Requirements

Local-only use needs only localhost access.

LAN use requires DevHub to bind to a LAN-accessible address and your firewall to allow the relevant ports.

Do not expose DevHub directly to the public internet without adding authentication.

## WSL Notes

LAN traffic hits **Windows** first, so Windows must accept and route it before DevHub's LAN mode (see [Setup](../getting-started/setup.md#localhost-vs-lan-access)) is reachable from other devices.

**Mirrored networking (recommended, Windows 11 22H2+).** Add this to `%USERPROFILE%\.wslconfig`, then `wsl --shutdown` and reopen your distro:

```ini
[wsl2]
networkingMode=mirrored
```

You may need Microsoft's [Hyper-V firewall rules](https://learn.microsoft.com/en-us/windows/wsl/networking#mirrored-mode-networking) once. Other devices use your **Windows** Wi‑Fi/Ethernet IPv4.

**Default NAT mode.** From an **elevated** Windows PowerShell:

```powershell
powershell.exe -ExecutionPolicy Bypass -File "\\wsl$\YOUR_DISTRO_NAME\home\YOU\dev\devhub\scripts\wsl\forward-devhub.ps1"
```

That sets a `netsh` portproxy for ports `1337` and `1336` plus a firewall rule. Re-run it after a reboot if devices can't connect.
