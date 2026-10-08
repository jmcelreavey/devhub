---
title: Task profiles (home / work)
description: Keep separate task lists per context in one repo, switch between them per machine, and see the other list read-only.
order: 21
icon: UserRound
tags: [tasks, profiles, git]
related:
  - architecture/notes-system
  - reference/environment-variables
---

# Task profiles (home / work)

A profile is a folder under `tasks/`: `tasks/home/2026-09-29.json`, `tasks/work/2026-09-29.json`.
Everything lives in the one repo and syncs through git as usual.

## The rule that avoids merge conflicts

**A machine only writes to its own active profile.** Home writes `tasks/home/`, work writes
`tasks/work/`, which keeps their task day-files separate. Shared notes and settings can
still conflict, and two machines using the same profile can edit the same task file.
The other profile's open tasks appear in the task list under **From home (n)** — read-only, on purpose.
To change one, switch to that profile.

The active profile is per-machine and is **not** committed: `DEVHUB_PROFILE`, else
`~/.config/devhub/profile.json` (`{ "active": "work" }`). If a profile is chosen but its folder doesn't
exist yet (fresh clone), it's used anyway — DevHub will not fall back to another profile and write into it.

## Setup

1. Top bar → the person icon → name your first profile (default `home`) → **Enable**.
   Existing day files are moved into `tasks/home/` (a plain rename, so git keeps history). The next tasks read imports them into `tasks/home/items/`.
2. On the other machine: pull, open the same menu, **Add** `work`. It becomes that machine's active profile.

Until step 1, tasks live in `tasks/items/`.

## What is and isn't per-profile

| Per-profile (active only) | Shared |
| --- | --- |
| Task items, history/weekly, MCP `tasks_*`, recall's task index | Notes, collections, docs, diagrams, agent runs |

Overlay shows every open item in each other profile, including one that has been open for a long time.

## Known limits

- `notes/.config/task-agent-runs/_index.json` is a single shared file and can still conflict if two
  machines dispatch agents between syncs. The per-task run files next to it are keyed by task id and don't.
- A machine on an older build that still writes flat `tasks/*.json` leaves stray files in the root.
  `POST /api/tasks/profiles {"action":"adopt"}` moves them into the active profile without overwriting.
- No identity or signing yet. The profile is a path, not an account; multi-user impersonation
  protection is a later step (signed writes per user key).
