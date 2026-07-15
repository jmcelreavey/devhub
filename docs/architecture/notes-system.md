# Notes System

DevHub uses notes as persistent memory for both humans and AI tools.

The goal is simple: keep useful context in plain local files that can be searched, edited, and synced with Git.

## Main Note Areas

| Area        | Purpose                                            |
| ----------- | -------------------------------------------------- |
| Daily notes | Day-by-day work notes and standups                 |
| Learnings   | Reusable knowledge distilled from work             |
| Sessions    | Longer records of significant AI-assisted sessions |
| Diagrams    | tldraw files for visual notes                      |
| Appraisal   | Structured review evidence and goals               |

## Two-Tier Memory

DevHub separates raw session capture from reusable learning.

```text
Session work
  -> session notes
  -> distilled learnings
  -> future AI sessions can load relevant context
```

This prevents every session from needing to load every past detail.

## Daily Notes

Daily notes are for current work:

- Standup drafts.
- Meeting notes.
- Quick context.
- Small reminders.

They are easy to search and safe to edit from the dashboard or MCP tools.

## Learnings

Learnings are for information that should be useful again.

Good learning notes are:

- Short.
- Clear.
- Topic-focused.
- Written for a future reader.
- Free of unnecessary session noise.

## Appraisal notes

Appraisal notes are intentional review records captured through the DevHub MCP server's `appraisal_*` tools. They are stored as regular BlockNote JSON under the notes tree so the dashboard can render them like other notes:

```text
notes/
  appraisal/
    self/<year>.json
    people/<person-slug>/<year>.json
```

Use them for evidence-backed moments, goals, and year-end summaries:

- `appraisal_record` captures a dated moment with a theme, summary, and at least one reference.
- `appraisal_set_goal` records or revises a review goal for the year.
- `appraisal_read`, `appraisal_list_goals`, and `appraisal_summarize` retrieve structured review material.

Appraisal entries are deliberately separate from `notes_search`'s default workspace slice. Use the dedicated `appraisal_*` tools, or explicit note paths, when you want to read or modify them.

## Why Files Instead Of A Database

Files are a good fit because they are:

- Easy to inspect.
- Easy to back up.
- Easy to version with Git.
- Portable across machines.
- Friendly to AI tools.

## Master Checklists

Folder-scoped **master checklists** live under `collections/` at the repo root (one JSON file per list). They are edited from the **Checklists** view in the notes UI (`/notes` with the checklists panel, or `/collections` which redirects there).

| Concept | Behavior |
| ------- | -------- |
| Scope   | Each master list is tied to a notes folder path (longest prefix wins for a given note). |
| In notes | Insert a **Linked checklist** block from `/` or link tasks to the folder’s master. Checked state is shared across notes that reference the same master item. |
| Labels  | Renaming a master item updates the canonical label. Linked blocks in other notes may show **drift** until you sync labels (see below). |
| API     | `GET/POST /api/collections`, `GET/PATCH/DELETE /api/collections/[id]` (route name is historical; payloads use master-list shapes). |
| Label sync | `GET /api/collections/[id]/linked-label-drift?itemId=…` counts linked blocks whose text differs from the master; `POST /api/collections/[id]/sync-linked-labels` with `{ itemId, label, excludeNotePath? }` rewrites matching blocks across notes. |
| Assets  | Images under the notes tree (e.g. `garden/project/assets/photo-1.jpg`) are served at `GET /api/notes-assets/...`. MCP markdown uses notes-relative paths; saved BlockNote JSON stores `/api/notes-assets/...` URLs. Use `notes_write_asset` to upload bytes from agents. |

Collection JSON writes are serialized with a repo mutex so rapid checklist edits from multiple tabs do not corrupt files.

## In-Editor AI (Optional)

The notes **BlockNote** editor can call an OpenAI-compatible provider through BlockNote's AI extension:

- Select text → **AI** (stars) on the formatting toolbar.
- Type **`/ai`** in the slash menu.

Configuration is env-only - see [Environment Variables](../reference/environment-variables.md#notes-repo-learning-and-briefing-ai-optional) (`AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`; any OpenAI-compatible provider, z.ai by default). Example placeholders are in `dashboard/.env.example`. Do not commit real API keys.

**Notes work fully without these variables.** When `AI_API_KEY` is unset, the editor omits AI toolbar, `/ai`, and related UI. `GET /api/notes/ai/status` reports `{ configured: false }`.

Backend route: `POST /api/notes/ai/chat` (Vercel AI SDK + BlockNote server helpers -> configured OpenAI-compatible chat endpoint).

## Content vaults

The dashboard treats rooted file trees as **vaults** with shared storage, API, and UI. Filesystem primitives (`VaultStorage`, codecs, path helpers) live in [`shared/vault/`](../../shared/vault/README.md) and are extended by the dashboard (assets, BlockNote search) and MCP server (workspace-scoped note search).

| Vault | Path (default) | Format | Routes |
| ----- | -------------- | ------ | ------ |
| Notes | `NOTES_DIR` / `notes/` | BlockNote JSON (`.json`) | `/notes`, `/api/notes/...` |
| Docs  | `REPO_ROOT/docs` (override with `DOCS_DIR`) | Markdown (`.md`) | `/docs`, `/api/docs/...` |

Docs use the same BlockNote editor with markdown load/save via `shared/markdown-convert/`. Scoped git sync (`Sync content`) includes `docs/` alongside `notes/`, `collections/`, and `tasks/`.

Open **Docs** in the sidebar (`/docs`) for the file tree, search, and BlockNote editing. Command palette content search includes docs when you use `/api/search` (notes by default; `?vault=docs` for docs-only API calls). Prefer editing architecture and guides here or in git — the automation that maintains this tree expects markdown on disk.

### Content sync workflow

Content sync is the low-friction path for personal content that changes while using the dashboard. It is intentionally scoped: `dashboard/lib/content-sync-paths.ts` defines `notes/`, `collections/`, `tasks/`, and `docs/` as the paths staged by the `sync_notes_tasks_push` action.

| Surface | Behavior |
| ------- | -------- |
| Top bar cloud button | Appears when `/api/status/git` reports dirty content. It starts `POST /api/scripts` with `script: "sync_notes_tasks_push"`, which stages only the scoped content paths, creates an auto-generated `chore(content): ...` commit, and pushes the current branch. |
| Top bar warning triangle | Handles everything that is not a scoped content sync: non-content dirty files, upstream commits waiting to be pulled, or merge conflicts. Dirty non-content files open the commit-message modal and run `commit_dirty_push`; upstream-only changes run `update_and_sync`; conflicts redirect to `/status`. |
| Status page | Shows repo branch, ahead/behind counts, dirty content vs other dirty files, recent sync failures, merge conflicts, and sync-health checks. Use it when the top bar blocks sync or a scripted action fails. |
| Actions page | Exposes the same allowlisted script IDs for manual runs and log inspection. `dry_run_scoped_sync` previews the scoped content commit without staging anything. |

`/api/status/git` classifies content using the configured directories (`NOTES_DIR`, `TASKS_DIR`, `DOCS_DIR`, and `collections/`), so relocated notes or tasks still show as content when they live inside the repo. Root `diagrams/` files are also shown as content-adjacent in dirty counts, but the scoped content script stages only `notes/`, `collections/`, `tasks/`, and `docs/`; if a diagram remains after a content sync, use the general commit flow or commit it manually.

#### Conflict recovery

Merge conflicts block content sync. Detection uses both Git unmerged status and `<<<<<<<` markers under the scoped content paths. Open **Status -> Merge conflicts** to:

1. Pick the conflicted file.
2. Edit out all conflict markers.
3. Save; the dashboard writes the file and runs `git add -- <path>`.
4. Repeat until the panel reports no conflicts, then run content sync or Update & Sync again.

The conflict API rejects saves that still contain conflict markers, so the file is not staged until it is actually resolved.

### File tree ordering

Custom sibling order for notes and docs is stored in `.devhub-order.json` at each vault root (per parent folder). Reorder from the sidebar via drag handles (arrow keys work when the handle is focused). The dashboard calls `PATCH /api/note-order` with the ordered sibling paths (add `?vault=docs` for the docs vault). Writes use atomic updates so concurrent reorders do not corrupt the file.

### Temporary sharing

Notes and docs can be published as secret GitHub Gists for short-lived read-only links. See [Sharing](../guides/sharing.md).

## Editor saves and navigation

Notes and docs autosave on a short debounce. Each navigation or vault switch bumps a **save generation** so in-flight saves from the previous page are dropped instead of overwriting the new page. If you edit and navigate away within the debounce window, wait a moment or use explicit save before leaving.

### In-app links

BlockNote link clicks in notes and docs resolve in-app when possible:

| Link form | Behavior |
| --------- | -------- |
| `/notes/...`, `/docs/...` | Navigate within the dashboard |
| Relative `.md` / `.json` paths | Resolve relative to the current note or doc slug |
| `repo://` / `repo:` | Open a sibling repo file in Cursor via `POST /api/repos/<name>/open` |
| `http(s):`, `mailto:`, `tel:` | Open externally (⌘/Ctrl-click opens in a new tab) |

See [Dashboard — Repo-aware links](dashboard.md#repo-aware-links) for repo link syntax.

## Maintenance

Keep active notes small enough to browse. Archive old or noisy material when it stops being useful day to day.
