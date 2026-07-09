# Performance Appraisal (MCP)

DevHub captures review evidence through MCP tools on the `devhub` server. Entries are BlockNote JSON under `notes/appraisal/` so the dashboard can render them like other notes.

Use this when you want **dated, reference-backed moments** during the year — not a scramble to reconstruct impact at review time.

## Storage layout

```text
notes/appraisal/
  self/<year>.json              # your self-review
  people/<slug>/<year>.json     # direct reports or others you appraise
```

Appraisal paths are **outside** the default `notes_search` workspace slice. Read or edit them with the `appraisal_*` tools or by opening the note path in the dashboard.

## Minimal workflow

1. **Set goals** — `appraisal_set_goal` for each review goal (slug + title). Goals appear under `## Goals` in the year file.
2. **Record moments** — `appraisal_record` when something worth remembering happens. Requires at least one `references[]` entry (PR, ticket, thread, dashboard link).
3. **Summarize** — `appraisal_summarize` near review time for theme-grouped bullets and goal coverage.

### `appraisal_record` fields

| Field | Required | Notes |
| ----- | -------- | ----- |
| `title` | yes | Short headline; deduped by slug (defaults from title) |
| `theme` | yes | `impact`, `technical`, `collaboration`, or `growth` |
| `summary` | yes | 1–3 factual sentences: what happened + evidence |
| `references` | yes | At least one URL or ref string |
| `subject` | no | Omit or `self` for your review; person slug for others |
| `goal` | no | Must match a slug from `appraisal_set_goal` |
| `date` | no | `YYYY-MM-DD`; defaults to today and selects the year file |

Updating an entry with the same slug replaces it in place.

## Tool reference

| Tool | Purpose |
| ---- | ------- |
| `appraisal_set_goal` | Add or revise a goal for the year |
| `appraisal_list_goals` | List goal slugs and titles |
| `appraisal_record` | Capture or update a themed moment |
| `appraisal_read` | Read one subject/year as markdown |
| `appraisal_list` | List appraisal files for a subject |
| `appraisal_people` | List people you have appraisal notes for |
| `appraisal_summarize` | Theme-grouped summary for review prep |
| `appraisal_delete` | Remove an entry by slug |

## Example agent prompts

- “I just merged PR #412 that cut CI from 22 to 9 minutes — record it under technical with the PR link as a reference.”
- “Add a growth goal slug `mentoring` titled ‘Grow two engineers to lead small projects’.”
- “Summarize my 2026 self-appraisal so far, grouped by theme.”

## Privacy and git

Appraisal notes live in the same git-backed notes tree as daily notes. If the repo is shared or pushed to a remote, `notes/appraisal/people/` is included in normal content sync. Treat sensitive feedback accordingly.

## Troubleshooting

| Issue | Fix |
| ----- | --- |
| `Unknown goal "…"` on record | Create the goal with `appraisal_set_goal` first, or omit `goal` |
| Entry not in palette search | Expected — use `appraisal_read` or open `notes/appraisal/...` directly |
| Empty year file | `appraisal_read` returns a skeleton with `## Goals` and theme headings when the file does not exist yet |

## See also

- [Notes System — Appraisal notes](../architecture/notes-system.md#appraisal-notes)
- [MCP Server — Appraisal tools](../architecture/mcp-server.md)
