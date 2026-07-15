# Command Palette

The command palette is the fastest way to move around DevHub and trigger common actions.

Open it with:

```text
Cmd+K
```

## What It Searches

- Pages.
- Notes (by title/path).
- Diagrams (tldraw files in the notes tree).
- Tasks.
- Tickets.
- Common actions.
- Standup shortcuts.
- **Content** — full-text matches inside notes when your query is at least two characters (debounced; uses `GET /api/search` substring mode).

For TF-IDF "related notes" search across the full notes vault, use the **Search** page at `/search` (`?mode=semantic` on the API). The palette always uses exact substring matching so results stay predictable for quick navigation.

## Actions

| Action | Shortcut / hint | What it does |
| ------ | --------------- | ------------ |
| Copy context pack for AI session | Empty-query default list | Fetches `GET /api/context-pack?format=markdown`, copies a markdown bundle to the clipboard: today's open tasks, recent learnings, daily note preview, and standup markdown. Use when starting an external AI session and you want local DevHub state in one paste. |
| Quick capture | `⌘⇧C` | Opens the capture dialog for a task, note, or learning. |
| Toggle animations | — | Flips the motion kill-switch (`body[data-motion="off"]`). |

**Copy context pack** is different from **Copy standup** on Today: the context pack adds tasks, learnings, and the daily note preview around the same standup window data.

### Result Ordering

With an empty query, the palette shows a fixed set of actions, recent tasks/tickets, notes, and diagrams.

With a typed query:

1. Fuzzy-scored navigation, notes, diagrams, tasks, tickets, and actions.
2. Content hits appended below, excluding paths already matched as note or diagram entries (avoids duplicate rows).

Selecting a content result opens the matching note or diagram.

## Keyboard Shortcuts

Press `?` while focused on DevHub to view the available shortcuts.

Common shortcuts include:

| Shortcut      | Action             |
| ------------- | ------------------ |
| `g h`         | Go to Today        |
| `g w`         | Go to Work         |
| `g p`         | Go to PRs          |
| `g n`         | Go to Notes        |
| `g s`         | Go to Status       |
| `g a`         | Go to Actions      |
| `g r`         | Go to Repos        |
| `g k`         | Go to Skills       |
| `g c`         | Go to Chamber      |
| `g l`         | Go to Calendar     |
| `g j`         | Go to Tickets (legacy; Work → Jira tab is the sidebar path) |
| `g t`         | Go to Tasks history (legacy; Work → History tab) |
| `g d`         | Go to Datadog      |
| `g /`         | Go to Search page  |
| `g f`         | Go to Diagrams     |
| `Cmd+Shift+O` | Toggle notes panel |
| `Cmd+Shift+T` | Toggle tasks panel |

## Tips

- Use page shortcuts for navigation.
- Use `Cmd+K` when you know what you want but not where it lives.
- On mobile, use the visible navigation and panel buttons instead of keyboard shortcuts.
