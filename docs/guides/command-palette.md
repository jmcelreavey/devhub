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
- **Content** — full-text matches inside notes when your query is at least two characters (debounced; uses `/api/search`).

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
| `g n`         | Go to Notes        |
| `g s`         | Go to Status       |
| `g a`         | Go to Actions      |
| `g r`         | Go to Repos        |
| `g k`         | Go to Skills       |
| `g c`         | Go to Chamber      |
| `g l`         | Go to Calendar     |
| `g j`         | Go to Tickets      |
| `g d`         | Go to Datadog      |
| `Cmd+Shift+O` | Toggle notes panel |
| `Cmd+Shift+T` | Toggle tasks panel |

## Tips

- Use page shortcuts for navigation.
- Use `Cmd+K` when you know what you want but not where it lives.
- On mobile, use the visible navigation and panel buttons instead of keyboard shortcuts.
