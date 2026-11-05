---
title: Dashboard
description: "The dashboard UI and core server: routes, storage boundaries, and where features hook in."
order: 2
icon: LayoutDashboard
tags: [architecture, dashboard]
related:
  - reference/api-routes
  - architecture/notes-system
  - architecture/database-client
  - integrations/github
---

# Dashboard Architecture

The dashboard is the main DevHub interface, with pages for tasks, notes, skills, actions, status, and setup.

The React UI and existing route adapters live in `apps/ui`; server domains and the core HTTP server live in `apps/core/src`, with shared contracts and filesystem modules in `packages/shared`. The desktop shell is in `apps/desktop` and the MCP server is in `packages/mcp`. Content roots such as `notes/` and `tasks/` have not moved.

The core/Vite checkout is still opt-in: `DEVHUB_CORE_SERVER=1 npm run dev` supervises Vite, core and the terminal. Vite listens on 1437 and proxies `/api` to a loopback core listener; the terminal uses 1439. The core server can serve built UI assets from `apps/ui/dist` on the same origin, after its API routes. See `apps/core/src/http/BLOCKED.md` for routes that still return 501.

For a staged core, set `DEVHUB_CORE_SERVER=1`, `DEVHUB_RESOURCE_ROOT` to the read-only resource directory and `DEVHUB_APP_DATA` to a writable directory outside it. The Vite output defaults to `ui/dist` under the resource root; set `DEVHUB_UI_DIST` to use a different location. A checkout defaults both roots to the checkout and serves `apps/ui/dist`. The server only binds to loopback. Route ownership is generated with `scripts/gen-core-routes.mjs`, so startup does not need Git or source files.

The default `npm run dev`, `npm run build` and desktop staging still use Next. The core/Vite production cutover and desktop candidate are not complete; `DEVHUB_DESKTOP_VITE_CANDIDATE=1` is rejected by staging. Do not treat a Next build or a browser WebKit run as proof of the new desktop layout.

## Build and target checks

From the repo root, `npm run build` currently builds the Next UI. `npm run desktop:build` stages that server and builds the native bundle; `npm run desktop:verify` checks the staged resources, and `npm run desktop:selftest` checks startup, authentication and a file round-trip. The WSL payload and Linux builder use the same desktop staging pipeline under `apps/desktop/scripts/`.

The final core/Vite build must stage core with the UI assets, preserve the `server.js` sidecar entry and health handshake, and pass the self-test against that staged layout. Until that pipeline and the core routes are ready, target results for it are unverified. The disposable-clone procedures and results template are in [Desktop target checks](../../scripts/targets/README.md).

## What The Dashboard Provides

| Area         | Purpose                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| Work | Home screen for tasks, Jira and history |
| Notifications | Updates needing attention, shown by the top-bar bell with a count badge |
| Notes        | BlockNote editing, file tree, folder-scoped master checklists, optional OpenAI-compatible in-editor AI      |
| Docs         | Read-first docs site with article view, TOC, backlinks, search, Mermaid, and BlockNote edit mode            |
| Tasks        | Daily task management, drag reorder for open items, weekly review, and history                              |
| Agent skills | Shared skill viewing, creation, sync, and collection (`/skills`, linked from Settings)                      |
| Actions      | Safe script runner for maintenance tasks                                                                    |
| Settings     | Health checks for repo, services, MCP, sync health, merge conflicts, and network access (`/status`)         |
| Agents       | Paseo workspace: chats, usage, connection (`/agents`)                                                       |
| Setup        | Environment and integration configuration                                                                   |
| Repos        | Sibling git checkout discovery, per-repo **work hub**, GitHub clone/search, Cursor/GitKraken/CLI launch, compose-up, Repo Learning, and owned-repo radar (`?view=owned`) |
| Databases    | In-app client for PostgreSQL, MongoDB, and SQLite (`/db`) — see [Database client](database-client.md)       |
| Integrations | Calendar, Jira, Datadog, GitHub and Slack |
| Editor       | Selection chat beside a diff, plus Cursor/VS Code pairing (`/editor`). See [Editor](../guides/editor.md) |
| Workflows    | Durable checks, reviews and publication proposals (Storyboard task panel → Evidence). See [Task checks](../guides/task-checks-and-reviews.md) |

## Walkthroughs

Recorded against disposable demo data.

### Tasks, history and weekly review

[Tasks: filtering tasks, history and the weekly review](../assets/demos/work.mp4)

### Repos

[Repos: local clones and the per-repo hub](../assets/demos/repos.mp4)

### Diagrams and docs

[Diagrams and the in-app docs](../assets/demos/diagrams-and-docs.mp4)

### Settings and setup

[Settings: status tabs and setup](../assets/demos/system.mp4)

Notes, search and the command palette have their own clips in [Notes system](notes-system.md#walkthroughs) and [Command palette](../guides/command-palette.md#walkthrough).

## Navigation

The sidebar is driven by `packages/shared/ui-lib/navigation/nav.ts` (`NAV_ITEMS`), grouped into **Workspace**, **Library**, **Tools** (the `infra` group id), and **System**. Integration-gated items stay hidden until `GET /api/setup/status` reports the matching flag. Plugin destinations (e.g. Ops) merge in via `groupSidebarNav`.

**Work** (`/work`) is the home screen. QA, Review and Skills keep their existing destinations. Notifications live on the top-bar bell (badge + count); there is no dedicated page — `/notifications` and `/briefing` redirect to `/work`.

Coding chats live on **Agents** (`/agents`). There are no sidebar rows that open a Claude / Cursor / ChatGPT / Antigravity terminal tab.

| Sidebar    | Route       | Notes                                                                                         |
| ---------- | ----------- | --------------------------------------------------------------------------------------------- |
| Storyboard | `/storyboard` | Tasks followed through their notes and agent runs                                           |
| Tasks      | `/work`     | Tasks + Jira + History tabs (see below). The URL predates the name; ⌘P still finds it as "Work" |
| PRs        | `/prs`      | Gated on `github`. Tabs: Mine / Review requested / Recently reviewed / Skipped / Worktrees (`?tab=cleanup`) |
| Calendar   | `/calendar` | Gated on `calendar`                                                                           |
| Notes      | `/notes`    | Library landing. Top-bar tabs: Notes, Docs, Diagrams, Live links (gated), Radar |
| Search     | `/search`   | Unified discovery (notes/docs + Recall). Library sidebar slot                                 |
| Repos      | `/repos`    | Desktop nav only; sibling clones sorted by recent git activity. Click a card for `/repos/<name>` (work hub). Owned radar at `?view=owned` |
| Ops        | `/ops`      | Tools group; from a plugin (`gate: infra`)                                                    |
| Datadog    | `/datadog`  | Tools group; gated on `datadog`                                                               |
| Databases  | `/db`       | Tools group. Desktop nav only, **ungated**. SQLite works with no setup; plugins can add connection providers. See [Database client](database-client.md) |
| Agents     | `/agents`   | System group. Tabs: Chats / Usage / Connection (old `?view=activity` links open Chats). See [Agents (Paseo)](../guides/paseo-agents.md) |
| Settings   | `/status`   | System group. Top-bar tabs: Status, Logs (desktop), Actions (desktop), Plugins, Setup. Links under the title: Agent skills, QA lab |

### Merged destinations

**Tasks** (`/work`) groups “things I owe” in one shell:

| Tab     | Content                          | API                                              |
| ------- | -------------------------------- | ------------------------------------------------ |
| Tasks   | Today's open queue               | `/api/tasks`                                     |
| Jira    | Ticket list | Jira routes; tab hidden until Jira is configured |
| History | Per-day task summaries           | `GET /api/tasks/history?includeTasks=1`          |

All three tabs share the same borderless `InlineSearch` row. **Tasks** filters on
body text, Jira key, due date, abandon reason, and linked-entity labels/ids.
**Jira** filters on key, summary, status, priority, type, project, and assignee.
**History** uses the same control for day summaries and links to the **Weekly
review** (`/review`). Whitespace-separated terms are AND-ed on every tab.

**Library** and **Settings** use `SectionTabs` in the top bar on sibling routes such as `/docs` and `/setup`. Library tabs are **Notes**, **Docs**, **Diagrams**, **Live links** (gated on GitHub), and **Radar**. Search and Databases have sidebar destinations. Research, My Voice and Conventions remain reachable through **⌘P**. The optional Career plugin adds Appraisal and 1:1 to the palette when enabled.

Settings tabs are **Status**, **Logs** (desktop), **Actions** (desktop), **Plugins** and **Setup**. Agent skills and the QA lab are links under the Settings title rather than tabs, because the top-bar strip is already as wide as the bar allows. **Tools** is a sidebar group (id `infra`): Ops comes from the infrastructure plugin, Datadog and Databases from core.

**Diagrams** (`/diagrams`, Library tab) opens a browse-by-folder landing page — recent diagrams plus folder cards (`lib/diagrams/diagram-browse.ts`). Click a card or recent item to open the tldraw editor at `/diagrams/[...path]`.

### Top bar at laptop widths

The header (`HubTopBar`) follows **its own** width (CSS container queries on `.hub-topbar`), not the window's. Left to right: section, search, focus, panels, then preferences (appearance, Setup, profile).

| Bar width | What folds |
| --------- | ---------- |
| Under ~840px, or under ~1040px when there are more than five section tabs | Library/System tabs become a **Section** dropdown labelled with the current page |
| Under ~1350px | Notes, tasks and diagrams fold into a **Panels** button. Terminal stays visible. Setup stays with appearance and profile — it is not in Panels |
| Under ~1160px | Search and idle Focus shrink to icons; Profiles shrinks to an initial. An empty sync slot collapses so it does not leave a gap |

Pointer-opened menus do not auto-focus the first item (that drew a thick ring). Keyboard focus uses one inset ring on the outer control. `⌘N` / `⌘T` / `⌘D` still toggle the panels when the labels are folded. Verified not to overlap from 900px up in Graphite Neon (Default) and Hollow (Halloween).

### What's new

After an update, a once-per-version **What's new** panel reads `GET /api/release-notes` (parsed `CHANGELOG.md`). Dismissal lives in `localStorage` (`devhub:release-notes:desktop` or `:web`) and hides the sidebar pill until the next version. Reopen it from **⌘P → What's new**, **Setup → About**, or `/changelog`. Desktop update banners show incoming notes before install. MCP `release_notes_read` reads the changelog without the dashboard.

### Legacy routes

Older URLs still work and remain reachable via **⌘P** (`LEGACY_NAV_ITEMS` in `nav.ts`): `/review` (**Weekly review**), `/review/rep` (**Daily rep**), `/qa` (**QA lab**), `/skills` (**Agent skills**), `/recall`, `/radar`, `/learnings`, `/voice`, `/conventions`, `/diagrams`, `/docs`, `/shared`, `/actions`, `/logs`, `/setup`. A page that lost its row names the row it lives under (`parent` in `nav.ts`), so the sidebar still shows where you are: `/review` lights Tasks, `/qa` and `/skills` light Settings. The tab title, workspace tab and ⌘P entry for every page come from the same registry. Library tabs cover `/radar`, `/diagrams`, `/docs`, and `/shared`; the other Library tools stay in the palette. Owned repos live at `/repos?view=owned`; tasks and Jira at `/work`. `/ops` (plugin), `/datadog` and `/db` live under the **Tools** sidebar group.

Career exposes `/appraisal`, `/one-on-one` and `/api/appraisal/*` through reviewed runtime aliases and navigation.

Notification counts live on the top-bar bell in both the desktop and mobile chrome.

### Repo-aware links

Tasks, BlockNote notes, Repo Learning tutor output, and lightweight markdown renderers recognize **`repo://`** and **`repo:`** links to sibling clones under the Repos scan directory:

```text
repo://my-service/src/auth.ts#L42
repo:my-service/docs/README.md
```

Clicking calls `POST /api/repos/<name>/open`. The route body is `{ filePath?, notePath?, worktree? }` — not `path` / `line`. `openPathInCursor` passes those paths to the `cursor` CLI as extra folders/files (no `cursor -g path:line`). Invalid repo names or `..` path segments are rejected. Links only work for repos DevHub already tracks — use the Repos page to clone first.

The in-app handler (`openRepoLinkHref` in `lib/repos/link.ts`) sends `filePath`, so links open the file in Cursor. A `#L42` fragment is parsed but isn't passed to Cursor; line-number navigation isn't supported.

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

A task is one file under `tasks/items/` (or `tasks/<profile>/items/`). It stays visible from `startDate` through `endDate`, or through today while it is open. [Task profiles](../guides/task-profiles.md) select the directory. The model, import, and two-machine update order are in [Tasks](tasks.md). **Work** reads and mutates items through `/api/tasks`.

| Behavior | Detail |
| -------- | ------ |
| Open work | An unfinished task stays on today without being copied. Slip is `startDate` before today while the task is still open. |
| Reorder | Drag open tasks (or use arrow keys on the drag handle). Only **open** tasks reorder. Order is a fractional `rank` on that item. |
| API | See table below |

Completed, abandoned, and ended tasks stay in history and standup. They are not part of a reorder.

| Method              | Body                                          | Purpose                                              |
| ------------------- | --------------------------------------------- | ---------------------------------------------------- |
| `GET /api/tasks`    | —                                             | Imports leftover day files, returns `{ date, tasks[], migrationNotice? }` for today |
| `POST /api/tasks`   | `{ text, date?, due? }`                       | Creates a task (`201`)                               |
| `PATCH /api/tasks`  | `{ ids[], date? }`                            | Reorders open tasks — every open id exactly once     |
| `PATCH /api/tasks`  | `{ id, done }`                                | Toggle complete                                      |
| `PATCH /api/tasks`  | `{ id, text?, due? }`                         | Edit text or due date                                |
| `PATCH /api/tasks`  | `{ id, status: "abandoned", abandonReason? }` | Abandon                                              |
| `PATCH /api/tasks`  | `{ id, status: "active" }`                    | Reactivate abandoned task                            |
| `PATCH /api/tasks`  | `{ id, timer: "start" \| "stop", date? }`     | Focus timer (see below)                              |
| `DELETE /api/tasks` | `{ id, date? }`                               | Remove the item. A legacy-backed task leaves `tasks/deleted/<id>.json` |

### Add to Jira

When Jira is configured, the task menu offers **Generate Jira ticket…** and **Add to Jira manually…**. Both open an editable draft before issue creation. The form can use a linked parent, inherits Team/sprint context from `GET /api/jira/meta`, and adds the new key to the task on success. See [Jira integration](../integrations/jira.md#create-tickets-from-tasks).

### Implement with agent

Task overflow **Implement with Agent…** (Work and the repo hub) opens the Agents handoff sheet and starts a Paseo agent with the `devhub-implement-task` skill. It does not start until you pick an assistant.

The agent curls `GET /api/tasks/implement/plan?taskId=&date=` first — tags, linked notes/repos, Jira ticket, and a depth-2 entity graph. Repo choice comes from the **task's own** `kind: "repo"` links (a back-link from another repo must not steal the checkout). Hub rows pass the hub's `cwd` so the agent stays in that tree.

A guardrail (`lib/tasks/implement-guardrails.ts`) blocks a third launch when **two** agent runs are already active. It reads `GET /api/agent/runs?summary=1` (`activeCount`), not the terminal dock. If the summary cannot be read, the guardrail fails open. Server-side `DEVHUB_AGENT_MAX_RUNS` (default 6) is a separate cap.

The agent must ask before commit, PR, Jira transition, or completing the task. See [Notes System — Create tasks from plan](notes-system.md#create-tasks-from-plan) for the inverse flow (plan → tickets).

### Focus timer

Focused time is `timeSpentMs` on the item, plus a running start in gitignored `tasks/.local/timers.json`. Only **one** timer runs in that directory — starting another stops the current one and folds the elapsed time into `timeSpentMs`.

| Action      | API                                                     |
| ----------- | ------------------------------------------------------- |
| Start timer | `PATCH /api/tasks` with `{ id, timer: "start", date? }` |
| Stop timer  | `PATCH /api/tasks` with `{ id, timer: "stop", date? }`  |

Completing, abandoning, or deleting a task settles any running timer into `timeSpentMs`.

### History

`GET /api/tasks/history` projects items onto each day from `startDate` through `endDate` (today, if the task is still open). Summaries are `total`, `completed`, `abandoned`, `moved`, `modified`. Add `?date=YYYY-MM-DD` for one day, or `?includeTasks=1` for the tasks as well.

## Weekly Review

The **Weekly review** page (`/review`, linked from Tasks → History and ⌘P) is a retrospective view over the last seven calendar days ending on a chosen date. It is not the plan-loop `devhub-retro` skill (that one proposes skill edits from finished work — see [Plan loop — Retro](../guides/plan-loop.md#8-retro)).

| Surface     | Route                                  | Behavior                                                                              |
| ----------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| Weekly review page | `/review`                       | Per-day created/completed/abandoned/moved bars, window totals, and a **slipped** list |
| API         | `GET /api/tasks/weekly?end=YYYY-MM-DD` | Same data as JSON; `end` defaults to today                                            |
| MCP         | `tasks_weekly`                         | Dashboard-backed proxy of the weekly route                                            |

**Slipped tasks** are still open with a `startDate` before that day. The same normalised text on three or more days in the window is listed (`SLIP_THRESHOLD = 3`). Two different tasks with the same text are grouped.

Pair with [Standup](../guides/standup.md) for daily forward-looking summaries; Weekly review is the backward-looking complement.

### Daily review reps

A **daily review rep** is one AI-free PR review per calendar day, then an optional compare-and-grade against the agent. The card lives on `/review`; the workout is `/review/rep`.

| Step | What happens |
| ---- | ------------ |
| Start | `POST /api/reps` `{ action: "start", pr }` picks today's PR (defaults to the top review-requested row). Idempotent — once a day has a pick, it sticks. Swap with `{ action: "repick", pr }` only before findings are saved. |
| Solo review | You read the diff (`GET /api/reps/diff?repo=&number=`) and write findings. Saving (`{ action: "save", findings }`) sets `completedAt` — that is what the streak counts. |
| Compare & grade | After findings are saved, **Review with agent** is unlocked for that PR. `{ action: "grade", caught, missed }` records how many agent findings you already had vs missed. Grading is optional and does **not** affect the streak. |

State is one JSON file per day under `reps/YYYY-MM-DD.json` (override with `REPS_DIR`). Stats (`streak`, last 35 days) come from those files. `reps/` is personal data — it is **not** in `sync_notes_tasks_push` paths, so a default in-repo `reps/` folder shows up as other dirty files until you commit it through Repo Git or relocate `REPS_DIR`.

On `/prs`, if today's unfinished rep is a review-requested PR, that row's **Review with agent** action is replaced with **Finish your daily rep first**.

## Agent CLI

In-app generation uses the CLI or HTTP provider selected under **/setup → AI Provider**. The resolver lives in `apps/ui/lib/ai/preference.ts`; the settings API is `GET/PUT /api/agent-cli`.

Coding work — implementation, PR review, schedules and MCP `agent_dispatch` — goes through **Paseo** (`POST /api/agent/runs`). `launchAgentJob` opens the Agents handoff sheet for those jobs; ordinary terminal commands use the propose chip.

See [Terminal and agent CLI — Agent CLI selection](../guides/terminal-and-agent-cli.md#agent-cli-selection) for generation settings and [Agents (Paseo)](../guides/paseo-agents.md) for coding runs.

## Pull Request Reviews

**PRs** (`/prs`, gated on `github`) reads `GET /api/github/prs` — authored PRs, review-requested PRs, and recently reviewed PRs (archived repos filtered from active queues; up to 100 rows per active bucket). Tabs: **Mine**, **Review requested**, **Recently reviewed**, **Skipped**, and **Worktrees** (`?tab=cleanup`). The screen search box filters those buckets client-side or pins a pasted PR URL; unmatched phrases fall back to `GET /api/github/prs/search` (**Elsewhere on GitHub**). See [GitHub — Search and pin](../integrations/github.md#search-and-pin) and [Finished worktrees](../integrations/github.md#finished-worktrees).

The **Review with agent** row action does **not** call a GitHub review API. It opens the Agents handoff sheet (`launchAgentJob` → `openAgentHandoff` → `POST /api/agent/runs`) and starts a Paseo agent with the `pr-explain-review` skill. The skill pulls conversation, inline review threads, and the linked Jira/GitHub ticket, then saves a note at `pr-reviews/<owner-repo-slug>-<pr-number>` via notes MCP. The **Notes** link polls `GET /api/notes/pr-reviews/<slug>` every few seconds until the note exists. There is no dashboard **Request review** action.

Full workflow, constraints, and troubleshooting: [GitHub integration](../integrations/github.md#row-actions).

PR review notes include a `## Links` EntityRef back to the PR (same contract as task and meeting notes). The note editor footer shows inbound and outbound relations via **EntityRelationsPanel**.

## Cross-entity linking

Tasks, calendar events, PRs, and notes share hop-around links through the `EntityRef` contract (`packages/shared/entity-note/`). UI entry points:

| Area                          | Actions                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Work → Tasks**              | **Note** opens or creates `task-notes/…`; **Link** opens searchable pickers for PR/calendar/note/repo/Jira/task refs; type `@` in the composer to search the same lists and attach a chip (calendar events are left out of `@`); overflow holds secondary actions |
| **Calendar** | Meeting **Note** button; link chips on events                                                                                                          |
| **PRs**                       | Review note action; link chips on PR rows                                                                                                              |
| **Notes** editor              | Relations panel; **Open with** / **Apply Cursor changes** when the note links a local repo (persistent Markdown working copies)                         |

Stable path conventions, `## Links` format, API, and MCP tools: [Notes System — Cross-entity linking](notes-system.md#cross-entity-linking). Cursor working-copy workflow: [Notes System — Cursor note working copies](notes-system.md#cursor-note-working-copies).

## Capability Radar

**Library → Radar** (`/radar`) combines an automated capability scan with a personal technology radar you maintain by hand.

| Surface         | Route / tool                                                                                                                      | Behavior                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability scan | `GET /api/capability/radar`, MCP `capability_radar`                                                                               | Latest snapshot, diff (added/spread/removed/drift), knowledge-drift rows. **Seen** / **Undo** on drift rows uses the same watermark store as Release Radar — rows hide at or below the acknowledged magnitude and resurface when they spread further. |
| Personal strip  | `GET /api/radar/personal`                                                                                                         | Parses `notes/radar/personal-radar.md` into adopt / trial / assess / hold items; when any owned repo needs attention, also lists **Owned repositories** rows (`ownedRepoAttention`) linking into `/own/<owner>/<name>` |
| Scan action     | `POST /api/capability/scan`, MCP `capability_scan`                                                                                | Full scan; writes dated snapshot under `notes/.cache/capability/`                                                                                                       |
| Weekly digest   | `POST /api/capability/digest`, job `capability_digest`                                                                            | Generate or return digest markdown                                                                                                                                      |
| Build lab       | Agent CLI + `capability-lab` skill (`GET /api/capability/journey/plan` → terminal handoff → `POST /api/capability/journey/adopt`) | Generation runs in the terminal; `POST /api/capability/journey` and MCP `capability_get_lab` only **fetch** an existing lab. Notes land under `notes/learnings/labs/…`. |

### Personal radar file

The top strip on `/radar` is **not** generated by the capability scan. Edit `notes/radar/personal-radar.md` (or follow the in-app link) using four `##` headings — **Adopt**, **Trial**, **Assess**, **Hold** — with bullet items under each. The parser is case-insensitive on headings and accepts `-` or `*` bullets. An empty or missing file shows the empty-state prompt unless owned-repo attention rows are present — then the **Owned repositories** strip still renders.

See [Capability Radar plan](../archive/capability-radar-plan.md) for scan architecture and lab workflow.

## Databases

**Tools → Databases** (`/db`, desktop nav, ungated) is the in-app client for PostgreSQL, MongoDB, and SQLite. Connections come from a local provider (hand-added + discovered `.db` files) and from a plugin `dashboard.connections` module (Infrastructure RDS/Atlas). The MCP `db_*` tools share the same pool and write gate. Full architecture: [Database client](database-client.md).

## Recall

**Recall** (`/recall`) is palette/legacy, not a sidebar slot — Search is the unified-discovery entry. The page is the interactive face of the derived memory layer described in [Recall](recall.md). It ranks passages from notes, docs, learnings, diagrams, task history, and the append-only event spine with hybrid BM25 + vector fusion, a token budget slider, and per-hit score breakdown.

| Surface | Route / tool | Behavior |
| ------- | ------------ | -------- |
| Recall page | `/recall` | Query UI with budget and keyword↔vector blend; per-signal score breakdown. `grade.verdict` is API/MCP-only today — the UI does not surface it yet. |
| Index status | `GET /api/recall/index` | Manifest, staleness flag, and event count for the panel header |
| API | `GET /api/recall?q=` | JSON hits plus `grade.verdict` (`answerable` / `weak` / `no-evidence`); `format=markdown` adds a pre-rendered block for clipboard or agents |
| Graph | `GET /api/recall/graph?entity=` | Entity neighbourhood lookup (MCP `recall_graph`); not shown in the `/recall` UI |
| Index | `POST /api/recall/index` | Rebuild the gitignored index under `notes/.index/recall/` (safe to delete anytime) |
| MCP | `recall`, `recall_graph`, `recall_remember`, `recall_index` | Agent-facing retrieval and event append |

The context pack (`GET /api/context-pack`) also calls `recall` internally when ranking learnings for the day's standup query. See [API Routes](../reference/api-routes.md).

## Own (repo ownership)

Ownership radar lives on **Repos** (`/repos?view=owned`, gated on GitHub). Per-repo pages stay at `/own/<owner>/<name>`. Mark repos owned from a Repos card or the owned index; state lives in `.devhub/ownership/repos.json` (not hand-edited). Full workflow: [Repo ownership](../guides/repo-ownership.md).

## Notifications

Home (`/`) redirects to Work (`/work`). Notifications are the top-bar bell: a count badge (red when an urgent item is unread) that opens a popover with the recent items, their reasons and per-item open/dismiss. `/notifications` and `/briefing` redirect to `/work`; recognised legacy queries and hashes on `/` and `/today` still map to their existing destinations first. There is no notifications page or sidebar row.

The feed groups PR reviews and changes, failing CI, agent runs needing input or failing, Datadog alerts, plugin items and plugin trust issues. Read, Dismiss and Restore apply to the current item version: changed content can surface again. The **Only repos I own** setting keeps the existing `needsYouOwnedReposOnly` preference. Unknown ownership shows everything. The popover carries a **Show** group of toggles (Pull requests, CI failing, Agent needs input, Plugins, Datadog on-call); source preferences live in `ui-prefs.json` under `notificationSources` and are applied to the feed server-side, so the badge and list stay consistent.

URGENT items used to get a global alert bar above page content; that bar is gone — the bell communicates the same thing without staking out the top of every route. Datadog is queried only when configured and confirmed on call. Meetings remain on Calendar and its nav badge; they are not notifications.

Each source is best-effort and reports `ok`, `degraded` or `off`, so an unavailable integration is labelled rather than treated as an empty inbox. The feed is derived on read. Read and dismissal versions live per profile in `~/.config/devhub/notifications.json`, beside `ui-prefs.json`; writes prune entries unseen for 30 days and retain at most 500 per profile.

Enabled plugins contribute through `plugin-needs/<plugin>.json`. Items may set `severity` to `info` (the default), `action` or `urgent`. Only enabled, trusted runtimes without `needs_attention` can contribute urgent items to the bar, capped at three per plugin. Other urgent contributions become action items in Notifications. DevHub's own plugin-trust alerts are separate.

Briefing generation, research, canvas, share and image APIs are removed. The `briefing_get` and `briefing_tasks` MCP tools are deleted without replacement.

## Repo Status And Content Sync

The dashboard keeps Git sync state visible without making every page own Git logic:

- `ContentSyncIndicator` is mounted in the desktop and mobile top bars. It polls `GET /api/status/git` every 30 seconds and hides itself when the repo is clean and up to date.
- The cloud button is for scoped content only: `notes/`, `collections/`, `tasks/`, `docs/`, and `upstarts/`. It runs the `sync_notes_tasks_push` action through `POST /api/scripts`. When content is clean but commits are unpushed, the cloud retries `push_unpushed_commits`.
- On the packaged desktop app, content sync (`sync_notes_tasks_push`), `update_and_sync`, and `sync_skills` read git state from the **linked checkout**, not app-data. Without a linked checkout they fail with "No linked git checkout". Attach via **View → Attach to Dev Server…** or see [Scripts — Linked checkout requirement](../reference/scripts.md#linked-checkout-requirement).
- The warning triangle opens the **Repo Git workspace** for non-content dirty files and merge conflicts, or runs `update_and_sync` when only **origin** commits are waiting (clean tree). Pre-push hook failures surface a **GitHookFailureDialog** with log excerpts and a copyable agent fix-it prompt.
- **Origin vs public core:** `update_and_sync` pulls/rebases from `origin` (your private mirror remote). Porting changes from the public template uses `pull_core` / `pull_core_preview` via `POST /api/scripts` → `scripts/devhub-update.sh`. **Backport** (`scripts/devhub-backport.sh`) is intentionally CLI/skill-only — there is no dashboard API. See [Fork workflow](../contributing/fork-workflow.md) and [Scripts](../reference/scripts.md).
- The Status page is the runbook surface. It shows repo branch, dirty content vs other dirty paths, ahead/behind counts, latest failed sync logs, conflict resolution, skill sync health, service status and MCP runtime status.
- The MCP panel (`GET /api/status/mcp`) lists each server under `mcp/shared/` only — not plugin or personal catalog entries. It reports whether each server's launch command resolves and how many matching processes are running. Bare command names such as `npx`, `tsx`, or `uvx` count as present when they resolve on `PATH`; only absolute or relative command paths must exist on disk. Idle servers are normal — MCP clients start stdio servers on demand. Plugin and personal MCP servers sync to Cursor/Claude/etc. but do not appear here; troubleshoot those via the AI client's MCP logs and `npm install` inside the plugin's `mcp-servers/<name>/` package. **Catalog editing** (`/api/mcp*`) is separate from runtime status — use **Agents → MCP** to add or edit repo/personal entries.

### Status page runbook

The Status page (`/status`) aggregates Git, sync, services, and infra into one operational view:

| Section                | What it shows                                                                                                                        | Primary actions                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health summary         | Aggregates stopped peer services, non-content dirty paths, behind count, merge conflicts, missing MCP binaries, and last failed sync | Banner turns amber when any item is present                                                                                                                                                                                                                                                                                 |
| Repo                   | Branch, content vs other dirty counts, ahead/behind, last commit                                                                     | **Sync** runs `update_and_sync` on a clean tree; **Commit & sync…** chains `commit_dirty_push` then `update_and_sync` when dirty                                                                                                                                                                                            |
| Merge conflicts        | Files with conflict markers under scoped content paths                                                                               | Inline edit via `ConflictResolverPanel`                                                                                                                                                                                                                                                                                     |
| Skill sync             | `GET /api/sync-health` plus preview diffs when unhealthy                                                                             | Links to Agents library; see [Skills guide](../guides/skills.md#sync-preview-before-sync)                                                                                                                                                                                                                                   |
| Services               | **Agents workspace** card: whether the Paseo daemon answers (`GET /api/status/services`)                                              | Connected / not connected; restart from **Agents → Connection**                                                                                                                                                                                                                                                              |
| MCP                    | Runtime scan of `mcp/shared/` only                                                                                                   | Idle = normal; missing binary = warning                                                                                                                                                                                                                                                                                     |
| External commands      | `GET /api/status/exec` — in-flight `execExternal` calls, slow recent ones, and in-flight DB queries                                  | Hidden when idle. An **overdue** row names the command (or query) holding things up. MCP: `status_exec`. See below.                                                                                                                                                                                                         |
| Dashboard rebuild      | `GET/POST /api/status/dashboard/rebuild`                                                                                             | **Rebuild & restart** builds Vite in the linked checkout and restarts core through the supervisor. Unavailable when the desktop shell supervises the server (`DEVHUB_SHELL_SUPERVISED=1`) or in a packaged app — use **View → Rebuild Dashboard…** or **Check for Updates** instead. Reopening DevHub does **not** rebuild. |

Failed sync runs surface from `GET /api/scripts/history` with log detail from `GET /api/scripts/runs/<runId>`. The **Agent prompt** button copies a fix-it prompt from the last 120 log lines for verify/pre-push failures.

### Desktop logs (`/logs`)

On desktop, **Settings → Logs** (`/logs`, also in ⌘P) tails the rotating log files under the OS app-data directory (`~/Library/Application Support/DevHub/logs/` on macOS). The page polls `GET /api/status/logs` every two seconds while **Live** is on, with filters for `shell`, `sidecar`, and `renderer` sources. **Open folder** calls the Tauri `open_logs` bridge when available. For startup failures before the dashboard loads, see [Desktop recovery](../guides/desktop-recovery.md).

The page reloads on manual refresh and polls Git, services and MCP every 30 seconds in the background.

Merge conflict recovery lives on Status through `ConflictResolverPanel`. It reads `GET /api/git/conflicts`, lets the user edit the conflicted file, and saves with `POST /api/git/conflicts`; the backend writes the resolved content and stages the file only after conflict markers are removed. The full content-sync runbook is in [Notes System -> Content sync workflow](notes-system.md#content-sync-workflow).

### When the dashboard hangs

One blocked subprocess blocks **every** route — "the app is dead" and "one `git`/`gh` call is stuck" look identical. Call `status_exec` (MCP) or `GET /api/status/exec` first; an entry with a large `runningMs` (especially `overdue: true`) names the command and cwd. Database queries report in the same payload (`dbQueries`, `dbSlowest`, `dbConnections`) because a stuck page looks the same from the outside. If that route itself does not answer, the event loop is already blocked — diagnose from `ps`/`lsof`, not by restarting blindly. Full ladder: skill `devhub-debug-hang`.

Every dashboard subprocess must go through `execExternal` (`lib/exec-external.ts`) with a timeout (default `DEVHUB_EXEC_TIMEOUT_MS`, 30s). There is no unbounded option. The Status **External commands** panel is idle-hidden; token-shaped args are redacted.

### Repo work hub

Click a card on `/repos` (or open `/repos/<name>`) for that clone's **work hub** — tasks, Jira, notes, PRs, and calendar clustered around the repo, plus inline git.

`GET /api/repos/<name>/work` fans out tasks, Jira, calendar (±14 days), and open PRs in parallel. A failed optional integration is listed in `degraded[]` (Jira / Calendar / GitHub) instead of rendering a bare empty state. Membership:

| Source   | Belongs to this repo when…                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| Task     | `kind: "repo"` EntityRef, or a `#repo` tag in the text                                                              |
| Note     | Path under `projects/<repo>`, a path segment matching the name, a `#repo` tag in the title, or a recall `repo:<name>` ref |
| Calendar | Repo link or `#repo` tag, and the event overlaps the ±14-day window                                                 |
| Jira     | In progress, or already tied to a repo-linked task                                                                  |

Clusters seed from repo-linked open tasks plus in-progress Jira whose one-hop graph touches the repo. Leftovers (tasks, notes, PRs, events) and open-but-not-in-progress tickets sit in **Backlog**. Finished tasks (up to 200) sit in **Done**. The composer at the top of Active work `POST`s a task with a repo link already set.

Open PRs are partitioned mine/others; **Commits** is a collapsible History panel plus the same `RepoGitWorkspace` as the list-page **Open Git** control. Hub task rows can launch [Implement with agent](#implement-with-agent) with `cwd` pinned to this checkout.

The header **Terminal** split launches a dock tab in this checkout: a plain shell, or Claude / ChatGPT (Codex) / Antigravity (`agy --dangerously-skip-permissions`) / Cursor Agent / OpenCode. **IDE** still opens the desktop app. `⌘⇧T` is the shell; `⌘Enter` is upstart.

On the `/repos` list, chips filter **changed**, **unpushed**, and **worktree**. A worktree is a second checkout whose `.git` is a file pointing at another clone in the scan folder — `GET /api/repos` sets `worktreeOf` to that parent path. Cards show a `worktree of <parent>` chip so they are not mistaken for a stray clone with a detached HEAD (the old `.git/HEAD` read threw on worktrees and scored them as high-risk).

**Changed** (`dirtyCount`) matches the Git workspace: `.DS_Store`, `__pycache__`, `.pyc`, and `.terraform` do not count, and in the DevHub checkout vault content is excluded too (it uses content-sync). **Unpushed** is `0` when the current branch's upstream is gone (`[gone]` / deleted remote after merge) — `HEAD --not --remotes` used to count those commits as a push queue. Agent-run worktrees live under `<repos-dir>/.devhub-worktrees/<repo>/` (a hidden sibling, not listed as repos); clean them from [PRs → Worktrees](../integrations/github.md#finished-worktrees).

### Git hub (`/git`)

A cross-repo entry point: the left rail lists every clone in the scan directory with branch, ahead/behind, changed-file and conflict counts, last activity, and state filters (*Needs attention*, *Conflicts*, *Changed*, *Behind*, *Unpushed*, *All*). The right pane embeds the same `RepoGitWorkspace` used on `/repos/:name`, so there is one git UI, not two. Rows come from `GET /api/git/overview` — one `git status --porcelain=v1 -z --branch` per repo (not the heavier `/api/repos` card scan), cached 60s with a five-minute backoff for repos whose status times out. The sidebar **Git** row badges the number of repos needing attention.

Network operations stream progress: push/pull/fetch answer NDJSON progress frames (git's `--progress` stderr, throttled) followed by a done frame, and the header shows elapsed seconds plus the last line. A client disconnect aborts the process group. SSH commands run with `BatchMode=yes` and a 10s connect timeout so an unknown host key fails fast instead of waiting out the network ceiling.

Mutations serialize per repository through an in-process FIFO plus a cross-process directory lock (`<git-dir>/devhub-mutation.lock`). A killed child settles within two seconds, the lock wait is bounded at two minutes (warning logged), and a lease older than any legitimate operation is recovered — the lock cannot wedge the dashboard silently.

Large working trees stay responsive: diffs render 1,200 lines at a time and changed-file lists render 300 rows with a **Show more** row.

### Repo Git workspace

`RepoGitWorkspace` is the in-dashboard git UI for the DevHub checkout and every sibling repo on `/repos`. Open it from the top-bar warning control, a repo card's **Open Git** badge, or `/status` when code changes block sync.

A persistent **Git rail** on the left keeps branches, remotes, tags, and stashes visible regardless of which tab is open. Branch rows are drop targets for History-graph commit drags (cherry-pick / merge / rebase onto that branch).

| Tab       | Purpose                                                                                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Changes   | Stage/unstage (per file, hunk, or all), inline diff with **find** (`⌘F` / `Ctrl+F` while focused), scoped discard (staged vs unstaged — discarding one side does not wipe the other), **Usually changed together** coupling hints (historical co-change ratios from the last 800 commits — advisory, not a gate), AI commit message, commit-only or commit-and-push |
| Branches  | Checkout, create, delete, rename, fetch, **pull rebase** / **pull merge**, push (with pre-push hook failure handling), merge/rebase onto another branch; **Remotes** section to add/rename/remove remotes and set fetch/push URLs |
| Stash     | List, apply, pop, drop; stash conflicts open the terminal with a resolve command                                                                                                          |
| History   | Commit graph (windowed for large repos) with **trusted avatars** per author (see below), branch relation banner (ahead/behind upstream) with inline **Fetch** / **Pull** / **Pull rebase**, author/search filters, commit detail with file list + diff + **commit context** chips (Jira keys, local PR review notes) + per-commit CI (`GET …/git/ci?commit=`), per-commit actions (cherry-pick, revert, tag, detached checkout, reset, branch-from-commit, **Rewrite history from here…**), **Compare branch** range diff vs default remote branch, **Open with → Cursor** at a historical revision |
| Conflicts | Inline conflict editor (same semantics as Status); also handles rebase/cherry-pick/revert conflicts                                                                                       |
| Blame     | Searchable file picker (`GET /api/repos/<name>/git/files`), porcelain blame, commit context chips, **In History** handoff to the History tab, **Open with → Cursor** at the blamed revision |
| Worktrees | List linked worktrees, add/remove, lock/unlock, prune stale entries; sibling scan directory correctly resolves worktree `.git` pointers |
| Reflog    | Recent reflog with reachable vs **unreachable** commits flagged — recovery path after a bad reset |

**Diff panes** share a toolbar: context lines (default / none / full), maximize to a modal, and in-pane find. Split layouts (History file list ↔ diff, Stash list ↔ diff, range compare) are resizable; pane fractions persist in `localStorage`.

Press **`?`** while the Repo Git workspace is focused for its **context shortcuts** overlay (not the global app shortcuts from [Command palette](../guides/command-palette.md#keyboard-shortcuts)). Tab-aware bindings include History `j`/`k` commit navigation, split-pane resize (`Tab` to focus the handle, `←`/`→` resize, `Home`/`End` snap), and diff find (`⌘F` / `Ctrl+F` when a diff pane is focused). `Esc` closes the top-most dialog.

**Compare branch** (History tab) opens a range diff with `base...head` (defaults: `head=HEAD`, `base` = merge-base with the repo's default remote branch). The modal lists changed files; selecting one shows a unified diff with the same toolbar as commit detail. Ahead/behind counts in the banner reflect `head` vs `base`. API: `GET /api/repos/<name>/git/range?base=&head=&path=`.

**Rewrite history from here…** (History commit menu) opens a drag-to-reorder planner for every commit newer than the chosen base. Ops are `pick` / `reword` / `fixup` / `squash` / `drop`. The server runs a scripted `git rebase -i` (`POST /api/repos/<name>/git/rebase-interactive`) with a generated todo file — `sequence.editor` overwrites the todo, `core.editor=true`, so no editor or TTY ever opens. Requires a checked-out branch and a clean tree; merge commits cannot be the base; squash/fixup cannot be the first step. Conflicts return `409 stash_conflict` and open the Conflicts tab.

**Undo** is a workspace chip for the last action **DevHub itself performed** (commit, cherry-pick, revert, pull-merge). It is not reflog archaeology. Soft undo is `git reset --soft HEAD~1` (`POST …/branches` `undo-commit`); hard undo is `reset-to-commit` with a backup branch first. The stack lives in `sessionStorage`, capped at 5, per repo — a private-mode or evicted tab just hides the chip.

**Usually changed together** (Changes tab) calls `GET /api/repos/<name>/git/coupling?paths=` for staged/unstaged paths. Suggestions come from the last 800 non-merge commits (5-minute in-process cache). Each hint shows how often the suggested file changed in the same commit as your selection — advisory, not a linter rule.

**Commit context** joins git history to local reasoning: `GET /api/repos/<name>/git/commit-context?commit=` parses the commit subject/body for PR numbers and Jira keys, then matches review notes under `notes/pr-reviews/` (`pr` = same PR, `ticket` = same Jira key, `related` = same ticket in a different repo). Chips appear on History commit detail and Blame. Hosted GitHub doesn't resolve these local note paths; DevHub joins the records locally. See [GitHub integration — Review notes in Git history](../integrations/github.md#review-notes-in-git-history).

**Commit avatars** resolve through a trusted CDN allowlist (`lib/people/avatar-trust.ts`). For commit history, `GET /api/repos/<name>/git/people` merges contributor identities across email aliases (GitHub login first, then display-name heuristic); History and the commit graph load avatars from that map with client-side GitHub noreply and Gravatar fallbacks (`lib/people/identity.ts`). Email-only surfaces (calendar organizers, Jira tickets) use `GET /api/people/avatar?email=` for Jira/Atlassian avatars only. Untrusted URLs are rejected — initials render instead. Click an avatar to open a full-resolution variant when the host supports it.

When the checkout is on a feature branch with an open GitHub PR, the workspace header and `/repos` cards show a compact PR link plus rolled-up CI state (`passing` / `failing` / `pending`) from `GET /api/repos/<name>/pr` (requires `gh auth login`; skipped on the repo's default branch).

API routes are scoped under `/api/repos/<name>/git/…` (and branch push/pull under `/api/repos/<name>/branches`). See [API Routes](../reference/api-routes.md#git-hub-and-repo-git-routes).

**DevHub-only:** content paths (`notes/`, `tasks/`, `collections/`, `upstarts/`, `docs/`, `diagrams/`, plus env-resolved content dirs) are classified by `lib/content/sync-dirs.ts` and **hidden from the Changes list** in the DevHub repo. Scoped sync (`sync_notes_tasks_push`) stages `notes/`, `collections/`, `tasks/`, `docs/`, `diagrams/`, and `upstarts/`.

Root `diagrams/` is included in scoped content sync alongside diagrams in the notes vault. `reps/` is outside scoped sync, but remains visible in Repo Git; commit it there or manually, or move it with `REPS_DIR`. Sibling repos show every file.

| Problem                                | What to do                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.lock` / "could not write index" | Another git process may be running, or a prior command left `.git/index.lock`. DevHub never deletes the lock for you — confirm no git is active, remove the lock manually, retry.                                                                                                                                                                                                                       |
| Pre-push verify failed                 | Read the hook output in **GitHookFailureDialog** or Status → failed sync logs. Full output is also written to `.git/devhub-hook-failure.log` in the repo. Fix lint, typecheck or test failures locally (`npm run verify`), or use **Agent prompt** / the `git-hook-fix` terminal handoff for an agent fix. CI checks the build separately. Emergency bypass: `DEVHUB_SKIP_VERIFY=1 git push` (see [Scripts](../reference/scripts.md#git-hooks)). |
| Stash apply left conflicts             | The terminal drawer opens with the `git-conflict-resolve` skill preloaded. Resolve markers, then retry apply/pop from the Stash tab.                                                                                                                                                                                                                                                                    |
| Interactive rebase conflicted          | Conflicts tab opens (`409 stash_conflict`, `action: "rebase"`). Ours is the target branch; theirs is the commit being replayed. Abort or continue from that tab.                                                                                                                                                                                                                                      |
| Undo chip missing                      | Expected: only actions DevHub performed in this tab are undoable, and the stack is `sessionStorage` (gone in private mode). Use Reflog for anything else.                                                                                                                                                                                                                                              |
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
