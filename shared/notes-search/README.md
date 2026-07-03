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
- `semanticSearchNotes(root, query, options)` — TF-IDF ranking over tokenized BlockNote/tldraw text (notes vault only; used by `GET /api/search?mode=semantic`)
- `extractPlainTextFromBlockNote(blocks)` — search-oriented plain text (not markdown export)
- `extractPlainTextFromTldraw(data)` — diagram shape labels/text
- `isWorkspaceNoteRel(relPath)` — MCP path filter (root scratch + `daily/` only; excludes `appraisal/`, learnings, and other subtrees from MCP `notes_search`)

Do not point dashboard search at `isWorkspaceNoteRel` without an explicit product change — that would hide learnings/diagrams from Command Palette and global search.
