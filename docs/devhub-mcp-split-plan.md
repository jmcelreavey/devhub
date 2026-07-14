# DevHub MCP Split & Expansion — Refactor Plan

Splitting today's single `notes-server` into two MCP servers — **DevHub MCP** (core) and
**DevHubBI MCP** (plugin) — and growing both well beyond notes so the agent can *do* what the
dashboard does: run Ops scripts, switch the dev profile, drive briefings, calendar, work, PRs,
agents, and more.

Status: **BI extract shipped** (2026-07-14). Core `mcp-servers/devhub-server` has no BI tools;
`devhub-bi/mcp-servers/devhub-bi-server` + `mcp/devhub-bi.json` contribute via plugin
`contributes.mcp`. Core dashboard-proxy expansion beyond BI remains incremental.

---

## 1. Where we are today

There is **one** MCP server, `mcp-servers/notes-server`, already internally named `devhub`
(v3.0.0). It registers five tool families, all of which talk **directly to the filesystem**
through `shared/vault/` and local storage classes — no dashboard required:

| Family | Tools | Backing |
|---|---|---|
| Notes | `notes_list/read/write/append/search/delete/write_asset` | `NotesStorage` → `notes/` (BlockNote JSON) |
| Docs | `docs_list/read/write/append/search/delete` | `VaultStorage` → `docs/` (Markdown) |
| Tasks | `tasks_list/create/update/delete/history` | `TasksStorage` → `tasks/` |
| Diagrams | `diagrams_list/read/create/update/add_note/delete/rename` | `DiagramsStorage` (tldraw JSON) |
| Appraisal | `appraisal_record/set_goal/list_goals/read/list/people/summarize/delete` | `appraisal.ts` over notes |

It is wired from `mcp/shared/notes.json` (REPO_ROOT-substituted at sync/bootstrap time into
per-tool MCP configs) and documented by the `devhub-notes-mcp` skill.

**Everything else the dashboard can do lives only in Next.js API routes** at `localhost:1337`
— roughly 90 routes. The agent currently has no programmatic handle on any of it:

- **Scripts / sync** — `/api/scripts` (+ `runs`, `stream`, `history`): the generic run
  registry behind the Actions page (`update_and_sync`, `commit_dirty_push`, `sync_skills`,
  `sync_agents`, `sync_mcp_servers`, `collect_*`, etc.).
- **Status / services** — `/api/status/{git,mcp,services}`, `/api/status/services/restart`.
- **Briefing** — `/api/dashboard/morning-briefing`, `/api/briefing/prefs`.
- **Calendar** — `/api/calendar/{week,calendars}`.
- **Work** — `/api/github/prs`, `/api/jira/{tickets,ticket/[key],…/transition}`, `/api/standup`.
- **Repos** — `/api/repos` (+ `clone`, `open`, `learn`, `compose-up`).
- **Asset management** — `/api/{agents,skills,mcp,persona,collections}`.
- **Datadog** — `/api/datadog/{oncall,recent-alerts,investigate,links}`.
- **Search** — `/api/search`.

**BI capabilities** are contributed by the `devhub-bi` plugin (gated `navGate: "bi"`) and live
under `app/ops`, `app/api/bi/**`, `lib/bi-*`, `lib/capi-*`, `lib/jumpbox-*`:

- **Profile** — `/api/bi/aws-profile` (POST switches `AWS_PROFILE`, persists to `.env.local`,
  re-syncs the dashboard process env; `confirmDangerous` for prd).
- **CAPI** — `/api/bi/capi/{scripts,preflight,run,runs,stream,workflow}`.
- **Access** — `/api/bi/{jumpbox,rds,mongo,eks,services,iam-config,user-email}`.

The split has been anticipated: `devhub-bi/README.md` already lists the `/ops` module +
`api/bi/**` as "not yet extracted (pending docs/notes plugin-awareness in core)."

---

## 2. Architecture decision — hybrid (fs-direct + dashboard HTTP proxy)

Two honest options were on the table; we are taking the hybrid.

- **Filesystem-direct tools** (no dashboard dependency) — notes, docs, tasks, diagrams,
  appraisal. These are pure file I/O with no shared in-process state. **Keep them exactly as
  they are.** They must keep working headless (e.g. an agent session with the dashboard down).

- **Dashboard-proxy tools** (need the running dashboard) — scripts, sync, status, briefing,
  calendar, work/PRs, repos, asset management, datadog, and **all** BI ops. These proxy HTTP
  to `http://localhost:1337`.

**Why proxy instead of importing `lib/` and shelling out directly:** the state these features
mutate lives in the *dashboard process*, not on disk. The AWS profile switch rewrites the
dashboard's `process.env` and `.env.local` and re-syncs `syncBiProcessEnvFromOverrides`; the
script run registry (`running` set, run IDs, stream buffers) is in-memory in the Next server;
secrets are loaded once (1Password / AWS creds) by the dashboard. If the MCP shelled out in its
own process, switching the profile from the agent would **not** affect the dashboard the user is
looking at — guaranteed drift. Proxying keeps **one source of truth**.

**Same-origin is already satisfied.** Every mutating route calls `isSameOrigin(req)`, which
returns `true` when there is no `Origin` header. Node's `fetch` from the MCP process sends no
`Origin`, so server-to-server POSTs pass without any auth change. (We will still document this
and leave a hook for a future loopback token.)

**Dashboard-down behaviour.** A shared client turns `ECONNREFUSED` into a clear, actionable
tool error: *"Could not reach the DevHub dashboard at http://localhost:1337 — start it with
`npm run dev`."* — never a raw stack trace.

```
                          ┌──────────────────────────────┐
   agent (Claude/etc.) ──▶│  DevHub MCP (core)            │
                          │   • notes/docs/tasks/...  ────┼──▶ filesystem  (headless OK)
                          │   • scripts/status/work/  ────┼──▶ http://localhost:1337/api/*
                          │     briefing/calendar/repos   │        (dashboard = source of truth)
                          └──────────────────────────────┘
                          ┌──────────────────────────────┐
   (only when BI enabled) │  DevHubBI MCP (plugin)        │
                          │   • profile/CAPI/jumpbox/ ────┼──▶ http://localhost:1337/api/bi/*
                          │     rds/mongo/eks/iam         │
                          └──────────────────────────────┘
```

---

## 3. Target shape

### 3.1 Core: `mcp-servers/devhub-server` (renamed from `notes-server`)

Restructure the single `mcp.ts` into a thin entry + per-domain registrars so the file stops
being a 900-line wall and new domains are additive:

```
mcp-servers/devhub-server/
  src/
    mcp.ts                # entry: build server, call register*(), connect stdio
    context.ts           # { storage, docsStorage, tasksStorage, diagramsStorage, dash }
    dashboard-client.ts  # fetch wrapper for localhost:1337 (+ run-polling helper)
    tools/
      notes.ts  docs.ts  tasks.ts  diagrams.ts  appraisal.ts   # existing, moved verbatim
      scripts.ts   status.ts   briefing.ts   calendar.ts        # new (proxy)
      work.ts      repos.ts     assets.ts     search.ts          # new (proxy)
    storage.ts  task-diagram-storage.ts  appraisal.ts  convert.ts  # unchanged
```

Each registrar: `export function registerNotesTools(server, ctx) { … }`. `mcp.ts` calls them
in order; BI is *not* among them (it lives in the plugin server).

### 3.2 BI: `devhub-bi/mcp-servers/devhub-bi-server` (new, in the plugin)

Mirrors the dashboard split — the BI server ships **inside the plugin repo**, registered only
when the BI plugin is enabled. Same `dashboard-client.ts` pattern, all tools proxy `/api/bi/*`.

### 3.3 Plugin MCP contribution (the missing core mechanism)

Today plugins contribute `agents/` and `skills/` (`devhub-plugin.json` → `contributes`) and a
`dashboard` block. They **cannot** contribute an MCP server. We add that:

```jsonc
// devhub-bi/devhub-plugin.json
"contributes": {
  "agents": "agents/",
  "skills": "skills/",
  "mcpServers": "mcp-servers/"        // NEW
},
"mcp": {                              // NEW — manifest the sync substitutes + merges
  "devhub-bi": {
    "command": "REPO_ROOT/<plugin>/mcp-servers/devhub-bi-server/node_modules/.bin/tsx",
    "args": ["REPO_ROOT/<plugin>/mcp-servers/devhub-bi-server/src/mcp.ts"],
    "env": { "DEVHUB_BASE_URL": "http://localhost:1337" },
    "navGate": "bi",
    "description": "DevHub BI MCP — AWS profile, CAPI scripts, jumpbox, RDS/Mongo/EKS, IAM."
  }
}
```

Core's `mcp/shared/notes.json` is renamed `mcp/shared/devhub.json` (same content, `DEVHUB_BASE_URL`
added). The sync/collect path (`lib/sync-mcp.ts`, `lib/collect-mcp.ts`) learns to:

1. discover plugin-contributed MCP manifests (respecting the plugin `enabled` flag + `navGate`),
2. substitute `REPO_ROOT` / plugin path,
3. merge into the per-tool MCP configs with **core-wins-on-name-collision** (same rule as other
   plugin assets), and
4. run `npm install` for plugin MCP servers during bootstrap, like `notes-server` today.

---

## 4. New tool surface

Grouped, enum-driven tools (not one tool per script) to keep the context footprint small.
Destructive actions take an explicit `confirm: true` that maps to the route's
`confirmDangerous` / 409 contract. Long-running work returns a `runId` to poll — MCP can't
stream.

### DevHub MCP (core) — additions

| Tool | Maps to | Notes |
|---|---|---|
| `scripts_list` | `GET /api/scripts` | catalog + which are running |
| `scripts_run` | `POST /api/scripts` | `script` enum (`sync_skills`, `update_and_sync`, `commit_dirty_push`, …) + per-script opts; returns `runId` |
| `scripts_run_status` | `GET /api/scripts/runs/[runId]` | poll lines/exit; replaces the SSE stream |
| `scripts_history` | `GET /api/scripts/history` | recent runs |
| `status_services` / `status_git` / `status_mcp` | `GET /api/status/*` | health snapshots |
| `services_restart` | `POST /api/status/services/restart` | **confirm-gated** |
| `briefing_get` | `GET /api/dashboard/morning-briefing` | the morning briefing |
| `briefing_prefs` | `GET/PUT /api/briefing/prefs` | read/update prefs |
| `calendar_week` / `calendar_list` | `GET /api/calendar/*` | requires Google creds; clean unconfigured error |
| `prs_list` | `GET /api/github/prs` | open PRs |
| `jira_tickets` / `jira_ticket_get` | `GET /api/jira/*` | my tickets / one ticket |
| `jira_ticket_transition` | `POST /api/jira/ticket/[key]/transition` | move status; confirm-gated |
| `standup_markdown` | `GET /api/standup/markdown` | standup digest |
| `repos_list` | `GET /api/repos` | clones + app status |
| `repos_open` / `repos_clone` / `repo_learn` | `POST /api/repos/*` | actions; `repo_learn` returns `runId` |
| `assets_list` (`agents`/`skills`/`mcp`/`persona`) | `GET /api/{agents,skills,mcp,persona}` | inventory |
| `datadog_oncall` / `datadog_recent_alerts` / `datadog_investigate` | `GET/POST /api/datadog/*` | on-call + alerts |
| `search` | `GET /api/search` | global dashboard search |

### DevHubBI MCP (plugin)

| Tool | Maps to | Notes |
|---|---|---|
| `bi_status` | `GET /api/bi` | AWS identity, profile, kube context, dependency check |
| `bi_switch_profile` | `POST /api/bi/aws-profile` | **the "switch dev profile."** `profile` (e.g. `dev`, `prd-subscriptions`) + `confirm` for dangerous (prd) |
| `bi_clear_profile` | `DELETE /api/bi/aws-profile` | unset |
| `bi_capi_scripts` | `GET /api/bi/capi/scripts` | catalog |
| `bi_capi_preflight` | `GET /api/bi/capi/preflight` | can-run check |
| `bi_capi_run` | `POST /api/bi/capi/run` | returns `runId`; **confirm-gated** on prd |
| `bi_capi_run_status` / `bi_capi_runs` | `GET /api/bi/capi/{runs/[id],runs}` | poll / history |
| `bi_jumpbox_connect` | `POST /api/bi/jumpbox/connect` | confirm-gated |
| `bi_rds_credentials` / `bi_rds_verify` | `POST /api/bi/rds*` | read vs write access mode |
| `bi_mongo_info` / `bi_eks` / `bi_services` / `bi_iam_config` | `GET /api/bi/*` | access surfaces |

---

## 5. Cross-cutting rules

- **Confirmation contract.** Tools whose routes return 409 without `confirmDangerous` expose a
  `confirm: boolean`. Tool descriptions state the danger ("switching to a prd profile / running
  CAPI against prd / restarting services requires `confirm: true`").
- **Run polling.** `*_run` → `{ runId, initialLines }`; `*_run_status(runId)` → `{ lines, done,
  exitCode }`. No SSE in MCP.
- **Unconfigured integrations.** Calendar/Jira/Datadog tools surface the route's
  unconfigured state as a one-line "configure X in /setup" message, mirroring the dashboard's
  four-state widgets.
- **Secrets never leave the dashboard.** The MCP loads no 1Password/AWS creds; it only proxies.
- **navGate gating.** The BI server is absent entirely unless the BI plugin is enabled, so
  non-BI users carry zero BI tool surface (also keeps context small).
- **Backward compatibility.** Every existing tool name (`notes_*`, `docs_*`, `tasks_*`,
  `diagrams_*`, `appraisal_*`) is preserved unchanged. Bump the server to **4.0.0** for the new
  surface; the config file rename ships with a deprecation shim that still reads `notes.json`.

---

## 6. Phasing

**Phase 0 — Plugin MCP mechanism + design.** Extend `devhub-plugin.json` schema and the
sync/collect path to discover, substitute, merge, and `npm install` plugin-contributed MCP
servers (core-wins, navGate-/enabled-aware). Add fixtures + tests. *No tools change yet.*

**Phase 1 — Rename + modularize (regression-safe).** `notes-server` → `devhub-server`; split
`mcp.ts` into `tools/*` registrars moved verbatim; add `dashboard-client.ts` + `context.ts`.
Rename `mcp/shared/notes.json` → `devhub.json` (with shim). Update bootstrap/health-check
references and re-sync per-tool configs. Behaviour identical — pin with existing tests.

**Phase 2 — Core read-only proxy tools.** `status_*`, `briefing_get`, `calendar_*`, `prs_list`,
`jira_tickets/get`, `standup_markdown`, `assets_list`, `search`. Lowest risk (no mutation).

**Phase 3 — Core action tools.** `scripts_list/run/run_status/history`, `services_restart`,
`repos_open/clone/learn`, `jira_ticket_transition`, `briefing_prefs` write. Confirm-gating +
run polling.

**Phase 4 — BI server + read tools.** Scaffold `devhub-bi/mcp-servers/devhub-bi-server`, wire it
via the Phase-0 plugin contribution. Ship `bi_status`, `bi_capi_scripts/preflight/runs`,
`bi_services`, `bi_iam_config`, `bi_mongo_info`, `bi_eks`.

**Phase 5 — BI action tools.** `bi_switch_profile` (+ `bi_clear_profile`), `bi_capi_run` /
`bi_capi_run_status`, `bi_jumpbox_connect`, `bi_rds_*`. Confirm-gating on prd throughout.

**Phase 6 — Skills + docs.** Split `devhub-notes-mcp` into `devhub-mcp` (core) and a
plugin-owned `devhub-bi-mcp` skill carrying behaviour (when to switch profile, how run polling
works, danger semantics). Update `README.md`, `docs/architecture/plugins.md`, and remove the
"not yet extracted" caveat from `devhub-bi/README.md`.

**Phase 7 — Verification.** Per-tool smoke tests against a running dashboard; unit tests for
`dashboard-client` error mapping and run polling; `npm run typecheck`, `npm test`, `npm run
build`. A short manual matrix (dashboard up vs down; BI enabled vs disabled; prd confirm path).

---

## 7. Verification matrix (smoke tests)

| Check | How |
|---|---|
| fs tools headless | Stop dashboard → `notes_list`, `tasks_create` still work |
| dashboard-down error | Stop dashboard → `scripts_list` returns the "start with npm run dev" message, not a stack trace |
| same-origin pass | `scripts_run` from MCP succeeds despite `isSameOrigin` (no Origin header) |
| run polling | `scripts_run sync_skills` → `runId`; `scripts_run_status` reaches `done:true` |
| confirm gate | `bi_switch_profile prd` without `confirm` → 409-mapped "needs confirm"; with `confirm:true` → switches |
| state single-source | `bi_switch_profile dev` → dashboard `/ops` page shows `dev` after refresh |
| plugin gating | BI plugin disabled → BI tools absent from the MCP entirely |
| collision rule | Plugin tool named like a core tool → core wins at sync |
| backward compat | All `notes_*`/`docs_*`/`tasks_*`/`diagrams_*`/`appraisal_*` names unchanged |

---

## 8. Risks & open questions

- **Tool-count bloat.** ~25 core + ~13 BI tools. Mitigated by enum-driven grouping and keeping
  BI behind the plugin. Revisit if any single tool's schema gets unwieldy.
- **Long-running CAPI / learn runs.** Polling is coarser than the dashboard's SSE; acceptable
  for an agent, but set sane poll guidance in the skill.
- **Loopback auth.** No-Origin same-origin pass is fine for single-user localhost. If the MCP is
  ever exposed beyond the loopback, add a shared token header — leave the hook in
  `dashboard-client.ts`.
- **`compose-up` / destructive repo actions.** Decide which repo actions are MCP-exposed at all
  vs left dashboard-only (recommend: expose `open`/`clone`/`learn`, hold `compose-up` for v2).
- **Headless actions.** Confirmed out of scope: action tools require the dashboard; only fs
  tools run headless.

---

## 9. First concrete PRs

1. `feat(plugins): plugin-contributed MCP servers` — Phase 0 (schema + sync/collect + tests).
2. `refactor(mcp): notes-server → devhub-server, modular tools` — Phase 1 (no behaviour change).
3. `feat(mcp): core read-only dashboard tools` — Phase 2.

Each is independently shippable and leaves the existing notes MCP fully working.
