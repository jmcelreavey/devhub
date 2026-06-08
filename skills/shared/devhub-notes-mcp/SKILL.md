---
name: devhub-notes-mcp
description: "Use the DevHub repo notes MCP (stdio). When the user or task involves searching, listing, reading, or editing BlockNote JSON notes under the repo's notes/ tree or Markdown docs under docs/ via MCP tools (keywords: notes MCP, devhub notes, devhub docs, daily note path, notes_list, notes_search, docs_read)."
---

DevHub ships a **stdio MCP server** (`mcp-servers/notes-server`) wired from `mcp/shared/notes.json`. The dashboard's sync/bootstrap substitutes `REPO_ROOT` and writes per-tool configs. **`NOTES_DIR`** defaults to `REPO_ROOT/notes`. **`DOCS_DIR`** defaults to `REPO_ROOT/docs`. Both vaults use the shared [`shared/vault/`](../../shared/vault/README.md) storage layer.

## Why a skill exists alongside MCP

- MCP tool **descriptions** carry parameters; they should stay the source of truth for args.
- This skill carries **behavior**: where day-to-day notes live, what `notes_list` / `notes_search` scope to, and when to reach for **`notes_read`** with an explicit path.

Do **not** paste full tool schemas here — they drift. Prefer invoking tools and reading errors.

## Layout (workspace vs everything)

**Default agent surface** (list + search):

- **`daily/`** — dated journals (`daily/YYYY-MM-DD`), same idea as the dashboard "today" card.
- **Root `*.json`** — loose scratch / context files next to `daily/`.

**Still valid via `notes_read` / `notes_write` / `notes_append` / `notes_delete`** when the user names a path, e.g. `learnings/engineering` — structured learnings and other trees are intentionally **out of** `notes_list` / `notes_search` so day-to-day search stays small.

**Docs** live under `docs/` as Markdown. Use the `docs_*` tools for architecture, guides, and reference pages. `docs_list` and `docs_search` cover the full docs tree (unlike the filtered notes workspace slice).

## Tool selection

| Goal                                                      | Tool                |
| --------------------------------------------------------- | ------------------- |
| See what's in the workspace slice                         | `notes_list`        |
| Find text across workspace slice                          | `notes_search`      |
| Load one note by path                                     | `notes_read`        |
| Create/replace whole note (markdown → blocks server-side) | `notes_write`       |
| Add to end of existing note                               | `notes_append`      |
| Write image bytes under notes/ (jpg, png, gif, webp)      | `notes_write_asset` |
| Remove a note                                             | `notes_delete`      |
| List all repo docs                                        | `docs_list`         |
| Search all repo docs                                      | `docs_search`       |
| Load one doc by path                                      | `docs_read`         |
| Create/replace a doc (markdown)                           | `docs_write`        |
| Append markdown to a doc                                  | `docs_append`       |
| Remove a doc                                              | `docs_delete`       |

**Images:** In markdown use notes-relative paths: `![caption](garden/project/assets/photo-1.jpg)`. Saved notes store `/api/notes-assets/...` URLs in image blocks. See [devhub-project-from-photos](../devhub-project-from-photos/SKILL.md) for the full project-note workflow.

**Toggles:** Use `::toggle <title>` ... `::end-toggle` to write a BlockNote toggle list item with child blocks. Use this for collapsed reference sections such as photos, assumptions, shops, or prep notes.

If MCP tools are **not** in the session, use the dashboard/API/fs in-repo per task — the skill does not replace a configured MCP.

## Practices

- Prefer **relative paths** as documented on each tool (`daily/2026-05-11`, `my-scratch`, `learnings/foo`, or `architecture/notes-system` for docs).
- After changing notes on disk outside MCP, assume nothing auto-invalidates; re-list or re-read as needed.
- `notes_write` is a full-note replacement. Do not use it for targeted edits to an existing note unless you have just reread and merged the latest full note content.
- For structured BlockNote notes with tables, headings, or user-edited layout, verify the backing JSON file under `REPO_ROOT/notes/<path>.json`. Rendered `notes_read` output can confirm text exists, but it may not prove the requested row/section landed in the intended place.
- If the user gives an explicit note path, check that exact file path when practical. Example: `learnings/foo` should map to `REPO_ROOT/notes/learnings/foo.json`.
- If an MCP write reports that it created a note that should already exist, stop and inspect the path before making more edits.
- For surgical edits to an existing table/section, patch the BlockNote JSON or use a dashboard/API route that preserves block structure, then verify with both file inspection and `notes_read`.
