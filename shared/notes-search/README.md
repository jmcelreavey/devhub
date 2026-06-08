# Notes search (shared core)

Plain-text extraction and filesystem search for BlockNote JSON under the notes vault.

## Consumers

| Consumer | Scope | tldraw |
|----------|-------|--------|
| **Dashboard** [`/api/search`](../../dashboard/app/api/search/route.ts) | Full vault (all `.json` under `notes/`) | Yes |
| **MCP** `notes_search` | Workspace only: root scratch + `daily/` via `isWorkspaceNoteRel` | No |

Presentation stays in each consumer (API JSON + scoring vs MCP markdown).

## API

- `searchNotes(root, query, options)` — walk, extract, line match, limit (default 50)
- `extractPlainTextFromBlockNote(blocks)` — search-oriented plain text (not markdown export)
- `extractPlainTextFromTldraw(data)` — diagram shape labels/text
- `isWorkspaceNoteRel(relPath)` — MCP path filter

Do not point dashboard search at `isWorkspaceNoteRel` without an explicit product change — that would hide learnings/diagrams from Command Palette and global search.
