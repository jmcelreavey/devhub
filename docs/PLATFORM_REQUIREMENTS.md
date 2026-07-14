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
| Node.js 20+ | Runs dashboard and tooling                  |
| npm         | Installs dependencies and runs scripts      |
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

For WSL2, mirrored networking is usually the simplest LAN option. NAT-mode WSL may require Windows port forwarding.
