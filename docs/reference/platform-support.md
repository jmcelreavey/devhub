---
title: Platform support
description: Which platforms run DevHub locally.
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
| Linux             | Supported              | Packaged AppImage and `.deb` are x86_64, built on Ubuntu 22.04. Closing the window quits (no tray). Checkout installs use standard Node 22 and Git. |

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

Local-only use needs only localhost access. Do not expose DevHub directly to the public internet; it has no user login.
