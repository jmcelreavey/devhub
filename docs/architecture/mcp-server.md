# MCP Server

DevHub ships a local stdio MCP server so AI tools can use DevHub through stable local tools instead of scraping the dashboard UI.

MCP stands for Model Context Protocol. In this repo, the canonical server is `mcp-servers/devhub-server/src/mcp.ts`, launched from the shared config at `mcp/shared/devhub.json`.

## Runtime model

The server has two tool tiers:

| Tier | Requires dashboard? | Source of truth | Tool groups |
| ---- | ------------------- | --------------- | ----------- |
| Filesystem-backed | No | Local files under `notes/`, `docs/`, and `tasks/` | Notes, docs, tasks, diagrams, appraisal |
| Dashboard-backed | Yes, default `http://localhost:1337` | Dashboard API routes and runtime state | Status, scripts, briefing, calendar, work, repos, Datadog, asset inventory, full search |

Filesystem-backed tools talk directly to disk and work headless. Dashboard-backed tools proxy through the local dashboard because the dashboard owns runtime-only state: script run history, peer service status, loaded integration secrets, repo scans, and work integration APIs.

If a dashboard-backed tool cannot reach the dashboard, it returns a clear MCP error telling the caller to start DevHub with `npm run dev` or set `DEVHUB_BASE_URL`.

## Configuration

The shared MCP config defines the launch command and environment placeholders:

```json
{
  "command": "REPO_ROOT/mcp-servers/devhub-server/node_modules/.bin/tsx",
  "args": ["REPO_ROOT/mcp-servers/devhub-server/src/mcp.ts"],
  "env": {
    "NOTES_DIR": "REPO_ROOT/notes",
    "TASKS_DIR": "REPO_ROOT/tasks",
    "DOCS_DIR": "REPO_ROOT/docs",
    "DEVHUB_BASE_URL": "http://localhost:1337"
  }
}
```

The sync engine substitutes `REPO_ROOT` and writes tool-specific configs for Cursor, Claude, Codex, and OpenCode. Users normally do not start the MCP process manually; the AI tool starts it on demand.

## Tool surface

Tool names are grouped by domain and use the `<domain>_<verb>` convention where possible.

| Domain | Tools | Notes |
| ------ | ----- | ----- |
| Notes | `notes_list`, `notes_read`, `notes_write`, `notes_write_asset`, `notes_append`, `notes_search`, `notes_delete` | Converts between BlockNote JSON and readable Markdown-like text. Workspace list/search is intentionally scoped; explicit paths can still read/write other note trees. |
| Docs | `docs_list`, `docs_read`, `docs_write`, `docs_append`, `docs_search`, `docs_delete` | Reads and writes Markdown files under `docs/`. |
| Tasks | `tasks_list`, `tasks_create`, `tasks_update`, `tasks_delete`, `tasks_history` | Uses daily JSON task files under `tasks/`. |
| Diagrams | `diagrams_list`, `diagrams_read`, `diagrams_create`, `diagrams_update`, `diagrams_add_note`, `diagrams_delete`, `diagrams_rename` | Stores tldraw JSON through the notes storage layer. |
| Appraisal | `appraisal_record`, `appraisal_set_goal`, `appraisal_list_goals`, `appraisal_read`, `appraisal_list`, `appraisal_people`, `appraisal_summarize`, `appraisal_delete` | Captures review evidence under `notes/appraisal/...`; see [Notes System](notes-system.md#appraisal-notes). |
| Status | `status_services`, `status_git`, `status_mcp`, `services_restart` | Dashboard-backed. Shows local service, git, and MCP process state; restart requires confirmation. |
| Scripts | `scripts_list`, `scripts_run`, `scripts_run_status`, `scripts_history` | Dashboard-backed. Mutating scripts require confirmation and return a `runId` to poll. |
| Briefing/calendar | `briefing_get`, `calendar_week`, `calendar_list` | Dashboard-backed. Uses dashboard integrations and daily briefing cache. |
| Work | `prs_list`, `jira_tickets`, `jira_ticket_get`, `jira_ticket_transition`, `standup_markdown`, `tasks_weekly` | Dashboard-backed. GitHub needs `gh` auth; Jira needs `/setup` configuration. |
| Repos | `repos_list`, `repos_open`, `repos_clone`, `repo_learn` | Dashboard-backed local repo inventory and repo learning context packs. |
| Datadog | `datadog_oncall`, `datadog_recent_alerts`, `datadog_investigate` | Dashboard-backed and only useful when Datadog env vars are configured. |
| Inventory/search | `assets_list`, `search` | Dashboard-backed asset catalog and full notes/docs search. |

BI-specific MCP tools are contributed by the private BI plugin as a separate server; they are not part of the core DevHub server.

## Storage model

The MCP server uses local files, not a database.

| Data | Default path | Format |
| ---- | ------------ | ------ |
| Notes | `notes/` | BlockNote JSON |
| Docs | `docs/` | Markdown (`.md`) |
| Tasks | `tasks/` | JSON files grouped by date |
| Diagrams | under notes storage | tldraw JSON |
| Appraisal | `notes/appraisal/self/<year>.json`, `notes/appraisal/people/<slug>/<year>.json` | BlockNote JSON rendered as structured Markdown by MCP |

Core vault filesystem logic lives in [`shared/vault/`](../../shared/vault/README.md) and is shared by the dashboard and MCP server. The MCP server runs as plain Node and imports shared code with relative paths, not dashboard `@/` aliases; tool-launched Node processes do not resolve Next.js aliases.

## Confirmation and long-running actions

Dashboard-backed tools follow two operational contracts:

- **Confirmation:** tools that mutate runtime or external state require `confirm: true`. Examples: `services_restart`, mutating `scripts_run` entries, and `jira_ticket_transition`.
- **Polling:** long-running actions return a `runId`. Call the matching status tool, such as `scripts_run_status`, until the run exits. MCP cannot stream the dashboard's live run log.

This keeps accidental service restarts or external workflow changes out of normal chat flow.

## Common workflows

### Read or update docs from an agent

1. Use `docs_search` or `docs_list` to find the page.
2. Use `docs_read` to load the current Markdown.
3. Use `docs_write` only after merging your intended change into the full current content.

`docs_write` is a full-file replacement, not a patch API.

### Run a dashboard action

1. Start the dashboard with `npm run dev`.
2. Call `scripts_list` and inspect whether the target action mutates state.
3. Call `scripts_run` with the script id. Add `confirm: true` only after checking the listed effects.
4. Poll `scripts_run_status` with the returned `runId`.

### Check local health from an agent

Use `status_services`, `status_git`, and `status_mcp` when the dashboard is running. Use these for operational context; they are dashboard-backed because they inspect live process and repo state.

## Setup and troubleshooting

| Symptom | What to check |
| ------- | ------------- |
| MCP server does not start | Install server deps with `npm install --prefix mcp-servers/devhub-server`, then sync MCP configs from the dashboard or setup scripts. |
| Dashboard-backed tools say DevHub is unreachable | Start the dashboard with `npm run dev`, or set `DEVHUB_BASE_URL` if it runs somewhere other than `http://localhost:1337`. |
| Filesystem tools use the wrong vault | Check `NOTES_DIR`, `TASKS_DIR`, and `DOCS_DIR` in the generated MCP config. |
| Work tools return auth/setup errors | GitHub PR tools need `gh auth login`; Jira and Datadog tools need their integrations configured in `/setup` or env vars. |
| A plugin MCP tool is missing | Check plugin registration in `~/.config/devhub/plugins.json`, then run the sync action so plugin MCP configs are materialized. |

## Safety model

The core server is scoped to configured DevHub directories and dashboard APIs. It is not a general-purpose filesystem API.

Keep secrets out of notes and docs unless you intentionally want them committed in this private mirror. Public/template backports must still respect the personal-data boundary in `CONTRIBUTING.md`.
