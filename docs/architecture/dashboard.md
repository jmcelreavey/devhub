# Dashboard Architecture

The dashboard is the main DevHub interface. It is a local Next.js app with pages for tasks, notes, integrations, skills, actions, status, and setup.

## What The Dashboard Provides

| Area         | Purpose                                                                      |
| ------------ | ---------------------------------------------------------------------------- |
| Today        | Daily workspace with tasks, notes, calendar, tickets, PRs, standup tools, and a morning briefing widget |
| Briefing     | Full-page personal start-of-day digest (weather, news, events, dev tip, and more) |
| Notes        | BlockNote editing, file tree, folder-scoped master checklists, optional OpenAI-compatible in-editor AI |
| Docs         | In-app editing of repo `docs/` markdown (BlockNote with markdown round-trip), file tree, content sync |
| Tasks        | Daily task management, drag reorder for open items, weekly review, and history |
| Skills       | Shared skill viewing, creation, sync, and collection                         |
| Actions      | Safe script runner for maintenance tasks                                     |
| Status       | Health checks for repo, services, MCP, sync health, merge conflicts, and network access |
| Setup        | Environment and integration configuration                                    |
| Repos        | Sibling git checkout discovery, GitHub clone/search, Cursor/GitKraken launch, compose-up, and Repo Learning |
| Integrations | Calendar, Jira, Datadog, GitHub, and internal ops views                      |

## Navigation (2026-06 IA)

The sidebar is driven by `dashboard/lib/nav.ts` — thirteen primary destinations grouped into **Workspace**, **Library**, and **System**. Integration-gated items stay hidden until `GET /api/setup/status` reports the matching flag.

| Sidebar | Route | Notes |
| ------- | ----- | ----- |
| Today | `/` | Daily hub |
| Briefing | `/briefing` | Full morning digest |
| Calendar | `/calendar` | Gated on `calendar` |
| Work | `/work` | Tasks + Jira + History tabs (see below) |
| PRs | `/prs` | Gated on `github` |
| Review | `/review` | Weekly retrospective; desktop nav only |
| Library | `/notes` | Top-bar tabs: Notes, Docs, Learnings, Radar, Appraisal, Research, Diagrams, Live links |
| Agents | `/skills` | Skills, persona, MCP catalog |
| Repos | `/repos` | Desktop nav only |
| System | `/status` | Top-bar tabs: Status, Ops, Datadog, Actions, Setup |
| Chamber | `/chamber` | Gated on `chamber` |
| OpenCode | `/opencode` | Gated on `opencode` |
| Claude | `/claude` | Gated on `claude`; desktop nav only |

### Merged destinations

**Work** (`/work`) groups “things I owe” in one shell:

| Tab | Content | API |
| --- | ------- | --- |
| Tasks | Today's open queue | `/api/tasks` |
| Jira | Ticket list (same as `/tickets`) | Jira routes; tab hidden until Jira is configured |
| History | Per-day task summaries | `GET /api/tasks/history?includeTasks=1` |

**Library** and **System** use `SectionTabs` in the top bar when you land on any sibling route (for example `/docs` or `/setup`). Gated tabs (Ops, Datadog, Live links) appear only when setup enables them.

### Legacy routes

Older URLs still work and remain reachable via **⌘K** (`LEGACY_NAV_ITEMS` in `nav.ts`): `/appraisal`, `/one-on-one`, `/radar`, `/research`, `/tasks`, `/tickets`, `/search`, `/learnings`, `/diagrams`, `/docs`, `/shared`, `/ops`, `/datadog`, `/actions`, `/setup`. They no longer have permanent sidebar slots — Library section tabs cover `/radar`, `/appraisal`, and `/research`.

On mobile, the bottom shelf uses **Work** (`/work`) instead of separate Tasks/Tickets entries.

### Repo-aware links

Tasks, BlockNote notes, Repo Learning tutor output, and lightweight markdown renderers recognize **`repo://`** and **`repo:`** links to sibling clones under the Repos scan directory:

```text
repo://my-service/src/auth.ts#L42
repo:my-service/docs/README.md
```

Clicking calls `POST /api/repos/<name>/open` with optional `{ path, line }` and opens the target in Cursor (`cursor -g path:line` when a line is present). Invalid repo names or `..` path segments are rejected. Links only work for repos DevHub already tracks — use the Repos page to clone first.

## Page Pattern

Most pages follow a simple pattern:

```text
Page route
  -> loads a screen
  -> calls local API routes
  -> renders data with loading, empty, error, and success states
```

The browser talks to the dashboard API. The API reads local files, shell tools, or third-party services depending on the feature.

## API Pattern

Dashboard API routes are local endpoints used by the UI. They are not intended as a public external API.

Common responsibilities include:

- Reading and writing notes or tasks.
- Running safe allowlisted actions.
- Checking setup status.
- Fetching integration data.
- Streaming action logs back to the UI.

## State Management

DevHub avoids a large global state system.

| State Type                 | Typical Location                        |
| -------------------------- | --------------------------------------- |
| Server data                | Local API routes and client fetch hooks |
| UI preferences             | Browser storage                         |
| Persistent user data       | Files on disk                           |
| Long-running action output | Server-sent event streams               |

This keeps the app understandable and makes most features independent.

## Tasks

Daily tasks live in repo-root `tasks/YYYY-MM-DD.json` (one file per calendar day). The **Today** and **Tasks** views read and mutate them through `/api/tasks`.

| Behavior | Detail |
| -------- | ------ |
| Rollover   | Open tasks from yesterday copy into today on first load; yesterday entries get `movedAt` / `movedToDate` |
| Reorder    | Drag open tasks in the list (or use arrow keys on the drag handle). Only **open** tasks reorder; done, abandoned, and moved tasks keep their relative slots. Order is array position in the day's JSON file. |
| API        | `PATCH /api/tasks` with `{ ids: string[], date?: string }` — must include every open task id exactly once |

Completed and abandoned tasks stay in the file for history and standup; they are not included in reorder requests.

### Add to Jira

When Jira is configured, each task exposes an **Add to Jira** action. The modal creates a Jira issue from the task text, optionally under the task's linked parent or another key, inherits Team/sprint context from `GET /api/jira/meta`, and rewrites the task with the new key on success. See [Jira integration](../integrations/jira.md#create-tickets-from-tasks).

### Focus timer

Each task can track focused work time via `timerStartedAt` (ISO start) and `timeSpentMs` (accumulated). Only **one** timer runs per calendar day — starting a timer on a new task stops any other running timer that day and folds elapsed time into `timeSpentMs`.

| Action | API |
| ------ | --- |
| Start timer | `PATCH /api/tasks` with `{ id, timer: "start", date? }` |
| Stop timer | `PATCH /api/tasks` with `{ id, timer: "stop", date? }` |

Completing, abandoning, or deleting a task settles any running timer into `timeSpentMs`.

### History

`GET /api/tasks/history` returns per-day summaries (`total`, `completed`, `abandoned`, `moved`, `modified`). Add `?date=YYYY-MM-DD` for one day's tasks, or `?includeTasks=1` for summaries plus full task arrays.

## Weekly Review

The **Review** page (`/review`, desktop nav) is a retrospective view over the last seven calendar days ending on a chosen date.

| Surface | Route | Behavior |
| ------- | ----- | -------- |
| Review page | `/review` | Per-day created/completed/abandoned/moved bars, window totals, and a **slipped** list |
| API | `GET /api/tasks/weekly?end=YYYY-MM-DD` | Same data as JSON; `end` defaults to today |
| MCP | `tasks_weekly` | Dashboard-backed proxy of the weekly route |

**Slipped tasks** are detected when the same task text (normalized) appears as rolled over (`moved`) on three or more distinct days within the window (`SLIP_THRESHOLD = 3`). Rollover mints a new task id each day, so slip detection compares text across days rather than ids.

Pair with [Standup](../guides/standup.md) for daily forward-looking summaries; Review is the backward-looking complement.

## Morning Briefing

The morning briefing is a personal start-of-day digest, not a work standup. It appears as a widget on **Today** and as a full page at `/briefing`.

| Surface | Route | Behavior |
| ------- | ----- | -------- |
| Today widget | `GET /api/dashboard/morning-briefing` | Compact card in the Today grid (structured sections + rendered `text` summary). Weather uses a dedicated React hero (`DashboardBriefingWeather`) — separate from the AI canvas HTML on `/briefing`. |
| Briefing page | `/briefing` | Full-page **AI-authored canvas** in a same-origin iframe (`GET /api/briefing/canvas`). Reshape via **Design** chat; refresh data without losing layout. |
| MCP | `briefing_get` | Returns the same rendered text through the dashboard-backed MCP tool. |

### Canvas page (`/briefing`)

The full briefing page is no longer a fixed React layout. Instead:

1. **Data assembly** — `lib/briefing/assemble.ts` builds a `BriefingContext` from prefs, feeds, calendar, and optional AI enrichment. Cached once per calendar day under `notes/.cache/briefing/`; `?refresh=1` bypasses the cache.
2. **Canvas document** — A complete HTML/CSS/JS page persisted in `notes/.config/briefing-canvas.json` (`lib/briefing-canvas.ts`). The default ships in-repo; AI edits stick until you redesign.
3. **Iframe shell** — `app/briefing/client.tsx` embeds `/api/briefing/canvas?theme=…` so arbitrary canvas CSS cannot touch app chrome. The canvas runs same-origin and reads injected `window.__BRIEFING__` (and may call `/api/briefing/data`).
4. **Design chat** — `POST /api/briefing/design` plans and applies layout edits when `AI_API_KEY` is set. The response includes a deterministic status line (`✓ Done — the canvas has been redrawn…`) so it is obvious whether the iframe reloaded. **Fresh look** requests (new visual identity — anime, neon, retro terminal, etc.) regenerate the canvas from scratch instead of revising in place; content-only tweaks (move/hide a section) keep the current document. Custom aesthetics stick across later edits until you ask to **reset**, which restores the shipped default canvas. Canvas generation distills anti-slop rules from `skills/shared/taste-skill` when that skill is installed (`lib/briefing-taste.ts`).
5. **Share** — `POST /api/briefing/share` publishes the rendered canvas to a secret gist and returns a preview URL.
6. **Research** — Background digs on demand:
   - **Interests** in briefing prefs trigger `runLast30DaysForInterests` during assembly (skips topics with a fresh file in the research dir unless `?refresh=1`).
   - **Design chat** and `POST /api/briefing/tasks` queue one-off topics via `createResearchTask` — Last30Days when the script is installed, otherwise an AI-written brief when `AI_API_KEY` is set.
   - Task state persists in `notes/.cache/briefing/tasks.json`; results land under `LAST30DAYS_MEMORY_DIR` (default `notes/research/`).
   - **Library → Research** (`/research`) lists saved digests. **Re-scan** reloads the folder; new digs are started from Briefing, not the Research tab.
7. **AI imagery** — When image generation is configured, the canvas can reference `GET /api/briefing/image?prompt=…&size=1536x1024` for same-origin PNG backgrounds and card art. Prompts are cached on disk per model/size; a 404 hides the image cleanly via `<img>` fallbacks.

Theme is bridged from the app shell (`lib/briefing-theme.ts`) so a dark-mode canvas does not sit on a light chrome (and vice versa).

### Sections and preferences

Preferences live in `notes/.config/briefing-prefs.json` and sync with the repo like other notes config. The **Tune briefing** chat (`POST /api/briefing/prefs/chat`) updates prefs conversationally when `AI_API_KEY` is set. Manual edits use `GET`/`PUT /api/briefing/prefs`. These prefs control **what data** the canvas receives, not the canvas layout itself.

| Section | Default | Source |
| ------- | ------- | ------ |
| Weather | on | Open-Meteo forecast for the configured location |
| Dev Tip | on | AI tip from your tech stack, or a deterministic fallback |
| News | on | RSS feeds from prefs |
| Events | on | Local event search around configured areas |
| Trending Repos | on | GitHub trending by language |
| Hacker News | on | HN top stories |
| Gaming | off | Gaming RSS feeds |
| On This Day | on | Historical events |
| Family Days Out | off | Nearby attractions when `hasKids` is enabled |
| Interests | off | AI snippets for configured hobbies |

AI enrichment (dev tip, AI summary, interests) is additive: when `AI_API_KEY` is unset or a provider call fails, the briefing still loads with deterministic content. See [Environment Variables](../reference/environment-variables.md#notes-repo-learning-and-briefing-ai-optional).

### Shared AI provider

Notes in-editor AI, Repo Learning generation, briefing enrichment, and the **Tune briefing** chat all route through `dashboard/lib/ai-provider.ts`. That module reads `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL` once and returns an OpenAI-compatible Vercel AI SDK model. GLM-specific `thinking` options are only sent when the configured base URL/model look like z.ai GLM — other providers get an empty options object so unknown fields are not rejected.

## Repo Status And Content Sync

The dashboard keeps Git sync state visible without making every page own Git logic:

- `ContentSyncIndicator` is mounted in the desktop and mobile top bars. It polls `GET /api/status/git` every 30 seconds and hides itself when the repo is clean and up to date.
- The cloud button is for scoped content only: `notes/`, `collections/`, `tasks/`, `docs/`, and `upstarts/`. It runs the `sync_notes_tasks_push` action through `POST /api/scripts`. When content is clean but commits are unpushed, the cloud retries `push_unpushed_commits`.
- The warning triangle opens the **Repo Git workspace** for non-content dirty files and merge conflicts, or runs `update_and_sync` when only upstream commits are waiting (clean tree). Pre-push hook failures surface a **GitHookFailureDialog** with log excerpts and a Chamber fix-it prompt.
- The Status page is the runbook surface. It shows repo branch, dirty content vs other dirty paths, ahead/behind counts, latest failed sync logs, conflict resolution, skill sync health, service status, MCP runtime status, and LAN access.
- The MCP panel (`GET /api/status/mcp`) lists each server under `mcp/shared/` only — not plugin or personal catalog entries. It reports whether each server's launch command resolves and how many matching processes are running. Bare command names such as `npx`, `tsx`, or `uvx` count as present when they resolve on `PATH`; only absolute or relative command paths must exist on disk. Idle servers are normal — MCP clients start stdio servers on demand. Plugin and personal MCP servers sync to Cursor/Claude/etc. but do not appear here; troubleshoot those via the AI client's MCP logs and `npm install` inside the plugin's `mcp-servers/<name>/` package. **Catalog editing** (`/api/mcp*`) is separate from runtime status — use **Agents → MCP** to add or edit repo/personal entries.

### Status page runbook

The Status page (`/status`) aggregates Git, sync, services, and infra into one operational view:

| Section | What it shows | Primary actions |
| ------- | ------------- | --------------- |
| Health summary | Aggregates stopped peer services, non-content dirty paths, behind count, merge conflicts, missing MCP binaries, and last failed sync | Banner turns amber when any item is present |
| Repo | Branch, content vs other dirty counts, ahead/behind, last commit | **Sync** runs `update_and_sync` on a clean tree; **Commit & sync…** chains `commit_dirty_push` then `update_and_sync` when dirty |
| Merge conflicts | Files with conflict markers under scoped content paths | Inline edit via `ConflictResolverPanel` |
| Skill sync | `GET /api/sync-health` plus preview diffs when unhealthy | Links to Agents library; see [Skills guide](../guides/skills.md#sync-preview-before-sync) |
| Services | OpenChamber and OpenCode port probes | Restart via `POST /api/status/services/restart`; cards hidden when setup disables a peer |
| MCP | Runtime scan of `mcp/shared/` only | Idle = normal; missing binary = warning |
| Infra | AWS profile/identity and kubectl context via `GET /api/bi` (plugin-backed) | Polls every 5 minutes; links to `/ops` |
| LAN access | Wi‑Fi IPv4 badge + QR | Client builds `http://<ip>:<port>…` for phone access on the same network |

Failed sync runs surface from `GET /api/scripts/history` with log detail from `GET /api/scripts/runs/<runId>`. The **Copy Chamber prompt** button builds a fix-it prompt from the last 120 log lines for verify/pre-push failures.

The page reloads on manual refresh and polls Git/services/MCP/LAN every 30 seconds in the background.

Merge conflict recovery lives on Status through `ConflictResolverPanel`. It reads `GET /api/git/conflicts`, lets the user edit the conflicted file, and saves with `POST /api/git/conflicts`; the backend writes the resolved content and stages the file only after conflict markers are removed. The full content-sync runbook is in [Notes System -> Content sync workflow](notes-system.md#content-sync-workflow).

### Repo Git workspace

`RepoGitWorkspace` is the in-dashboard git UI for the DevHub checkout and every sibling repo on `/repos`. Open it from the top-bar warning control, a repo card's **Open Git** badge, or `/status` when code changes block sync.

| Tab | Purpose |
| --- | ------- |
| Changes | Stage/unstage (per file, hunk, or all), inline diff, scoped discard (staged vs unstaged — discarding one side does not wipe the other), AI commit message, commit-only or commit-and-push |
| Branches | Checkout, create, delete, pull, push (with pre-push hook failure handling) |
| Stash | List, apply, pop, drop; stash conflicts open the terminal with a resolve command |
| History | Commit graph, file history, show commit |
| Conflicts | Inline conflict editor (same semantics as Status) |
| Blame | Porcelain blame for a file path |

API routes are scoped under `/api/repos/<name>/git/…` (and branch push/pull under `/api/repos/<name>/branches`). See [API Routes](../reference/api-routes.md#repo-git-routes).

**DevHub-only:** personal content paths (`notes/`, `tasks/`, `docs/`, `diagrams/`, etc.) are classified by `lib/content-sync-dirs.ts` and **hidden from the Changes list** in the DevHub repo — they sync via the top-bar cloud button, not the generic commit flow. Sibling repos show every file.

| Problem | What to do |
| ------- | ---------- |
| `index.lock` / "could not write index" | Another git process may be running, or a prior command left `.git/index.lock`. DevHub never deletes the lock for you — confirm no git is active, remove the lock manually, retry. |
| Pre-push verify failed | Read the hook output in **GitHookFailureDialog** or Status → failed sync logs. Fix lint/tests/build locally (`npm run verify`), or use **Copy Chamber prompt** for an agent handoff. Emergency bypass: `DEVHUB_SKIP_VERIFY=1 git push` (see [Scripts](../reference/scripts.md#git-hooks)). |
| Wrong Node version in hook | The pre-push hook sources `nvm` when your shell's Node does not match `.nvmrc`. Run `nvm install` from repo root if verify fails under a system Node. |

## Safety Boundaries

The dashboard is powerful because it can run local scripts and write files. To keep that manageable:

- Actions are allowlisted.
- Paths are validated before file access.
- Secrets stay in local environment files or secret managers.
- Setup makes optional integrations explicit.

## Contributor Guidance

When adding dashboard features:

- Prefer a small page plus a small API route.
- Keep optional integrations graceful when unconfigured.
- Show useful loading, empty, and error states.
- Avoid making local-only features look like public APIs.
