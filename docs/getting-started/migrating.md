---
title: Migrating an older setup
description: Move an existing DevHub install onto the current directory layout.
order: 4
icon: ArrowRightLeft
tags: [setup]
related:
  - getting-started/installation
---

# Migration

Use this guide when moving from an older DevHub setup to the current structure.

## Coming from a specific older setup

Two bigger moves have happened. If one of these is you, start there.

| You were using | What changed | What to do |
| -------------- | ------------ | ---------- |
| The old **Electron** desktop app | The desktop app is now Tauri-based. | Install the new app. On first launch it finds the old install and offers to import it, keeping or copying each data folder. The old install is never modified. See [Coming from the old Electron app](desktop-app.md#coming-from-the-old-electron-app). |
| **OpenChamber**, the OpenCode web chat, or the **AionUi** workspace | Coding chats and agent runs now live on **Agents** (`/agents`), backed by the [Paseo](../guides/paseo-agents.md) daemon. `/chamber` and `/opencode` redirect there. | Set the **Agents password** in Setup, then run `npm run agents:install`. `OPENCHAMBER_UI_PASSWORD` still works as a fallback for the new `DEVHUB_PASEO_PASSWORD`. Older run records stay on disk; to continue an old task, start a Paseo conversation with its saved handoff. |

Anything else is covered by the general flow below.

## Before You Start

1. Commit or back up local changes.
2. Make sure your notes are saved.
3. Confirm you can restore from Git or another backup.

## Recommended Migration Flow

```bash
git pull
npm install
bash scripts/install.sh
npm run verify
```

Then open:

```text
http://localhost:1337/setup
```

Review paths, integrations, and network settings.

## What May Change

Depending on your previous version, migration may affect:

- Dashboard dependencies.
- MCP configuration files.
- Skill sync destinations.
- Persona sync behavior.
- Notes directory structure.
- Git hooks.
- Optional integration settings.

## Notes Migration

DevHub expects notes to live in a structured notes directory with areas for daily notes, learnings, sessions, and diagrams.

If you have older notes, keep a backup before moving or converting them.

## Troubleshooting

| Problem                  | Fix                                   |
| ------------------------ | ------------------------------------- |
| Dashboard does not start | Run `npm run doctor`                  |
| MCP tools are missing    | Run MCP sync from the dashboard       |
| Skills are missing       | Run skill sync from the dashboard     |
| Persona is stale         | Run persona sync from the dashboard   |
| Verification fails       | Fix the reported issue before pushing |

## Safe Migration Rule

When in doubt, preserve old files first. DevHub is file-based, so backups are simple and valuable.
