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
| MCP       | MCP catalog CRUD (`mcp/shared/` and personal `~/.config/devhub/mcp-personal/`); runtime process scan is under Status (`/api/status/mcp`) |
| Notes     | Notes CRUD, tree access, PR review notes under `pr-reviews/...`, note image assets (`GET /api/notes-assets/...`), optional in-editor AI (`GET /api/notes/ai/status`, `POST /api/notes/ai/chat`) |
| Docs      | Repo `docs/` markdown CRUD (`/api/docs/...`), file tree (`GET /api/docs/tree`), same ordering API as notes (`PATCH /api/note-order?vault=docs`) |
| Share     | Publish notes/docs as secret GitHub Gists (`GET`/`POST`/`DELETE` `/api/share`; `DELETE ?all=1` clears all) |
| Collections | Master checklist CRUD under repo `collections/` (legacy route name); `GET …/linked-label-drift?itemId=` and `POST …/sync-linked-labels` propagate master item labels into linked note blocks |
| OpenCode  | Read/update shared `opencode.json`; secret env hints |
| Persona   | View shared and local persona configuration          |
| Repos     | Repository discovery, actions, and Repo Learning artifacts |
| Scripts   | Run allowlisted maintenance and sync actions; stream/history endpoints expose run output |
| Search    | Full-text and semantic search (`?q=` required; default notes, `?vault=docs` for docs) |
| Setup     | Read and save setup configuration                    |
| Skills    | Shared skill catalog CRUD, local import scan, and ai-tools refresh |
| Sidebar   | Nav badge counts and activity signatures           |
| Status    | Health checks for Git, services, MCP, sync health, and LAN access |
| Sync preview | Preview repo → local sync without applying        |
| Tasks     | Task CRUD, open-task reorder (`PATCH` with `{ ids }`), rollover, timers, weekly review, and history |
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
| `GET /api/context-pack`, `GET /api/context-pack?format=markdown` | Command palette **Copy context pack for AI session** | Returns `{ openTasks, recentLearnings, dailyNotePreview, standupMarkdown, … }`. With `format=markdown`, also includes a pre-rendered `markdown` string for clipboard copy. Standup subsection is fetched internally from `/api/standup/markdown`. |
| `GET /api/repos` | Repos page (`/repos`) | Lists sibling git checkouts under `dirname(REPO_ROOT)` with branch, remote, dirty/unpushed counts, and `hasCompose`. Returns `{ repos, scanDirDisplay }` (tilde-formatted scan path). |
| `GET /api/repos/github` | Repos page GitHub search | Optional `?q=` filter. Requires `gh auth login`. Returns `{ repos }` with `fullName`, privacy, default branch, and `localRepoName` when already cloned. Search results cache ~30s; accessible-repo list ~5m. |
| `POST /api/repos/clone` | Repos page **Clone** | Body: `{ fullName: "owner/repo" }`. Clones into the scan directory as a direct child folder. `409` when the folder already exists. |
| `DELETE /api/repos/<name>` | Repos page **Remove** | Deletes a local clone from the scan directory. Refuses to delete the current DevHub checkout (`400`). |
| `GET /api/repos/apps` | Repos page action buttons | Cached per process: `{ gitkraken, docker }` — whether GitKraken (macOS app or CLI) and `docker` are available. |
| `POST /api/repos/<name>/open` | Repos **Open in Cursor** | Spawns the Cursor CLI on the repo path. `503` when `cursor` is not on `PATH`. |
| `POST /api/repos/<name>/open-gitkraken` | Repos **Open in GitKraken** | macOS uses the `gitkraken://` URL scheme; Linux spawns `gitkraken -p`. |
| `POST /api/repos/<name>/compose-up` | Repos **Compose up** | Runs `docker compose up -d` in the repo root (120s timeout). Shown only when `hasCompose` is true. |
| `GET /api/repos/<name>/learn`, `GET /api/repos/<name>/learn/status`, `GET /api/repos/<name>/learn/pack.zip`, `POST /api/repos/<name>/learn/tutor` | Repo Learning panel | Resolves sibling git checkouts only. Deterministic facts work without AI; generated briefs, NotebookLM packs, and tutor responses require `AI_API_KEY`. |
| `GET /api/learnings` | Learnings browser | Without query: `{ entries }` from `notes/learnings/`. With `?category=<slug>`: returns one learning detail or `404`. |
| `GET /api/status/git` | Top-bar sync indicator, Status page | Returns `branch`, `dirtyCount`, `contentDirtyCount`, `otherDirtyCount`, per-bucket counts (`notesCount`, `tasksCount`, `diagramsCount`, `docsCount`), `ahead`/`behind`, `conflictCount`, `conflictFiles`, `lastCommit`, and `hints[]`. Content buckets use configured `NOTES_DIR`, `TASKS_DIR`, `DOCS_DIR`, and `collections/` — relocated paths still count as content when inside the repo. `otherDirtyCount` excludes content; the Status health banner uses it so notes/tasks are not mislabeled as generic dirty paths. Upstream `git fetch` runs at most every four minutes; intermediate polls recount against the last fetched upstream ref. |
| `GET /api/git/conflicts` | Status merge-conflict panel | Lists files with Git unmerged status or conflict markers under scoped content paths and includes readable file content for editing. |
| `POST /api/git/conflicts` | Status merge-conflict panel | Body: `{ path, content }`. Rejects invalid paths or content that still contains `<<<<<<<` markers; on success writes the content, runs `git add -- <path>`, and returns the remaining conflict count. |
| `GET /api/status/mcp` | Status MCP panel | Scans running processes for each server in `mcp/shared/`. Returns `command`, `fingerprint`, `binaryExists`, `runningCount`, and `pids`. Bare launch commands (`npx`, `tsx`, `uvx`, …) are considered present when resolvable on `PATH`; path-based commands must exist on disk. |
| `GET /api/status/services`, `POST /api/status/services/restart` | Status services panel | Probes **peer services only** — OpenChamber and OpenCode via `DEV_SERVICES`. Does not self-probe the dashboard. Service cards render only when `/api/setup/status` reports `chamber` / `opencode` enabled. Restart is same-origin only. |
| `GET /api/status/lan` | Status LAN badge + QR | Returns `{ addresses: string[] }` — non-internal IPv4 addresses, interface-prioritized. The UI builds `http://<ip>:<port>…` client-side (always `http://` for phone access, even when the tab was opened via HTTPS proxy) and can render a QR code. |
| `GET /api/sync-health` | Status skill-sync panel | Returns `{ healthy, skillsVerified, missing[], unreadable[], skillPreview, agentPreview }`. When `healthy: false`, `skillPreview` / `agentPreview` are full `SyncPreviewResult` objects (see `GET /api/sync-preview`); when healthy, previews are `null`. |
| `GET /api/sync-preview?kind=skill\|agent` | Agents library (`/skills`), Sync health panel | Read-only preview of repo → local sync. Query: `prune=true` to include prune candidates; `exclude=<comma-separated-slugs>` skips catalog entries (slug regex `[a-z0-9][a-z0-9_-]{0,62}`). Returns `{ kind, sourceCount, excluded, prune, targets[] }` with per-tool `writes`, `prunes`, `unchanged`. |
| `GET /api/mcp`, `POST /api/mcp` | Agents → MCP tab | `GET` lists repo (`mcp/shared/`) and personal servers with `scope`. `POST` creates an entry (`name`, `command?`, `description?`, `scope?: "personal"`). Same-origin on `POST`. |
| `GET/PUT/PATCH/DELETE /api/mcp/<name>` | MCP editor | `GET` returns `{ name, scope, content, modified }`. `PUT` replaces JSON content. `PATCH` renames (`{ newName }`). `DELETE` removes the entry. Add `?scope=personal` for `~/.config/devhub/mcp-personal/`. |
| `GET /api/mcp/local` | MCP import UI | Scans local tool MCP configs for import candidates (`{ candidates }`). |
| `GET /api/jobs`, `POST /api/jobs` | Actions scheduled jobs | `GET` returns `{ jobs, scripts }` (allowlisted script catalog for the picker). `POST` creates a job (`name`, `script`, `cron`, `enabled?`). Same-origin on `POST`. Jobs run only while the dashboard process is alive. |
| `GET/PATCH/DELETE /api/jobs/<id>`, `POST /api/jobs/<id>` | Actions scheduled jobs | `GET` reads one job. `PATCH` updates fields. `DELETE` removes it. `POST` triggers immediately (`202` with run info). Same-origin on mutating methods. |
| `POST /api/actions/launch-claude` | Top bar, command palette | Launches Claude Desktop when installed; falls back to opening `https://claude.ai/new` in the browser. |
| `GET /api/scripts/history` | Status failed-sync panel, Actions | Returns the last 50 script runs from `~/.local/state/devhub/runs.jsonl`, newest first (`{ runId, script, startedAt, finishedAt?, exitCode? }[]`). Status surfaces the latest failed `commit_dirty_push` or `update_and_sync` run. |
| `GET /api/scripts/runs/<runId>` | Status failed-sync panel, Actions | Returns `{ runId, script, startedAt, finishedAt?, exitCode?, lines[] }` for a completed or in-progress run. Older history entries may return `404` if output was not captured. |
| `GET /api/scripts/stream/<runId>` | Actions live output | Server-sent events: `data: "<line>"` per log line; `event: done` with exit code when finished. Replays buffered lines then streams live output. |
| `GET /api/scripts` | Actions page | Returns `{ scripts, catalog }` — full allowlisted action catalog with labels, descriptions, `mutates`, and `effects[]`. |
| `POST /api/scripts` | Top-bar sync indicator, Status page, Actions page | Starts an allowlisted action and returns `202 { runId }`. Same-origin only. Optional body fields depend on the script — see [Scripts](../reference/scripts.md#in-process-action-catalog). |
| `GET /api/search` | Command palette content search, `/search` page | `?q=` required. Default vault is notes; `?vault=docs` searches repo docs. Optional `?prefix=` limits to paths under a folder (rejects `..` and leading `/`). Default mode is substring line match; `?mode=semantic` uses TF-IDF over notes vault only (BlockNote + tldraw text) and returns `{ score, preview }` per file. |
| `GET /api/tasks/weekly` | Weekly Review page (`/review`), MCP `tasks_weekly` | `?end=YYYY-MM-DD` optional (defaults to today). Returns a 7-day window ending on `end`: per-day `created`/`completed`/`abandoned`/`moved` counts, window `totals`, and `slipped` tasks (same text rolled over on ≥3 distinct days). |
| `GET /api/sidebar/counts` | Sidebar nav badges | Polls every 60s. Returns open task count, Jira ticket count, GitHub PR count (authored + review-requested), stale live-link count (`shared`), and `signatures` for ticket/PR activity badges. Cached server-side for 60s. |
| `GET /api/skills` | Skills page | Returns `{ skills, aiTools }` from the shared catalog under `skills/shared/` plus ai-tools metadata. |
| `POST /api/skills` | Skills **New skill** | Body: `{ name, description? }`. Creates `skills/shared/<name>/SKILL.md`. Name must match `[a-z0-9_-]+`. |
| `GET/PUT/PATCH/DELETE /api/skills/<name>` | Skills editor | `GET` returns content and `readOnly`/`source` metadata. `PUT` replaces `SKILL.md`. `PATCH` renames the folder (`{ newName }`). `DELETE` removes the folder. Upstream ai-tools skills are read-only (`403`). |
| `GET /api/skills/local` | Skills import UI | Scans `~/.claude/skills`, `~/.codex/skills`, and similar tool dirs for import candidates. |
| `GET/DELETE /api/skills/local/<name>` | Local skill preview/remove | `GET` reads installed copy; `DELETE` removes local installations. |
| `POST /api/skills/refresh-ai-tools` | Skills ai-tools sync | Pulls upstream ai-tools skills when `AI_TOOLS_SYNC` is enabled. Returns `{ ok, disabled?, lines, … }`; responds with `disabled: true` when `AI_TOOLS_SYNC=0`. |
| `GET /api/setup/status` | Setup wizard, nav gates, Status service cards | Returns integration readiness booleans (`core`, `github`, `calendar`, `jira`, `datadog`, `bi`, `chamber`, `opencode`, `claude`), `allowLanNetwork`, `hasOpenchamberUiPassword`, and per-integration `*Vars` previews (saved key presence, not secrets). `datadogVars` includes work email and schedule ID for the setup form. `bi` is dependency-free presence detection (`AWS_PROFILE`, `BI_OPS_USER_EMAIL`, `CAPI_REPO_PATH`). |
| `POST /api/setup/save` | Setup wizard | Persists integration and core settings to `dashboard/.env.local`. Same-origin only. |
| `POST /api/setup/validate-path` | Setup path fields | Body: `{ path, kind: "repoRoot" \| "notesDir" }`. Returns `{ ok, resolved, message, isGitRepo?, hasNotesIndex? }`. |
| `POST /api/setup/check/datadog` | Setup Datadog **Test keys** | Validates API + application key pair against the Events API. Unsaved form values take precedence over saved env. |
| `GET /api/datadog/links` | Datadog page, Today strip | Returns `{ configured, ddSite?, oncall, teamAlerts, eventsToday }` deep links. `configured: false` when no API key. |
| `GET /api/datadog/oncall` | Datadog page, Today strip, briefing | On-call roster + whether `BI_OPS_USER_EMAIL` is on call. Fail-closed codes: `not_configured`, `needs_application_key`, `needs_email`, `upstream`. |
| `GET /api/datadog/recent-alerts` | Datadog page | Five most recent on-call and team Slack alert events. Requires application key. |
| `POST /api/datadog/investigate` | Datadog **Investigate** button | Body: `{ scope?, title?, status?, tags?, timestampMs? }`. Spawns an OpenCode session with a structured prompt. `502` when OpenCode is unreachable. |
| `GET /api/jira/ticket/<key>/transitions` | Task complete/abandon Jira prompt | Returns `{ key, transitions[] }` — available workflow transitions for the ticket. |
| `POST /api/jira/ticket/<key>/transition` | Task complete/abandon Jira prompt | Body: `{ transitionId }`. Applies the workflow transition. Same-origin on POST. |
| `PATCH /api/tasks` (timer) | Task list focus timer | Body: `{ id, timer: "start" \| "stop", date? }`. Starts or stops the focus timer on one task. Only one timer runs per day — starting a new timer stops any other running timer that day. Returns the updated task with `timerStartedAt` / `timeSpentMs`. |
| `GET /api/tasks/history` | Task history views | Default: `{ date, total, completed, abandoned, moved, modified }[]` per day file, newest first. `?date=YYYY-MM-DD`: `{ date, tasks }` for one day. `?includeTasks=1`: same summaries plus full `tasks[]` per day. |

## Content Sync Actions

These action IDs are local operational interfaces, not public APIs. The full catalog (20+ actions) is returned by `GET /api/scripts` as `{ scripts, catalog }`. See [Scripts](../reference/scripts.md#in-process-action-catalog) for the complete list and optional `POST` body fields.

| Script ID | Purpose | Main constraints |
| --------- | ------- | ---------------- |
| `sync_notes_tasks_push` | Stage, commit, and push scoped content paths: `notes/`, `collections/`, `tasks/`, and `docs/`. | Requires `main` or `master`; uses an auto-generated `chore(content): ...` commit message. |
| `dry_run_scoped_sync` | Preview which scoped content files would be committed. | Read-only; requires `main` or `master` because it mirrors the scoped sync guardrails. |
| `commit_dirty_push` | Stage all tracked and untracked changes, commit with the provided message, and push. | Requires `main` or `master`; accepts `commitMessage` (max 180 chars). |
| `update_and_sync` | Pull/rebase from origin, sync shared assets/configuration, optionally create a sync commit, and push. | Git operations require a clean tree; the dashboard blocks or redirects when dirty files or conflicts are present. |
| `pull_core_preview` | Fetch upstream public-core commits and show diff stat — read-only. | Wraps `devhub-update.sh --dry-run`. |
| `pull_core` | Port upstream public-core changes onto the mirror, then validate + sync. | Requires `main`/`master` and no non-personal uncommitted changes. |
| `sync_skills`, `sync_agents`, `sync_mcp_servers`, `sync_native_persona`, `sync_opencode_config` | Push repo catalog → local tool dirs/configs. | Optional `prune: true` removes local entries missing from repo. Filter with `skills`/`agents`/`servers` or `exclude*` arrays. |
| `collect_local_*`, `collect_opencode_config`, `collect_local_persona` | Reverse-sync local tool state into the repo. | `collect_local_persona` requires `personaTool`; `collect_local_mcp_servers` accepts `importMcpTarget: "repo" \| "personal"`. |
| `validate`, `verify_sync` | Repo integrity and skill readability checks. | Read-only. |
| `push_unpushed_commits` | Push ahead commits without staging new changes. | `main`/`master` only. |
| `sync_notes_push` | Legacy notes-only scoped sync. | Prefer `sync_notes_tasks_push` for the full content set. |

## Contributor Guidance

When adding routes:

- Keep route responsibilities narrow.
- Validate input at the boundary.
- Return useful errors for the UI.
- Avoid exposing arbitrary shell or filesystem access.
- Keep public documentation at the group level unless a route is user-facing.
