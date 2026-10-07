---
title: Command palette
description: The fastest way to move around DevHub and trigger common actions.
order: 1
icon: Command
tags: [ui]
related:
  - guides/theming
---

# Command Palette

The command palette is the fastest way to move around DevHub and trigger common actions.

Open it with **⌘P** (Ctrl+P on Linux/Windows), or click the **Search…** box in the top bar.

## Walkthrough

[Command palette and search walkthrough](../assets/demos/command-palette.mp4)

## What It Searches

- Pages.
- Notes (by title/path).
- Diagrams (tldraw files in the notes tree).
- Tasks.
- Tickets.
- Common actions.
- Standup shortcuts.
- **Content** — full-text matches inside notes when your query is at least two characters (debounced; uses `GET /api/search` substring mode).
- **Terminal sessions** — matches in recent PTY logs when your query is at least two characters (`GET /api/terminal/search`). Selecting a hit opens a read-only transcript modal with line numbers and copy actions; output is secret-redacted (unlike **Copy all output** on a live dock tab, which uses the raw log).

For TF-IDF "related notes" search across the full notes vault, use the **Search** page at `/search` (`?mode=semantic` on the API). The palette always uses exact substring matching so results stay predictable for quick navigation.

## Actions

| Action                           | Shortcut / hint          | What it does                                                                                                                                                                                                                                                       |
| -------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Copy context pack for AI session | Empty-query default list | Fetches `GET /api/context-pack?format=markdown`, copies a markdown bundle to the clipboard: today's open tasks, learnings relevant to them, daily note preview, and standup markdown. Learnings are ranked by `recall` against your open tasks and daily note rather than taken by recency; if there is no index or nothing open yet, it falls back to the most recent and says so in the heading. Use when starting an external AI session and you want local DevHub state in one paste. |
| Open today's note                | Empty-query default list | Opens the notes panel on `daily/YYYY-MM-DD` (`devhub:notes-open-today`). Works even when the panel is already open. Same file as the Today editor. See [Notes System — Daily Notes](../architecture/notes-system.md#daily-notes). |
| Quick capture                    | `⌘⇧C`                    | Opens the capture dialog for a task, note, or learning.                                                                                                                                                                                                            |
| Toggle animations                | —                        | Flips the motion kill-switch (`body[data-motion="off"]`).                                                                                                                                                                                                          |

**Copy context pack** is different from **Copy standup** on Today: the context pack adds tasks, learnings, and the daily note preview around the same standup window data.

### Result Ordering

With an empty query, the palette shows a fixed set of actions, recent tasks/tickets, notes, and diagrams.

With a typed query:

1. Fuzzy-scored navigation, notes, diagrams, tasks, tickets, and actions.
2. Content hits appended below, excluding paths already matched as note or diagram entries (avoids duplicate rows).

Selecting a content result opens the matching note or diagram.

## Keyboard Shortcuts

Press `?` while focused on DevHub to view **global** app shortcuts (navigation, panels, command palette). The Repo Git workspace has a separate context overlay — press `?` while that panel is focused. See [Dashboard — Repo Git workspace](../architecture/dashboard.md#repo-git-workspace).

Common shortcuts include:

| Shortcut      | Action                                          |
| ------------- | ----------------------------------------------- |
| `⌘P`          | Command palette (`⇧↵` opens a result in a new tab) |
| `⌘N`          | Toggle notes panel (`⌘⇧O` still works)          |
| `⌘T`          | Toggle tasks panel (`⌘⇧T` still works)          |
| `⌘D`          | Toggle diagrams panel                           |
| `⌘⇧C`         | Quick capture (task, note, or learning)         |
| `⌘\`          | Toggle sidebar                                  |
| `⌘1`–`⌘9`     | Jump to workspace tab                           |
| `g h`         | Go to Today                                     |
| `g w`         | Go to Work                                      |
| `g t` / `g j` | Go to Work → Tasks / Jira                       |
| `g p`         | Go to PRs                                       |
| `g n`         | Go to Notes                                     |
| `g /`         | Go to Search                                    |
| `g f`         | Go to Diagrams                                  |
| `g r`         | Go to Repos                                     |
| `g k`         | Go to Skills                                    |
| `g c`         | Go to Agents                                    |
| `g l`         | Go to Calendar                                  |
| `g d`         | Go to Datadog                                   |
| `g o`         | Go to Ops (plugin)                              |
| `g s`         | Go to Status                                    |
| `g a`         | Go to Actions                                   |

The `g` chords are defined in `components/shell/KeyboardShortcuts.tsx`; `⌘` chords in `lib/app-shortcuts.ts`.

## Tips

- Use page shortcuts for navigation.
- Use `⌘P` when you know what you want but not where it lives.
- On mobile, use the visible navigation and panel buttons instead of keyboard shortcuts.
