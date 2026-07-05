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
| Integrations | Calendar, Jira, Datadog, GitHub, and internal ops views                      |

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
| Today widget | `GET /api/dashboard/morning-briefing` | Compact card in the Today grid. |
| Briefing page | `/briefing` | Full layout with collapsible sections and refresh. |
| MCP | `briefing_get` | Returns the same rendered text through the dashboard-backed MCP tool. |

The API fetches only sections the user has enabled in briefing preferences. Results are cached once per calendar day under `notes/.cache/briefing/`; add `?refresh=1` to bypass the cache.

### Sections and preferences

Preferences live in `notes/.config/briefing-prefs.json` and sync with the repo like other notes config. The **Tune briefing** chat on `/briefing` (`POST /api/briefing/prefs/chat`) updates prefs conversationally when `AI_API_KEY` is set. Manual edits use `GET`/`PUT /api/briefing/prefs`.

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
- The cloud button is for scoped content only: `notes/`, `collections/`, `tasks/`, and `docs/`. It runs the `sync_notes_tasks_push` action through `POST /api/scripts`.
- The warning triangle is for blockers and broader Git work: non-content dirty files run `commit_dirty_push`, upstream-only changes run `update_and_sync`, and merge conflicts send the user to `/status`.
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
