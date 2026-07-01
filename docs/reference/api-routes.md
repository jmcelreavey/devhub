# API Routes

DevHub API routes are local endpoints used by the dashboard UI. They are not intended to be a public hosted API.

## Route Groups

| Group     | Purpose                                              |
| --------- | ---------------------------------------------------- |
| Actions   | Launch native OpenChamber/OpenCode apps when installed |
| Agents    | View shared and local agent configuration            |
| Infra plugin (`/api/bi/*`) | Optional plugin-backed ops: AWS profile, EKS, RDS, Mongo, CAPI, IAM |
| Briefing  | Morning briefing data and user preferences           |
| Calendar  | Google Calendar auth and event reads                 |
| Datadog   | Alert links and summaries                            |
| Git       | Local repo status and merge-conflict detection/resolution |
| GitHub    | Pull request/review queues, recently reviewed PRs, and repository data |
| Jira      | Ticket data and redirects                            |
| Jobs      | Scheduled job management                             |
| Learnings | Browse reusable learning notes                       |
| MCP       | View MCP server configuration                        |
| Notes     | Notes CRUD, tree access, PR review notes under `pr-reviews/...`, note image assets (`GET /api/notes-assets/...`), optional in-editor AI (`GET /api/notes/ai/status`, `POST /api/notes/ai/chat`) |
| Docs      | Repo `docs/` markdown CRUD (`/api/docs/...`), file tree (`GET /api/docs/tree`), same ordering API as notes (`PATCH /api/note-order?vault=docs`) |
| Share     | Publish notes/docs as secret GitHub Gists (`GET`/`POST`/`DELETE` `/api/share`; `DELETE ?all=1` clears all) |
| Collections | Master checklist CRUD under repo `collections/` (legacy route name); `GET …/linked-label-drift?itemId=` and `POST …/sync-linked-labels` propagate master item labels into linked note blocks |
| OpenCode  | Read/update shared `opencode.json`; secret env hints |
| Persona   | View shared and local persona configuration          |
| Repos     | Repository discovery, actions, and Repo Learning artifacts |
| Scripts   | Run allowlisted maintenance and sync actions; stream/history endpoints expose run output |
| Search    | Full-text search (`?q=` required; default notes, `?vault=docs` for docs) |
| Setup     | Read and save setup configuration                    |
| Status    | Health checks for Git, services, MCP, sync health, and LAN access |
| Sync preview | Preview repo → local sync without applying        |
| Tasks     | Task CRUD, open-task reorder (`PATCH` with `{ ids }`), rollover, timers, and history |
| Tree      | Notes file tree listing                              |

## Common Behavior

- Routes return JSON unless they stream logs or redirect.
- Mutating routes are intended for same-origin dashboard use.
- Long-running actions expose progress through server-sent events.
- Optional integrations should fail clearly when unconfigured.

## Notable User-Facing Routes

| Route | Used By | Notes |
| ----- | ------- | ----- |
| `GET /api/github/prs` | Today GitHub PR panel, `/prs` | Requires an authenticated local `gh` session. Returns authored PRs, review-requested PRs, and recently reviewed PRs; archived repositories are filtered from active queues. |
| `GET /api/notes/pr-reviews/<slug>` | PR **Notes** links | The GitHub PR **Review** action polls this route after starting OpenCode. A `404` just means the review note has not been written yet. |
| `GET /api/dashboard/morning-briefing` | Today briefing widget, `/briefing`, MCP `briefing_get` | Returns structured briefing data plus a rendered `text` summary. Cached per calendar day under `notes/.cache/briefing/`; `?refresh=1` bypasses the cache. AI sections fall back gracefully when `AI_API_KEY` is unset. |
| `GET /api/briefing/prefs`, `PUT /api/briefing/prefs` | Briefing settings UI | Reads or updates `notes/.config/briefing-prefs.json`. `PUT` is same-origin only and accepts partial updates (location, feeds, section toggles, tech stack, interests). |
| `POST /api/briefing/prefs/chat` | Briefing **Tune briefing** dialog | Streams a conversational prefs update. Requires `AI_API_KEY`; returns `503` when unconfigured. Saves merged prefs to disk after each assistant turn. |
| `GET /api/repos/<name>/learn`, `GET /api/repos/<name>/learn/status`, `GET /api/repos/<name>/learn/pack.zip`, `POST /api/repos/<name>/learn/tutor` | Repo Learning panel | Resolves sibling git checkouts only. Deterministic facts work without AI; generated briefs, NotebookLM packs, and tutor responses require `AI_API_KEY`. |
| `GET /api/status/git` | Top-bar sync indicator, Status page | Returns branch, dirty counts, content-vs-other dirty counts, ahead/behind counts, conflict count, last commit, and user-facing hints. It fetches upstream at most every four minutes; intermediate polls compare against the last fetched upstream ref. |
| `GET /api/git/conflicts` | Status merge-conflict panel | Lists files with Git unmerged status or conflict markers under scoped content paths and includes readable file content for editing. |
| `POST /api/git/conflicts` | Status merge-conflict panel | Body: `{ path, content }`. Rejects invalid paths or content that still contains `<<<<<<<` markers; on success writes the content, runs `git add -- <path>`, and returns the remaining conflict count. |
| `GET /api/status/mcp` | Status MCP panel | Scans running processes for each server in `mcp/shared/`. Returns `command`, `fingerprint`, `binaryExists`, `runningCount`, and `pids`. Bare launch commands (`npx`, `tsx`, `uvx`, …) are considered present when resolvable on `PATH`; path-based commands must exist on disk. |
| `GET /api/status/services`, `POST /api/status/services/restart` | Status services panel | Probes dashboard, OpenChamber, and OpenCode ports. Restart is same-origin only. |
| `GET /api/status/lan` | Status LAN panel | Returns LAN URLs for accessing the dashboard and companions from other devices on the network. |
| `GET /api/sync-health` | Status skill-sync panel | Checks shared skill sync health across configured tool directories and includes preview diffs for unhealthy skill/agent sync state. |
| `GET /api/scripts` | Actions page | Returns the allowlisted script catalog. Content-sync-related IDs include `sync_notes_tasks_push`, `dry_run_scoped_sync`, `commit_dirty_push`, and `update_and_sync`. |
| `POST /api/scripts` | Top-bar sync indicator, Status page, Actions page | Starts an allowlisted action and returns `202 { runId }`. Same-origin only. `commit_dirty_push` accepts a trimmed `commitMessage`; filter options are accepted only by the script families that use them. |

## Content Sync Actions

These action IDs are local operational interfaces, not public APIs:

| Script ID | Purpose | Main constraints |
| --------- | ------- | ---------------- |
| `sync_notes_tasks_push` | Stage, commit, and push scoped content paths: `notes/`, `collections/`, `tasks/`, and `docs/`. | Requires `main` or `master`; uses an auto-generated `chore(content): ...` commit message. |
| `dry_run_scoped_sync` | Preview which scoped content files would be committed. | Read-only; requires `main` or `master` because it mirrors the scoped sync guardrails. |
| `commit_dirty_push` | Stage all tracked and untracked changes, commit with the provided message, and push. | Requires `main` or `master`; intended for dirty files outside scoped content. |
| `update_and_sync` | Pull/rebase from origin, sync shared assets/configuration, optionally create a sync commit, and push. | Git operations require a clean tree; the dashboard blocks or redirects when dirty files or conflicts are present. |

## Contributor Guidance

When adding routes:

- Keep route responsibilities narrow.
- Validate input at the boundary.
- Return useful errors for the UI.
- Avoid exposing arbitrary shell or filesystem access.
- Keep public documentation at the group level unless a route is user-facing.
