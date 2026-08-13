---
title: Dashboard
description: "The Next.js app you use day to day: routes, data loading, storage boundaries, and where features hook in."
order: 2
icon: LayoutDashboard
tags: [architecture, dashboard]
related:
  - reference/api-routes
  - architecture/notes-system
---

# Dashboard Architecture

The dashboard is the main DevHub interface. It is a local Next.js app with pages for tasks, notes, integrations, skills, actions, status, and setup.

## What The Dashboard Provides

| Area         | Purpose                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| Today        | Daily workspace with tasks, notes, calendar, tickets, PRs, standup tools, and a morning briefing widget     |
| Briefing     | Full-page personal start-of-day digest (weather, news, events, research, and more)                          |
| Notes        | BlockNote editing, file tree, folder-scoped master checklists, optional OpenAI-compatible in-editor AI      |
| Docs         | Read-first docs site with article view, TOC, backlinks, search, Mermaid, and BlockNote edit mode            |
| Tasks        | Daily task management, drag reorder for open items, weekly review, and history                              |
| Skills       | Shared skill viewing, creation, sync, and collection                                                        |
| Actions      | Safe script runner for maintenance tasks                                                                    |
| Status       | Health checks for repo, services, MCP, sync health, merge conflicts, and network access                     |
| Setup        | Environment and integration configuration                                                                   |
| Repos        | Sibling git checkout discovery, GitHub clone/search, Cursor/GitKraken launch, compose-up, and Repo Learning |
| Integrations | Calendar, Jira, Datadog, GitHub, and internal ops views                                                     |

## Walkthroughs

### Today workspace

[Today tasks and planning walkthrough](/api/notes-assets/assets/feature-demos/demo-01-today.mp4)

When allowlisted script runs failed since your last visit, Today shows a dismissible **While you were away** banner (`WhileYouWereAway` → `GET /api/since?ts=<epoch-ms>`). The client stores the last-visit timestamp in `localStorage` (`devhub:last-visit`) and stamps it on unmount so opening the page does not immediately mark failures as seen. Successes are counted in the payload but do not surface a banner — only failures earn the alert. Default lookback is 12 hours when no prior visit is recorded.

### Morning briefing

[Briefing and design controls walkthrough](/api/notes-assets/assets/feature-demos/demo-02-briefing.mp4)

### Research and diagrams

[Research and diagrams walkthrough](/api/notes-assets/assets/feature-demos/demo-09-research-and-diagrams.mp4)

### Status, actions, and setup

[Status, Datadog, actions, and setup walkthrough](/api/notes-assets/assets/feature-demos/demo-11-status-datadog-actions-setup.mp4)

## Navigation (2026-06 IA)

The sidebar is driven by `dashboard/lib/nav.ts` — primary destinations grouped into **Workspace**, **Library**, **BI**, and **System**. Integration-gated items stay hidden until `GET /api/setup/status` reports the matching flag. Plugin destinations (e.g. Ops) merge in via `groupSidebarNav`.

| Sidebar  | Route       | Notes                                                                                  |
| -------- | ----------- | -------------------------------------------------------------------------------------- |
| Today    | `/`         | Daily hub                                                                              |
| Briefing | `/briefing` | Full morning digest                                                                    |
| Calendar | `/calendar` | Gated on `calendar`                                                                    |
| Work     | `/work`     | Tasks + Jira + History tabs (see below)                                                |
| PRs      | `/prs`      | Gated on `github`                                                                      |
| Review   | `/review`   | Weekly retrospective; desktop nav only                                                 |
| Library  | `/notes`    | Top-bar tabs: Notes, Docs, Radar, Appraisal, Research, Diagrams, Live links (gated)      |
| Recall   | `/recall`   | Hybrid retrieval over notes, docs, tasks, and the event spine — see [Recall](recall.md)   |
| Agents   | `/skills`   | Skills, persona, MCP catalog                                                           |
| Repos    | `/repos`    | Desktop nav only; sibling clones sorted by recent git activity                         |
| Own      | `/own`      | Repo ownership radar (gated on `github`); see [Repo ownership](../guides/repo-ownership.md) |
| Ops      | `/ops`      | BI group; from BI plugin (`gate: bi`)                                                  |
| Datadog  | `/datadog`  | BI group; gated on `datadog`                                                           |
| System   | `/status`   | Top-bar tabs: Status, Logs (desktop), Actions (desktop), Setup                          |
| Chamber  | `/chamber`  | Gated on `chamber`                                                                     |
| OpenCode | `/opencode` | Gated on `opencode`                                                                    |
| Claude   | `/claude`   | Gated on `claude`; desktop nav only                                                    |

### Merged destinations

**Work** (`/work`) groups “things I owe” in one shell:

| Tab     | Content                          | API                                              |
| ------- | -------------------------------- | ------------------------------------------------ |
| Tasks   | Today's open queue               | `/api/tasks`                                     |
| Jira    | Ticket list (same as `/tickets`) | Jira routes; tab hidden until Jira is configured |
| History | Per-day task summaries           | `GET /api/tasks/history?includeTasks=1`          |

**Library** and **System** use `SectionTabs` in the top bar when you land on any sibling route (for example `/docs` or `/setup`). Gated tabs (Live links) appear only when setup enables them. **System** also includes a **Logs** tab (desktop only) for live tail of shell, sidecar, and renderer logs. **BI** is a sidebar group (Ops from the BI plugin, Datadog from core) — first-class items, not System tabs.

### Legacy routes

Older URLs still work and remain reachable via **⌘K** (`LEGACY_NAV_ITEMS` in `nav.ts`): `/appraisal`, `/one-on-one`, `/radar`, `/research`, `/tasks`, `/tickets`, `/search`, `/learnings`, `/diagrams`, `/docs`, `/shared`, `/actions`, `/setup`. They no longer have permanent sidebar slots — Library section tabs cover `/radar`, `/appraisal`, and `/research`; `/learnings` stays palette-only. `/ops` (plugin) and `/datadog` live under the **BI** sidebar group.

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

| Behavior | Detail                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rollover | Open tasks from yesterday copy into today on first load; yesterday entries get `movedAt` / `movedToDate`                                                                                                     |
| Reorder  | Drag open tasks in the list (or use arrow keys on the drag handle). Only **open** tasks reorder; done, abandoned, and moved tasks keep their relative slots. Order is array position in the day's JSON file. |
| API      | See table below                                                                                                                                                                                              |

Completed and abandoned tasks stay in the file for history and standup; they are not included in reorder requests.

| Method              | Body                                          | Purpose                                              |
| ------------------- | --------------------------------------------- | ---------------------------------------------------- |
| `GET /api/tasks`    | —                                             | Runs rollover, returns `{ date, tasks[] }` for today |
| `POST /api/tasks`   | `{ text, date?, due? }`                       | Creates a task (`201`)                               |
| `PATCH /api/tasks`  | `{ ids[], date? }`                            | Reorders open tasks — every open id exactly once     |
| `PATCH /api/tasks`  | `{ id, done }`                                | Toggle complete                                      |
| `PATCH /api/tasks`  | `{ id, text?, due? }`                         | Edit text or due date                                |
| `PATCH /api/tasks`  | `{ id, status: "abandoned", abandonReason? }` | Abandon                                              |
| `PATCH /api/tasks`  | `{ id, status: "active" }`                    | Reactivate abandoned task                            |
| `PATCH /api/tasks`  | `{ id, timer: "start" \| "stop", date? }`     | Focus timer (see below)                              |
| `DELETE /api/tasks` | `{ id, date? }`                               | Remove task from the day file                        |

### Add to Jira

When Jira is configured, each task exposes an **Add to Jira** action. The modal creates a Jira issue from the task text, optionally under the task's linked parent or another key, inherits Team/sprint context from `GET /api/jira/meta`, and rewrites the task with the new key on success. See [Jira integration](../integrations/jira.md#create-tickets-from-tasks).

### Focus timer

Each task can track focused work time via `timerStartedAt` (ISO start) and `timeSpentMs` (accumulated). Only **one** timer runs per calendar day — starting a timer on a new task stops any other running timer that day and folds elapsed time into `timeSpentMs`.

| Action      | API                                                     |
| ----------- | ------------------------------------------------------- |
| Start timer | `PATCH /api/tasks` with `{ id, timer: "start", date? }` |
| Stop timer  | `PATCH /api/tasks` with `{ id, timer: "stop", date? }`  |

Completing, abandoning, or deleting a task settles any running timer into `timeSpentMs`.

### History

`GET /api/tasks/history` returns per-day summaries (`total`, `completed`, `abandoned`, `moved`, `modified`). Add `?date=YYYY-MM-DD` for one day's tasks, or `?includeTasks=1` for summaries plus full task arrays.

## Weekly Review

The **Review** page (`/review`, desktop nav) is a retrospective view over the last seven calendar days ending on a chosen date.

| Surface     | Route                                  | Behavior                                                                              |
| ----------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| Review page | `/review`                              | Per-day created/completed/abandoned/moved bars, window totals, and a **slipped** list |
| API         | `GET /api/tasks/weekly?end=YYYY-MM-DD` | Same data as JSON; `end` defaults to today                                            |
| MCP         | `tasks_weekly`                         | Dashboard-backed proxy of the weekly route                                            |

**Slipped tasks** are detected when the same task text (normalized) appears as rolled over (`moved`) on three or more distinct days within the window (`SLIP_THRESHOLD = 3`). Rollover mints a new task id each day, so slip detection compares text across days rather than ids.

Pair with [Standup](../guides/standup.md) for daily forward-looking summaries; Review is the backward-looking complement.

## Agent CLI

One-shot terminal handoffs — PR review, capability **Build lab**, DX audit, repo upstart — run through either **OpenCode** (`opencode run`) or the **Cursor CLI** (`cursor-agent -p … --force --model <model>`). The choice is global, not per feature.

| Surface    | Route / env                           | Behavior                                                                                                           |
| ---------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Setup      | `/setup → Agent CLI`                  | Pick CLI and optional model overrides                                                                              |
| Skills     | **Skills → Agent CLI**                | Same settings as Setup                                                                                             |
| API        | `GET/PUT /api/agent-cli`              | Read/save `DEVHUB_AGENT_CLI`, `DEVHUB_AGENT_OPENCODE_MODEL`, `DEVHUB_AGENT_CURSOR_MODEL` in `dashboard/.env.local` |
| Setup poll | `GET /api/setup/status` → `agentVars` | `{ cli, opencodeModel, cursorModel, cursorAgentInstalled }` for nav gates and the Cursor option                    |

OpenCode is the default (`DEVHUB_AGENT_CLI` omitted or `opencode`). Cursor appears only when `cursor-agent` resolves on `PATH`; `PUT` with `cli: "cursor"` returns `400` otherwise. Blank `opencodeModel` keeps the shared `opencode.json` default; Cursor defaults to `cursor-grok-4.5-high` when unset.

Launch wiring lives in `dashboard/lib/terminal-launch.ts`. See [OpenCode and OpenChamber — Agent CLI selection](../guides/opencode-and-chamber.md#agent-cli-selection).

## Pull Request Reviews

**PRs** (`/prs`, gated on `github`) and the Today GitHub panel read `GET /api/github/prs` — authored PRs, review-requested PRs, and recently reviewed PRs (archived repos filtered from active queues).

The **Review** row action does **not** call a review API. It opens the terminal drawer and runs the configured Agent CLI with the `pr-explain-review` skill. The skill pulls conversation, inline review threads, and the linked Jira/GitHub ticket, then saves a note at `pr-reviews/<owner-repo-slug>-<pr-number>` via notes MCP. The **Notes** link polls `GET /api/notes/pr-reviews/<slug>` every few seconds until the note exists.

Full workflow, constraints, and troubleshooting: [GitHub integration](../integrations/github.md#row-actions).

PR review notes include a `## Links` EntityRef back to the PR (same contract as task and meeting notes). The note editor footer shows inbound and outbound relations via **EntityRelationsPanel**.

## Cross-entity linking

Tasks, calendar events, PRs, and notes share hop-around links through the `EntityRef` contract (`shared/entity-note/`). UI entry points:

| Area                          | Actions                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Work → Tasks**              | **Note** opens or creates `task-notes/…`; **Link** opens searchable pickers for PR/calendar/note/repo/Jira/task refs; overflow holds secondary actions |
| **Calendar** / Today briefing | Meeting **Note** button; link chips on events                                                                                                          |
| **PRs**                       | Review note action; link chips on PR rows                                                                                                              |
| **Notes** editor              | Relations panel; **Open with** / **Apply Cursor changes** when the note links a local repo (persistent Markdown working copies)                         |

Stable path conventions, `## Links` format, API, and MCP tools: [Notes System — Cross-entity linking](notes-system.md#cross-entity-linking). Cursor working-copy workflow: [Notes System — Cursor note working copies](notes-system.md#cursor-note-working-copies).

## Capability Radar

**Library → Radar** (`/radar`) combines an automated capability scan with a personal technology radar you maintain by hand.

| Surface         | Route / tool                                                                                                                      | Behavior                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability scan | `GET /api/capability/radar`, MCP `capability_radar`                                                                               | Latest snapshot, diff (added/spread/removed), knowledge-drift rows from repo analysis                                                                                   |
| Personal strip  | `GET /api/radar/personal`                                                                                                         | Parses `notes/radar/personal-radar.md` into adopt / trial / assess / hold items                                                                                         |
| Scan action     | `POST /api/capability/scan`, MCP `capability_scan`                                                                                | Full scan; writes dated snapshot under `notes/.cache/capability/`                                                                                                       |
| Weekly digest   | `POST /api/capability/digest`, job `capability_digest`                                                                            | Generate or return digest markdown                                                                                                                                      |
| Build lab       | Agent CLI + `capability-lab` skill (`GET /api/capability/journey/plan` → terminal handoff → `POST /api/capability/journey/adopt`) | Generation runs in the terminal; `POST /api/capability/journey` and MCP `capability_get_lab` only **fetch** an existing lab. Notes land under `notes/learnings/labs/…`. |

### Personal radar file

The top strip on `/radar` is **not** generated by the capability scan. Edit `notes/radar/personal-radar.md` (or follow the in-app link) using four `##` headings — **Adopt**, **Trial**, **Assess**, **Hold** — with bullet items under each. The parser is case-insensitive on headings and accepts `-` or `*` bullets. An empty or missing file shows the empty-state prompt; Today may deep-link here when knowledge drift is detected and the file exists.

See [Capability Radar plan](../archive/capability-radar-plan.md) for scan architecture and lab workflow.

## Recall

**Library → Recall** (`/recall`) is the interactive face of the derived memory layer described in [Recall](recall.md). It ranks passages from notes, docs, learnings, task history, and the append-only event spine with hybrid BM25 + vector fusion, a token budget slider, and per-hit score breakdown.

| Surface | Route / tool | Behavior |
| ------- | ------------ | -------- |
| Recall page | `/recall` | Query UI with budget and keyword↔vector blend; optional graph view of co-occurring sources |
| API | `GET /api/recall?q=` | JSON hits plus `grade` (`strong` / `weak` / `none`); `format=markdown` adds a pre-rendered block for clipboard or agents |
| Index | `POST /api/recall/index` | Rebuild the gitignored index under `notes/.index/recall/` (safe to delete anytime) |
| MCP | `recall`, `recall_graph`, `recall_remember`, `recall_index` | Agent-facing retrieval and event append |

The context pack (`GET /api/context-pack`) also calls `recall` internally when ranking learnings for the day's standup query. See [API Routes](../reference/api-routes.md).

## Own (repo ownership)

**Library → Own** (`/own`, gated on GitHub) tracks repositories you are accountable for — inbound PRs, obligation health, knowledge gaps, and catch-up digests. Mark repos owned from `/repos` or the Own index; state lives in `.devhub/ownership/repos.json` (not hand-edited). Full workflow: [Repo ownership](../guides/repo-ownership.md).

## Morning Briefing

The morning briefing is a personal start-of-day digest, not a work standup. It appears as a widget on **Today** and as a full page at `/briefing`.

| Surface       | Route                                 | Behavior                                                                                                                                                                                            |
| ------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Today widget  | `GET /api/dashboard/morning-briefing` | Compact card in the Today grid (structured sections + rendered `text` summary). Weather uses a dedicated React hero (`DashboardBriefingWeather`) — separate from the AI canvas HTML on `/briefing`. |
| Briefing page | `/briefing`                           | Full-page **AI-authored canvas** in a same-origin iframe (`GET /api/briefing/canvas`). Reshape via **Design** chat; refresh data without losing layout.                                             |
| MCP           | `briefing_get`                        | Returns the same rendered text through the dashboard-backed MCP tool.                                                                                                                               |

### Canvas page (`/briefing`)

The full briefing page is no longer a fixed React layout. Instead:

1. **Data assembly** — `lib/briefing/assemble.ts` builds a `BriefingContext` from prefs, feeds, calendar, and optional AI enrichment. Cached once per calendar day under `notes/.cache/briefing/`; `?refresh=1` bypasses the cache.
2. **Canvas document** — A complete HTML/CSS/JS page persisted in `notes/.config/briefing-canvas.json` (`lib/briefing-canvas.ts`). The default ships in-repo; AI edits stick until you redesign.
3. **Iframe shell** — `app/briefing/client.tsx` embeds `/api/briefing/canvas?theme=…` so arbitrary canvas CSS cannot touch app chrome. The canvas runs same-origin and reads injected `window.__BRIEFING__` (and may call `/api/briefing/data`).
4. **Design chat** — `POST /api/briefing/design` plans and applies layout edits when `AI_API_KEY` is set. The response includes a deterministic status line (`✓ Done — the canvas has been redrawn…`) so it is obvious whether the iframe reloaded; prefs-only edits append **Preferences saved.** **Fresh look** requests (new visual identity — anime, neon, retro terminal, etc.) set `freshLook` and persist `customAesthetic: true` in `notes/.config/briefing-canvas.json`, which **replaces** the house palette rules in the generation prompt (not layered on top). The canvas regenerates from scratch instead of revising in place. Content-only tweaks (move/hide a section) keep the current document and house theme. Custom aesthetics stick across later edits until you ask to **reset**, which restores the shipped default canvas and clears `customAesthetic`. When `skills/shared/taste-skill` is installed, `lib/briefing-taste.ts` distills its anti-slop rules for the default (house) aesthetic; the skill itself targets landing pages, so only a compact subset is fed into briefing generation.
5. **Share** — `GET/POST/DELETE /api/briefing/share` reads, publishes, or removes a secret gist snapshot of the rendered canvas.
6. **Research** — Background digs on demand:
   - **Interests** in briefing prefs trigger `runLast30DaysForInterests` during assembly (skips topics with a fresh file in the research dir unless `?refresh=1`).
   - **Design chat** and `POST /api/briefing/tasks` queue one-off topics via `createResearchTask` — Last30Days when the script is installed, otherwise an AI-written brief when `AI_API_KEY` is set.
   - Task state persists in `notes/.cache/briefing/tasks.json`; results land under `LAST30DAYS_MEMORY_DIR` (default `notes/research/`).
   - **Library → Research** (`/research`) lists saved digests. **Re-scan** reloads the folder; new digs are started from Briefing, not the Research tab.
7. **AI imagery** — When image generation is configured, the canvas can reference `GET /api/briefing/image?prompt=…&size=1536x1024` for same-origin PNG backgrounds and card art. Prompts are cached on disk per model/size; a 404 hides the image cleanly via `<img>` fallbacks.

Theme is bridged from the app shell (`lib/briefing-theme.ts`) so a dark-mode canvas does not sit on a light chrome (and vice versa).

### Sections and preferences

Preferences live in `notes/.config/briefing-prefs.json` and sync with the repo like other notes config. There is no dedicated prefs API — edit the JSON directly, or ask **Design** chat (`POST /api/briefing/design`) to patch fields (location, feeds, section toggles, interests). Prefs control **what data** the canvas receives, not the canvas layout itself.

| Section             | Default | Source                                                             |
| ------------------- | ------- | ------------------------------------------------------------------ |
| Weather             | on      | Open-Meteo forecast for `location` (`name`, `lat`, `lon`) in prefs |
| News                | on      | RSS feeds from prefs                                               |
| Events              | on      | Local event search around `eventSearchAreas`                       |
| Trending Repos      | on      | GitHub trending by `repoLanguages`                                 |
| Hacker News         | on      | HN top stories                                                     |
| Gaming              | off     | Gaming RSS feeds                                                   |
| On This Day         | on      | Historical events                                                  |
| Family Days Out     | off     | Nearby attractions when `hasKids` is enabled                       |
| Background Research | on      | Cached Last30Days briefs for configured interests                  |
| Interests           | off     | AI snippets for configured hobbies (requires `AI_API_KEY`)         |

The Today widget weather hero (`DashboardBriefingWeather`) is separate from the `/briefing` canvas — it uses thermal/atmosphere bands derived from Open-Meteo codes and does not reload when you redesign the canvas.

AI enrichment (interests, design chat, research fallbacks) is additive: when `AI_API_KEY` is unset or a provider call fails, the briefing still loads with deterministic content. See [Environment Variables](../reference/environment-variables.md#notes-repo-learning-and-briefing-ai-optional).

### Shared AI provider

Notes in-editor AI, Repo Learning generation, briefing design chat, and interest snippets all route through `dashboard/lib/ai-provider.ts`. That module reads `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL` once and returns an OpenAI-compatible Vercel AI SDK model. GLM-specific `thinking` options are only sent when the configured base URL/model look like z.ai GLM — other providers get an empty options object so unknown fields are not rejected.

## Repo Status And Content Sync

The dashboard keeps Git sync state visible without making every page own Git logic:

- `ContentSyncIndicator` is mounted in the desktop and mobile top bars. It polls `GET /api/status/git` every 30 seconds and hides itself when the repo is clean and up to date.
- The cloud button is for scoped content only: `notes/`, `collections/`, `tasks/`, `docs/`, and `upstarts/`. It runs the `sync_notes_tasks_push` action through `POST /api/scripts`. When content is clean but commits are unpushed, the cloud retries `push_unpushed_commits`.
- On the packaged desktop app, content sync (`sync_notes_tasks_push`), `update_and_sync`, and `sync_skills` read git state from the **linked checkout**, not app-data. Without a linked checkout they fail with "No linked git checkout". Attach via **View → Attach to Dev Server…** or see [Scripts — Linked checkout requirement](../reference/scripts.md#linked-checkout-requirement).
- The warning triangle opens the **Repo Git workspace** for non-content dirty files and merge conflicts, or runs `update_and_sync` when only **origin** commits are waiting (clean tree). Pre-push hook failures surface a **GitHookFailureDialog** with log excerpts and a Chamber fix-it prompt.
- **Origin vs public core:** `update_and_sync` pulls/rebases from `origin` (your private mirror remote). Porting changes from the public template uses `pull_core` / `pull_core_preview` via `POST /api/scripts` → `scripts/devhub-update.sh`. **Backport** (`scripts/devhub-backport.sh`) is intentionally CLI/skill-only — there is no dashboard API. See [Fork workflow](../contributing/fork-workflow.md) and [Scripts](../reference/scripts.md).
- The Status page is the runbook surface. It shows repo branch, dirty content vs other dirty paths, ahead/behind counts, latest failed sync logs, conflict resolution, skill sync health, service status, MCP runtime status, and LAN access.
- The MCP panel (`GET /api/status/mcp`) lists each server under `mcp/shared/` only — not plugin or personal catalog entries. It reports whether each server's launch command resolves and how many matching processes are running. Bare command names such as `npx`, `tsx`, or `uvx` count as present when they resolve on `PATH`; only absolute or relative command paths must exist on disk. Idle servers are normal — MCP clients start stdio servers on demand. Plugin and personal MCP servers sync to Cursor/Claude/etc. but do not appear here; troubleshoot those via the AI client's MCP logs and `npm install` inside the plugin's `mcp-servers/<name>/` package. **Catalog editing** (`/api/mcp*`) is separate from runtime status — use **Agents → MCP** to add or edit repo/personal entries.

### Status page runbook

The Status page (`/status`) aggregates Git, sync, services, and infra into one operational view:

| Section                | What it shows                                                                                                                        | Primary actions                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health summary         | Aggregates stopped peer services, non-content dirty paths, behind count, merge conflicts, missing MCP binaries, and last failed sync | Banner turns amber when any item is present                                                                                                                                                                                                                                                                                 |
| Plugin materialization | `GET /api/status/materialized` — compares plugin-owned dashboard copies to plugin source                                             | Amber banner when core copies diverge from the plugin checkout (edits there are lost on `sync_plugins` / `predev`)                                                                                                                                                                                                          |
| Repo                   | Branch, content vs other dirty counts, ahead/behind, last commit                                                                     | **Sync** runs `update_and_sync` on a clean tree; **Commit & sync…** chains `commit_dirty_push` then `update_and_sync` when dirty                                                                                                                                                                                            |
| Merge conflicts        | Files with conflict markers under scoped content paths                                                                               | Inline edit via `ConflictResolverPanel`                                                                                                                                                                                                                                                                                     |
| Skill sync             | `GET /api/sync-health` plus preview diffs when unhealthy                                                                             | Links to Agents library; see [Skills guide](../guides/skills.md#sync-preview-before-sync)                                                                                                                                                                                                                                   |
| Services               | OpenChamber and OpenCode port probes                                                                                                 | Restart via `POST /api/status/services/restart`; cards hidden when setup disables a peer                                                                                                                                                                                                                                    |
| MCP                    | Runtime scan of `mcp/shared/` only                                                                                                   | Idle = normal; missing binary = warning                                                                                                                                                                                                                                                                                     |
| Infra                  | AWS profile/identity and kubectl context via `GET /api/bi` (plugin-backed)                                                           | Polls every 5 minutes; links to `/ops`                                                                                                                                                                                                                                                                                      |
| LAN access             | Wi‑Fi IPv4 badge + QR                                                                                                                | Client builds `http://<ip>:<port>…` for phone access on the same network                                                                                                                                                                                                                                                    |
| Dashboard rebuild      | `GET/POST /api/status/dashboard/rebuild`                                                                                             | **Rebuild & restart** runs `npm run restart` in the linked checkout (production build + relaunch). Unavailable when the desktop shell supervises the server (`DEVHUB_SHELL_SUPERVISED=1`) or in a packaged app — use **View → Rebuild Dashboard…** or **Check for Updates** instead. Reopening DevHub does **not** rebuild. |

Failed sync runs surface from `GET /api/scripts/history` with log detail from `GET /api/scripts/runs/<runId>`. The **Copy Chamber prompt** button builds a fix-it prompt from the last 120 log lines for verify/pre-push failures.

### Desktop logs (`/logs`)

On desktop, **System → Logs** (`/logs`, also in ⌘K) tails the rotating log files under the OS app-data directory (`~/Library/Application Support/DevHub/logs/` on macOS). The page polls `GET /api/status/logs` every two seconds while **Live** is on, with filters for `shell`, `sidecar`, and `renderer` sources. **Open folder** calls the Tauri `open_logs` bridge when available. For startup failures before the dashboard loads, see [Desktop recovery](../guides/desktop-recovery.md).

The page reloads on manual refresh and polls Git/services/MCP/LAN every 30 seconds in the background.

Merge conflict recovery lives on Status through `ConflictResolverPanel`. It reads `GET /api/git/conflicts`, lets the user edit the conflicted file, and saves with `POST /api/git/conflicts`; the backend writes the resolved content and stages the file only after conflict markers are removed. The full content-sync runbook is in [Notes System -> Content sync workflow](notes-system.md#content-sync-workflow).

### Repo Git workspace

`RepoGitWorkspace` is the in-dashboard git UI for the DevHub checkout and every sibling repo on `/repos`. Open it from the top-bar warning control, a repo card's **Open Git** badge, or `/status` when code changes block sync.

| Tab       | Purpose                                                                                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Changes   | Stage/unstage (per file, hunk, or all), inline diff with **find** (`⌘F` / `Ctrl+F` while focused), scoped discard (staged vs unstaged — discarding one side does not wipe the other), **Usually changed together** coupling hints (historical co-change ratios from the last 800 commits — advisory, not a gate), AI commit message, commit-only or commit-and-push |
| Branches  | Checkout, create, delete, fetch, pull, push (with pre-push hook failure handling); **Remotes** section to add/rename/remove remotes and set fetch/push URLs |
| Stash     | List, apply, pop, drop; stash conflicts open the terminal with a resolve command                                                                                                          |
| History   | Commit graph (windowed for large repos) with **trusted avatars** per author (see below), branch relation banner (ahead/behind upstream) with inline **Fetch** / **Pull**, author/search filters, commit detail with file list + diff + **commit context** chips (Jira keys, local PR review notes), per-commit actions (cherry-pick, revert, tag, detached checkout, reset, branch-from-commit), **Compare branch** range diff vs default remote branch, **Open with → Cursor** at a historical revision |
| Conflicts | Inline conflict editor (same semantics as Status)                                                                                                                                         |
| Blame     | Searchable file picker (`GET /api/repos/<name>/git/files`), porcelain blame, commit context chips, **In History** handoff to the History tab, **Open with → Cursor** at the blamed revision |
| Worktrees | List linked worktrees, add/remove, lock/unlock, prune stale entries; sibling scan directory correctly resolves worktree `.git` pointers |
| Reflog    | Recent reflog with reachable vs **unreachable** commits flagged — recovery path after a bad reset |

**Diff panes** share a toolbar: context lines (default / none / full), maximize to a modal, and in-pane find. Split layouts (History file list ↔ diff, Stash list ↔ diff, range compare) are resizable; pane fractions persist in `localStorage`.

Press **`?`** while the Repo Git workspace is focused for its **context shortcuts** overlay (not the global app shortcuts from [Command palette](../guides/command-palette.md#keyboard-shortcuts)). Tab-aware bindings include History `j`/`k` commit navigation, split-pane resize (`Tab` to focus the handle, `←`/`→` resize, `Home`/`End` snap), and diff find (`⌘F` / `Ctrl+F` when a diff pane is focused). `Esc` closes the top-most dialog.

**Compare branch** (History tab) opens a range diff with `base...head` (defaults: `head=HEAD`, `base` = merge-base with the repo's default remote branch). The modal lists changed files; selecting one shows a unified diff with the same toolbar as commit detail. Ahead/behind counts in the banner reflect `head` vs `base`. API: `GET /api/repos/<name>/git/range?base=&head=&path=`.

**Usually changed together** (Changes tab) calls `GET /api/repos/<name>/git/coupling?paths=` for staged/unstaged paths. Suggestions come from the last 800 non-merge commits (5-minute in-process cache). Each hint shows how often the suggested file changed in the same commit as your selection — advisory, not a linter rule.

**Commit context** joins git history to local reasoning: `GET /api/repos/<name>/git/commit-context?commit=` parses the commit subject/body for PR numbers and Jira keys, then matches review notes under `notes/pr-reviews/` (`pr` = same PR, `ticket` = same Jira key, `related` = same ticket in a different repo). Chips appear on History commit detail and Blame. Hosted git cannot do this — the notes never leave your machine. See [GitHub integration — Review notes in Git history](../integrations/github.md#review-notes-in-git-history).

**Commit avatars** resolve through a trusted CDN allowlist (`lib/people/avatar-trust.ts`): GitHub (`avatars.githubusercontent.com` and `users.noreply.github.com` addresses), Atlassian/Jira avatars, then Gravatar when available. `GET /api/repos/<name>/git/people` merges contributor identities across email aliases; History and the commit graph load avatars from that map. Email-only surfaces (calendar organizers, Jira tickets) fall back to `GET /api/people/avatar?email=`. Untrusted URLs are rejected — initials render instead. Click an avatar to open a full-resolution variant when the host supports it.

When the checkout is on a feature branch with an open GitHub PR, the workspace header and `/repos` cards show a compact PR link plus rolled-up CI state (`passing` / `failing` / `pending`) from `GET /api/repos/<name>/pr` (requires `gh auth login`; skipped on the repo's default branch).

API routes are scoped under `/api/repos/<name>/git/…` (and branch push/pull under `/api/repos/<name>/branches`). See [API Routes](../reference/api-routes.md#repo-git-routes).

**DevHub-only:** personal content paths (`notes/`, `tasks/`, `collections/`, `upstarts/`, `docs/`, plus env-resolved content dirs) are classified by `lib/content-sync-dirs.ts` and **hidden from the Changes list** in the DevHub repo. Scoped sync (`sync_notes_tasks_push`) covers `notes/`, `collections/`, `tasks/`, `docs/`, and `upstarts/` — **not** `diagrams/`, which must be committed through the Repo Git workspace or a manual commit. Sibling repos show every file.

| Problem                                | What to do                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.lock` / "could not write index" | Another git process may be running, or a prior command left `.git/index.lock`. DevHub never deletes the lock for you — confirm no git is active, remove the lock manually, retry.                                                                                                                                                                                                                       |
| Pre-push verify failed                 | Read the hook output in **GitHookFailureDialog** or Status → failed sync logs. Full output is also written to `.git/devhub-hook-failure.log` in the repo. Fix lint/tests/build locally (`npm run verify`), or use **Copy Chamber prompt** / the `git-hook-fix` terminal handoff for an agent fix. Emergency bypass: `DEVHUB_SKIP_VERIFY=1 git push` (see [Scripts](../reference/scripts.md#git-hooks)). |
| Stash apply left conflicts             | The terminal drawer opens with the `git-conflict-resolve` skill preloaded. Resolve markers, then retry apply/pop from the Stash tab.                                                                                                                                                                                                                                                                    |
| Wrong Node version in hook             | The pre-push hook sources `nvm` when your shell's Node does not match `.nvmrc`. Run `nvm install` from repo root if verify fails under a system Node.                                                                                                                                                                                                                                                   |

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
